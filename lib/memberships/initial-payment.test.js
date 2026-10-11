// Run with `npm test` (Node's built-in test runner).
//
// "Record Payment Now" on Create Membership and Renew Membership. The behaviour is tested directly - payment omitted,
// full payment, partial payment, mixed payment methods, and the order that keeps the membership and its payment safe -
// with the real payment validator and the real `record_membership_payment` call shape (only the Supabase client is
// faked). The wiring that cannot run without a server (the action, the form, the pages) is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createWithInitialPayment,
  INITIAL_PAYMENT_FIELD,
  parseInitialPayment,
  PAYMENT_NOT_RECORDED_NOTICE,
  validateInitialPayment,
} from "./initial-payment.js";
import { validatePaymentInput } from "./payments-core.js";

const TODAY = "2026-10-11";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

/** A Supabase client that records every rpc call and answers with `reply`. */
function fakeSupabase(reply = { data: "payment-1", error: null }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return typeof reply === "function" ? reply(name, args) : reply;
    },
  };
}

/** A membership insert that succeeds, counting how often it ran. */
function creator(result = { id: "mem-1" }) {
  const create = async () => {
    create.calls += 1;
    return result;
  };
  create.calls = 0;
  return create;
}

const cash = (amount) => ({ method: "cash", amount, referenceId: "", notes: "" });

/** The whole path the action takes for one submission: parse, validate against the membership amount, create, record. */
async function submit({ raw, amount, supabase = fakeSupabase(), create = creator() }) {
  const parsed = parseInitialPayment(raw === undefined ? null : JSON.stringify(raw));
  const check = parsed.enabled ? validateInitialPayment(parsed.input, { amount, today: TODAY }) : null;
  if (check && !check.success) return { invalid: check.errors, supabase, create };
  const outcome = await createWithInitialPayment({ supabase, payment: check?.data ?? null, create });
  return { outcome, supabase, create };
}

// ---- reading the form ------------------------------------------------------------------------------------------------------

test("no payment field means no payment; a payment is read from the one JSON field", () => {
  for (const raw of [null, undefined, "", "   "]) assert.deepEqual(parseInitialPayment(raw), { enabled: false });
  const input = { paymentDate: TODAY, methods: [cash("100")], issueTaxInvoice: false };
  assert.deepEqual(parseInitialPayment(JSON.stringify(input)), { enabled: true, input });
});

test("a payment field that cannot be read is a payment with nothing in it, never silently no payment", () => {
  for (const raw of ["{not json", "[]", "42", '"text"', "null"]) {
    const parsed = parseInitialPayment(raw);
    assert.equal(parsed.enabled, true, raw);
    const checked = validateInitialPayment(parsed.input, { amount: "1500", today: TODAY });
    assert.equal(checked.success, false, raw);
    assert.equal(checked.errors.methods, "Add at least one payment method.");
    assert.equal(checked.errors.payment_date, "Enter the payment date.");
  }
});

// ---- payment omitted ------------------------------------------------------------------------------------------------------------

test("payment omitted: the membership is created and no payment is attempted", async () => {
  const { outcome, supabase, create } = await submit({ raw: undefined, amount: "1500" });
  assert.deepEqual(outcome, { id: "mem-1", payment: null });
  assert.equal(create.calls, 1);
  assert.equal(supabase.calls.length, 0, "record_membership_payment is never called");
});

// ---- full payment ------------------------------------------------------------------------------------------------------------------

test("full payment: validated against the membership amount, then recorded once through record_membership_payment", async () => {
  const { outcome, supabase, create } = await submit({
    raw: { paymentDate: TODAY, methods: [cash("1500")], issueTaxInvoice: true },
    amount: "1500",
  });
  assert.deepEqual(outcome, { id: "mem-1", payment: { recorded: true, paymentId: "payment-1" } });
  assert.equal(create.calls, 1);
  assert.deepEqual(supabase.calls, [
    {
      name: "record_membership_payment",
      args: {
        p_membership_id: "mem-1",
        p_payment_date: TODAY,
        p_methods: [{ method: "cash", amount: "1500.00", reference_id: null, notes: null }],
        p_issue_tax_invoice: true,
      },
    },
  ]);
});

test("the tax invoice choice is passed as given - on, off, or left to the student's default", async () => {
  for (const [choice, expected] of [[true, true], [false, false], [undefined, null]]) {
    const { supabase } = await submit({ raw: { paymentDate: TODAY, methods: [cash("100")], issueTaxInvoice: choice }, amount: "1500" });
    assert.equal(supabase.calls[0].args.p_issue_tax_invoice, expected, String(choice));
  }
});

