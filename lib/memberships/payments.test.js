// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 2 - membership payments: the pure rules in payments-core.js, the database
// call (with a fake client), and the migration's decisions read from its SQL text.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAYMENT_METHODS,
  fromPaise,
  matchKnownPaymentError,
  recordPaymentFor,
  summarizePayments,
  toPaise,
  validatePaymentInput,
} from "./payments-core.js";

const sql = readFileSync(new URL("../../supabase/migrations/0034_membership_payments.sql", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");
const TODAY = "2026-10-09";
const row = (method, amount, extra = {}) => ({ method, amount, ...extra });

// ---- amounts ------------------------------------------------------------------------------------

test("amounts are exact in paise: two decimals at most, positive, no other characters", () => {
  assert.equal(toPaise("1500"), 150000);
  assert.equal(toPaise("1500.5"), 150050);
  assert.equal(toPaise(" 0.05 "), 5);
  for (const bad of ["", "-1", "1.234", "1,000", "abc", "1e3", null, undefined]) assert.equal(toPaise(bad), null, String(bad));
  assert.equal(fromPaise(150050), "1500.50");
  assert.equal(fromPaise(5), "0.05");
});

test("paid and balance come from the recorded payments, and the balance never goes below zero", () => {
  assert.deepEqual(summarizePayments(4000, []), { amountPaise: 400000, paidPaise: 0, balancePaise: 400000 });
  assert.deepEqual(summarizePayments("4000.00", [{ amount: 1500 }, { amount: "1000.50" }]), { amountPaise: 400000, paidPaise: 250050, balancePaise: 149950 });
  assert.equal(summarizePayments(1000, [{ amount: 1000 }]).balancePaise, 0);
});

// ---- validation ---------------------------------------------------------------------------------

test("a mixed payment (cash + UPI with a reference) within the balance is valid; the total is the sum", () => {
  const result = validatePaymentInput(
    { paymentDate: TODAY, methods: [row("cash", "1000"), row("upi", "500.50", { referenceId: " UPI123 ", notes: "" })] },
    { today: TODAY, balancePaise: 400000 },
  );
  assert.equal(result.success, true);
  assert.equal(result.data.totalPaise, 150050);
  assert.deepEqual(result.data.methods, [
    { method: "cash", amount: "1000.00", reference_id: null, notes: null },
    { method: "upi", amount: "500.50", reference_id: "UPI123", notes: null },
  ]);
});

test("an installment may be less than the balance; more than the balance is refused", () => {
  assert.equal(validatePaymentInput({ paymentDate: TODAY, methods: [row("cash", "1")] }, { today: TODAY, balancePaise: 400000 }).success, true);
  const over = validatePaymentInput({ paymentDate: TODAY, methods: [row("cash", "3000"), row("card", "1000.01")] }, { today: TODAY, balancePaise: 400000 });
  assert.equal(over.success, false);
  assert.match(over.errors.methods, /more than the outstanding balance/);
});

test("the date is required and not in the future; every method needs a valid method and amount", () => {
  const result = validatePaymentInput(
    { paymentDate: "2026-10-10", methods: [row("cheque", "10"), row("cash", "0"), row("card", "5", { referenceId: "x".repeat(101) })] },
    { today: TODAY, balancePaise: 400000 },
  );
  assert.equal(result.success, false);
  assert.match(result.errors.payment_date, /future/);
  assert.match(result.errors.rows[0].method, /Select a payment method/);
  assert.match(result.errors.rows[1].amount, /greater than zero/);
  assert.match(result.errors.rows[2].referenceId, /100/);
  assert.match(validatePaymentInput({ paymentDate: "", methods: [] }, { today: TODAY, balancePaise: 1 }).errors.methods, /at least one/);
});

test("the methods are cash, card, UPI, bank transfer and other - the same list the database allows", () => {
  assert.deepEqual(PAYMENT_METHODS.map((m) => m.value), ["cash", "card", "upi", "bank_transfer", "other"]);
  assert.match(sql, /method in \('cash', 'card', 'upi', 'bank_transfer', 'other'\)/);
});

// ---- the database call ------------------------------------------------------------------------------

function fakeSupabase(result) {
  const calls = [];
  return { calls, rpc: async (name, args) => (calls.push({ name, args }), result) };
}

test("recording calls record_membership_payment with the membership, date and methods - and writes no table", async () => {
  const supabase = fakeSupabase({ data: "pay-1", error: null });
  const data = { paymentDate: TODAY, methods: [{ method: "cash", amount: "100.00", reference_id: null, notes: null }] };
  assert.deepEqual(await recordPaymentFor(supabase, "m-1", data), { success: true, paymentId: "pay-1" });
  assert.deepEqual(supabase.calls, [{ name: "record_membership_payment", args: { p_membership_id: "m-1", p_payment_date: TODAY, p_methods: data.methods, p_issue_tax_invoice: null } }]);
});

test("the database's own messages are shown plainly; anything else is a generic message", async () => {
  const over = await recordPaymentFor(fakeSupabase({ data: null, error: { code: "22023", message: "The payment cannot be more than the outstanding balance." } }), "m", { paymentDate: TODAY, methods: [] });
  assert.equal(over.fieldErrors.methods, "The payment cannot be more than the outstanding balance.");
  assert.equal(matchKnownPaymentError({ code: "55000", message: "This membership is already paid." }).error, "This membership is already paid.");
  assert.equal(matchKnownPaymentError({ code: "55006", message: "The amount cannot change the payment status given by the recorded payments." }).fieldErrors.amount.length > 0, true);
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await recordPaymentFor(fakeSupabase({ data: null, error: { code: "XX000", message: "boom" } }), "m", { paymentDate: TODAY, methods: [] }), { error: "Could not record the payment. Try again." });
  } finally {
    console.error = original;
  }
});

