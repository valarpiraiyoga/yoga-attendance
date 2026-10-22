// Run with `npm test` (Node's built-in test runner).
//
// The reminder data layer (R2): the queries and the assembly are driven with a fake Supabase client, so what is read and what comes back is
// tested for real; the server-only, Admin-only entry point (lib/reminders/data.js) needs the Next.js runtime, so it is pinned from source - the
// project's way. These mocks do not prove the queries behave against a real database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IN_CHUNK_SIZE, PAGE_SIZE, fetchPaymentsByMembership, fetchStudentMemberships, loadReminders } from "./data-core.js";

const TODAY = "2026-11-17";

// ---- a fake Supabase client: records every query, filters the tables the way PostgREST would ---------------------------------------------------

function fakeClient({ memberships = [], payments = [], failOn = null } = {}) {
  const queries = [];
  const tables = { memberships, membership_payments: payments };

  const matchesOr = (row, expression) => {
    // Only the shape the candidate query uses: and(end_date.not.is.null,end_date.lte.X),payment_status.in.(a,b)
    const match = /^and\(end_date\.not\.is\.null,end_date\.lte\.(\d{4}-\d{2}-\d{2})\),payment_status\.in\.\(([^)]*)\)$/.exec(expression);
    if (!match) throw new Error(`unexpected or() filter: ${expression}`);
    const [, cutoff, statuses] = match;
    return (row.end_date != null && row.end_date <= cutoff) || statuses.split(",").includes(row.payment_status);
  };

  function from(table) {
    const query = { table, select: null, filters: [], range: null };
    queries.push(query);
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select(columns) {
        query.select = columns;
        return builder;
      },
      is(column, value) {
        query.filters.push(["is", column, value]);
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return builder;
      },
      in(column, values) {
        query.filters.push(["in", column, values]);
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      or(expression) {
        query.filters.push(["or", expression]);
        rows = rows.filter((row) => matchesOr(row, expression));
        return builder;
      },
      order(column) {
        query.filters.push(["order", column]);
        rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
        return builder;
      },
      async range(start, end) {
        query.range = [start, end];
        if (failOn === table) return { data: null, error: { code: "42501", message: "permission denied" } };
        return { data: rows.slice(start, end + 1), error: null };
      },
      then() {
        throw new Error("every read must be paged with range()");
      },
    };
    return builder;
  }
  return { from, queries };
}

const student = (id) => ({ id, full_name: `Student ${id}`, student_code: `YC-${id}`, photo_url: null });
const m = (overrides) => ({
  id: "m1",
  membership_code: "MEM-000001",
  student_id: "s1",
  kind: "duration",
  plan: "monthly",
  package_name: null,
  start_date: "2026-10-21",
  end_date: "2026-11-20",
  cancelled_at: null,
  payment_status: "paid",
  amount: "3000.00",
  currency: "INR",
  students: student(overrides?.student_id ?? "s1"),
  ...overrides,
});

const keysOf = (result) => result.reminders.map((reminder) => `${reminder.membershipId}:${reminder.type}`);

// ---- what is read --------------------------------------------------------------------------------------------------------------------------

test("candidates: non-cancelled memberships with an end date on or before today + 6, or a Pending / Partially Paid status - nothing else", async () => {
  const client = fakeClient({ memberships: [] });
  await loadReminders(client, TODAY);
  const candidates = client.queries[0];
  assert.equal(candidates.table, "memberships");
  assert.deepEqual(candidates.filters.slice(0, 2), [
    ["is", "cancelled_at", null],
    ["or", "and(end_date.not.is.null,end_date.lte.2026-11-23),payment_status.in.(pending,partially_paid)"],
  ]);
  assert.equal(client.queries.length, 1, "nothing else is read when there are no candidates");
});

test("only the columns the rules and the screens need are read - no notes, pricing, phone or email", async () => {
  const client = fakeClient({ memberships: [m({ payment_status: "pending" })] });
  await loadReminders(client, TODAY);
  const all = client.queries.map((query) => query.select).join(" ");
  for (const column of ["notes", "phone", "email", "standard_fee", "individual_discount", "custom_fee"]) assert.ok(!all.includes(column), column);
  assert.equal(client.queries.find((query) => query.table === "membership_payments").select, "membership_id, amount");
});

