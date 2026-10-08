// Run with `npm test` (Node's built-in test runner).
//
// The status-aware document action of a membership: View Receipt for a Paid membership (the
// stored Invoice Detail), View Due Notice for a Pending one (the existing membership
// document page). The decision is `membershipDocumentAction` (tested directly); the list's icon, the
// list and detail overflow menus and the card are pinned from source - the project's way for
// components that cannot be rendered under node:test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { invoiceExistsOf, membershipDocumentAction } from "./document-action.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const MENU = "../../app/memberships/membership-card-menu.js";
const TABLE = "../../app/memberships/membership-table.js";
const CARD = "../../app/memberships/membership-card-item.js";
const HISTORY = "../../app/memberships/[id]/membership-history-row.js";
const CANCEL = "../../app/memberships/[id]/cancel-membership.js";
const DETAIL = "../../app/memberships/[id]/page.js";
const ID = "11111111-1111-4111-8111-111111111111";

// ---- the decision -------------------------------------------------------------------------------------------------

test("Pending: Payment Due Notice, opening the existing membership document page", () => {
  assert.deepEqual(membershipDocumentAction(ID, "pending"), {
    kind: "due-notice",
    label: "View Due Notice",
    href: `/memberships/${ID}/receipt`,
  });
});

test("Paid with an invoice: Receipt, opening the existing Invoice Detail route", () => {
  assert.deepEqual(membershipDocumentAction(ID, "paid", true), {
    kind: "receipt",
    label: "View Receipt",
    href: `/memberships/${ID}/invoice`,
  });
});

test("Paid without an invoice: Issue Receipt, which is not a link - a 404 is never offered", () => {
  for (const missing of [false, undefined, null, 0]) {
    assert.deepEqual(membershipDocumentAction(ID, "paid", missing), { kind: "issue-receipt", label: "Issue Receipt", href: null });
  }
  assert.equal(membershipDocumentAction(ID, "paid").href, null, "unknown invoice state is not treated as an invoice");
});

test("a Pending membership never offers an invoice, whether or not one somehow exists", () => {
  assert.equal(membershipDocumentAction(ID, "pending", true).kind, "due-notice");
  assert.equal(membershipDocumentAction(ID, "pending", false).kind, "due-notice");
});

test("whether an invoice exists is read from the embedded relation, as an object, an array or nothing", () => {
  assert.equal(invoiceExistsOf({ id: "i" }), true);
  assert.equal(invoiceExistsOf([{ id: "i" }]), true);
  assert.equal(invoiceExistsOf([]), false);
  assert.equal(invoiceExistsOf(null), false);
  assert.equal(invoiceExistsOf(undefined), false);
});

test("only the payment status decides: it takes no membership status at all", () => {
  assert.equal(membershipDocumentAction.length, 2, "(membershipId, paymentStatus)");
  const helper = code("./document-action.js");
  assert.doesNotMatch(helper, /cancelled|active|expired|upcoming|membership\.status|\.status\b/i);
  for (const status of ["upcoming", "active", "expired", "cancelled"]) {
    // A membership status in the payment slot is not "paid", so it can never read as a paid invoice.
    assert.equal(membershipDocumentAction(ID, status).kind, "due-notice", status);
    assert.equal(membershipDocumentAction(ID, status, true).kind, "due-notice", status);
  }
});

test("the database allows only paid and pending; anything else reads as Pending, never as a paid invoice", () => {
  // The application's payment-status map has exactly those two (read as text: lib/status.js uses the @/ alias).
  const map = source("../status.js").match(/export const PAYMENT_STATUS = \{([\s\S]*?)\};/)[1];
  assert.deepEqual([...map.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]), ["paid", "pending"]);
  assert.match(readFileSync(new URL("../../supabase/migrations/0008_memberships.sql", import.meta.url), "utf8"), /check \(payment_status in \('paid', 'pending'\)\)/);
  for (const odd of [undefined, null, "", "PAID", "Paid", "refunded", 0]) {
    assert.equal(membershipDocumentAction(ID, odd).kind, "due-notice", String(odd));
  }
});

test("the words are the approved ones, and none of the old ones", () => {
  const labels = [["pending", true], ["pending", false], ["paid", true], ["paid", false]].map(([status, exists]) => membershipDocumentAction(ID, status, exists).label);
  assert.deepEqual(labels, ["View Due Notice", "View Due Notice", "View Receipt", "Issue Receipt"]);
  for (const label of labels) assert.doesNotMatch(label, /acknowledgement|invoice/i, label);
});

