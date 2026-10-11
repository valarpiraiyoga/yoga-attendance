// Run with `npm test` (Node's built-in test runner).
//
// Two focused UI improvements.
//
// 1. The Membership form (Create and Edit) no longer shows, explains or submits a Payment Status.
// 2. Edit Payment (migration 0040): until a document is issued, a recorded payment's date and its methods (type,
//    amount, reference, notes; added, changed or removed) can all be edited, as ONE save that is validated first, written
//    in one transaction, audited, and followed by the membership's payment status. The SQL is read as text; the
//    validation and the database call are tested for real; the dialog and the panel are pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editPaymentFor, fetchPaymentsForMembership, matchKnownPaymentError, toPaise, validatePaymentInput } from "./payments-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (text) => text.replace(/^\s*--.*$/gm, "");

const M40 = read("../../supabase/migrations/0040_edit_payment_details.sql");
const C40 = sqlCode(M40);
const C35 = sqlCode(read("../../supabase/migrations/0035_tax_invoice_preferences.sql"));
const C38 = sqlCode(read("../../supabase/migrations/0038_payment_amount_edits.sql"));

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

const EDIT = fn(C40, "create or replace function public.edit_payment(");
const RECORD = fn(C35, "create or replace function public.record_membership_payment(");

// ==== 1. The Membership form ==========================================================================================

test("Create and Edit Membership show no Payment Status, no explanation of it, and submit none", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.doesNotMatch(form, /Payment Status|Managed from Payments|PAYMENT_STATUS/);
  assert.doesNotMatch(form, /name="payment_status"|payment_status:|formData\.get\("payment_status"\)/);
  // The amount is still there, with its own label and error.
  assert.match(form, /name="amount"/);
  assert.match(form, /<Label htmlFor="amount">Amount \(\{currency\}\)<\/Label>/);
});

test("the payment status stays automatic: no action or validator reads one from the form, and the database owns it", () => {
  assert.doesNotMatch(code("./actions.js"), /payment_status|PAYMENT_STATUS/);
  assert.doesNotMatch(code("./validation.js"), /payment_status|PAYMENT_STATUS/);
  // Recording and editing a payment are the only things that move it, under the payments guard's marker.
  assert.match(RECORD, /perform set_config\('yoga\.payment_status_sync', v_mem\.id::text, true\);/);
  assert.match(EDIT, /perform set_config\('yoga\.payment_status_sync', v_mem\.id::text, true\);/);
  // It is still read where it matters.
  assert.match(code("../../app/memberships/[id]/page.js"), /PAYMENT_STATUS\[membership\.payment_status\]/);
});

// ==== 2. Edit Payment: validation (the Record Payment validator, against what this payment may total) ==================

// A membership of 1,000 with another payment of 600: this payment (currently 400) may total up to 400.
const AVAILABLE = toPaise("1000") - toPaise("600");
const TODAY = "2026-10-11";
const row = (method, amount, referenceId = "", notes = "") => ({ method, amount, referenceId, notes });
const check = (input) => validatePaymentInput(input, { today: TODAY, balancePaise: AVAILABLE });

