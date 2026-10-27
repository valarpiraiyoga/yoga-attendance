// Run with `npm test` (Node's built-in test runner).
//
// F-03 Step 2 - payment request IDs (migration 0065). The pure pieces are tested directly: the request ID sent to
// `record_membership_payment`, the checks that must let a retry through, which results end a request, and the mapping of
// 0065's refusals. A fake database that replays a request ID the way 0065 does drives the whole retry path. The wiring
// that cannot run without a server or a browser (the server action, the dialog) is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkPaymentToRecord,
  endsPaymentRequest,
  isRecordedPaymentRequest,
  matchKnownPaymentError,
  PAYMENT_REQUEST_MISMATCH_MESSAGE,
  paymentRequestFor,
  recordPaymentFor,
  REQUEST_ID_PATTERN,
  validatePaymentInput,
} from "./payments-core.js";
import { createWithInitialPayment } from "./initial-payment.js";

const TODAY = "2026-10-27";
const REQUEST = "6f1c2b9e-4a7d-4c1e-9b2a-3d5e7f9a1b2c";
const OTHER_REQUEST = "0b8e4f6a-2c1d-4e3f-8a9b-7c6d5e4f3a2b";
const THIRD_REQUEST = "9d2a7c4e-1b3f-4a5d-8e6c-0f1a2b3c4d5e";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cash = (amount) => ({ paymentDate: TODAY, methods: [{ method: "cash", amount }], issueTaxInvoice: null });

/** A Supabase client that records every rpc call and answers with `reply`. */
function fakeSupabase(reply = { data: "pay-1", error: null }) {
  const calls = [];
  return { calls, rpc: async (name, args) => (calls.push({ name, args }), typeof reply === "function" ? reply(args) : reply) };
}

/**
 * A membership of `amountPaise` (`db.amountPaise`, which a test may correct) and the 0065 rules that matter here: a request ID that has recorded a payment answers a
 * repeat with that payment, and refuses other details or another membership (23505); otherwise the payment is recorded
 * within the balance. `loseNextAnswer` records the payment and then throws, as a dropped connection would.
 */
function fakeDatabase(amountPaise) {
  const db = { payments: [], loseNextAnswer: false, amountPaise };
  const paidPaise = (membershipId) => db.payments.filter((p) => p.membershipId === membershipId).reduce((sum, p) => sum + p.totalPaise, 0);
  const fingerprint = (args) => JSON.stringify([args.p_payment_date, args.p_methods, args.p_issue_tax_invoice ?? null]);

  db.client = {
    rpc: async (name, args) => {
      assert.equal(name, "record_membership_payment");
      const existing = args.p_request_id && db.payments.find((p) => p.requestId === args.p_request_id);
      if (existing) {
        if (existing.membershipId !== args.p_membership_id) {
          return { data: null, error: { code: "23505", message: "This request ID has already been used for another membership." } };
        }
        if (existing.fingerprint !== fingerprint(args)) {
          return { data: null, error: { code: "23505", message: "This request ID has already been used for a different payment." } };
        }
        return { data: existing.id, error: null };
      }
      const totalPaise = args.p_methods.reduce((sum, m) => sum + Math.round(Number(m.amount) * 100), 0);
      if (paidPaise(args.p_membership_id) >= db.amountPaise) {
        return { data: null, error: { code: "55000", message: "This membership is already paid." } };
      }
      if (totalPaise > db.amountPaise - paidPaise(args.p_membership_id)) {
        return { data: null, error: { code: "22023", message: "The payment cannot be more than the outstanding balance." } };
      }
      const payment = { id: `pay-${db.payments.length + 1}`, membershipId: args.p_membership_id, requestId: args.p_request_id ?? null, totalPaise, fingerprint: fingerprint(args) };
      db.payments.push(payment);
      if (db.loseNextAnswer) {
        db.loseNextAnswer = false;
        throw new Error("fetch failed");
      }
      return { data: payment.id, error: null };
    },
  };

  /** What the server action does, with the real checks and the real database call; `requestId` as the dialog sends it. */
  db.submit = async (membershipId, input, requestId) => {
    const paid = paidPaise(membershipId) >= db.amountPaise;
    const result = await checkPaymentToRecord(input, {
      today: TODAY,
      paid,
      balancePaise: paid ? 0 : db.amountPaise - paidPaise(membershipId),
      isRecordedRequest: async () => Boolean(requestId) && db.payments.some((p) => p.requestId === requestId),
    });
    if (result.alreadyPaid) return { error: "This membership is already paid." };
    if (!result.success) return { error: "Check the highlighted fields.", fieldErrors: result.errors };
    return recordPaymentFor(db.client, membershipId, result.data, requestId);
  };
  /** What the page shows for a membership: its payment count and its outstanding balance. */
  db.page = (membershipId) => ({
    paymentCount: db.payments.filter((p) => p.membershipId === membershipId).length,
    balancePaise: Math.max(0, db.amountPaise - paidPaise(membershipId)),
  });
  return db;
}

