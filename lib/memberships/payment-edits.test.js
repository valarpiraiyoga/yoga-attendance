// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 8 - editing a recorded payment's amount before its document is issued (migration 0038):
// the validation, the database call, the read of what is editable, the SQL (read as text: the edit function, the
// audit trail, and the issuing core re-created with only the concurrency fix) and the UI's visibility rules.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editPaymentAmountFor, fetchPaymentsForMembership, matchKnownPaymentError, validatePaymentEdit } from "./payments-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const M38 = read("../../supabase/migrations/0038_payment_amount_edits.sql");
const C38 = M38.replace(/^\s*--.*$/gm, "");

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

const METHODS = [{ id: "m-cash" }, { id: "m-upi" }];

// ---- validation -------------------------------------------------------------------------------------------------

test("an edit gives every existing method an amount; the total is their sum", () => {
  const result = validatePaymentEdit({ allocations: [{ id: "m-upi", amount: "150.5" }, { id: "m-cash", amount: "200" }] }, { methods: METHODS, availablePaise: 100000 });
  assert.equal(result.success, true);
  // In the payment's own method order, normalized to two decimals.
  assert.deepEqual(result.data, { allocations: [{ id: "m-cash", amount: "200.00" }, { id: "m-upi", amount: "150.50" }], totalPaise: 35050 });
});

test("no method may be left out, added or replaced", () => {
  for (const allocations of [
    [{ id: "m-cash", amount: "100" }],
    [{ id: "m-cash", amount: "100" }, { id: "m-upi", amount: "100" }, { id: "m-card", amount: "100" }],
    [{ id: "m-cash", amount: "100" }, { id: "m-card", amount: "100" }],
    [],
  ]) {
    const result = validatePaymentEdit({ allocations }, { methods: METHODS, availablePaise: 100000 });
    assert.equal(result.success, false, JSON.stringify(allocations));
    assert.equal(result.errors.allocations, "Enter an amount for each payment method.");
  }
});

test("each amount is positive, with at most two decimals", () => {
  for (const bad of ["0", "-5", "1.234", "", "abc"]) {
    const result = validatePaymentEdit({ allocations: [{ id: "m-cash", amount: bad }, { id: "m-upi", amount: "10" }] }, { methods: METHODS, availablePaise: 100000 });
    assert.equal(result.success, false, bad);
    assert.match(result.errors.rows["m-cash"], /greater than zero/);
  }
});

test("the total may use this payment's own previous amount, but not more than the membership allows", () => {
  // Membership 1,000; another payment 600; this payment was 400 -> it may be anything up to 400.
  const available = 100000 - 60000;
  const at = (cash, upi) => validatePaymentEdit({ allocations: [{ id: "m-cash", amount: cash }, { id: "m-upi", amount: upi }] }, { methods: METHODS, availablePaise: available });
  assert.equal(at("300", "100").success, true, "the full 400");
  assert.equal(at("50", "50").success, true, "reduced to 100");
  const over = at("300", "100.01");
  assert.equal(over.success, false);
  assert.equal(over.errors.allocations, "The payment cannot be more than the outstanding balance.");
});

// ---- the database call and the read ------------------------------------------------------------------------------------

test("an edit is one call to edit_payment_amount with the method allocations; the database's refusals are shown plainly", async () => {
  const calls = [];
  const supabase = { rpc: async (name, args) => (calls.push({ name, args }), { data: "p1", error: null }) };
  const allocations = [{ id: "m-cash", amount: "200.00" }];
  assert.deepEqual(await editPaymentAmountFor(supabase, "p1", { allocations }), { success: true });
  assert.deepEqual(calls, [{ name: "edit_payment_amount", args: { p_payment_id: "p1", p_allocations: allocations } }]);
  const blocked = matchKnownPaymentError({ code: "55006", message: "A document has been issued for this payment, so its amount cannot be edited." });
  assert.match(blocked.error, /Correct the document instead/);
});

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

test("Edit Amount is offered only beside Issue Document, and only while the payment has no document", () => {
  const panel = code("../../app/memberships/[id]/payments-panel.js");
  const noDocument = panel.slice(panel.indexOf("{payment.document ? ("), panel.indexOf("</TableCell>", panel.indexOf("{payment.document ? (")));
  assert.match(noDocument, /\) : \(\s*<div className="flex flex-wrap items-center gap-2">\s*\{canIssueDocument \? \(\s*<IssuePaymentDocument/);
  assert.match(noDocument, /\{payment\.editable \? \(\s*<EditPaymentAmount/);
  assert.equal((panel.match(/<EditPaymentAmount/g) ?? []).length, 1);
  // The edit trail shows under the amount: what it was before the first edit.
  assert.match(panel, /Edited · was \{formatCurrency\(payment\.edits\[0\]\.previous_amount, currency\)\}/);
});

test("the dialog opens with each method's amount, shows the new total and the balance, and sends every method", () => {
  const dialog = code("../../app/memberships/[id]/edit-payment-amount.js");
  assert.match(dialog, /Object\.fromEntries\(methods\.map\(\(method\) => \[method\.id, method\.amount\]\)\)/);
  assert.match(dialog, /const availablePaise = balancePaise \+ \(toPaise\(Number\(paymentAmount\)\.toFixed\(2\)\) \?\? 0\);/);
  assert.match(dialog, /New total/);
  assert.match(dialog, /Balance after this edit/);
  assert.match(dialog, /allocations: methods\.map\(\(method\) => \(\{ id: method\.id, amount: amounts\[method\.id\] \}\)\)/);
  assert.doesNotMatch(dialog, /Add method|removeRow|addRow|name="method"/, "no method is added or removed");
});

test("the action requires the Admin role first and refuses a payment that has a document", () => {
  const actions = code("./payment-actions.js");
  const edit = actions.slice(actions.indexOf("export async function editMembershipPayment("));
  assert.ok(edit.indexOf("await requireRole(ROLES.ADMIN)") < edit.indexOf("createClient()"));
  assert.match(edit, /if \(!payment\.editable\) \{\s*return \{ error:/);
  assert.match(edit, /editPaymentAmountFor\(supabase, paymentId, result\.data\)/);
});