test("the date, the methods, the amounts, the references and the notes can all be changed in one edit", () => {
  const result = check({
    paymentDate: "2026-10-02",
    methods: [row("upi", "250.50", "  UPI-998877 ", "Paid by parent"), row("cash", "149.50", "", "Balance in cash")],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.paymentDate, "2026-10-02");
  assert.equal(result.data.totalPaise, 40000);
  assert.deepEqual(result.data.methods, [
    { method: "upi", amount: "250.50", reference_id: "UPI-998877", notes: "Paid by parent" },
    { method: "cash", amount: "149.50", reference_id: null, notes: "Balance in cash" },
  ]);
});

test("methods can be added and removed, so the total is simply the sum of what is entered", () => {
  assert.equal(check({ paymentDate: TODAY, methods: [row("cash", "400")] }).data.totalPaise, 40000, "one method");
  assert.equal(check({ paymentDate: TODAY, methods: [row("cash", "100"), row("card", "100"), row("upi", "100"), row("bank_transfer", "50")] }).data.totalPaise, 35000, "four methods");
  assert.equal(check({ paymentDate: TODAY, methods: [] }).errors.methods, "Add at least one payment method.", "none left");
});

test("the total may reduce or use the whole allowance, but never exceed it", () => {
  assert.equal(check({ paymentDate: TODAY, methods: [row("cash", "400")] }).success, true, "its own previous amount is available");
  assert.equal(check({ paymentDate: TODAY, methods: [row("cash", "1")] }).success, true, "reduced");
  const over = check({ paymentDate: TODAY, methods: [row("cash", "300"), row("upi", "100.01")] });
  assert.equal(over.success, false);
  assert.equal(over.errors.methods, "The payment cannot be more than the outstanding balance.");
});

test("a bad date, method or amount is refused with the same messages as when recording", () => {
  assert.equal(check({ paymentDate: "", methods: [row("cash", "10")] }).errors.payment_date, "Enter the payment date.");
  assert.equal(check({ paymentDate: "2026-10-12", methods: [row("cash", "10")] }).errors.payment_date, "The payment date cannot be in the future.");
  const bad = check({ paymentDate: TODAY, methods: [row("cheque", "10"), row("cash", "0"), row("cash", "1.234")] });
  assert.equal(bad.errors.rows[0].method, "Select a payment method.");
  assert.match(bad.errors.rows[1].amount, /greater than zero/);
  assert.match(bad.errors.rows[2].amount, /at most two decimals/);
});

// ==== the database call and the read =====================================================================================

test("an edit is ONE call to edit_payment carrying the date and every method; the database's refusals are shown plainly", async () => {
  const calls = [];
  const supabase = { rpc: async (name, args) => (calls.push({ name, args }), { data: "p1", error: null }) };
  const methods = [{ method: "cash", amount: "200.00", reference_id: null, notes: null }];
  assert.deepEqual(await editPaymentFor(supabase, "p1", { paymentDate: "2026-10-02", methods }), { success: true });
  assert.deepEqual(calls, [{ name: "edit_payment", args: { p_payment_id: "p1", p_payment_date: "2026-10-02", p_methods: methods } }]);

  const blocked = matchKnownPaymentError({ code: "55006", message: "A document has been issued for this payment, so it cannot be edited." });
  assert.match(blocked.error, /Correct the document instead/);
  assert.equal(matchKnownPaymentError({ code: "22023", message: "The payment cannot be more than the outstanding balance." }).fieldErrors.methods.length > 0, true);

  const refused = await editPaymentFor({ rpc: async () => ({ data: null, error: { code: "55006", message: "A document has been issued for this payment, so it cannot be edited." } }) }, "p1", { paymentDate: TODAY, methods });
  assert.match(refused.error, /cannot be edited/);
  const unknown = await editPaymentFor({ rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }, "p1", { paymentDate: TODAY, methods });
  assert.equal(unknown.error, "Could not edit the payment. Try again.");
});

test("a payment is editable only while it has no document at all, issued or cancelled", async () => {
  const builder = (rows) => {
    const b = { select: () => b, eq: () => b, order: () => b, then: (resolve) => resolve({ data: rows, error: null }) };
    return { from: () => b };
  };
  const base = { amount: 100, membership_payment_methods: [], membership_payment_edits: [] };
  const [none, issued, cancelled, corrected] = await fetchPaymentsForMembership(
    builder([
      { ...base, id: "a", invoices: [] },
      { ...base, id: "b", invoices: [{ id: "d", status: "issued" }] },
      { ...base, id: "c", invoices: [{ id: "d", status: "cancelled" }] },
      { ...base, id: "e", invoices: [{ id: "d", status: "cancelled" }, { id: "f", status: "issued" }] },
    ]),
    "m1"
  );
  assert.deepEqual([none.editable, issued.editable, cancelled.editable, corrected.editable], [true, false, false, false]);
});

// ==== the action ===========================================================================================================

test("the action: Admin first; refuses a payment with a document; validates BEFORE the one database call; writes nothing itself", () => {
  const actions = code("./payment-actions.js");
  const edit = actions.slice(actions.indexOf("export async function editMembershipPayment("));
  assert.ok(edit.indexOf("await requireRole(ROLES.ADMIN)") < edit.indexOf("createClient()"));
  assert.match(edit, /if \(!payment\.editable\) \{\s*return \{ error: "A document has been issued for this payment, so it cannot be edited\. Correct the document instead\." \};/);
  // What the membership allows for this payment: its amount less every OTHER payment - the same figure the database uses.
  assert.match(edit, /payments\.filter\(\(row\) => row\.id !== paymentId\)/);
  const validate = edit.indexOf("validatePaymentInput(input, { today: await todayDateString(), balancePaise: availablePaise })");
  const save = edit.indexOf("editPaymentFor(supabase, paymentId, result.data)");
  assert.ok(validate > 0 && validate < save, "validated, then saved");
  assert.match(edit, /if \(!result\.success\) \{[\s\S]*?return \{ error: "Check the highlighted fields\.", fieldErrors, rowErrors: rows \};/);
  assert.doesNotMatch(edit, /\.from\("membership_payment|\.insert\(|\.update\(|\.delete\(|\.rpc\(/, "the one write is the shared function");
  assert.equal((edit.match(/editPaymentFor\(/g) ?? []).length, 1, "exactly one save");
});

// ==== the migration ==========================================================================================================

test("0040 checks 0038 first; its only DDL adds two nullable audit columns; no row is touched and 0038 is not re-created", () => {
  assert.ok(C40.indexOf("needs migration 0038") < C40.indexOf("alter table public.membership_payment_edits"));
  assert.match(C40, /add column if not exists previous_payment_date date,\s+add column if not exists new_payment_date date;/);
  const outside = C40.replace(EDIT, "").replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from|drop |create table|create trigger)\b/i);
  assert.equal((C40.match(/create or replace function/g) ?? []).length, 1, "one function");
  // 0038's objects are only looked up (the precondition), never created, replaced, dropped or altered.
  assert.doesNotMatch(C40, /(create|replace|drop|alter|revoke|grant)[^;]*(edit_payment_amount|issue_payment_document_core)/i, "0038's objects are left alone");
  assert.doesNotMatch(C40, /issue_payment_document_core/);
  assert.doesNotMatch(C40, /not null/i, "nothing that existing rows could violate");
});

test("edit_payment: Admin only; the membership locked before the payment; refused once ANY document exists, under the locks", () => {
  assert.match(EDIT, /security definer\s+set search_path = ''/);
  assert.match(EDIT, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  const membershipLock = EDIT.indexOf("from public.memberships\n  where id = v_payment.membership_id\n  for update;");
  const paymentLock = EDIT.indexOf("from public.membership_payments\n  where id = p_payment_id\n  for update;");
  assert.ok(membershipLock > 0 && paymentLock > membershipLock, "membership, then payment: the order of recording and issuing");
  const documentCheck = EDIT.indexOf("if exists (select 1 from public.invoices where payment_id = v_payment.id) then");
  assert.ok(documentCheck > paymentLock);
  assert.doesNotMatch(EDIT.slice(documentCheck, documentCheck + 130), /status/, "issued or cancelled alike");
  assert.match(EDIT, /'A document has been issued for this payment, so it cannot be edited\.' using errcode = '55006'/);
  assert.match(C40, /revoke execute on function public\.edit_payment\(uuid, date, jsonb\) from public, anon;/);
  assert.match(C40, /grant execute on function public\.edit_payment\(uuid, date, jsonb\) to authenticated;/);
});

test("it checks the date and every method with the very messages record_membership_payment uses", () => {
  for (const message of [
    "The payment date is required.",
    "The payment date cannot be in the future.",
    "Add at least one payment method.",
    "Select a valid payment method.",
    "Each payment method needs an amount greater than zero, with at most two decimals.",
    "The payment cannot be more than the outstanding balance.",
  ]) {
    assert.ok(RECORD.includes(`'${message}'`), `record: ${message}`);
    assert.ok(EDIT.includes(`'${message}'`), `edit: ${message}`);
  }
  assert.match(EDIT, /v_method not in \('cash', 'card', 'upi', 'bank_transfer', 'other'\)/);
  assert.match(EDIT, /v_amount <= 0 or v_amount <> round\(v_amount, 2\)/);
  assert.match(EDIT, /v_reference := nullif\(btrim\(coalesce\(v_entry ->> 'reference_id', ''\)\), ''\);/);
  assert.match(EDIT, /v_notes := nullif\(btrim\(coalesce\(v_entry ->> 'notes', ''\)\), ''\);/);
  assert.match(EDIT, /where membership_id = v_mem\.id and id <> v_payment\.id;/);
  assert.match(EDIT, /if v_total > v_mem\.amount - v_other then/);
});

test("nothing is half-saved: everything is validated before the first write, and the writes are one transaction", () => {
  const firstWrite = EDIT.indexOf("delete from public.membership_payment_methods");
  for (const guard of ["'Not authorized.'", "'Payment not found.'", "cannot be edited.", "The payment date is required.", "Add at least one payment method.", "Select a valid payment method.", "greater than zero", "outstanding balance."]) {
    const at = EDIT.indexOf(guard);
    assert.ok(at > 0 && at < firstWrite, `${guard} is checked before any write`);
  }
  // The methods are replaced, then the payment, then the audit row, then the membership - inside the one function.
  const order = [
    "delete from public.membership_payment_methods where payment_id = v_payment.id;",
    "insert into public.membership_payment_methods (payment_id, position, method, amount, reference_id, notes)",
    "update public.membership_payments\n  set payment_date = p_payment_date,\n      amount       = v_total",
    "insert into public.membership_payment_edits (",
    "update public.memberships\n    set payment_status = v_status",
  ].map((text) => EDIT.indexOf(text));
  assert.ok(order.every((at) => at > 0) && order.every((at, i) => i === 0 || at > order[i - 1]), order.join(","));
  assert.doesNotMatch(EDIT, /exception when others then\s+(null|return)/, "no error is swallowed after a write");
  assert.doesNotMatch(EDIT, /commit|rollback|savepoint/i);
});

test("allocations stay whole: the methods are rewritten in order and the deferred checks of 0034 still see them add up", () => {
  assert.match(EDIT, /select v_payment\.id, t\.ord::smallint, t\.entry ->> 'method', \(t\.entry ->> 'amount'\)::numeric,\s+t\.entry ->> 'reference_id', t\.entry ->> 'notes'\s+from jsonb_array_elements\(v_new\) with ordinality as t\(entry, ord\);/);
  assert.match(EDIT, /amount       = v_total/);
  assert.match(EDIT, /v_total := v_total \+ v_amount;/);
  // The checks themselves are 0034's, deferred to commit, and fire on both tables.
  const m34 = sqlCode(read("../../supabase/migrations/0034_membership_payments.sql"));
  assert.match(m34, /v_allocated <> v_amount then\s+raise exception 'The payment methods must add up to the payment amount\.'/);
  assert.match(m34, /create constraint trigger membership_payment_methods_check_totals_trigger[\s\S]*?deferrable initially deferred/);
});

test("the membership's status and payment date follow the payments exactly as in 0038, and an unchanged edit records nothing", () => {
  const block = (sql) => {
    const start = sql.indexOf("  -- The membership's status follows its payments;");
    return sql.slice(start, sql.indexOf("  return v_payment.id;\nend;", start));
  };
  // Compared with their comments in (the block starts at one).
  const edit40 = fn(M40, "create or replace function public.edit_payment(");
  const edit38 = fn(read("../../supabase/migrations/0038_payment_amount_edits.sql"), "create or replace function public.edit_payment_amount(");
  assert.ok(block(edit40).length > 300);
  assert.equal(block(edit40), block(edit38), "the same status and date recalculation");
  assert.match(EDIT, /if v_payment\.payment_date = p_payment_date and v_previous = v_new then\s+return v_payment\.id;/);
});

test("each edit is audited with who, when, and the previous and new date, amount and methods", () => {
  assert.match(EDIT, /insert into public\.membership_payment_edits \(\s*payment_id, edited_by, previous_amount, new_amount, previous_allocations, new_allocations,\s*previous_payment_date, new_payment_date\s*\)\s*values \(\s*v_payment\.id, auth\.uid\(\), v_payment\.amount, v_total, v_previous, v_new,\s*v_payment\.payment_date, p_payment_date\s*\);/);
  assert.ok(EDIT.indexOf("into v_previous") < EDIT.indexOf("delete from public.membership_payment_methods"), "the old methods are captured before they are replaced");
});

// ==== the application ===========================================================================================================

test("Edit Payment is offered only in the no-document branch of the panel, replaces Edit Amount, and keeps documents viewable", () => {
  const panel = code("../../app/memberships/[id]/payments-panel.js");
  const noDocument = panel.slice(panel.indexOf("{payment.document ? ("), panel.indexOf("</TableCell>", panel.indexOf("{payment.document ? (")));
  assert.match(noDocument, /\{payment\.editable \? \(\s*<EditPayment\b/);
  assert.equal((panel.match(/<EditPayment\b/g) ?? []).length, 1);
  assert.doesNotMatch(panel, /EditPaymentAmount|edit-payment-amount/);
  assert.match(panel, /payment=\{payment\}/);
  // A payment WITH a document is the link to it, ahead of (and outside) the edit.
  assert.ok(panel.indexOf("documents/${payment.document.id}") < panel.indexOf("<EditPayment"));
  // The trail: "was" only when the amount really changed (an edit of a date or a note keeps the amount).
  assert.match(panel, /Number\(payment\.edits\[0\]\.previous_amount\) !== Number\(payment\.amount\)/);
});

test("the dialog reuses the payment fields, opens with what is saved now, sends the whole payment, and offers no tax invoice choice", () => {
  const dialog = code("../../app/memberships/[id]/edit-payment.js");
  assert.match(dialog, /import PaymentFields, \{ usePaymentDraft \} from "@\/app\/memberships\/\[id\]\/payment-fields";/);
  assert.match(dialog, /initialPaymentDate: payment\.payment_date,\s+initialRows: payment\.methods\.map\(rowOf\),/);
  assert.match(dialog, /if \(next\) draft\.load\(payment\.payment_date, payment\.methods\.map\(rowOf\)\);/);
  assert.match(dialog, /const availablePaise = balancePaise \+ \(toPaise\(Number\(payment\.amount\)\.toFixed\(2\)\) \?\? 0\);/);
  assert.match(dialog, /editMembershipPayment\(membershipId, payment\.id, \{ paymentDate: draft\.paymentDate, methods: draft\.rows \}\)/);
  assert.match(dialog, /showTaxInvoice=\{false\}/);
  assert.match(dialog, /confirmLabel="Save Payment"/);
  // The fields of a recorded method all come through the row: type, amount, reference and notes.
  assert.match(dialog, /referenceId: method\.reference_id \?\? "",\s+notes: method\.notes \?\? "",/);
  // Nothing in the dialog writes anything but through the action.
  assert.doesNotMatch(dialog, /\.rpc\(|supabase|updateStudent/);
});

test("the shared fields hide the tax invoice choice only when asked, so recording a payment is unchanged", () => {
  const fields = code("../../app/memberships/[id]/payment-fields.js");
  assert.match(fields, /showTaxInvoice = true,/);
  assert.match(fields, /\{showTaxInvoice \? \(/);
  assert.match(fields, /load\(date, savedRows\) \{\s+setPaymentDate\(date\);\s+setRows\(savedRows\);/);
  for (const file of ["../../app/memberships/[id]/record-payment.js", "../../app/memberships/membership-form.js"]) {
    assert.doesNotMatch(code(file), /showTaxInvoice/, file);
  }
});

test("the 0040 migration is the only schema change: nothing else in the application calls a new table or column", () => {
  const dialog = code("../../app/memberships/[id]/edit-payment.js");
  const actions = code("./payment-actions.js");
  assert.doesNotMatch(dialog + actions, /previous_payment_date|new_payment_date/);
});