/**
 * The dialog's Confirm, with the real helpers it uses (`paymentRequestFor`, `endsPaymentRequest`): the kept request is
 * `state.request`; `state.paymentCount` is the count the page shows - set when the page renders and on `refresh()`, as a
 * revalidation re-renders the page while the dialog stays mounted.
 */
function dialog(db, membershipId, { ids = [REQUEST, OTHER_REQUEST, THIRD_REQUEST] } = {}) {
  const state = { request: null, paymentCount: db.page(membershipId).paymentCount, sent: [] };
  state.refresh = () => {
    state.paymentCount = db.page(membershipId).paymentCount;
  };
  state.confirm = async (input) => {
    state.request = paymentRequestFor(state.request, state.paymentCount, () => ids.shift());
    const requestId = state.request.id;
    state.sent.push(requestId);
    try {
      const result = await db.submit(membershipId, input, requestId);
      if (endsPaymentRequest(result)) state.request = null;
      return result;
    } catch {
      return { unanswered: true };
    }
  };
  return state;
}

// ---- the database call --------------------------------------------------------------------------------------

test("the request ID is sent to record_membership_payment as p_request_id, with everything else unchanged", async () => {
  const supabase = fakeSupabase();
  const data = { paymentDate: TODAY, methods: [{ method: "upi", amount: "250.00", reference_id: "UPI1", notes: null }], issueTaxInvoice: false };
  assert.deepEqual(await recordPaymentFor(supabase, "m-1", data, REQUEST), { success: true, paymentId: "pay-1" });
  assert.deepEqual(supabase.calls, [
    {
      name: "record_membership_payment",
      args: { p_membership_id: "m-1", p_payment_date: TODAY, p_methods: data.methods, p_issue_tax_invoice: false, p_request_id: REQUEST },
    },
  ]);
});

test("without a request ID the argument is not sent at all, so the call is exactly the pre-0065 one", async () => {
  for (const missing of [undefined, null, ""]) {
    const supabase = fakeSupabase();
    await recordPaymentFor(supabase, "m-1", cash("10.00"), missing);
    assert.equal("p_request_id" in supabase.calls[0].args, false, String(missing));
  }
});

test("request IDs are UUIDs (what crypto.randomUUID makes and the column holds)", () => {
  assert.equal(REQUEST_ID_PATTERN.test(REQUEST), true);
  assert.equal(REQUEST_ID_PATTERN.test(crypto.randomUUID()), true);
  for (const bad of ["", "abc", `${REQUEST}x`, REQUEST.replaceAll("-", ""), "'; drop table x; --"]) assert.equal(REQUEST_ID_PATTERN.test(bad), false, bad);
});

// ---- 0065's refusals ----------------------------------------------------------------------------------------

test("a request ID reused with other details, or for another membership, is shown as 'check before recording again'", async () => {
  for (const message of ["This request ID has already been used for a different payment.", "This request ID has already been used for another membership."]) {
    const known = matchKnownPaymentError({ code: "23505", message });
    assert.deepEqual(known, { error: PAYMENT_REQUEST_MISMATCH_MESSAGE, code: "23505" });
    const saved = await recordPaymentFor(fakeSupabase({ data: null, error: { code: "23505", message } }), "m", cash("10.00"), REQUEST);
    assert.deepEqual(saved, { error: PAYMENT_REQUEST_MISMATCH_MESSAGE, code: "23505" });
  }
  assert.match(PAYMENT_REQUEST_MISMATCH_MESSAGE, /may already have been recorded/);
  assert.match(PAYMENT_REQUEST_MISMATCH_MESSAGE, /Refresh the page and check/);
  // Another unique violation is not taken for one of these.
  assert.equal(matchKnownPaymentError({ code: "23505", message: "duplicate key value violates unique constraint" }), null);
});

