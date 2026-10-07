// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice / Receipt — Phase 2: payment date and invoice on the existing
// Membership screens. What is shown and which action is offered is decided in
// lib/invoices/membership-invoice.js (pure, tested directly); the components
// that use it are pinned structurally, the project's way for UI that cannot be
// rendered under node:test (see lib/schedules/details-page.test.js).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { formatDate } from "../format.js";
import {
  DOCUMENT_TITLE_LABEL,
  getFormPaymentDateState,
  getInvoiceSectionState,
  getPaymentDateState,
  paymentDateText,
  prepareIssueInvoiceInput,
} from "./membership-invoice.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Source with comments removed, so a pattern cannot match explanatory text.
const code = (path) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PAGE = "../../app/memberships/[id]/page.js";
const PANEL = "../../app/memberships/[id]/invoice-panel.js";
const ISSUE = "../../app/memberships/[id]/issue-invoice.js";
const FORM = "../../app/memberships/membership-form.js";
const EDIT = "../../app/memberships/[id]/edit/page.js";

const PAID = { id: "m1", payment_status: "paid", payment_date: "2026-10-01" };
const PAID_NO_DATE = { id: "m2", payment_status: "paid", payment_date: null };
const PENDING = { id: "m3", payment_status: "pending", payment_date: null };
const INVOICE = {
  id: "i1",
  document_title: "invoice",
  invoice_number: 1224,
  invoice_date: "2026-10-03",
  payment_date: "2026-10-02",
};

// ---- 1-3. payment date -------------------------------------------------------------------------

test("a Paid membership shows its payment date", () => {
  assert.deepEqual(getPaymentDateState(PAID), { kind: "recorded", date: "2026-10-01" });
  assert.equal(paymentDateText(getPaymentDateState(PAID)), formatDate("2026-10-01"));
});

test("a Pending membership does not show a payment date as if it were paid", () => {
  assert.deepEqual(getPaymentDateState(PENDING), { kind: "not-applicable", date: null });
  assert.equal(paymentDateText(getPaymentDateState(PENDING)), "Not applicable while payment is Pending");
  // Even a stray date on a non-Paid row is not presented as a payment date.
  assert.equal(getPaymentDateState({ payment_status: "pending", payment_date: "2026-10-01" }).kind, "not-applicable");
});

test("an existing Paid membership with no payment date shows the missing state — no date is invented", () => {
  const state = getPaymentDateState(PAID_NO_DATE);
  assert.deepEqual(state, { kind: "missing", date: null });
  assert.equal(paymentDateText(state), "Not recorded");
});

