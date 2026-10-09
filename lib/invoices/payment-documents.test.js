// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 4 - payment-level documents and the separate payment receipt sequence
// (migration 0036). The SQL is read as text: every membership-level function 0036 re-creates must be
// its latest definition with only the payment conditions added, and the new issuing function must keep
// the two sequences apart. The application pieces are tested directly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issuePaymentDocumentFor } from "./invoice-core.js";
import { DOCUMENT_TITLE_LABEL, getInvoiceSectionState } from "./membership-invoice.js";
import { invoiceExistsOf, membershipDocumentAction } from "../memberships/document-action.js";

const MIGRATIONS = "../../supabase/migrations/";
const read = (name) => readFileSync(new URL(`${MIGRATIONS}${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const M36 = read("0036_payment_documents.sql");
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");
const C36 = code(M36);

/** One `create or replace function` from its header to its closing `$$;`, as written (comments in). */
function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

// ---- every re-created function is its latest definition plus only the payment conditions -------------------

const SAME_EXCEPT = [
  ["0033_membership_service_details.sql", "create or replace function public.issue_invoice_core(", [
    [/\n\n  -- 0036: a membership paid through recorded payments[\s\S]*?using errcode = '55000';\n  end if;/, ""],
    [" and payment_id is null) then", ") then"],
    [" and document_series = 'invoice') loop", ") loop"],
  ]],
  ["0026_invoices.sql", "create or replace function public.issue_invoice(", [[" and payment_id is null) then", ") then"]]],
  ["0033_membership_service_details.sql", "create or replace function public.sync_invoice_from_membership(", [
    ["\n    and payment_id is null   -- 0036: payment documents never follow the membership", ""],
  ]],
  ["0026_invoices.sql", "create or replace function public.memberships_invoice_guard()", [[" and payment_id is null) then", ") then"]]],
  ["0026_invoices.sql", "create or replace function public.memberships_auto_issue_invoice()", [
    [/ and payment_id is null\)\n     -- 0036:[^\n]*\n     and not exists \(select 1 from public\.membership_payments where membership_id = new\.id\) then/, ") then"],
  ]],
  ["0027_invoice_prefix.sql", "create or replace function public.invoice_settings_guard()", [
    [" where document_series = 'invoice')", ")"],
    [/\n\n  -- 0036: the payment receipt series[\s\S]*?new\.payment_receipt_next_number := null;\n  end if;/, ""],
    [",\n      new.payment_receipt_starting_number, new.payment_receipt_prefix)", ")"],
    [",\n      old.payment_receipt_starting_number, old.payment_receipt_prefix)", ")"],
  ]],
  ["0030_invoice_membership_sync.sql", "create or replace function public.invoices_reserve_number()", [
    [/  -- 0036: each number series has its own reservations[\s\S]*?    return new;\n  end if;\n\n/, ""],
  ]],
  ["0026_invoices.sql", "create or replace function public.update_invoice_details(", [
    [/  if v_invoice\.document_series = 'payment_receipt' then[\s\S]*?  elsif v_settings\.starting_invoice_number is not null/, "  if v_settings.starting_invoice_number is not null"],
    ["\n      and document_series = v_invoice.document_series", ""],
  ]],
];

for (const [source, header, undo] of SAME_EXCEPT) {
  test(`0036 re-creates ${header.match(/public\.(\w+)/)[1]} from ${source.slice(0, 4)} with only the payment conditions added`, () => {
    let now = fn(M36, header);
    for (const [from, to] of undo) {
      const before = now;
      now = now.replace(from, to);
      assert.notEqual(now, before, `the change ${String(from).slice(0, 60)} is present`);
    }
    assert.equal(now, fn(read(source), header));
  });
}

// ---- schema ---------------------------------------------------------------------------------------------------

test("0036 links documents to payments and series without touching existing rows", () => {
  assert.match(C36, /add column if not exists payment_id uuid references public\.membership_payments \(id\) on delete restrict;/);
  assert.match(C36, /add column if not exists document_series text not null default 'invoice';/);
  assert.match(C36, /check \(document_series in \('invoice', 'payment_receipt'\)\)/);
  assert.match(C36, /check \(document_title in \('invoice', 'receipt', 'payment_receipt'\)\)/);
  // A payment receipt documents a payment, carries no tax, and is the only document titled so.
  assert.match(C36, /\(document_series = 'payment_receipt'\) = \(document_title = 'payment_receipt'\)/);
  assert.match(C36, /document_series <> 'payment_receipt' or \(payment_id is not null and tax_enabled = false\)/);
  const outside = C36.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("uniqueness per kind: one membership-level document per membership, one document per payment, numbers unique per series", () => {
  assert.match(C36, /create unique index invoices_membership_id_unique\s+on public\.invoices \(membership_id\)\s+where payment_id is null;/);
  assert.match(C36, /create unique index if not exists invoices_payment_id_unique\s+on public\.invoices \(payment_id\)\s+where payment_id is not null;/);
  assert.match(C36, /create unique index invoices_invoice_number_unique\s+on public\.invoices \(invoice_number\)\s+where document_series = 'invoice';/);
  assert.match(C36, /create unique index if not exists invoices_payment_receipt_number_unique\s+on public\.invoices \(invoice_number\)\s+where document_series = 'payment_receipt';/);
});

test("payment receipt numbers have their own permanent reservations, with no client access", () => {
  assert.match(C36, /create table if not exists public\.payment_receipt_number_reservations \(\s+receipt_number bigint\s+primary key check \(receipt_number > 0\)/);
  assert.match(C36, /revoke all on public\.payment_receipt_number_reservations from anon, authenticated;/);
  assert.match(C36, /alter table public\.payment_receipt_number_reservations enable row level security;/);
});

test("the payment receipt settings: starting number and prefix are Admin-writable; the counter is not", () => {
  assert.match(C36, /add column if not exists payment_receipt_starting_number bigint,\s+add column if not exists payment_receipt_next_number bigint,\s+add column if not exists payment_receipt_prefix text;/);
  assert.match(C36, /grant update \(payment_receipt_starting_number, payment_receipt_prefix\) on public\.invoice_settings to authenticated;/);
  assert.doesNotMatch(C36, /grant update \([^)]*payment_receipt_next_number/);
  assert.match(C36, /payment_receipt_prefix !~ '\[0-9\]\$'/);
});

// ---- issuing a payment's document -----------------------------------------------------------------------------

const ISSUE = fn(C36, "create or replace function public.issue_payment_document(");

test("issue_payment_document: Admin only, the same lock order as issue_invoice_core, one document per payment", () => {
  assert.match(ISSUE, /security definer\s+set search_path = ''/);
  assert.match(ISSUE, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  const lockMembership = ISSUE.indexOf("from public.memberships\n  where id = v_payment.membership_id\n  for update;");
  const lockSettings = ISSUE.indexOf("from public.invoice_settings\n  where singleton\n  for update;");
  assert.ok(lockMembership > 0 && lockSettings > lockMembership, "membership row, then settings row");
  assert.match(ISSUE, /if exists \(select 1 from public\.invoices where payment_id = v_payment\.id\) then\s+raise exception 'A document has already been issued for this payment\.'/);
  assert.match(C36, /grant execute on function public\.issue_payment_document\(uuid, date\) to authenticated;/);
});

test("the payment's own choice picks the series; each series numbers only against itself", () => {
  assert.match(ISSUE, /v_series := case when v_payment\.issue_tax_invoice then 'invoice' else 'payment_receipt' end;/);
  assert.match(ISSUE, /invoice_number_reservations where invoice_number = v_candidate\)\s+or exists \(select 1 from public\.invoices where invoice_number = v_candidate and document_series = 'invoice'\)/);
  assert.match(ISSUE, /payment_receipt_number_reservations where receipt_number = v_candidate\)\s+or exists \(select 1 from public\.invoices where invoice_number = v_candidate and document_series = 'payment_receipt'\)/);
  assert.match(ISSUE, /update public\.invoice_settings set next_invoice_number = v_candidate \+ 1 where singleton;/);
  assert.match(ISSUE, /update public\.invoice_settings set payment_receipt_next_number = v_candidate \+ 1 where singleton;/);
  assert.match(ISSUE, /'Payment receipt numbering has not been configured\.'/);
});

test("a tax invoice carries the tax (tax-inclusive, on the payment amount); a payment receipt carries none", () => {
  assert.match(ISSUE, /v_taxed := v_series = 'invoice' and v_settings\.tax_enabled;/);
  assert.match(ISSUE, /v_tax := round\(v_payment\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\);/);
  assert.match(ISSUE, /case when v_series = 'invoice' then v_settings\.document_title else 'payment_receipt' end/);
  assert.match(ISSUE, /case when v_series = 'invoice' then v_settings\.invoice_prefix else v_settings\.payment_receipt_prefix end/);
  assert.match(ISSUE, /v_mem\.currency, v_payment\.amount,/);
});

test("payment documents never follow the membership and nothing issues one automatically", () => {
  assert.doesNotMatch(C36, /create trigger/i, "0036 adds no trigger");
  assert.match(fn(C36, "create or replace function public.sync_invoice_from_membership("), /and payment_id is null/);
  assert.match(fn(C36, "create or replace function public.memberships_auto_issue_invoice()"), /not exists \(select 1 from public\.membership_payments where membership_id = new\.id\)/);
  assert.match(fn(C36, "create or replace function public.issue_invoice_core("), /'This membership has recorded payments: issue a document for each payment\.'/);
});

// ---- the application ------------------------------------------------------------------------------------------------

test("Issue Document sends only the payment to issue_payment_document", async () => {
  const calls = [];
  const supabase = { rpc: async (name, args) => (calls.push({ name, args }), { data: "doc-1", error: null }) };
  assert.deepEqual(await issuePaymentDocumentFor(supabase, "pay-1"), { success: true, invoiceId: "doc-1" });
  assert.deepEqual(calls, [{ name: "issue_payment_document", args: { p_payment_id: "pay-1" } }]);
  const refused = await issuePaymentDocumentFor({ rpc: async () => ({ data: null, error: { code: "23505", message: "A document has already been issued for this payment." } }) }, "pay-1");
  assert.equal(refused.error, "A document has already been issued for this payment.");
  assert.equal((await issuePaymentDocumentFor(supabase, "")).error, "Could not issue the document. Try again.");
});

test("a payment document is not the membership's receipt: lists and sections see only the membership-level one", () => {
  assert.equal(invoiceExistsOf([{ id: "d", payment_id: "p" }]), false);
  assert.equal(invoiceExistsOf([{ id: "d", payment_id: "p" }, { id: "m", payment_id: null }]), true);
  assert.equal(invoiceExistsOf([{ id: "legacy" }]), true, "an older read without payment_id still counts");
  assert.deepEqual(membershipDocumentAction("m1", "paid", false, true), { kind: "payments", label: "View Payments", href: "/memberships/m1" });
  assert.equal(membershipDocumentAction("m1", "paid", false, false).kind, "issue-receipt", "unchanged without payments");
  assert.equal(membershipDocumentAction("m1", "paid", true, true).kind, "receipt", "an existing membership-level receipt stays reachable");
  const paid = { payment_status: "paid", payment_date: "2026-10-01" };
  assert.equal(getInvoiceSectionState({ membership: paid, invoice: null, hasPayments: true }).canIssue, false);
  assert.equal(getInvoiceSectionState({ membership: paid, invoice: null }).canIssue, true);
  assert.equal(DOCUMENT_TITLE_LABEL.payment_receipt, "Payment Receipt");
});

test("the membership-level invoice page reads only the membership-level document; payment documents have their own page", () => {
  const core = readFileSync(new URL("./invoice-core.js", import.meta.url), "utf8");
  assert.match(core, /\.eq\("membership_id", membershipId\)\s*\/\/[^\n]*\n\s*\.is\("payment_id", null\)/);
  const data = readFileSync(new URL("./data.js", import.meta.url), "utf8");
  assert.match(data, /if \(!document \|\| document\.membership_id !== membershipId \|\| !document\.payment_id\) return null;/);
  const page = readFileSync(new URL("../../app/memberships/[id]/documents/[documentId]/page.js", import.meta.url), "utf8");
  assert.match(page, /getPaymentDocument\(id, documentId\)/);
  assert.match(page, /if \(!document\) \{\s*notFound\(\);\s*\}/);
  const route = readFileSync(new URL("../../app/memberships/[id]/documents/[documentId]/pdf/route.js", import.meta.url), "utf8");
  assert.match(route, /requireAdmin: \(\) => requireRole\(ROLES\.ADMIN\)/);
  assert.match(route, /getInvoice: \(membershipId\) => getPaymentDocument\(membershipId, documentId\)/);
});