test("the mapped messages are exactly the ones migration 0065 raises, with its SQLSTATE", () => {
  const sql = source("../../supabase/migrations/0065_payment_request_ids.sql");
  for (const message of ["This request ID has already been used for a different payment.", "This request ID has already been used for another membership."]) {
    assert.match(sql, new RegExp(`raise exception '${message.replace(/\./g, "\\.")}' using errcode = '23505'`));
    assert.notEqual(matchKnownPaymentError({ code: "23505", message }), null);
  }
});

// ---- which results end a request -----------------------------------------------------------------------------

test("a request ends with a recorded payment or a 'used with other details' refusal - and with nothing else", () => {
  assert.equal(endsPaymentRequest({ success: true, paymentId: "p" }), true);
  assert.equal(endsPaymentRequest({ error: PAYMENT_REQUEST_MISMATCH_MESSAGE, code: "23505" }), true);
  // A refusal recorded nothing under the ID; an unclear failure may have recorded it. Either way the ID is kept.
  assert.equal(endsPaymentRequest({ error: "Check the highlighted fields.", fieldErrors: { methods: "x" } }), false);
  assert.equal(endsPaymentRequest({ error: "The payment cannot be more than the outstanding balance.", code: "22023" }), false);
  assert.equal(endsPaymentRequest({ error: "This membership is already paid." }), false);
  assert.equal(endsPaymentRequest({ error: "Could not record the payment. Try again." }), false);
  assert.equal(endsPaymentRequest(undefined), false);
  assert.equal(endsPaymentRequest(null), false);
});

// ---- the checks before the database ----------------------------------------------------------------------------

const never = async () => assert.fail("the request ID is looked up only when a check would refuse");

test("a first submission is checked exactly as before, and the request ID is not even looked up", async () => {
  const ok = await checkPaymentToRecord(cash("400"), { today: TODAY, paid: false, balancePaise: 100000, isRecordedRequest: never });
  assert.deepEqual(ok, validatePaymentInput(cash("400"), { today: TODAY, balancePaise: 100000 }));
  const over = await checkPaymentToRecord(cash("1000.01"), { today: TODAY, paid: false, balancePaise: 100000, isRecordedRequest: async () => false });
  assert.equal(over.success, false);
  assert.equal(over.errors.methods, "The payment cannot be more than the outstanding balance.");
  assert.deepEqual(await checkPaymentToRecord(cash("1"), { today: TODAY, paid: true, balancePaise: 0, isRecordedRequest: async () => false }), {
    success: false,
    alreadyPaid: true,
  });
});

test("a retry of a recorded request is let through when its own payment made the membership Paid or used the balance", async () => {
  const recorded = async () => true;
  const paid = await checkPaymentToRecord(cash("1000"), { today: TODAY, paid: true, balancePaise: 0, isRecordedRequest: recorded });
  assert.equal(paid.success, true);
  assert.equal(paid.data.totalPaise, 100000);
  const partly = await checkPaymentToRecord(cash("600"), { today: TODAY, paid: false, balancePaise: 40000, isRecordedRequest: recorded });
  assert.equal(partly.success, true);
});

test("a retry still meets every check but the balance: date, methods and amounts", async () => {
  const recorded = async () => true;
  const future = await checkPaymentToRecord({ ...cash("10"), paymentDate: "2026-10-28" }, { today: TODAY, paid: true, balancePaise: 0, isRecordedRequest: recorded });
  assert.equal(future.errors.payment_date, "The payment date cannot be in the future.");
  const badAmount = await checkPaymentToRecord(cash("1.234"), { today: TODAY, paid: false, balancePaise: 0, isRecordedRequest: recorded });
  assert.ok(badAmount.errors.rows[0].amount);
  const noMethods = await checkPaymentToRecord({ paymentDate: TODAY, methods: [] }, { today: TODAY, paid: true, balancePaise: 0, isRecordedRequest: recorded });
  assert.equal(noMethods.errors.methods, "Add at least one payment method.");
});