// ---- partial payment ------------------------------------------------------------------------------------------------------------------

test("partial payment: less than the amount is valid and is recorded as it is", async () => {
  const { outcome, supabase } = await submit({ raw: { paymentDate: "2026-10-01", methods: [cash("600")], issueTaxInvoice: false }, amount: "1500" });
  assert.equal(outcome.payment.recorded, true);
  assert.equal(supabase.calls[0].args.p_methods[0].amount, "600.00");
  assert.equal(supabase.calls[0].args.p_payment_date, "2026-10-01");
  assert.equal(supabase.calls[0].args.p_issue_tax_invoice, false);
});

test("a payment above the membership amount is refused BEFORE any membership is created", async () => {
  const { invalid, create, supabase } = await submit({ raw: { paymentDate: TODAY, methods: [cash("1500.01")] }, amount: "1500" });
  assert.equal(invalid.methods, "The payment cannot be more than the outstanding balance.");
  assert.equal(create.calls, 0, "no membership written");
  assert.equal(supabase.calls.length, 0);
});

test("the payment date is required, a real date, and not in the future", async () => {
  for (const [date, message] of [["", "Enter the payment date."], ["10/10/2026", "Enter a valid payment date."], ["2026-10-12", "The payment date cannot be in the future."]]) {
    const { invalid, create } = await submit({ raw: { paymentDate: date, methods: [cash("100")] }, amount: "1500" });
    assert.equal(invalid.payment_date, message, date);
    assert.equal(create.calls, 0);
  }
});

// ---- mixed payment methods -----------------------------------------------------------------------------------------------------------------

test("mixed methods: every method is sent in order with its reference and notes, adding up to the payment", async () => {
  const methods = [
    { method: "cash", amount: "500", referenceId: "", notes: "" },
    { method: "upi", amount: "700.50", referenceId: "  UPI-778899  ", notes: "Paid by parent" },
    { method: "card", amount: "299.50", referenceId: "", notes: "" },
  ];
  const { outcome, supabase, create } = await submit({ raw: { paymentDate: TODAY, methods, issueTaxInvoice: true }, amount: "1500" });
  assert.equal(outcome.payment.recorded, true);
  assert.equal(create.calls, 1);
  assert.equal(supabase.calls.length, 1, "one payment, however many methods");
  assert.deepEqual(supabase.calls[0].args.p_methods, [
    { method: "cash", amount: "500.00", reference_id: null, notes: null },
    { method: "upi", amount: "700.50", reference_id: "UPI-778899", notes: "Paid by parent" },
    { method: "card", amount: "299.50", reference_id: null, notes: null },
  ]);
  const total = supabase.calls[0].args.p_methods.reduce((sum, m) => sum + Number(m.amount), 0);
  assert.equal(total, 1500);
});

test("mixed methods: their SUM is checked against the balance, and each method is checked on its own", async () => {
  const over = await submit({ raw: { paymentDate: TODAY, methods: [cash("1000"), { method: "upi", amount: "500.01" }] }, amount: "1500" });
  assert.equal(over.invalid.methods, "The payment cannot be more than the outstanding balance.");

  const bad = await submit({ raw: { paymentDate: TODAY, methods: [cash("100"), { method: "upi", amount: "0" }, { method: "cheque", amount: "5" }] }, amount: "1500" });
  assert.equal(bad.invalid.rows[1].amount, "Enter an amount greater than zero, with at most two decimals.");
  assert.equal(bad.invalid.rows[2].method, "Select a payment method.");
  assert.equal(bad.create.calls, 0);
});

// ---- the same rules as every payment ---------------------------------------------------------------------------------------------

test("the validator IS the Record Payment validator: the same input and balance give the same answer", () => {
  const input = { paymentDate: TODAY, methods: [cash("250"), { method: "bank_transfer", amount: "250", referenceId: "TXN1" }], issueTaxInvoice: false };
  assert.deepEqual(validateInitialPayment(input, { amount: "1500", today: TODAY }), validatePaymentInput(input, { today: TODAY, balancePaise: 150000 }));
  assert.deepEqual(validateInitialPayment({ paymentDate: TODAY, methods: [cash("9999")] }, { amount: "1500", today: TODAY }).success, false);
});

