// Run with `npm test` (Node's built-in test runner).
//
// "View Cancelled Invoice" in the Payments section: a payment whose document was cancelled and has no issued replacement offers a
// link to that cancelled document's page, beside Issue Document. The data (which document the link opens) is run for real through
// fetchPaymentsForMembership with a fake client; the panel (where the link shows and where it goes) is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchPaymentsForMembership } from "../memberships/payments-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = "../../app/memberships/[id]/payments-panel.js";

function client(rows) {
  const queries = [];
  const builder = { select: (columns) => (queries.push(columns), builder), eq: () => builder, order: () => builder, then: (resolve) => resolve({ data: rows, error: null }) };
  return { queries, from: () => builder };
}

const BASE = { amount: 100, membership_payment_methods: [], membership_payment_edits: [] };
const doc = (id, number, status, extra = {}) => ({
  id,
  invoice_number: number,
  invoice_prefix: "INV-",
  document_series: "invoice",
  document_title: "invoice",
  invoice_date: "2026-10-09",
  status,
  cancelled_at: status === "cancelled" ? "2026-10-10T10:00:00Z" : null,
  ...extra,
});

async function payments(...invoiceLists) {
  return fetchPaymentsForMembership(client(invoiceLists.map((invoices, index) => ({ ...BASE, id: `p${index}`, invoices }))), "m1");
}

// ---- which document the link opens -----------------------------------------------------------------------------------

test("a payment with a cancelled document and no issued one offers that document (and no issued document)", async () => {
  const [none, onlyCancelled] = await payments([], [doc("d1", 837, "cancelled")]);
  assert.equal(none.cancelledDocument, null);
  assert.equal(none.document, null);
  assert.equal(onlyCancelled.document, null, "nothing is issued");
  assert.equal(onlyCancelled.cancelledDocument.id, "d1");
  assert.equal(onlyCancelled.corrected, true);
});

test("an issued document keeps the existing behaviour: the issued one is the link, and there is no cancelled-document link", async () => {
  const [issued, replaced] = await payments([doc("d1", 837, "issued")], [doc("d1", 837, "cancelled"), doc("d2", 838, "issued", { cancelled_at: null })]);
  assert.equal(issued.document.id, "d1");
  assert.equal(issued.cancelledDocument, null);
  assert.equal(issued.corrected, false);

  // A corrected payment: the replacement is the one issued document (its page lists the correction history); no second button.
  assert.equal(replaced.document.id, "d2");
  assert.equal(replaced.cancelledDocument, null);
  assert.equal(replaced.corrected, true);
});

test("when several documents were cancelled, the last one cancelled is opened - its page lists every earlier document", async () => {
  const [chain] = await payments([
    doc("d1", 837, "cancelled", { cancelled_at: "2026-10-10T10:00:00Z" }),
    doc("d3", 839, "cancelled", { cancelled_at: "2026-10-12T10:00:00Z" }),
    doc("d2", 838, "cancelled", { cancelled_at: "2026-10-11T10:00:00Z" }),
  ]);
  assert.equal(chain.cancelledDocument.id, "d3");

  // Cancelled in one transaction (the same time): the higher number is the later document.
  const [sameTime] = await payments([
    doc("a", 840, "cancelled", { cancelled_at: "2026-10-12T10:00:00Z" }),
    doc("b", 841, "cancelled", { cancelled_at: "2026-10-12T10:00:00Z" }),
  ]);
  assert.equal(sameTime.cancelledDocument.id, "b");
});

test("it works for a tax invoice and for a payment receipt: the document is passed on with its series and number", async () => {
  const [tax, receipt] = await payments(
    [doc("t1", 837, "cancelled")],
    [doc("r1", 52, "cancelled", { document_series: "payment_receipt", document_title: "payment_receipt", invoice_prefix: "PR-" })],
  );
  assert.equal(tax.cancelledDocument.document_title, "invoice");
  assert.equal(tax.cancelledDocument.invoice_number, 837);
  assert.equal(receipt.cancelledDocument.document_title, "payment_receipt");
  assert.equal(receipt.cancelledDocument.invoice_prefix, "PR-");
});