test("isRecordedPaymentRequest reads membership_payments by request_id; a failed read counts as not recorded", async () => {
  const reads = [];
  const client = (reply) => ({
    from(table) {
      const query = {
        select: (columns) => (reads.push({ table, columns }), query),
        eq: (column, value) => (reads.push({ column, value }), query),
        maybeSingle: async () => reply,
      };
      return query;
    },
  });
  assert.equal(await isRecordedPaymentRequest(client({ data: { id: "pay-1" }, error: null }), REQUEST), true);
  assert.deepEqual(reads, [{ table: "membership_payments", columns: "id" }, { column: "request_id", value: REQUEST }]);
  assert.equal(await isRecordedPaymentRequest(client({ data: null, error: null }), REQUEST), false);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await isRecordedPaymentRequest(client({ data: null, error: { code: "42703", message: "column does not exist" } }), REQUEST), false);
  } finally {
    console.error = original;
  }
});

// ---- the whole retry path, against a database that replays like 0065 ----------------------------------------------------

test("an answer lost after the payment was recorded: the retry keeps the request ID and returns the SAME payment - one payment", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  assert.deepEqual(await admin.confirm(cash("1000")), { unanswered: true });
  assert.equal(admin.request.id, REQUEST, "kept: nothing answered");
  // The membership is Paid by the lost payment: without the request ID the checks would say "already paid".
  assert.deepEqual(await admin.confirm(cash("1000")), { success: true, paymentId: "pay-1" });
  assert.deepEqual(admin.sent, [REQUEST, REQUEST]);
  assert.equal(db.payments.length, 1);
  assert.equal(admin.request, null, "answered: the next payment gets a new ID");
});

test("a lost answer on an installment: the retry is let past the smaller balance and replays the payment", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("600"));
  // 400 left, and the retry is for 600: the balance check alone would refuse it.
  assert.deepEqual(await admin.confirm(cash("600")), { success: true, paymentId: "pay-1" });
  assert.equal(db.payments.length, 1);
});

test("after a payment is recorded, the next payment gets a new request ID and is recorded as a new payment", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-1" });
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-2" });
  assert.deepEqual(admin.sent, [REQUEST, OTHER_REQUEST]);
  assert.equal(db.payments.length, 2);
});

test("a refusal keeps the request ID (nothing was recorded under it), and the corrected payment is recorded once", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  const over = await admin.confirm(cash("2000"));
  assert.equal(over.fieldErrors.methods, "The payment cannot be more than the outstanding balance.");
  assert.equal(admin.request.id, REQUEST);
  assert.deepEqual(await admin.confirm(cash("1000")), { success: true, paymentId: "pay-1" });
  assert.deepEqual(admin.sent, [REQUEST, REQUEST]);
  assert.equal(db.payments.length, 1);
});

test("a lost answer, then changed details under the same ID: refused as possibly recorded, the ID ends, nothing is recorded twice", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("300"));
  const changed = await admin.confirm(cash("350"));
  assert.deepEqual(changed, { error: PAYMENT_REQUEST_MISMATCH_MESSAGE, code: "23505" });
  assert.equal(db.payments.length, 1);
  assert.equal(admin.request, null, "the ID is spent; a new submission, after checking, is a new payment");
});

test("the same request ID for another membership is refused and records nothing", async () => {
  const db = fakeDatabase(100000);
  await db.submit("m-1", cash("100"), REQUEST);
  assert.deepEqual(await db.submit("m-2", cash("100"), REQUEST), { error: PAYMENT_REQUEST_MISMATCH_MESSAGE, code: "23505" });
  assert.equal(db.payments.length, 1);
});

test("without a request ID nothing changes: a repeat records a second payment, as before 0065", async () => {
  const db = fakeDatabase(100000);
  await db.submit("m-1", cash("100"), null);
  await db.submit("m-1", cash("100"), null);
  assert.equal(db.payments.length, 2);
});

// ---- a request ID belongs to the payment count it was made for (Steps 2A, 2C) ------------------------------------------------

test("paymentRequestFor: keeps the request while the payment count is the same, makes a new one when it changed or none is kept", () => {
  const ids = [REQUEST, OTHER_REQUEST, THIRD_REQUEST];
  const make = () => ids.shift();
  const first = paymentRequestFor(null, 2, make);
  assert.deepEqual(first, { id: REQUEST, paymentCount: 2 });
  assert.equal(paymentRequestFor(first, 2, make), first, "same count: the very same request");
  assert.deepEqual(paymentRequestFor(first, 3, make), { id: OTHER_REQUEST, paymentCount: 3 }, "count changed: a new one");
  assert.deepEqual(paymentRequestFor(undefined, 3, make), { id: THIRD_REQUEST, paymentCount: 3 }, "none kept: a new one");
  assert.equal(ids.length, 0, "an ID is made only when needed");
  // A membership with no payments yet has a count of zero - a count, not 'none'.
  assert.equal(paymentRequestFor({ id: REQUEST, paymentCount: 0 }, 0, () => assert.fail("kept")).id, REQUEST);
});