test("renewal context: EVERY membership of the expiry candidates' students is read - active, future, expired and cancelled - not just the window", async () => {
  const memberships = [
    m({ id: "old", end_date: "2026-11-15" }),
    m({ id: "future", start_date: "2026-12-01", end_date: "2026-12-31" }),
    m({ id: "older", start_date: "2026-01-01", end_date: "2026-01-31" }),
    m({ id: "cancelled", start_date: "2026-11-10", end_date: "2026-12-09", cancelled_at: "2026-11-11T00:00:00Z" }),
  ];
  const client = fakeClient({ memberships });
  const result = await loadReminders(client, TODAY);
  const context = client.queries.find((query) => query.select === "id, student_id, start_date, end_date, cancelled_at");
  assert.ok(context, "a separate read of the students' memberships");
  assert.deepEqual(context.filters, [["in", "student_id", ["s1"]], ["order", "id"]], "by student only - no date, status or cancellation filter");
  // The FUTURE membership is not a candidate (its own window has not started), yet it is the student's latest-ending one, so neither "old" nor
  // "older" may have an expiry reminder (01-product.md §5 "Reminders"). Only reading every membership of the student shows that; the cancelled
  // one, though it ends later than "old", does not count.
  assert.deepEqual(keysOf(result), []);
});

test("without a later-ending membership, only the student's latest-ending membership has a reminder - never the older expired ones", async () => {
  const memberships = [
    m({ id: "old", end_date: "2026-11-15" }),
    m({ id: "older", start_date: "2026-01-01", end_date: "2026-01-31" }),
    m({ id: "oldest", start_date: "2025-01-01", end_date: "2025-01-31" }),
    m({ id: "cancelled", start_date: "2026-11-10", end_date: "2026-12-09", cancelled_at: "2026-11-11T00:00:00Z" }),
  ];
  assert.deepEqual(keysOf(await loadReminders(fakeClient({ memberships }), TODAY)), ["old:expiry"]);
});

test("a renewal OUTSIDE the candidate set still resolves the expiry reminder (it is found through the renewal context)", async () => {
  const memberships = [
    m({ id: "old", end_date: "2026-11-15" }),
    // Active today, ends long after the window, Paid: not a candidate itself, but it covers today.
    m({ id: "renewal", start_date: "2026-11-16", end_date: "2027-11-15" }),
  ];
  const result = await loadReminders(fakeClient({ memberships }), TODAY);
  assert.deepEqual(keysOf(result), []);
});

test("a future-starting renewal that ends later supersedes the old reminder; another student's membership never affects it", async () => {
  const withFuture = [m({ id: "old", end_date: "2026-11-15" }), m({ id: "future", start_date: "2026-11-20", end_date: "2027-11-19" })];
  assert.deepEqual(keysOf(await loadReminders(fakeClient({ memberships: withFuture }), TODAY)), []);

  const withOtherStudent = [
    m({ id: "old", end_date: "2026-11-15" }),
    m({ id: "other", student_id: "s2", start_date: "2026-11-01", end_date: "2027-10-31" }),
  ];
  assert.deepEqual(keysOf(await loadReminders(fakeClient({ memberships: withOtherStudent }), TODAY)), ["old:expiry"]);
});

test("payment reminders are unchanged: a superseded older membership with a balance keeps its payment reminder", async () => {
  const memberships = [
    m({ id: "old", end_date: "2026-11-15", payment_status: "partially_paid" }),
    m({ id: "renewal", start_date: "2026-11-16", end_date: "2027-11-15", payment_status: "pending" }),
  ];
  const payments = [{ membership_id: "old", amount: "1000.00" }];
  const result = await loadReminders(fakeClient({ memberships, payments }), TODAY);
  assert.deepEqual(keysOf(result), ["old:payment", "renewal:payment"]);
});