test("nothing else about a payment changes: it stays locked, its methods and amount are untouched, the columns only gained the cancellation time", async () => {
  const fake = client([{ ...BASE, id: "p0", amount: 250, invoices: [doc("d1", 837, "cancelled")] }]);
  const [payment] = await fetchPaymentsForMembership(fake, "m1");
  assert.equal(payment.editable, false, "a cancelled document still locks the payment");
  assert.equal(payment.amount, 250);
  assert.deepEqual(payment.methods, []);
  assert.match(fake.queries[0], /invoices\(id, invoice_number, invoice_prefix, document_series, document_title, invoice_date, status, cancelled_at\)/);
  assert.doesNotMatch(fake.queries[0], /total_amount|tax_amount|customer_|business_/, "no document detail is read for the link");
});

// ---- the panel -------------------------------------------------------------------------------------------------------

test("the link is shown only when there is no issued document, beside Issue Document", () => {
  const panel = code(PANEL);
  // It lives inside the "no issued document" branch, after the Issue Document / Not available choice.
  const noDocument = panel.slice(panel.indexOf(") : ("), panel.indexOf("{payment.editable ? ("));
  assert.match(noDocument, /<IssuePaymentDocument/);
  assert.match(noDocument, /\{payment\.cancelledDocument \? \(/);
  assert.ok(noDocument.indexOf("<IssuePaymentDocument") < noDocument.indexOf("payment.cancelledDocument"));
  // The branch above it (an issued document) is untouched and has no such link.
  const issuedBranch = panel.slice(panel.indexOf("{payment.document ? ("), panel.indexOf(") : ("));
  assert.doesNotMatch(issuedBranch, /cancelledDocument|View Cancelled Invoice/);
  assert.equal([...panel.matchAll(/View Cancelled Invoice/g)].length, 2, "the label, and its accessible name");
  assert.equal([...panel.matchAll(/<IssuePaymentDocument/g)].length, 1, "no second Issue Document button");
});

test("it opens the existing document page of the cancelled document - a plain link, never an action", () => {
  const panel = code(PANEL);
  assert.match(panel, /render=\{<Link href=\{`\/memberships\/\$\{membership\.id\}\/documents\/\$\{payment\.cancelledDocument\.id\}`\} \/>\}\s+nativeButton=\{false\}/);
  assert.match(panel, /aria-label=\{`View Cancelled Invoice \$\{DOCUMENT_TITLE_LABEL\[payment\.cancelledDocument\.document_title\] \?\? payment\.cancelledDocument\.document_title\} \$\{formatInvoiceNumberOf\(payment\.cancelledDocument\)\}`\}/);
  // Viewing issues nothing: no server action is imported or called for it, and the link is not a form.
  assert.doesNotMatch(panel, /@\/lib\/invoices\/actions|issuePaymentDocument\(|<form/);
  assert.match(panel, /import IssuePaymentDocument from "@\/app\/memberships\/\[id\]\/issue-payment-document";/);
});

test("the page it opens shows the original number, details, Cancelled status, reason and correction history, and offers no correction", () => {
  const page = code("../../app/memberships/[id]/documents/[documentId]/page.js");
  assert.match(page, /const document = await getPaymentDocument\(id, documentId\);/);
  assert.match(page, /This document was cancelled\{invoiceDocument\.cancellation\?\.date/);
  assert.match(page, /Reason: \{invoiceDocument\.cancellation\.reason\}/);
  assert.match(page, /Correction History/);
  assert.match(page, /<InvoiceDocument invoiceDocument=\{invoiceDocument\}/);
  // Correct Document and Cancel Document are inside the issued-only branch, so a cancelled document shows neither, and nothing here issues.
  assert.match(page, /\{isCancelled \? null : \(/);
  assert.doesNotMatch(page, /issuePaymentDocument|IssuePaymentDocument/);
});

test("the document's own authorization is unchanged: the page and its loader are Admin only", () => {
  assert.match(code("../../app/memberships/[id]/documents/[documentId]/page.js"), /await requireRole\(ROLES\.ADMIN\);/);
  const data = code("./data.js");
  const start = data.indexOf("export async function getPaymentDocument(");
  assert.match(data.slice(start, data.indexOf("\n}\n", start)), /await requireRole\(ROLES\.ADMIN\);/);
});
