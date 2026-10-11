// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 8 - editing a recorded payment's amount before its document is issued (migration 0038):
// the read of what is editable, and the SQL (read as text: the edit function, the audit trail, and the issuing core
// re-created with only the concurrency fix). Migration 0040 later widened the edit to the whole payment; the app now
// calls edit_payment, tested in payment-edit-details.test.js. 0038's function and audit trail remain as history.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchPaymentsForMembership } from "./payments-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const M38 = read("../../supabase/migrations/0038_payment_amount_edits.sql");
const C38 = M38.replace(/^\s*--.*$/gm, "");

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

// ---- the read ------------------------------------------------------------------------------------------------------------

function fakeSupabase(rows) {
  const builder = { select: () => builder, eq: () => builder, order: () => builder, then: (resolve) => resolve({ data: rows, error: null }) };
  return { from: () => builder };
}

test("a payment is editable only while it has no document at all - not even a cancelled one - and its edits come oldest first", async () => {
  const base = { id: "p", amount: 100, membership_payment_methods: [], membership_payment_edits: [] };
  const [none, issued, cancelledOnly, corrected] = await fetchPaymentsForMembership(
    fakeSupabase([
      { ...base, id: "none", invoices: [] },
      { ...base, id: "issued", invoices: [{ id: "d1", status: "issued" }] },
      { ...base, id: "cancelled", invoices: [{ id: "d1", status: "cancelled" }] },
      { ...base, id: "corrected", invoices: [{ id: "d1", status: "cancelled" }, { id: "d2", status: "issued" }] },
    ]),
    "m1"
  );
  assert.equal(none.editable, true);
  assert.equal(issued.editable, false);
  assert.equal(cancelledOnly.editable, false);
  assert.equal(corrected.editable, false);

  const [edited] = await fetchPaymentsForMembership(
    fakeSupabase([{ ...base, invoices: [], membership_payment_edits: [
      { id: "e2", edited_at: "2026-12-06T10:00:00Z", previous_amount: 900, new_amount: 800 },
      { id: "e1", edited_at: "2026-12-05T10:00:00Z", previous_amount: 1000, new_amount: 900 },
    ] }]),
    "m1"
  );
  assert.deepEqual(edited.edits.map((e) => e.id), ["e1", "e2"]);
});

// ---- the migration ------------------------------------------------------------------------------------------------------