test("an invalid membership amount does not hide the payment's own errors, and does not invent a balance error", () => {
  const ok = validateInitialPayment({ paymentDate: TODAY, methods: [cash("100")] }, { amount: "", today: TODAY });
  assert.equal(ok.success, true, "the amount's own error is shown on the amount field");
  const bad = validateInitialPayment({ paymentDate: "", methods: [] }, { amount: "abc", today: TODAY });
  assert.equal(bad.success, false);
  assert.equal(bad.errors.payment_date, "Enter the payment date.");
});

// ---- safety: order and duplicates ------------------------------------------------------------------------------------------------

test("if the membership cannot be created, no payment is attempted", async () => {
  const failure = { error: "Check the highlighted fields.", fieldErrors: { start_date: "overlap" } };
  const supabase = fakeSupabase();
  const outcome = await createWithInitialPayment({
    supabase,
    payment: validateInitialPayment({ paymentDate: TODAY, methods: [cash("100")] }, { amount: "1500", today: TODAY }).data,
    create: async () => ({ failure }),
  });
  assert.deepEqual(outcome, { failure });
  assert.equal(supabase.calls.length, 0);
});

test("if recording the payment is refused, the membership stays, the payment is not retried, and the caller is told", async () => {
  const supabase = fakeSupabase({ data: null, error: { code: "23514", message: "The payment cannot be more than the outstanding balance." } });
  const create = creator();
  const { outcome } = await submit({ raw: { paymentDate: TODAY, methods: [cash("100")] }, amount: "1500", supabase, create });
  assert.equal(outcome.id, "mem-1");
  assert.deepEqual(outcome.payment, { recorded: false, error: "The payment cannot be more than the outstanding balance." });
  assert.equal(create.calls, 1);
  assert.equal(supabase.calls.length, 1, "exactly one attempt");
});

test("if recording the payment throws (a dropped connection), nothing escapes after the membership exists", async () => {
  const supabase = { calls: [], rpc: async () => { throw new Error("socket hang up"); } };
  const create = creator();
  const originalError = console.error;
  console.error = () => {};
  try {
    const { outcome } = await submit({ raw: { paymentDate: TODAY, methods: [cash("100")] }, amount: "1500", supabase, create });
    assert.equal(outcome.id, "mem-1");
    assert.equal(outcome.payment.recorded, false);
  } finally {
    console.error = originalError;
  }
  assert.equal(create.calls, 1);
});

test("a payment is recorded once per created membership, whatever the number of methods", async () => {
  const { supabase } = await submit({ raw: { paymentDate: TODAY, methods: [cash("1"), cash("2"), cash("3")] }, amount: "10" });
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].args.p_methods.length, 3);
});

// ---- the wiring ------------------------------------------------------------------------------------------------------------------------