test("payments: only the payment candidates' payments are read, and each balance is amount less recorded payments (the existing calculation)", async () => {
  const memberships = [
    m({ id: "a", payment_status: "pending", end_date: "2027-01-31" }),
    m({ id: "b", payment_status: "partially_paid", end_date: "2027-01-31" }),
    m({ id: "c", payment_status: "partially_paid", end_date: "2027-01-31" }),
    m({ id: "expiring-paid", end_date: "2026-11-18" }),
  ];
  const payments = [
    { membership_id: "b", amount: "1000.00" },
    { membership_id: "b", amount: "500.50" },
    { membership_id: "c", amount: "3000.00" },
    { membership_id: "expiring-paid", amount: "3000.00" },
  ];
  const client = fakeClient({ memberships, payments });
  const result = await loadReminders(client, TODAY);
  const read = client.queries.find((query) => query.table === "membership_payments");
  assert.deepEqual(read.filters[0], ["in", "membership_id", ["a", "b", "c"]], "only Pending / Partially Paid candidates");
  const balance = Object.fromEntries(result.reminders.filter((r) => r.type === "payment").map((r) => [r.membershipId, r.balancePaise]));
  assert.deepEqual(balance, { a: 300000, b: 149950 }, "c is fully paid (no reminder) even though its status is still partially_paid");
});

test("no renewal context is read when nothing is in the expiry window, and no payments when nothing is Pending / Partially Paid", async () => {
  const onlyPayment = fakeClient({ memberships: [m({ payment_status: "pending", end_date: "2027-06-30" })] });
  await loadReminders(onlyPayment, TODAY);
  assert.deepEqual(onlyPayment.queries.map((query) => query.select === "id, student_id, start_date, end_date, cancelled_at"), [false, false]);

  const onlyExpiry = fakeClient({ memberships: [m({ end_date: "2026-11-18" })] });
  await loadReminders(onlyExpiry, TODAY);
  assert.ok(!onlyExpiry.queries.some((query) => query.table === "membership_payments"));
});

// ---- what comes back ------------------------------------------------------------------------------------------------------------------------

test("each reminder carries the rule's facts plus the student and membership the screens show; expiry and payment are separate entries", async () => {
  const result = await loadReminders(fakeClient({ memberships: [m({ payment_status: "pending" })] }), TODAY);
  assert.deepEqual(keysOf(result), ["m1:expiry", "m1:payment"]);
  assert.deepEqual(result.counts, { total: 2, expiry: 1, payment: 1 });
  const [expiry, payment] = result.reminders;
  assert.equal(expiry.daysUntilEnd, 3);
  assert.equal(payment.balancePaise, 300000);
  assert.deepEqual(expiry.student, { id: "s1", fullName: "Student s1", studentCode: "YC-s1", photoUrl: null });
  assert.deepEqual(expiry.membership, {
    id: "m1",
    code: "MEM-000001",
    kind: "duration",
    plan: "monthly",
    packageName: null,
    startDate: "2026-10-21",
    endDate: "2026-11-20",
    paymentStatus: "pending",
    currency: "INR",
  });
  assert.equal(result.today, TODAY);
});

test("cancelled memberships are never candidates: no expiry and no payment reminder, whatever their balance", async () => {
  const result = await loadReminders(
    fakeClient({ memberships: [m({ payment_status: "pending", cancelled_at: "2026-11-01T00:00:00Z", end_date: "2026-11-18" })] }),
    TODAY
  );
  assert.deepEqual(result.reminders, []);
});

test("an upcoming membership with a balance has a payment reminder; one with no end date has no expiry reminder", async () => {
  const memberships = [
    m({ id: "upcoming", payment_status: "pending", start_date: "2027-01-01", end_date: "2027-01-31" }),
    m({ id: "open", payment_status: "paid", kind: "class_count", end_date: null }),
  ];
  assert.deepEqual(keysOf(await loadReminders(fakeClient({ memberships }), TODAY)), ["upcoming:payment"]);
});