// ---- the list's icon, table and card ----------------------------------------------------------------------------------

test("the table's document icon follows the payment status: its label, tooltip, destination and icon", () => {
  const table = code(TABLE);
  assert.match(table, /const documentAction = membershipDocumentAction\(membership\.id, membership\.payment_status, membership\.invoice_exists\);/);
  assert.match(table, /const DOCUMENT_ICON = \{ "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus \};/);
  assert.match(table, /const DocumentIcon = DOCUMENT_ICON\[documentAction\.kind\];/);
  assert.match(table, /aria-label=\{`\$\{documentAction\.label\} for membership \$\{membership\.membership_code\}`\}/);
  assert.match(table, /title=\{documentAction\.label\}/);
  assert.match(table, /documentAction\.href\s*\? \{ render: <Link href=\{documentAction\.href\} \/>, nativeButton: false \}\s*: \{ onClick: \(\) => setIssueOpen\(true\) \}/);
  assert.match(table, /<DocumentIcon className="size-4" aria-hidden="true" \/>/);
  assert.match(table, /import \{ FilePlus, FileText, Receipt \} from "lucide-react";/);
});

test("the card's document icon follows the payment status in the same way", () => {
  const card = code(CARD);
  assert.match(card, /const documentAction = membershipDocumentAction\(membership\.id, membership\.payment_status, membership\.invoice_exists\);/);
  assert.match(card, /const DOCUMENT_ICON = \{ "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus \};/);
  assert.match(card, /const DocumentIcon = DOCUMENT_ICON\[documentAction\.kind\];/);
  assert.match(card, /aria-label=\{`\$\{documentAction\.label\} for \$\{student\?\.full_name \?\? membership\.membership_code\}`\}/);
  assert.match(card, /title=\{documentAction\.label\}/);
  assert.match(card, /documentAction\.href\s*\? \{ render: <Link href=\{documentAction\.href\} \/>, nativeButton: false \}\s*: \{ onClick: \(\) => setIssueOpen\(true\) \}/);
  assert.match(card, /import \{ CalendarDays, FilePlus, FileText, Receipt, Banknote \} from "lucide-react";/);
});

test("the icon button itself is unchanged: same variant, size and colours, same place before the menu", () => {
  for (const path of [TABLE, CARD]) {
    const text = code(path);
    assert.match(text, /type="button"\s+variant="ghost"\s+size="icon-sm"\s+className="text-brand hover:bg-brand\/10 hover:text-brand"/, path);
    assert.ok(text.indexOf("<DocumentIcon") < text.indexOf("<MembershipCardMenu"), path);
    assert.match(text, /nativeButton: false/, path);
  }
  assert.match(code(TABLE), /className="w-px py-3 pr-3 pl-1 whitespace-nowrap"/, "the Action column is as it was");
});

test("the table and the card both pass the payment status to the menu", () => {
  for (const path of [TABLE, CARD]) {
    assert.match(code(path), /<MembershipCardMenu[^>]*paymentStatus=\{membership\.payment_status\}/s, path);
  }
});

// ---- the three-dot menu ------------------------------------------------------------------------------------------------

test("the menu's document item is the status-aware action, in the old item's place", () => {
  const menu = code(MENU);
  assert.match(menu, /const documentAction = membershipDocumentAction\(membershipId, paymentStatus, invoiceExists\);/);
  assert.match(menu, /\{documentAction\.href \? \(\s*<DropdownMenuItem render=\{<Link href=\{documentAction\.href\} \/>\} nativeButton=\{false\}>\s*\{documentAction\.label\}\s*<\/DropdownMenuItem>\s*\) : \(\s*<DropdownMenuItem onClick=\{onIssueInvoice\}>\{documentAction\.label\}<\/DropdownMenuItem>\s*\)\}/);
  assert.doesNotMatch(menu, /View Receipt|\/receipt/, "no hard-coded receipt item or link remains");
});

test("the rest of the menu is exactly as it was, in the same order", () => {
  const menu = code(MENU);
  const labels = [...menu.matchAll(/<DropdownMenuItem render=\{<Link href=\{.*?\} \/>\} nativeButton=\{false\}>\s*([^<]+?)\s*<\/DropdownMenuItem>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["View Membership", "Edit Membership", "Renew Membership", "{documentAction.label}", "View Student"]);
  assert.match(menu, /href=\{`\/memberships\/\$\{membershipId\}`\}/);
  assert.match(menu, /href=\{`\/memberships\/\$\{membershipId\}\/edit`\}/);
  assert.match(menu, /href=\{`\/memberships\/\$\{membershipId\}\/renew`\}/);
  assert.match(menu, /href=\{`\/students\/\$\{studentId\}`\}/);
  // The existing structure: View Student after its own divider, extra items (Cancel) after another.
  assert.ok(menu.indexOf("{documentAction.label}") < menu.indexOf("<DropdownMenuSeparator />"));
  assert.match(menu, /min-w-44/);
});

test("no membership menu or icon says View Receipt any more", () => {
  const dir = "../../app/memberships/";
  const files = readdirSync(new URL(dir, import.meta.url), { recursive: true })
    .map(String)
    .filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
    .map((f) => `${dir}${f.replaceAll("\\", "/")}`)
    // The receipt page is the Pending document itself; its own heading and Print Receipt button are its own.
    .filter((f) => !f.includes("/receipt/"));
  assert.ok(files.length > 5);
  for (const file of files) assert.doesNotMatch(code(file), /View Receipt|View receipt|view receipt/, file);
});

test("the menu gets the payment status wherever it is used: list, card, detail header and history", () => {
  assert.match(code(DETAIL), /<CancelMembership[\s\S]*?paymentStatus=\{membership\.payment_status\}\s*invoiceExists=\{Boolean\(invoice\)\}/);
  assert.match(code(CANCEL), /export default function CancelMembership\(\{ membershipId, studentId, paymentStatus, invoiceExists, invoiceToIssue,/);
  assert.match(code(CANCEL), /<MembershipCardMenu[\s\S]*?paymentStatus=\{paymentStatus\}\s*invoiceExists=\{invoiceExists\}\s*onIssueInvoice=\{\(\) => setIssueOpen\(true\)\}/);
  assert.match(code(HISTORY), /<MembershipCardMenu\s+membershipId=\{entry\.id\}\s+paymentStatus=\{entry\.payment_status\}\s+invoiceExists=\{entry\.invoice_exists\}\s+onIssueInvoice=\{\(\) => setIssueOpen\(true\)\}/);
  // Every use of the menu passes it.
  for (const path of [TABLE, CARD, HISTORY, CANCEL]) assert.match(code(path), /paymentStatus=/, path);
});

// ---- destinations -------------------------------------------------------------------------------------------------------------

test("the destinations are existing routes: the Invoice Detail page and the membership document page", () => {
  assert.ok(readFileSync(new URL("../../app/memberships/[id]/invoice/page.js", import.meta.url), "utf8").includes("InvoiceDetailPage"));
  assert.ok(readFileSync(new URL("../../app/memberships/[id]/receipt/page.js", import.meta.url), "utf8").includes("MembershipReceiptPage"));
  const helper = code("./document-action.js");
  assert.deepEqual([...helper.matchAll(/`\/memberships\/\$\{membershipId\}\/(\w+)`/g)].map((m) => m[1]).sort(), ["invoice", "receipt"]);
  assert.match(helper, /label: "Issue Receipt", href: null/);
});

test("the list reads only what the action needs: whether an invoice exists, and the payment date for the dialog", () => {
  const data = source("../memberships/data.js");
  const list = data.match(/const LIST_COLUMNS =\s*"([^"]+)"/)[1];
  assert.match(list, /payment_status, payment_date, cancelled_at, invoices\(id\), students\(/);
  assert.doesNotMatch(list, /invoice_number|invoice_date|tax|bank|terms|signature|total_amount/);
  // The embedded relation is reduced to one flag; the rows never carry the invoices array on to the screens.
  const code_ = code("../memberships/data.js");
  assert.equal((code_.match(/invoice_exists: invoiceExistsOf\(invoices\)/g) ?? []).length, 2, "list and history");
  assert.match(code_, /\.map\(\(\{ invoices, \.\.\.membership \}\) => \(\{/);
  // The student's membership history carries the same two facts.
  assert.match(data, /payment_status, payment_date, cancelled_at, invoices\(id\)"\)/);
});

// ---- nothing else moved ----------------------------------------------------------------------------------------------------------

test("the invoice, its actions, the receipt page and the payment rules are untouched", () => {
  for (const path of ["../invoices/invoice-core.js", "../invoices/actions.js", "../invoices/share-invoice.js", "../invoices/edit-invoice.js", "../../app/memberships/[id]/receipt/page.js", "../../app/memberships/[id]/invoice/page.js"]) {
    assert.doesNotMatch(code(path), /membershipDocumentAction|document-action/, path);
  }
  assert.doesNotMatch(code("./document-action.js"), /supabase|createClient|requireRole|fetch\(|payment_date|invoice_/);
});