test("0038 checks its preconditions first and changes no existing row", () => {
  assert.ok(C38.indexOf("needs migration 0037") < C38.indexOf("create table if not exists public.membership_payment_edits"));
  const outside = C38.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("the audit trail keeps who, when, the previous and new amount and every allocation; Admin may read, nobody writes", () => {
  const table = C38.slice(C38.indexOf("create table if not exists public.membership_payment_edits"), C38.indexOf(");", C38.indexOf("create table if not exists public.membership_payment_edits")));
  for (const column of ["payment_id", "edited_at", "edited_by", "previous_amount", "new_amount", "previous_allocations", "new_allocations"]) {
    assert.match(table, new RegExp(`\\b${column}\\b`), column);
  }
  assert.match(C38, /alter table public\.membership_payment_edits enable row level security;/);
  assert.match(C38, /revoke all on public\.membership_payment_edits from public, anon, authenticated;/);
  assert.match(C38, /grant select on public\.membership_payment_edits to authenticated;/);
  assert.match(C38, /using \(public\.is_admin\(\)\);/);
  assert.doesNotMatch(C38, /grant (insert|update|delete)[^;]*membership_payment_edits/i);
});

const EDIT = fn(C38, "create or replace function public.edit_payment_amount(");

test("edit_payment_amount: Admin only; the membership locked before the payment; refused once ANY document exists", () => {
  assert.match(EDIT, /security definer\s+set search_path = ''/);
  assert.match(EDIT, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  const membershipLock = EDIT.indexOf("from public.memberships\n  where id = v_payment.membership_id\n  for update;");
  const paymentLock = EDIT.indexOf("from public.membership_payments\n  where id = p_payment_id\n  for update;");
  assert.ok(membershipLock > 0 && paymentLock > membershipLock, "membership, then payment");
  const documentCheck = EDIT.indexOf("if exists (select 1 from public.invoices where payment_id = v_payment.id) then");
  assert.ok(documentCheck > paymentLock, "checked under the locks");
  assert.doesNotMatch(EDIT.slice(documentCheck, documentCheck + 120), /status/, "issued or cancelled alike");
  assert.match(C38, /grant execute on function public\.edit_payment_amount\(uuid, jsonb\) to authenticated;/);
});

test("every existing method gets one positive amount; the total is checked against the membership less the OTHER payments", () => {
  assert.match(EDIT, /where id = v_method_id and payment_id = v_payment\.id/);
  assert.match(EDIT, /if v_amount is null or v_amount <= 0 or v_amount <> round\(v_amount, 2\) then/);
  assert.match(EDIT, /if v_count <> v_methods\s+or \(select count\(distinct value ->> 'id'\) from jsonb_array_elements\(p_allocations\)\) <> v_methods then/);
  assert.match(EDIT, /where membership_id = v_mem\.id and id <> v_payment\.id;/);
  assert.match(EDIT, /if v_total > v_mem\.amount - v_other then/);
});

test("only the amounts change: method types, references and notes are never written, and nothing is added or removed", () => {
  const update = EDIT.slice(EDIT.indexOf("update public.membership_payment_methods m"), EDIT.indexOf("update public.membership_payments\n"));
  assert.match(update, /set amount = \(a\.value ->> 'amount'\)::numeric/);
  assert.doesNotMatch(update, /method\s*=|reference_id\s*=|notes\s*=|position\s*=/);
  assert.doesNotMatch(EDIT, /insert into public\.membership_payment_methods|delete from/i);
  assert.match(EDIT, /update public\.membership_payments\s+set amount = v_total\s+where id = v_payment\.id;/);
  assert.doesNotMatch(EDIT, /payment_date\s*=\s*[^;]*v_payment|issue_tax_invoice\s*=/, "the payment date and the tax choice stay as recorded");
});

test("each edit is recorded with its previous amount before the payment is changed; an unchanged edit records nothing", () => {
  assert.ok(EDIT.indexOf("into v_previous") < EDIT.indexOf("update public.membership_payment_methods m"));
  assert.match(EDIT, /insert into public\.membership_payment_edits \(payment_id, edited_by, previous_amount, new_amount, previous_allocations, new_allocations\)\s+values \(v_payment\.id, auth\.uid\(\), v_payment\.amount, v_total, v_previous, v_new\);/);
  assert.match(EDIT, /if v_total = v_payment\.amount and not exists \([\s\S]*?\) then\s+return v_payment\.id;\s+end if;/);
});

test("the membership's status and payment date follow the payments, set under the payments guard's marker", () => {
  assert.match(EDIT, /v_status := case when v_other \+ v_total >= v_mem\.amount then 'paid' else 'partially_paid' end;/);
  assert.match(EDIT, /select max\(payment_date\) into v_latest/);
  assert.match(EDIT, /payment_date   = case when v_status = 'paid' then v_latest else null end/);
  assert.match(EDIT, /perform set_config\('yoga\.payment_status_sync', v_mem\.id::text, true\);/);
  assert.match(EDIT, /perform set_config\('yoga\.payment_status_sync', '', true\);/);
});

test("the issuing core is 0037's with only the payment re-read, locked, after the membership and settings locks", () => {
  const was = fn(read("../../supabase/migrations/0037_invoice_corrections.sql"), "create or replace function public.issue_payment_document_core(");
  const now = fn(M38, "create or replace function public.issue_payment_document_core(");
  const reread = /\n\n  -- 0038: read the payment again[^\n]*\n[^\n]*\n  select \* into v_payment\n  from public\.membership_payments\n  where id = p_payment_id\n  for update;\n/;
  assert.match(now, reread);
  assert.equal(now.replace(reread, "\n"), was);
  assert.ok(now.indexOf("where singleton\n  for update;") < now.search(reread), "after the settings lock");
  assert.match(C38, /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid\) from public, anon, authenticated;/);
});

// ---- the application ------------------------------------------------------------------------------------------------------
