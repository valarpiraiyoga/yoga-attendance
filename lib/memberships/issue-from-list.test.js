// Run with `npm test` (Node's built-in test runner).
//
// Issue Receipt from the Memberships list and menus: a Paid membership with no invoice offers Issue
// Invoice, which opens the EXISTING Issue Receipt dialog (the one Membership Details uses) instead of
// linking to an Invoice Detail page that would be a 404. Plus the Pending document's new wording.
// The decision is `membershipDocumentAction` (tested in document-action.test.js); the components are
// pinned from source - the project's way for code that needs the React and Next.js runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { invoiceExistsOf, membershipDocumentAction } from "./document-action.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir) =>
  readdirSync(new URL(dir, import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
    .map((f) => `${dir}${f.replaceAll("\\", "/")}`);

const ISSUE = "../../app/memberships/[id]/issue-invoice.js";
const BRIDGE = "../../app/memberships/membership-issue-invoice.js";
const TABLE = "../../app/memberships/membership-table.js";
const CARD = "../../app/memberships/membership-card-item.js";
const MENU = "../../app/memberships/membership-card-menu.js";
const HISTORY = "../../app/memberships/[id]/membership-history-row.js";
const CANCEL = "../../app/memberships/[id]/cancel-membership.js";
const DETAIL = "../../app/memberships/[id]/page.js";
const PANEL = "../../app/memberships/[id]/invoice-panel.js";
const ID = "11111111-1111-4111-8111-111111111111";

// ---- the three states, end to end ---------------------------------------------------------------------------------------

test("Pending -> due notice; Paid with an invoice -> Receipt; Paid without -> Issue Receipt", () => {
  assert.deepEqual(
    [["pending", false], ["pending", true], ["paid", true], ["paid", false]].map(([status, exists]) => membershipDocumentAction(ID, status, exists).label),
    ["View Due Notice", "View Due Notice", "View Receipt", "Issue Receipt"]
  );
});

test("after a successful issue the row reads View Receipt: the invoice now exists, so the action changes", () => {
  const before = membershipDocumentAction(ID, "paid", invoiceExistsOf([]));
  assert.equal(before.kind, "issue-receipt");
  // The list is re-read after the action revalidates /memberships; the row then carries the invoice.
  const after = membershipDocumentAction(ID, "paid", invoiceExistsOf([{ id: "new-invoice" }]));
  assert.deepEqual(after, { kind: "receipt", label: "View Receipt", href: `/memberships/${ID}/invoice` });
  assert.match(code("../invoices/actions.js"), /revalidatePath\("\/memberships"\);\s*revalidatePath\(membershipPath\(membershipId\)\);/);
  assert.match(code("../invoices/actions.js"), /if \(result\.success\) \{\s*revalidateMembership\(membershipId\);\s*\}/);
});

// ---- the one dialog ---------------------------------------------------------------------------------------------------------

test("there is ONE Issue Receipt dialog, one place that calls issueInvoice, and one payment-date flow", () => {
  const files = walk("../../app/");
  assert.deepEqual(files.filter((f) => /title="Issue receipt"/.test(code(f))), ["../../app/memberships/[id]/issue-invoice.js"]);
  assert.deepEqual(files.filter((f) => /\bissueInvoice\(/.test(code(f))), ["../../app/memberships/[id]/issue-invoice.js"]);
  assert.deepEqual(files.filter((f) => /prepareIssueInvoiceInput/.test(code(f))), ["../../app/memberships/[id]/issue-invoice.js"]);
  assert.deepEqual(files.filter((f) => /id="issue-payment-date"/.test(code(f))), ["../../app/memberships/[id]/issue-invoice.js"]);
});

test("the dialog was made reusable without changing it: same title, wording, fields, action and rules", () => {
  const issue = code(ISSUE);
  assert.match(issue, /export function IssueInvoiceDialog\(\{ open, onOpenChange, membershipId, needsPaymentDate, paymentDateLabel, student, membership \}\)/);
  assert.match(issue, /title="Issue receipt"/);
  assert.match(issue, /confirmLabel="Issue Receipt"\s+pendingLabel="Issuing…"/);
  assert.match(issue, /This membership is Paid but has no recorded payment date\. Enter the date it was actually paid — it is not filled in for you\./);
  assert.match(issue, /The recorded payment date \(\$\{paymentDateLabel\}\) will be used for the receipt\./);
  assert.match(issue, /prepareIssueInvoiceInput\(\{ needsPaymentDate, paymentDate, invoiceDate \}\)/);
  assert.match(issue, /const result = await issueInvoice\(membershipId, prepared\.input\);/);
  assert.match(issue, /setFormError\(errors\.payment_date \|\| errors\.invoice_date \? null : result\.error\);/);
  assert.match(issue, /label="Payment date" required error=\{fieldErrors\.payment_date\}/);
  assert.match(issue, /label="Receipt date"\s+error=\{fieldErrors\.invoice_date\}\s+help="Optional\. Left blank, it is the payment date\."/);
  // Closing resets what was typed, as before.
  assert.match(issue, /if \(!next\) \{[^}]*setPaymentDate\(""\);[^}]*setInvoiceDate\(""\);[^}]*setFieldErrors\(\{\}\);[^}]*setFormError\(null\);/s);
});