// ---- the migration ----------------------------------------------------------------------------------

test("0034 adds Partially Paid and changes no existing row", () => {
  assert.match(sql, /add constraint memberships_payment_status_valid\s+check \(payment_status in \('pending', 'partially_paid', 'paid'\)\)/);
  const outside = sql.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("payments and methods: Admin may read, nobody may write directly (the function is the only writer)", () => {
  for (const table of ["membership_payments", "membership_payment_methods"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant select on public\\.${table} to authenticated;`));
    assert.match(sql, new RegExp(`on public\\.${table}\\s+for select\\s+to authenticated\\s+using \\(public\\.is_admin\\(\\)\\);`));
  }
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*membership_payment/i);
});

test("record_membership_payment: Admin only, locks the membership, refuses an already-Paid one, a future date and an over-payment", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.record_membership_payment("));
  assert.match(fn, /security definer\s+set search_path = ''/);
  assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.'/);
  assert.match(fn, /where id = p_membership_id\s+for update;/);
  assert.match(fn, /if v_mem\.payment_status = 'paid' then\s+raise exception 'This membership is already paid\.'/);
  assert.match(fn, /if p_payment_date > v_today then/);
  assert.match(fn, /if v_total > v_mem\.amount - v_paid then/);
  // Paid once the payments cover the amount (with that payment's date), Partially Paid before.
  assert.match(fn, /v_status := case when v_paid \+ v_total >= v_mem\.amount then 'paid' else 'partially_paid' end;/);
  assert.match(fn, /payment_date\s+= case when v_status = 'paid' then p_payment_date else null end/);
  assert.match(sql, /grant execute on function public\.record_membership_payment\(uuid, date, jsonb\) to authenticated;/);
});

test("deferred checks keep method totals equal to the payment and payments within the membership amount", () => {
  assert.match(sql, /create constraint trigger membership_payments_check_totals_trigger\s+after insert or update on public\.membership_payments\s+deferrable initially deferred/);
  assert.match(sql, /create constraint trigger membership_payment_methods_check_totals_trigger\s+after insert or update on public\.membership_payment_methods\s+deferrable initially deferred/);
  assert.match(sql, /if v_allocated <> v_amount then/);
  assert.match(sql, /if v_paid > v_due then/);
});

test("a membership with payments: its status follows them and its amount cannot change that status", () => {
  const guard = sql.slice(sql.indexOf("create or replace function public.memberships_payments_guard()"));
  assert.match(guard, /current_setting\('yoga\.payment_status_sync', true\) = old\.id::text/);
  assert.match(guard, /'Partially Paid is set by recording payments\.'/);
  assert.match(guard, /'The payment status follows the recorded payments\.'/);
  assert.match(guard, /'The amount cannot change the payment status given by the recorded payments\.'/);
  assert.match(sql, /create trigger memberships_payments_guard_trigger\s+before insert or update on public\.memberships/);
});

test("receipt issuing is untouched: 0034 does not redefine any invoice function or trigger", () => {
  assert.doesNotMatch(sql, /issue_invoice|invoices_freeze|sync_invoice|memberships_auto_issue|memberships_invoice_guard/);
});

// ---- Step 3: tax invoice preferences (migration 0035) ---------------------------------------------------

const sql35 = readFileSync(new URL("../../supabase/migrations/0035_tax_invoice_preferences.sql", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

test("the payment's own tax invoice choice is sent as given; without one the database uses the student's default", async () => {
  for (const [given, sent] of [[true, true], [false, false], [undefined, null], ["yes", null]]) {
    const result = validatePaymentInput({ paymentDate: TODAY, methods: [row("cash", "10")], issueTaxInvoice: given }, { today: TODAY, balancePaise: 1000 });
    assert.equal(result.data.issueTaxInvoice, sent, String(given));
    const supabase = fakeSupabase({ data: "p", error: null });
    await recordPaymentFor(supabase, "m", result.data);
    assert.equal(supabase.calls[0].args.p_issue_tax_invoice, sent);
  }
});

test("0035: both preferences default to true and no existing row is changed", () => {
  assert.match(sql35, /alter table public\.students\s+add column if not exists tax_invoice_default boolean not null default true;/);
  assert.match(sql35, /alter table public\.membership_payments\s+add column if not exists issue_tax_invoice boolean not null default true;/);
  const outside = sql35.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("0035: record_membership_payment is 0034's with only the tax invoice choice added", () => {
  const START = "create or replace function public.record_membership_payment(";
  const body = (text) => text.slice(text.indexOf(START), text.indexOf("\n$$;", text.indexOf(START)));
  const now = body(sql35)
    .replace("  p_methods       jsonb,\n  p_issue_tax_invoice boolean default null\n)", "  p_methods       jsonb\n)")
    .replace("  v_issue_tax  boolean;\n", "")
    .replace(/\n\n  select coalesce\(p_issue_tax_invoice[\s\S]*?v_issue_tax := coalesce\(v_issue_tax, p_issue_tax_invoice, true\);\n/, "\n")
    .replace("created_by, issue_tax_invoice)\n  values (v_mem.id, p_payment_date, v_total, auth.uid(), v_issue_tax)", "created_by)\n  values (v_mem.id, p_payment_date, v_total, auth.uid())");
  const squeeze = (text) => text.replace(/\n{3,}/g, "\n\n");
  assert.equal(squeeze(now), squeeze(body(sql)));
  // The override wins, else the student's saved default, else the system default; the student row is only read.
  assert.match(sql35, /select coalesce\(p_issue_tax_invoice, s\.tax_invoice_default, true\) into v_issue_tax/);
  assert.doesNotMatch(sql35, /update public\.students/);
  assert.match(sql35, /drop function if exists public\.record_membership_payment\(uuid, date, jsonb\);/);
  assert.match(sql35, /grant execute on function public\.record_membership_payment\(uuid, date, jsonb, boolean\) to authenticated;/);
});

test("the student form posts the preference, and validation keeps it on unless explicitly off", async () => {
  const { parseTaxInvoiceDefault } = await import("../students/validation.js");
  for (const on of [undefined, null, "1", "on", true]) assert.equal(parseTaxInvoiceDefault(on), true, String(on));
  for (const off of ["0", "false", "off", false]) assert.equal(parseTaxInvoiceDefault(off), false, String(off));
  const form = readFileSync(new URL("../../app/students/student-form.js", import.meta.url), "utf8");
  assert.match(form, /name="tax_invoice_default"\s+value="1"\s+uncheckedValue="0"/);
  const actions = readFileSync(new URL("../students/actions.js", import.meta.url), "utf8");
  assert.equal((actions.match(/tax_invoice_default: formData\.get\("tax_invoice_default"\)/g) ?? []).length, 3);
});

test("Record Payment starts from the student's preference and sends this payment's choice only", () => {
  const dialog = readFileSync(new URL("../../app/memberships/[id]/record-payment.js", import.meta.url), "utf8");
  assert.match(dialog, /useState\(taxInvoiceDefault\)/);
  assert.match(dialog, /type="checkbox"/);
  assert.match(dialog, /Issue tax invoice/);
  assert.match(dialog, /recordMembershipPayment\(membershipId, \{ paymentDate, methods: rows, issueTaxInvoice \}\)/);
  // The dialog never touches the student record.
  assert.doesNotMatch(dialog, /updateStudent|students/);
});