test("a lost response, then a refresh showing it: the old ID is dropped and a second identical installment is a NEW payment", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  assert.deepEqual(await admin.confirm(cash("300")), { unanswered: true });
  assert.equal(db.payments.length, 1, "the first payment was saved; only its answer was lost");
  // Another action (edit payment, issue document) revalidated the page: it now shows that payment.
  admin.refresh();
  assert.equal(admin.paymentCount, 1);
  // The Admin records the next installment with exactly the same date, method and amount.
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-2" });
  assert.deepEqual(admin.sent, [REQUEST, OTHER_REQUEST]);
  assert.equal(db.payments.length, 2, "recorded, not replayed");
});

test("the balance back where it was (an amount correction cancels the lost payment) still gives a new ID: the count moved", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  const before = db.page("m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("300"));
  // A term correction raises the membership amount by exactly the lost payment: the balance shows 1000 again.
  db.amountPaise = 130000;
  admin.refresh();
  assert.equal(db.page("m-1").balancePaise, before.balancePaise, "the balance alone could not tell");
  assert.notEqual(admin.paymentCount, before.paymentCount);
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-2" });
  assert.deepEqual(admin.sent, [REQUEST, OTHER_REQUEST]);
  assert.equal(db.payments.length, 2, "a new payment, not a replay of the first");
});

test("without the rule the same case replays the first payment (what the rule prevents)", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("300"));
  // The old request sent again, as the dialog did before this rule: the database answers with the FIRST payment.
  assert.deepEqual(await db.submit("m-1", cash("300"), REQUEST), { success: true, paymentId: "pay-1" });
  assert.equal(db.payments.length, 1);
});

test("a retry with the count unchanged reuses the same ID - after an exception, after a refusal, and after a refresh that adds nothing", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("300"));
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-1" });
  assert.deepEqual(admin.sent, [REQUEST, REQUEST]);
  assert.equal(db.payments.length, 1);

  const otherDb = fakeDatabase(100000);
  const other = dialog(otherDb, "m-9", { ids: [OTHER_REQUEST, THIRD_REQUEST] });
  assert.ok((await other.confirm(cash("2000"))).fieldErrors, "refused: over the balance");
  // An unrelated refresh (a document issued, an amount corrected) changes no payment count.
  otherDb.amountPaise = 120000;
  other.refresh();
  await other.confirm(cash("500"));
  assert.deepEqual(other.sent, [OTHER_REQUEST, OTHER_REQUEST]);
});

test("closing and reopening the dialog with the count unchanged keeps the ID (closing touches no request state)", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  db.loseNextAnswer = true;
  await admin.confirm(cash("300"));
  // Close and reopen: the component resets its fields; the kept request and the count stay as they were.
  assert.deepEqual(admin.request, { id: REQUEST, paymentCount: 0 });
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-1" });
  assert.deepEqual(admin.sent, [REQUEST, REQUEST]);
  assert.equal(db.payments.length, 1);

  const component = code("../../app/memberships/[id]/record-payment.js");
  const handler = component.slice(component.indexOf("function handleOpenChange"), component.indexOf("function runRecord"));
  assert.doesNotMatch(handler, /requestRef/);
});

test("each new payment, once the page shows the one before, gets a new ID", async () => {
  const db = fakeDatabase(100000);
  const admin = dialog(db, "m-1");
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-1" });
  admin.refresh();
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-2" });
  admin.refresh();
  assert.deepEqual(await admin.confirm(cash("300")), { success: true, paymentId: "pay-3" });
  assert.deepEqual(admin.sent, [REQUEST, OTHER_REQUEST, THIRD_REQUEST]);
  assert.equal(new Set(admin.sent).size, 3);
});