test("Membership Details' own Issue Receipt button is the same as before, now built on that dialog", () => {
  const issue = code(ISSUE);
  assert.match(issue, /export default function IssueInvoice\(\{ membershipId, needsPaymentDate, paymentDateLabel, student, membership \}\)/);
  assert.match(issue, /<Button type="button" variant="outline" onClick=\{\(\) => setOpen\(true\)\}>\s*<Receipt className="size-4" aria-hidden="true" \/>\s*Issue Receipt\s*<\/Button>/);
  assert.match(issue, /<IssueInvoiceDialog\s+open=\{open\}\s+onOpenChange=\{setOpen\}\s+membershipId=\{membershipId\}/);
  // The panel still uses it exactly as it did.
  assert.match(code(PANEL), /<IssueInvoice\s+membershipId=\{membership\.id\}\s+needsPaymentDate=\{state\.needsPaymentDate\}\s+paymentDateLabel=\{state\.paymentDate\.kind === "recorded" \? formatDate\(state\.paymentDate\.date\) : null\}/);
});

test("the list's bridge only turns a row into the dialog's props — a recorded payment date is shown, none is asked for", () => {
  const bridge = code(BRIDGE);
  assert.match(bridge, /import \{ IssueInvoiceDialog \} from "@\/app\/memberships\/\[id\]\/issue-invoice";/);
  assert.match(bridge, /needsPaymentDate=\{!membership\.payment_date\}/);
  assert.match(bridge, /paymentDateLabel=\{membership\.payment_date \? formatDate\(membership\.payment_date\) : null\}/);
  assert.match(bridge, /planLabel: PLAN\[membership\.plan\] \?\? membership\.plan/);
  assert.match(bridge, /period: formatPeriod\(membership\.start_date, membership\.end_date\)/);
  // No form, no action, no validation of its own.
  assert.doesNotMatch(bridge, /issueInvoice|ConfirmDialog|<Input|FormField|prepareIssueInvoiceInput|useTransition|supabase/);
});

// ---- the list ----------------------------------------------------------------------------------------------------------------