test("the action validates the payment before it writes, records it only through the shared function, and warns if it failed", () => {
  const actions = code("./actions.js");
  const create = actions.slice(actions.indexOf("export async function createMembership"), actions.indexOf("export async function updateMembership"));
  const parse = create.indexOf("parseInitialPayment(formData.get(INITIAL_PAYMENT_FIELD))");
  const validate = create.indexOf("validateInitialPayment(");
  const insert = create.indexOf('.from("memberships")');
  assert.ok(parse > 0 && parse < validate && validate < insert, "parse, validate, then write");
  assert.ok(create.indexOf("if (!result.success || (paymentCheck && !paymentCheck.success))") < insert, "refused before any write");
  assert.match(create, /createWithInitialPayment\(\{\s*supabase,\s*payment: paymentCheck\?\.data \?\? null,/);
  assert.equal((create.match(/\.from\("memberships"\)/g) ?? []).length, 1, "one insert");
  assert.doesNotMatch(create, /record_membership_payment|recordPaymentFor|\.rpc\(/, "no payment logic of its own");
  assert.match(create, /paymentErrors: paymentCheck\.errors/);
  assert.match(create, /if \(outcome\.payment && !outcome\.payment\.recorded\) \{\s*redirect\(`\$\{membershipPath\(outcome\.id\)\}\?success=\$\{context === "renewal" \? "renewed" : "created"\}&notice=\$\{PAYMENT_NOT_RECORDED_NOTICE\}`\);/);
  assert.equal(INITIAL_PAYMENT_FIELD, "initial_payment");
  assert.equal(PAYMENT_NOT_RECORDED_NOTICE, "payment_not_recorded");
  // Editing a membership never records a payment.
  const update = actions.slice(actions.indexOf("export async function updateMembership"), actions.indexOf("export async function cancelMembership"));
  assert.doesNotMatch(update, /InitialPayment|initial_payment/);
});

test("the form: Record Payment Now is optional, off by default, and submits a payment only while it is on", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.match(form, /allowInitialPayment = false,/);
  assert.match(form, /const \[paymentEnabled, setPaymentEnabled\] = useState\(false\);/);
  assert.match(form, /\{allowInitialPayment \? \(/);
  assert.match(form, /<Label htmlFor="record-payment-now">Record Payment Now<\/Label>/);
  // The toggle itself submits nothing; the payment field exists only inside the shared fields, only while enabled.
  assert.doesNotMatch(form.slice(form.indexOf('id="record-payment-now"'), form.indexOf("</Label>", form.indexOf('id="record-payment-now"'))), /name=/);
  assert.match(form, /\{paymentEnabled \? \(\s*<>[\s\S]*?<PaymentFields[\s\S]*?fieldName=\{INITIAL_PAYMENT_FIELD\}/);
  assert.doesNotMatch(form, /type="hidden"/);
  const fields = code("../../app/memberships/[id]/payment-fields.js");
  assert.match(fields, /\{fieldName \? <input type="hidden" name=\{fieldName\} value=\{JSON\.stringify\(draft\.input\)\} \/> : null\}/);
  assert.equal((fields.match(/name=/g) ?? []).length, 1, "no other input is submitted");
  // The existing fields and the read-only status are untouched.
  for (const field of ['name="plan"', 'name="start_date"', 'name="end_date"', 'name="amount"', 'name="notes"']) assert.ok(form.includes(field), field);
  assert.doesNotMatch(form, /Payment Status|Managed from Payments/);
});

test("the review shows the payment, and the form checks it before opening the review", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.match(form, /const paymentResult = paymentEnabled \? validateInitialPayment\(payment\.input, \{ amount: input\.amount, today \}\) : null;/);
  assert.match(form, /if \(!result\.success \|\| \(paymentResult && !paymentResult\.success\)\) \{/);
  assert.match(form, /\{reviewData\.payment \? \(/);
  for (const label of ['label="Payment"', 'label="Tax invoice"', 'label="Result"']) assert.ok(form.includes(label), label);
});

test("Create and Renew offer it; Edit does not", () => {
  for (const page of ["../../app/memberships/new/page.js", "../../app/students/[id]/memberships/new/page.js", "../../app/memberships/[id]/renew/page.js"]) {
    const text = code(page);
    assert.match(text, /\ballowInitialPayment\b/, page);
    assert.match(text, /today=\{await todayDateString\(\)\}/, page);
  }
  assert.doesNotMatch(code("../../app/memberships/[id]/edit/page.js"), /allowInitialPayment/);
});

test("Record Payment and Record Payment Now share one implementation of the payment fields", () => {
  const dialog = code("../../app/memberships/[id]/record-payment.js");
  const form = code("../../app/memberships/membership-form.js");
  for (const text of [dialog, form]) {
    assert.match(text, /import PaymentFields, \{ usePaymentDraft \} from "@\/app\/memberships\/\[id\]\/payment-fields";/);
    assert.match(text, /<PaymentFields/);
  }
  // The dialog still sends the same payment to the same action, and never touches the student record.
  assert.match(dialog, /recordMembershipPayment\(membershipId, draft\.input\)/);
  assert.doesNotMatch(dialog, /updateStudent|students/);
  // The shared fields hold the one set of method inputs.
  const fields = code("../../app/memberships/[id]/payment-fields.js");
  assert.equal((fields.match(/Transaction \/ reference ID/g) ?? []).length, 1);
  assert.equal((dialog.match(/Transaction \/ reference ID/g) ?? []).length, 0, "not duplicated in the dialog");
  assert.equal((form.match(/Transaction \/ reference ID/g) ?? []).length, 0, "nor in the form");
});

test("the membership page warns, until a payment exists, when the payment did not go through", () => {
  const page = code("../../app/memberships/[id]/page.js");
  assert.match(page, /rawParams\?\.notice === PAYMENT_NOT_RECORDED_NOTICE && payments\.length === 0/);
  assert.match(page, /<Alert variant="warning" role="alert"/);
  assert.match(page, /Check Payments below before recording it again/);
});

test("no schema change: nothing in the database is new for this feature", () => {
  const core = code("./initial-payment.js");
  assert.match(core, /recordPaymentFor/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(/, "no table is written here");
});