test("the panel passes the payment count, and the dialog keys its request on it", () => {
  const panel = code("../../app/memberships/[id]/payments-panel.js");
  assert.match(panel, /<RecordPayment[\s\S]*?paymentCount=\{payments\.length\}[\s\S]*?\/>/);
  const component = code("../../app/memberships/[id]/record-payment.js");
  assert.match(component, /export default function RecordPayment\(\{ membershipId, balancePaise, paymentCount,/);
  assert.match(component, /paymentRequestFor\(requestRef\.current, paymentCount, /);
  assert.doesNotMatch(component, /paymentRequestFor\(requestRef\.current, balancePaise/);
  assert.match(source("./payments-core.js"), /relies on payments never being deleted/);
});

// ---- the first payment of Create / Renew Membership ----------------------------------------------------------------

test("Record Payment Now sends no request ID: it is recorded once, on the server, and never retried", async () => {
  const supabase = fakeSupabase();
  const data = validatePaymentInput(cash("500"), { today: TODAY, balancePaise: 100000 }).data;
  const outcome = await createWithInitialPayment({ supabase, payment: data, create: async () => ({ id: "mem-new" }) });
  assert.deepEqual(outcome, { id: "mem-new", payment: { recorded: true, paymentId: "pay-1" } });
  assert.equal(supabase.calls.length, 1);
  assert.equal("p_request_id" in supabase.calls[0].args, false);
  assert.match(source("./initial-payment.js"), /No request ID is sent \(0065's `p_request_id` stays NULL, its default\)/);
});

// ---- the wiring (source) ---------------------------------------------------------------------------------------------

test("the server action takes the request ID, checks its shape, lets retries through, and passes it to the database", () => {
  const action = code("./payment-actions.js");
  const record = action.slice(action.indexOf("export async function recordMembershipPayment"), action.indexOf("export async function editMembershipPayment"));
  assert.match(record, /export async function recordMembershipPayment\(membershipId, input, requestId = null\)/);
  assert.match(record, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(record, /requestId !== null && !REQUEST_ID_PATTERN\.test\(String\(requestId\)\)/);
  assert.match(record, /checkPaymentToRecord\(input, \{/);
  assert.match(record, /isRecordedRequest: async \(\) => Boolean\(requestId\) && \(await isRecordedPaymentRequest\(supabase, requestId\)\)/);
  assert.match(record, /recordPaymentFor\(supabase, membershipId, result\.data, requestId\)/);
  // The Paid check no longer refuses before a retry could be recognised.
  assert.doesNotMatch(record, /if \(membership\.payment_status === "paid"\) \{\s*return/);
  // A mismatch refreshes the pages too, so the payment that WAS recorded shows.
  assert.match(record, /if \(saved\.success \|\| saved\.code === "23505"\) \{\s*revalidatePath\("\/memberships"\);/);
});

test("the dialog keeps one request, ties it to the payment count, clears it only when the request ends, and never on close or failure", () => {
  const dialogSource = code("../../app/memberships/[id]/record-payment.js");
  assert.match(dialogSource, /const requestRef = useRef\(null\);/);
  assert.match(dialogSource, /requestRef\.current = paymentRequestFor\(requestRef\.current, paymentCount, \(\) => crypto\.randomUUID\(\)\);/);
  assert.match(dialogSource, /const requestId = requestRef\.current\.id;/);
  assert.match(dialogSource, /recordMembershipPayment\(membershipId, draft\.input, requestId\)/);
  assert.match(dialogSource, /if \(endsPaymentRequest\(result\)\) requestRef\.current = null;/);
  // The request is set before the transition starts (so a retry always finds it); one place makes an ID, one clears it.
  assert.ok(dialogSource.indexOf("requestRef.current = paymentRequestFor") < dialogSource.indexOf("startTransition(async"));
  assert.equal((dialogSource.match(/crypto\.randomUUID\(\)/g) ?? []).length, 1);
  assert.equal((dialogSource.match(/requestRef\.current = null/g) ?? []).length, 1);
  // An unanswered call (the catch) keeps it.
  const unanswered = dialogSource.slice(dialogSource.indexOf("} catch {"), dialogSource.indexOf("if (endsPaymentRequest"));
  assert.match(unanswered, /Could not reach the server\. Try again\./);
  assert.doesNotMatch(unanswered, /requestRef/);
  // Closing the dialog resets the fields, not the request.
  const close = dialogSource.slice(dialogSource.indexOf("function handleOpenChange"), dialogSource.indexOf("function runRecord"));
  assert.doesNotMatch(close, /requestRef/);
});
