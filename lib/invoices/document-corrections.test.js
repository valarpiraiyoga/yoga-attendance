// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 6 - correcting a payment document by cancel-and-reissue (migration 0037). The SQL
// is read as text: the re-created functions must be their latest definitions plus only the correction
// changes, and the correction must be one locked transaction. The application pieces are tested directly,
// and a cancelled document is rendered for real to check it says so.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "./pdf/invoice-pdf.js";
import { extractPdfText } from "./pdf/pdf-text.js";
import { buildInvoiceDocument } from "./invoice-document.js";
import { correctPaymentDocumentFor } from "./invoice-core.js";

const read = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const M37 = read("0037_invoice_corrections.sql");
const C37 = M37.replace(/^\s*--.*$/gm, "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

// ---- the re-created functions ---------------------------------------------------------------------------------

test("issue_payment_document_core is 0036's issue_payment_document with only the series and replacement inputs added", () => {
  const was = fn(read("0036_payment_documents.sql"), "create or replace function public.issue_payment_document(");
  const now = fn(M37, "create or replace function public.issue_payment_document_core(")
    .replace("issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid\n)", "issue_payment_document(\n  p_payment_id    uuid,\n  p_document_date date default null\n)")
    .replace(" and status = 'issued') then", ") then")
    .replace(/  -- A replacement keeps the series[^\n]*\n  v_series := coalesce\(p_series, (case [^;]*end)\);/, "  v_series := $1;")
    .replace("service_details, service_details_tracked,\n    replaces_id\n  )", "service_details, service_details_tracked\n  )")
    .replace("public.membership_service_details(v_mem.id), true,\n    p_replaces_id\n  )", "public.membership_service_details(v_mem.id), true\n  )");
  assert.equal(now, was);
});

test("issue_payment_document keeps its signature and behaviour: Admin only, the payment's own series, no replacement", () => {
  const wrapper = fn(C37, "create or replace function public.issue_payment_document(");
  assert.match(wrapper, /p_payment_id    uuid,\s+p_document_date date default null/);
  assert.match(wrapper, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  assert.match(wrapper, /return public\.issue_payment_document_core\(p_payment_id, p_document_date, null, null\);/);
  assert.match(C37, /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid\) from public, anon, authenticated;/);
  assert.match(C37, /grant execute on function public\.issue_payment_document\(uuid, date\) to authenticated;/);
});

test("the freeze trigger is 0033's plus: a cancelled document never changes, and cancelling only inside the correction", () => {
  const was = fn(read("0033_membership_service_details.sql"), "create or replace function public.invoices_freeze_snapshot()");
  const now = fn(M37, "create or replace function public.invoices_freeze_snapshot()");
  const restored = now.replace(/  -- 0037: a cancelled document is final[\s\S]*?  end if;\n\n  -- 0037: only correct_payment_document\(\)[\s\S]*?  end if;\n\n/, "");
  assert.equal(restored, was);
  assert.match(now, /if old\.status = 'cancelled' then\s+raise exception 'A cancelled document cannot be changed\.'/);
  assert.match(now, /current_setting\('yoga\.invoice_cancel', true\) = old\.id::text then\s+v_exempt := v_exempt \|\| array\['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason'\];/);
});

// ---- schema -------------------------------------------------------------------------------------------------------

test("0037 adds status, cancellation and the replacement link, and changes no existing row", () => {
  assert.match(C37, /add column if not exists status text not null default 'issued'/);
  assert.match(C37, /add column if not exists cancelled_by uuid references auth\.users \(id\) on delete set null/);
  assert.match(C37, /add column if not exists replaces_id uuid references public\.invoices \(id\) on delete restrict/);
  assert.match(C37, /check \(status in \('issued', 'cancelled'\)\)/);
  assert.match(C37, /status = 'cancelled' and cancelled_at is not null\s+and cancellation_reason is not null/);
  assert.match(C37, /check \(\(status = 'issued' and replaces_id is null\) or payment_id is not null\)/);
  const outside = C37.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("one issued document per payment, and a document is replaced at most once", () => {
  assert.match(C37, /create unique index invoices_payment_id_unique\s+on public\.invoices \(payment_id\)\s+where payment_id is not null and status = 'issued';/);
  assert.match(C37, /create unique index if not exists invoices_replaces_id_unique\s+on public\.invoices \(replaces_id\)\s+where replaces_id is not null;/);
});

// ---- the correction ------------------------------------------------------------------------------------------------

const CORRECT = fn(C37, "create or replace function public.correct_payment_document(");

test("correct_payment_document: Admin only, a required reason, payment documents only, never twice", () => {
  assert.match(CORRECT, /security definer\s+set search_path = ''/);
  assert.match(CORRECT, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  assert.match(CORRECT, /'Enter the reason for the correction\.'/);
  assert.match(CORRECT, /if v_doc\.payment_id is null then\s+raise exception 'Only a payment document can be corrected\.'/);
  assert.match(CORRECT, /if v_doc\.status <> 'issued' then\s+raise exception 'This document has already been cancelled\.'/);
  assert.match(C37, /grant execute on function public\.correct_payment_document\(uuid, text\) to authenticated;/);
});

test("the correction takes the issuing locks first, then the document, so concurrent corrections serialize", () => {
  const membership = CORRECT.indexOf("from public.memberships where id = v_doc.membership_id for update");
  const settings = CORRECT.indexOf("from public.invoice_settings where singleton for update");
  const doc = CORRECT.indexOf("where id = p_document_id\n  for update;");
  assert.ok(membership > 0 && settings > membership && doc > settings, "membership, settings, then the document");
  // The status is checked AFTER the document lock, so the second of two concurrent corrections finds it cancelled.
  assert.ok(CORRECT.indexOf("if v_doc.status <> 'issued'") > doc);
});

test("cancel, then reissue in the same series dated as the original - one function, so a failure rolls both back", () => {
  const cancel = CORRECT.indexOf("set status              = 'cancelled'");
  const reissue = CORRECT.indexOf("public.issue_payment_document_core(v_doc.payment_id, v_doc.invoice_date, v_doc.document_series, v_doc.id)");
  assert.ok(cancel > 0 && reissue > cancel, "the original is cancelled before the replacement takes the one issued slot");
  assert.match(CORRECT, /perform set_config\('yoga\.invoice_cancel', v_doc\.id::text, true\);/);
  assert.match(CORRECT, /perform set_config\('yoga\.invoice_cancel', '', true\);/);
  assert.doesNotMatch(CORRECT, /exception when/i, "nothing is swallowed: any failure aborts the whole correction");
  // The payment, its methods and the membership are never written.
  assert.doesNotMatch(CORRECT, /update public\.(membership_payments|membership_payment_methods|memberships)|delete from/);
});

// ---- the application ---------------------------------------------------------------------------------------------------

test("Correct Document sends the document and the trimmed reason, and refuses an empty reason before calling", async () => {
  const calls = [];
  const supabase = { rpc: async (name, args) => (calls.push({ name, args }), { data: "new-doc", error: null }) };
  assert.deepEqual(await correctPaymentDocumentFor(supabase, "doc-1", "  Wrong student name  "), { success: true, invoiceId: "new-doc" });
  assert.deepEqual(calls, [{ name: "correct_payment_document", args: { p_document_id: "doc-1", p_reason: "Wrong student name" } }]);
  const empty = await correctPaymentDocumentFor(supabase, "doc-1", "   ");
  assert.equal(empty.fieldErrors.reason, "Enter the reason for the correction.");
  assert.equal(calls.length, 1, "no call without a reason");
  const twice = await correctPaymentDocumentFor({ rpc: async () => ({ data: null, error: { code: "55006", message: "This document has already been cancelled." } }) }, "doc-1", "x");
  assert.equal(twice.error, "This document has already been cancelled and corrected.");
});

const doc = (overrides = {}) => ({
  id: "d1", membership_id: "m1", payment_id: "p1", document_series: "payment_receipt", document_title: "payment_receipt",
  invoice_number: 31, invoice_prefix: "PR-", invoice_date: "2026-12-05", payment_date: "2026-12-04",
  description: "Monthly Membership", plan: "monthly", period_start: "2026-12-01", period_end: "2026-12-31",
  currency: "INR", total_amount: 1000, tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null,
  customer_name: "Asha Rao", customer_code: "YC-000012", business_name: "Sri Yoga Center",
  status: "issued", cancelled_at: null, cancellation_reason: null, ...overrides,
});

test("a cancelled document carries its cancellation in the view model; an issued one carries none", () => {
  assert.equal(buildInvoiceDocument(doc()).cancellation, null);
  const cancelled = buildInvoiceDocument(doc({ status: "cancelled", cancelled_at: "2026-12-06T04:00:00Z", cancelled_on: "2026-12-06", cancellation_reason: "Wrong student name" }));
  assert.deepEqual(cancelled.cancellation, { date: "Dec 06, 2026", reason: "Wrong student name" });
  // Nothing else in the document changes: it keeps its number, amount and dates.
  assert.equal(cancelled.number, "PR-31");
  assert.equal(cancelled.amounts.total, "₹1,000.00");
});

test("the printed and downloaded copies of a cancelled document say CANCELLED, with the reason", async () => {
  const cancelled = doc({ status: "cancelled", cancelled_on: "2026-12-06", cancellation_reason: "Wrong student name" });
  const joined = extractPdfText(await renderToBuffer(createElement(InvoicePdf, { invoiceDocument: buildInvoiceDocument(cancelled) }))).join(" ");
  assert.ok(joined.includes("CANCELLED ON DEC 06, 2026"), joined);
  assert.ok(joined.includes("Cancellation reason: Wrong student name"));
  const issued = extractPdfText(await renderToBuffer(createElement(InvoicePdf, { invoiceDocument: buildInvoiceDocument(doc()) }))).join(" ");
  assert.ok(!issued.toUpperCase().includes("CANCELLED"));
  const html = source("../../app/memberships/[id]/invoice/invoice-document.js");
  assert.match(html, /\{doc\.cancellation \? \(/);
  assert.match(html, /Cancellation reason: \{doc\.cancellation\.reason\}/);
});

test("the document page offers Correct Document only on an issued document, and links a cancelled one to its replacement", () => {
  const page = source("../../app/memberships/[id]/documents/[documentId]/page.js");
  assert.match(page, /\{isCancelled \? null : \(\s*<CorrectDocument/);
  assert.match(page, /const replacement = document\.history\.find\(\(row\) => row\.replaces_id === document\.id\)/);
  assert.match(page, /Replaced by/);
  assert.match(page, /This document replaces/);
  assert.match(page, /Correction History/);
  const dialog = source("../../app/memberships/[id]/documents/[documentId]/correct-document.js");
  assert.match(dialog, /if \(!reason\.trim\(\)\) \{\s*setFieldError\("Enter the reason for the correction\."\);\s*return;\s*\}/);
  assert.match(dialog, /router\.push\(`\/memberships\/\$\{membershipId\}\/documents\/\$\{result\.invoiceId\}`\)/);
});

test("the payments list shows the current issued document, and marks a payment whose document was corrected", () => {
  const core = source("../memberships/payments-core.js");
  assert.match(core, /document: documents\.find\(\(doc\) => \(doc\.status \?\? "issued"\) === "issued"\) \?\? null/);
  assert.match(core, /corrected: documents\.some\(\(doc\) => doc\.status === "cancelled"\)/);
});