test("in the table and the card, Paid without an invoice opens the dialog: no link, no navigation to a 404", () => {
  for (const path of [TABLE, CARD]) {
    const text = code(path);
    assert.match(text, /documentAction\.href\s*\? \{ render: <Link href=\{documentAction\.href\} \/>, nativeButton: false \}\s*: \{ onClick: \(\) => setIssueOpen\(true\) \}/, path);
    assert.match(text, /\{documentAction\.kind === "issue-receipt" \? \(\s*<MembershipIssueInvoiceDialog membership=\{membership\} student=\{student\} open=\{issueOpen\} onOpenChange=\{setIssueOpen\} \/>\s*\) : null\}/, path);
    assert.match(text, /invoiceExists=\{membership\.invoice_exists\}\s*hasPayments=\{membership\.has_payments\}\s*onIssueInvoice=\{\(\) => setIssueOpen\(true\)\}/, path);
    assert.match(text, /const \[issueOpen, setIssueOpen\] = useState\(false\);/, path);
    // The only link target is the helper's href, which is null for this state.
    assert.doesNotMatch(text, /\/invoice`|\/invoice"/, path);
  }
});

test("the icons: Pending FileText, Paid with invoice Receipt, Paid without FilePlus — all lucide-react", () => {
  for (const path of [TABLE, CARD]) {
    const text = code(path);
    assert.match(text, /const DOCUMENT_ICON = \{ "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus, "payments": Wallet \};/, path);
    assert.match(text, /from "lucide-react";/, path);
  }
  const icons = new Set(Object.keys(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).dependencies));
  assert.ok(icons.has("lucide-react"));
});

test("the icon button keeps its size, place and style in all three states", () => {
  for (const path of [TABLE, CARD]) {
    const text = code(path);
    assert.equal((text.match(/<Button\s+type="button"\s+variant="ghost"\s+size="icon-sm"\s+className="text-brand hover:bg-brand\/10 hover:text-brand"/g) ?? []).length, 1, path);
    assert.ok(text.indexOf("<DocumentIcon") < text.indexOf("<MembershipCardMenu"), path);
    assert.match(text, /title=\{documentAction\.label\}/, path);
  }
  assert.match(code(TABLE), /className="w-px py-3 pr-3 pl-1 whitespace-nowrap"/);
});

// ---- the menu --------------------------------------------------------------------------------------------------------------

test("the menu's fourth item is a link for the two viewing states and Issue Receipt (opening the dialog) for the third", () => {
  const menu = code(MENU);
  assert.match(menu, /invoiceExists = false,\s*hasPayments = false,\s*onIssueInvoice,/);
  assert.match(menu, /<DropdownMenuItem onClick=\{onIssueInvoice\}>\{documentAction\.label\}<\/DropdownMenuItem>/);
  // The order is unchanged: View, Edit, Renew, the document action, then View Student.
  const order = ["View Membership", "Edit Membership", "Renew Membership", "{documentAction.label}", "View Student"].map((text) => menu.indexOf(text));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test("the Membership Details header menu and the student's other memberships offer the same, with the same dialog", () => {
  assert.match(code(CANCEL), /import \{ IssueInvoiceDialog \} from "@\/app\/memberships\/\[id\]\/issue-invoice";/);
  assert.match(code(CANCEL), /\{invoiceToIssue \? \(\s*<IssueInvoiceDialog\s+open=\{issueOpen\}\s+onOpenChange=\{setIssueOpen\}\s+membershipId=\{membershipId\}\s+needsPaymentDate=\{invoiceToIssue\.needsPaymentDate\}\s+paymentDateLabel=\{invoiceToIssue\.paymentDateLabel\}/);
  assert.match(code(DETAIL), /const invoiceState = getInvoiceSectionState\(\{ membership, invoice, hasPayments \}\);/);
  assert.match(code(DETAIL), /invoiceToIssue=\{\s*invoiceState\.canIssue\s*\?/);
  assert.match(code(HISTORY), /entry\.payment_status === "paid" && !entry\.invoice_exists && !entry\.has_payments \? \(\s*<MembershipIssueInvoiceDialog membership=\{entry\} student=\{student\}/);
  assert.match(code(DETAIL), /<MembershipHistoryRow key=\{entry\.id\} entry=\{entry\} student=\{student\} \/>/);
});

// ---- the data ---------------------------------------------------------------------------------------------------------------

test("only the minimum is read for it: invoices(id) and the payment date, reduced to a single invoice_exists flag", () => {
  const data = source("./data.js");
  assert.match(data, /payment_status, payment_date, cancelled_at, invoices\(id, payment_id\), membership_payments\(id\), students\(id, full_name, student_code, photo_url\)/);
  assert.match(data, /payment_status, payment_date, cancelled_at, invoices\(id, payment_id\), membership_payments\(id\)"\)/);
  assert.match(code("./data.js"), /import \{ invoiceExistsOf \} from "@\/lib\/memberships\/document-action";/);
  assert.equal((code("./data.js").match(/invoice_exists: invoiceExistsOf\(invoices\)/g) ?? []).length, 2);
});

test("Invoice Detail still answers 404 when there is no invoice — it was not changed to hide the case", () => {
  const page = code("../../app/memberships/[id]/invoice/page.js");
  assert.match(page, /if \(!invoice\) \{\s*notFound\(\);\s*\}/);
});

// ---- the Pending document's wording -------------------------------------------------------------------------------------------

test("the Pending document is the Payment Due Notice, printed as Print Due Notice", () => {
  const page = code("../../app/memberships/[id]/receipt/page.js");
  assert.match(page, /title="Payment Due Notice"/);
  assert.match(page, /description=\{`Payment Due Notice \$\{membership\.membership_code\}: print it or send it on WhatsApp\.`\}/);
  assert.match(page, /\$\{center\.name\} – Payment Due Notice` : "Payment Due Notice"/);
  assert.doesNotMatch(page, /Membership Receipt/);
  assert.match(code("../../app/memberships/[id]/receipt/print-receipt-button.js"), /Print Due Notice/);
  assert.doesNotMatch(code("../../app/memberships/[id]/receipt/print-receipt-button.js"), /Print Receipt/);
});

test("the route stays /receipt, and the page is otherwise the same document", () => {
  assert.ok(readdirSync(new URL("../../app/memberships/[id]/receipt/", import.meta.url)).includes("page.js"));
  assert.equal(membershipDocumentAction(ID, "pending").href, `/memberships/${ID}/receipt`);
  const page = code("../../app/memberships/[id]/receipt/page.js");
  assert.match(page, /window\.print|PrintReceiptButton/);
  assert.match(page, /@page \{ size: A4; margin: 14mm; \}/);
  assert.match(page, /Send WhatsApp/);
  assert.match(page, /<h1 className="text-page-title font-semibold tracking-wide text-brand uppercase">Payment Due Notice<\/h1>/, "the document's own heading");
});

// ---- nothing else moved ---------------------------------------------------------------------------------------------------------

test("the invoice, its PDF, Print, Share, Edit and the payment rules are untouched", () => {
  for (const path of ["../invoices/invoice-core.js", "../invoices/pdf/invoice-pdf.js", "../invoices/share-invoice.js", "../invoices/edit-invoice.js", "../../app/memberships/[id]/invoice/page.js", "../../app/memberships/[id]/invoice/print-invoice-button.js"]) {
    assert.doesNotMatch(code(path), /membershipDocumentAction|IssueInvoiceDialog|invoice_exists/, path);
  }
  assert.doesNotMatch(code("./actions.js"), /invoice_exists|invoiceExistsOf/);
});

// ---- the approved wording, and none of the old ------------------------------------------------------------------------

const FEATURE_FILES = [
  "../../app/memberships/membership-table.js",
  "../../app/memberships/membership-card-item.js",
  "../../app/memberships/membership-card-menu.js",
  "../../app/memberships/[id]/cancel-membership.js",
  "../../app/memberships/[id]/issue-invoice.js",
  "../../app/memberships/[id]/membership-history-row.js",
  "../../app/memberships/[id]/receipt/page.js",
  "../../app/memberships/[id]/receipt/print-receipt-button.js",
  "../../app/memberships/membership-issue-invoice.js",
  "./document-action.js",
];

test("none of the old wording remains in the feature: no Payment Acknowledgement, View Paid Invoice or Issue Invoice", () => {
  for (const file of FEATURE_FILES) {
    const text = source(file); // comments included: nothing in this feature says the old words
    assert.doesNotMatch(text, /Payment Acknowledgement|Paid Invoice|Issue Invoice|View Invoice/, file);
  }
});

test("the user-facing words are View Due Notice, View Receipt and Issue Receipt — in the helper, and everywhere they are shown", () => {
  const helper = code("./document-action.js");
  assert.deepEqual([...helper.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["View Receipt", "View Payments", "Issue Receipt", "View Due Notice"]);
  // The table, card, menus, and detail header show what the helper says: no label is typed anywhere else.
  for (const file of FEATURE_FILES.slice(0, 3)) {
    assert.doesNotMatch(code(file), /"View (Due Notice|Receipt)"|"Issue Receipt"/, file);
    assert.match(code(file), /documentAction\.label/, file);
  }
});

test("Membership Details' button and the dialog read Issue Receipt, with a Receipt date", () => {
  const issue = code(ISSUE);
  assert.match(issue, /Issue Receipt\s*<\/Button>/);
  assert.match(issue, /confirmLabel="Issue Receipt"/);
  assert.match(issue, /title="Issue receipt"/);
  assert.match(issue, /label="Receipt date"/);
  // Internal names are unchanged: the component, the action and the ids keep "invoice".
  assert.match(issue, /export function IssueInvoiceDialog/);
  assert.match(issue, /issueInvoice\(membershipId, prepared\.input\)/);
  assert.match(issue, /id="issue-invoice-date"/);
});

test("the Pending page is the Payment Due Notice throughout: title, heading, number, footer, print button and message", () => {
  const page = code("../../app/memberships/[id]/receipt/page.js");
  assert.match(page, /title="Payment Due Notice"/);
  assert.match(page, /text-brand uppercase">Payment Due Notice<\/h1>/);
  assert.match(page, /<Detail label="Notice No\.">/);
  assert.match(page, /`Notice No\.: \$\{membership\.membership_code\}`/);
  assert.match(page, /aria-label=\{`Payment Due Notice \$\{membership\.membership_code\}`\}/);
  assert.match(page, /Notice \{membership\.membership_code\} · Generated/);
  assert.doesNotMatch(page, /Receipt No\.|>Receipt<|Receipt \{membership|aria-label=\{`Receipt/);
  assert.match(code("../../app/memberships/[id]/receipt/print-receipt-button.js"), /Print Due Notice/);
  // It stays a neutral reminder: no "Paid" confirmation wording is added to it.
  assert.doesNotMatch(page, /Payment received|Paid in full|Thank you for your payment/i);
});

// ---- behaviour that must hold ----------------------------------------------------------------------------------------

test("a Paid membership that already has a receipt cannot issue another through this action", () => {
  // The action is a link to the receipt - there is no Issue button for it - and the dialog is only mounted for the issue state.
  assert.deepEqual(membershipDocumentAction(ID, "paid", true), { kind: "receipt", label: "View Receipt", href: `/memberships/${ID}/invoice` });
  for (const path of [TABLE, CARD]) {
    assert.match(code(path), /\{documentAction\.kind === "issue-receipt" \? \(/, path);
    assert.doesNotMatch(code(path), /kind === "receipt"[^\n]*MembershipIssueInvoiceDialog/, path);
  }
  assert.match(code(HISTORY), /entry\.payment_status === "paid" && !entry\.invoice_exists && !entry\.has_payments \? \(/);
  assert.match(code(CANCEL), /\{invoiceToIssue \? \(/);
  assert.match(code(DETAIL), /invoiceState\.canIssue\s*\?/, "the detail header only gets the issue props when nothing has been issued");
  // And the database holds the line regardless: one receipt per membership.
  assert.match(source("../../supabase/migrations/0026_invoices.sql"), /create unique index if not exists invoices_membership_id_unique/);
  assert.match(source("../../supabase/migrations/0036_payment_documents.sql"), /create unique index invoices_membership_id_unique\s+on public\.invoices \(membership_id\)\s+where payment_id is null;/);
  assert.match(source("../../supabase/migrations/0026_invoices.sql"), /An invoice has already been issued for this membership\./);
});

test("table, card, list menu, detail header menu and history rows all take the state-aware action", () => {
  for (const path of [TABLE, CARD, HISTORY, CANCEL]) assert.match(code(path), /<MembershipCardMenu[\s\S]*?paymentStatus=/, path);
  for (const path of [TABLE, CARD]) assert.match(code(path), /membershipDocumentAction\(membership\.id, membership\.payment_status, membership\.invoice_exists, membership\.has_payments\)/, path);
  assert.match(code(MENU), /membershipDocumentAction\(membershipId, paymentStatus, invoiceExists, hasPayments\)/);
});