test("ordered most urgent first: expiry by end date (longest overdue first), then payment by start date", async () => {
  const memberships = [
    m({ id: "soon", student_id: "s1", end_date: "2026-11-20" }),
    m({ id: "overdue", student_id: "s2", end_date: "2026-10-01" }),
    m({ id: "pay-late", student_id: "s3", payment_status: "pending", start_date: "2026-12-01", end_date: "2027-01-01" }),
    m({ id: "pay-early", student_id: "s4", payment_status: "pending", start_date: "2026-09-01", end_date: "2027-02-01" }),
  ];
  assert.deepEqual(keysOf(await loadReminders(fakeClient({ memberships }), TODAY)), ["overdue:expiry", "soon:expiry", "pay-early:payment", "pay-late:payment"]);
});

test("the same inputs give the same answer: nothing depends on the machine's clock, and a missing today is refused", async () => {
  const memberships = [m({ payment_status: "pending" })];
  const first = await loadReminders(fakeClient({ memberships }), TODAY);
  const second = await loadReminders(fakeClient({ memberships }), TODAY);
  assert.deepEqual(first, second);
  for (const today of [undefined, "", "17/11/2026"]) await assert.rejects(loadReminders(fakeClient({ memberships }), today), TypeError);
});

// ---- size, failures ---------------------------------------------------------------------------------------------------------------------

test("every read is paged with range(), so no result is cut at the API's row limit", async () => {
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, index) =>
    m({ id: `m${String(index).padStart(5, "0")}`, student_id: `s${index}`, payment_status: "pending", end_date: "2027-06-30", students: student(`s${index}`) })
  );
  const client = fakeClient({ memberships: many });
  const result = await loadReminders(client, TODAY);
  assert.equal(result.counts.payment, PAGE_SIZE + 5);
  const candidatePages = client.queries.filter((query) => query.table === "memberships").map((query) => query.range);
  assert.deepEqual(candidatePages, [[0, PAGE_SIZE - 1], [PAGE_SIZE, 2 * PAGE_SIZE - 1]]);
});

test("long id lists are split into chunks, so request URLs stay short", async () => {
  const ids = Array.from({ length: IN_CHUNK_SIZE * 2 + 3 }, (_, index) => `s${index}`);
  const client = fakeClient({ memberships: [] });
  await fetchStudentMemberships(client, [...ids, ids[0], null]);
  assert.deepEqual(client.queries.map((query) => query.filters[0][2].length), [IN_CHUNK_SIZE, IN_CHUNK_SIZE, 3], "de-duplicated, nulls dropped");

  const payments = fakeClient({ payments: [] });
  await fetchPaymentsByMembership(payments, ids);
  assert.equal(payments.queries.length, 3);
});

test("a failed read throws the plain message (details only in the log) - no partial reminder list is returned", async () => {
  for (const table of ["memberships", "membership_payments"]) {
    const client = fakeClient({ memberships: [m({ payment_status: "pending" })], failOn: table });
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));
    try {
      await assert.rejects(loadReminders(client, TODAY), { message: "Could not load reminders." });
    } finally {
      console.error = original;
    }
    assert.ok(logged.some((line) => line.includes("42501")), table);
  }
});

// ---- the Admin-only entry point (pinned from source) ---------------------------------------------------------------------------------------

const entry = readFileSync(new URL("./data.js", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

test("getReminders is server-only and checks the Admin role BEFORE reading anything", () => {
  assert.match(entry, /^import "server-only";/);
  const check = entry.indexOf("await requireRole(ROLES.ADMIN);");
  assert.ok(check > 0);
  assert.ok(check < entry.indexOf("createClient()") && check < entry.indexOf("getCentreToday()") && check < entry.indexOf("loadReminders("));
  assert.ok(!/ROLES\.INSTRUCTOR/.test(entry), "no other role is allowed");
});

test("getReminders reads through the Admin's own session (RLS applies), on the centre's date - never the secret-key client or the machine's clock", () => {
  assert.ok(entry.includes('from "@/lib/supabase/server"') && !entry.includes("supabase/admin"));
  assert.ok(entry.includes("loadReminders(supabase, await getCentreToday())"));
  assert.ok(!/new Date\(|Date\.now\(/.test(entry));
});

test("the data layer only reads: no insert, update, delete, upsert or rpc anywhere", () => {
  const core = readFileSync(new URL("./data-core.js", import.meta.url), "utf8");
  for (const source of [entry, core]) assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(source));
});