test("nothing in the presentation layer computes a date or reads the clock", () => {
  for (const path of ["./membership-invoice.js", ISSUE, PANEL, FORM]) {
    const text = code(path);
    assert.doesNotMatch(text, /new Date\(\)|Date\.now\(|toISOString|todayDateString|getCentreToday|centre_timezone/, path);
  }
});

// ---- 4-7. when Issue Invoice is offered ---------------------------------------------------------

test("Issue Invoice is offered only for a Paid membership with no invoice", () => {
  assert.equal(getInvoiceSectionState({ membership: PAID, invoice: null }).canIssue, true);
  assert.equal(getInvoiceSectionState({ membership: PAID_NO_DATE, invoice: null }).canIssue, true);
  assert.equal(getInvoiceSectionState({ membership: PENDING, invoice: null }).canIssue, false);
  assert.equal(getInvoiceSectionState({ membership: PENDING, invoice: undefined }).canIssue, false);
});

test("a membership with no payment date needs the Admin to confirm one; one with a date does not", () => {
  assert.equal(getInvoiceSectionState({ membership: PAID_NO_DATE, invoice: null }).needsPaymentDate, true);
  assert.equal(getInvoiceSectionState({ membership: PAID, invoice: null }).needsPaymentDate, false);
  assert.equal(getInvoiceSectionState({ membership: PENDING, invoice: null }).needsPaymentDate, false);
});

test("Issue Invoice requires a confirmed payment date when the membership has none — blank is refused, never defaulted", () => {
  for (const blank of ["", "   ", undefined]) {
    const result = prepareIssueInvoiceInput({ needsPaymentDate: true, paymentDate: blank, invoiceDate: "2026-10-05" });
    assert.deepEqual(result, { errors: { payment_date: "Confirm the payment date to issue this invoice." } }, JSON.stringify(blank));
  }
  const confirmed = prepareIssueInvoiceInput({ needsPaymentDate: true, paymentDate: " 2026-09-15 " });
  assert.deepEqual(confirmed, { input: { paymentDate: "2026-09-15", invoiceDate: null } });
});

test("an existing payment date is reused: it is never sent, so the Admin cannot replace it", () => {
  const result = prepareIssueInvoiceInput({ needsPaymentDate: false, paymentDate: "2020-01-01", invoiceDate: "" });
  assert.deepEqual(result, { input: { paymentDate: null, invoiceDate: null } });

  const dialog = code(ISSUE);
  // The date field is rendered only when one is needed; otherwise the existing date is named.
  assert.match(dialog, /\{needsPaymentDate \? \(\s*<FormField id="issue-payment-date"/);
  assert.match(dialog, /The recorded payment date \(\$\{paymentDateLabel\}\) will be used for the invoice\./);
});

test("the invoice date is optional: blank lets the database default it, a value is passed through", () => {
  assert.equal(prepareIssueInvoiceInput({ needsPaymentDate: false }).input.invoiceDate, null);
  assert.equal(prepareIssueInvoiceInput({ needsPaymentDate: false, invoiceDate: " 2026-10-06 " }).input.invoiceDate, "2026-10-06");
});

test("Issue Invoice disappears once an invoice exists, and a second one cannot be started", () => {
  for (const membership of [PAID, PAID_NO_DATE]) {
    const state = getInvoiceSectionState({ membership, invoice: INVOICE });
    assert.equal(state.hasInvoice, true);
    assert.equal(state.canIssue, false);
    assert.equal(state.needsPaymentDate, false);
  }
  // The panel only renders the action from `canIssue`.
  assert.match(code(PANEL), /state\.canIssue \? \(\s*<IssueInvoice/);
});

test("the Issue Invoice dialog follows the Cancel Membership pattern: the button only opens a confirmation", () => {
  const dialog = code(ISSUE);
  assert.match(dialog, /<ConfirmDialog/);
  assert.match(dialog, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(dialog, /onConfirm=\{runIssue\}/);
  // The action is called from Confirm only, inside a transition.
  assert.equal((dialog.match(/issueInvoice\(/g) ?? []).length, 1);
  assert.ok(dialog.indexOf("startTransition") < dialog.indexOf("await issueInvoice("));
  // The validation message for a missing date happens before any call.
  assert.ok(dialog.indexOf("prepareIssueInvoiceInput(") < dialog.indexOf("await issueInvoice("));
  // Errors from the database are shown against the field they belong to.
  assert.match(dialog, /error=\{fieldErrors\.payment_date\}/);
  assert.match(dialog, /error=\{fieldErrors\.invoice_date\}/);
  assert.match(dialog, /payment date[\s\S]*not filled in for you/i);
});

// ---- 8. invoice information ------------------------------------------------------------------------

test("an invoice's own values are shown — its payment date is the invoice's, not the membership's", () => {
  const state = getInvoiceSectionState({ membership: { ...PAID, payment_date: "2026-10-01" }, invoice: INVOICE });
  assert.deepEqual(state.paymentDate, { kind: "recorded", date: "2026-10-02" });

  const panel = code(PANEL);
  const withInvoice = panel.slice(panel.indexOf("{invoice ? ("), panel.indexOf(") : ("));
  assert.match(withInvoice, /label="Document Title"[\s\S]*DOCUMENT_TITLE_LABEL\[invoice\.document_title\]/);
  assert.match(withInvoice, /label="Invoice Number"[\s\S]*\{invoice\.invoice_number\}/);
  assert.match(withInvoice, /label="Invoice Date"[\s\S]*formatDate\(invoice\.invoice_date\)/);
  assert.match(withInvoice, /label="Payment Date"[\s\S]*formatDate\(invoice\.payment_date\)/);
  assert.doesNotMatch(withInvoice, /membership\./, "nothing in the invoice block is derived from the membership");
});

test("the document title reads Invoice or Receipt", () => {
  assert.deepEqual(DOCUMENT_TITLE_LABEL, { invoice: "Invoice", receipt: "Receipt" });
});

test("with no invoice the panel says 'Not issued' and does not show an invoice number or date", () => {
  const panel = code(PANEL);
  const without = panel.slice(panel.indexOf(") : ("));
  assert.match(without, /Not issued/);
  assert.doesNotMatch(without, /invoice\.invoice_number|invoice\.invoice_date/);
});

test("Membership Details loads the invoice from getInvoiceForMembership and renders the panel", () => {
  const page = code(PAGE);
  assert.match(page, /import \{ getInvoiceForMembership \} from "@\/lib\/invoices\/data";/);
  assert.match(page, /getInvoiceForMembership\(id\)/);
  assert.match(page, /<InvoicePanel\s+membership=\{membership\}\s+invoice=\{invoice\}/);
  // After the summary tiles and the save toast, before the existing panels.
  assert.ok(page.indexOf("<StatTileGroup") < page.indexOf("<InvoicePanel"));
  assert.ok(page.indexOf("<InvoicePanel") < page.indexOf('title="Covered Batch Enrollments"'));
});

// ---- 9-10. Paid -> Pending and the locked payment date ---------------------------------------------------

test("on the form the payment date is a read-only line — never a control, never sent", () => {
  const form = code(FORM);
  assert.doesNotMatch(form, /name="payment_date"|id="payment_date"/);
  assert.doesNotMatch(form, /payment_date:/, "the form's payload is unchanged");
  assert.match(form, /id="payment_date-note"[^>]*>\s*Payment date: \{paymentDateText\(paymentDateState\)\}/);
  assert.match(form, /aria-describedby="payment_date-note"/);
});

test("the payment date is shown as locked once an invoice exists", () => {
  const state = getFormPaymentDateState({ paymentStatus: "paid", membership: PAID, hasInvoice: true });
  assert.deepEqual(state, { kind: "locked", date: "2026-10-01" });
  assert.match(paymentDateText(state), /locked once the invoice is issued/);
  // Locked whatever the Payment Status select currently says.
  assert.equal(getFormPaymentDateState({ paymentStatus: "pending", membership: PAID, hasInvoice: true }).kind, "locked");

  assert.match(code(EDIT), /const hasInvoice = Boolean\(await getInvoiceForMembership\(id\)\);/);
  assert.match(code(EDIT), /hasInvoice=\{hasInvoice\}/);
});

test("before an invoice exists the line follows the selection, without inventing a date", () => {
  assert.equal(getFormPaymentDateState({ paymentStatus: "pending", membership: PENDING }).kind, "not-applicable");
  assert.equal(getFormPaymentDateState({ paymentStatus: "pending", membership: PAID }).kind, "not-applicable");
  assert.deepEqual(getFormPaymentDateState({ paymentStatus: "paid", membership: PAID }), { kind: "recorded", date: "2026-10-01" });
  assert.equal(getFormPaymentDateState({ paymentStatus: "paid", membership: PAID_NO_DATE }).kind, "missing");
  // Becoming Paid (Pending -> Paid, or a brand-new membership): the database records the date on save.
  assert.deepEqual(getFormPaymentDateState({ paymentStatus: "paid", membership: PENDING }), { kind: "on-save", date: null });
  assert.deepEqual(getFormPaymentDateState({ paymentStatus: "paid", membership: null }), { kind: "on-save", date: null });
  assert.equal(paymentDateText({ kind: "on-save", date: null }), "Recorded when the membership is saved as Paid");
});

test("Paid -> Pending after an invoice is not blocked in the browser: it reaches the database, whose message is shown", () => {
  const form = code(FORM);
  // The select is not disabled by, or otherwise tied to, an invoice.
  const selectStart = form.search(/<Select\s+name="payment_status"/);
  assert.ok(selectStart > 0, "the payment status select");
  const select = form.slice(selectStart, form.indexOf("</Select>", selectStart));
  assert.doesNotMatch(select, /hasInvoice/);
  assert.match(select, /disabled=\{isPending\}/);
  // No client-side rule about the transition anywhere in the form.
  assert.doesNotMatch(form, /hasInvoice[^;\n]*["']pending["']|["']pending["'][^;\n]*hasInvoice/);

  // The database's message arrives as a payment_status field error and is shown under the select…
  assert.match(form, /fieldErrors\.payment_status \? \(\s*<p role="alert" className="text-small text-danger">\s*\{fieldErrors\.payment_status\}/);
  // …and the banner does not repeat the same sentence.
  assert.match(form, /state\?\.error && !Object\.values\(fieldErrors\)\.includes\(state\.error\)/);
});

test("the membership actions map that database error to the payment_status field", () => {
  // Phase 1 behaviour the form relies on (pinned here so Phase 2 cannot drift from it).
  const actions = code("../memberships/actions.js");
  assert.match(actions, /return \{ error: rule\.error, fieldErrors: rule\.fieldErrors, values: submittedValues\(formData\) \};/);
  assert.match(code("./invoice-core.js"), /"payment_status", "The payment status cannot be changed after an invoice has been issued\."/);
});

// ---- 11. authorization --------------------------------------------------------------------------------------

test("invoice information and actions live only behind the Admin guard", () => {
  // Membership Details, its layout and its data all require the Admin role.
  assert.match(code(PAGE), /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("../../app/memberships/layout.js"), /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("./data.js"), /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("./actions.js"), /await requireRole\(ROLES\.ADMIN\);/);
  // The invoice UI is reachable from nowhere else: the panel only from Membership Details, the dialog only from the panel.
  const files = walk("../../app/").filter((f) => f.endsWith(".js"));
  const importers = (needle) => files.filter((file) => source(file).includes(needle));
  assert.deepEqual(importers("invoice-panel"), ["../../app/memberships/[id]/page.js"]);
  assert.deepEqual(importers("[id]/issue-invoice"), ["../../app/memberships/[id]/invoice-panel.js"]);
  // No Instructor-visible area refers to invoices at all.
  for (const file of files.filter((f) => !f.includes("/memberships/"))) {
    assert.doesNotMatch(source(file), /lib\/invoices|invoice-panel|issue-invoice/, file);
  }
});

function walk(dir) {
  return readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]
  );
}

// ---- 12. a newly Paid membership is not invoiced twice -----------------------------------------------------

test("saving a membership as Paid never issues an invoice from the application: the database does", () => {
  const appFiles = walk("../../app/").filter((f) => f.endsWith(".js"));
  const callers = appFiles.filter((file) => /\bissueInvoice\b/.test(code(file)));
  assert.deepEqual(callers, ["../../app/memberships/[id]/issue-invoice.js"], "only the explicit dialog");

  const lib = ["../memberships/actions.js", "../memberships/validation.js", "../memberships/data.js"];
  for (const file of lib) {
    assert.doesNotMatch(code(file), /issueInvoice|issue_invoice/, file);
  }
  // The create / edit / renew screens and the form never call it.
  for (const file of [FORM, EDIT, "../../app/memberships/new/page.js", "../../app/memberships/[id]/renew/page.js"]) {
    if (existsSync(new URL(file, import.meta.url))) assert.doesNotMatch(code(file), /issueInvoice/, file);
  }
});

test("after a save the page simply reads what the database produced (no manual issue, no polling)", () => {
  assert.doesNotMatch(code(FORM), /issueInvoice|getInvoice|setInterval|setTimeout/);
  // The membership actions still redirect to the details page, which loads the invoice server-side.
  assert.match(code("../memberships/actions.js"), /redirect\(`\$\{membershipPath\(id\)\}\?success=updated`\)/);
});

// ---- 13. existing behaviour intact -------------------------------------------------------------------------

test("the membership form keeps the same fields, payload and submit path", () => {
  const form = code(FORM);
  for (const name of ["plan", "start_date", "end_date", "amount", "payment_status", "notes"]) {
    assert.match(form, new RegExp(`name="${name}"`), name);
  }
  assert.match(form, /useActionState\(action, \{\}\)/);
  assert.match(form, /const BLUR_VALIDATED_FIELDS = new Set\(\["plan", "start_date", "end_date", "amount", "payment_status", "notes"\]\);/);
  // Status options unchanged.
  assert.match(form, /\{ value: "pending", label: "Pending" \},\s*\{ value: "paid", label: "Paid" \}/);
});

test("membership validation still has no payment date: the database owns it", () => {
  assert.doesNotMatch(code("../memberships/validation.js"), /payment_date/);
});

test("the membership list and table are untouched by invoices", () => {
  const dir = "../../app/memberships/";
  for (const file of readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith(".js"))) {
    if (file === "membership-form.js") continue;
    assert.doesNotMatch(code(`${dir}${file}`), /invoice|payment_date/i, file);
  }
  // The list read is unchanged; only the single-membership read gained payment_date.
  const data = source("../memberships/data.js");
  const list = data.match(/const LIST_COLUMNS =\s*"([^"]+)"/)[1];
  const detail = data.match(/const DETAIL_COLUMNS =\s*"([^"]+)"/)[1];
  assert.doesNotMatch(list, /payment_date/);
  assert.match(detail, /payment_status, payment_date, cancelled_at/);
});

// ---- scope ---------------------------------------------------------------------------------------------

test("Phase 2 adds no invoice screen, settings, numbering UI, print, PDF or sharing", () => {
  const dir = new URL("../../app/memberships/[id]/", import.meta.url);
  const entries = readdirSync(dir).sort();
  assert.deepEqual(entries.filter((e) => /invoice/i.test(e)), ["invoice-panel.js", "issue-invoice.js"], "no invoice route");
  assert.equal(existsSync(new URL("../../app/invoices", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../app/settings/invoice-receipt", import.meta.url)), false);

  for (const file of [PANEL, ISSUE, FORM, "./membership-invoice.js"]) {
    const text = code(file);
    assert.doesNotMatch(text, /starting_invoice|startingInvoice|next_invoice|tax_rate|taxRate|signature|window\.print|navigator\.share|wa\.me|react-pdf/i, file);
  }
  // The existing receipt page is unchanged by this phase.
  assert.match(code("../../app/memberships/[id]/receipt/page.js"), /Print Receipt|PrintReceiptButton/);
});
