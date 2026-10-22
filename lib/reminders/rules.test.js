// Run with `npm test` (Node's built-in test runner).
//
// Membership expiry and payment reminders - the pure rules (01-product.md §5 "Reminders"). Every test passes its own centre-local `today`, so
// nothing here depends on the machine's clock or time zone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPIRY_REMINDER_LEAD_DAYS,
  PAYMENT_REMINDER_STATUSES,
  REMINDER_TYPES,
  collectReminders,
  expiryReminderOf,
  expiryReminderStart,
  isLatestEndingMembership,
  isResolvedByRenewal,
  latestEndDateOf,
  outstandingBalancePaise,
  paymentReminderOf,
  remindersForMembership,
} from "./rules.js";
import { EXPIRING_SOON_DAYS, expiringSoonCutoff, membershipToday } from "../memberships/validity.js";

const END = "2026-11-20";
const membership = (overrides = {}) => ({
  id: "m1",
  student_id: "s1",
  start_date: "2026-10-21",
  end_date: END,
  cancelled_at: null,
  payment_status: "paid",
  amount: 3000,
  ...overrides,
});
const expiry = (today, overrides = {}, studentMemberships = []) => expiryReminderOf(membership(overrides), { today, studentMemberships });

// ---- expiry: the date boundary -----------------------------------------------------------------------------------------------------------------

test("expiry boundary: 7 days before the end date is not yet a reminder; 6 days before is the first day", () => {
  assert.equal(expiry("2026-11-13"), null, "7 days before (8 days left counting the end date)");
  assert.ok(expiry("2026-11-14"), "6 days before - 7 days left, the end date included");
  assert.equal(expiryReminderStart(END), "2026-11-14");
  assert.equal(EXPIRY_REMINDER_LEAD_DAYS, 6);
});

test("expiry boundary: one day before and the end date itself are reminders", () => {
  assert.equal(expiry("2026-11-19").daysUntilEnd, 1);
  assert.equal(expiry(END).daysUntilEnd, 0);
});

test("after expiry the reminder continues every day until resolved, and says how long ago", () => {
  assert.equal(expiry("2026-11-21").daysUntilEnd, -1);
  assert.equal(expiry("2026-12-20").daysUntilEnd, -30);
  assert.equal(expiry("2027-11-20").daysUntilEnd, -365, "a year later, still unresolved");
});

test("the window is exactly the Memberships list's 'Expiring Soon' boundary", () => {
  assert.equal(EXPIRY_REMINDER_LEAD_DAYS, EXPIRING_SOON_DAYS - 1);
  for (const today of ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-20"]) {
    const expiringSoon = END <= expiringSoonCutoff(today);
    assert.equal(Boolean(expiry(today)), expiringSoon, today);
  }
});

test("the window crosses month and year ends and leap days correctly", () => {
  assert.equal(expiryReminderStart("2027-01-03"), "2026-12-28");
  assert.equal(expiryReminderStart("2028-03-02"), "2028-02-25");
  assert.equal(expiryReminderStart("2028-03-05"), "2028-02-28");
  assert.equal(expiryReminderStart("2028-03-06"), "2028-02-29", "2028 is a leap year");
  assert.equal(expiryReminderOf(membership({ end_date: "2027-01-03" }), { today: "2026-12-27" }), null);
  assert.equal(expiryReminderOf(membership({ end_date: "2027-01-03" }), { today: "2026-12-28" }).daysUntilEnd, 6);
});

test("the reminder carries what the screens need and nothing they would have to re-derive", () => {
  assert.deepEqual(expiry("2026-11-17"), { type: "expiry", membershipId: "m1", studentId: "s1", endDate: END, daysUntilEnd: 3 });
});

// ---- expiry: exclusions and resolution --------------------------------------------------------------------------------------------------------

test("a cancelled membership has no expiry reminder - before or after its end date", () => {
  assert.equal(expiry("2026-11-17", { cancelled_at: "2026-11-01T10:00:00Z" }), null);
  assert.equal(expiry("2026-12-01", { cancelled_at: "2026-11-01T10:00:00Z" }), null);
});

test("a membership with no end date (a class-count membership with No expiry, too) never has an expiry reminder", () => {
  for (const end_date of [null, undefined, ""]) {
    assert.equal(expiry("2030-01-01", { end_date }), null, String(end_date));
  }
  assert.equal(expiry("2030-01-01", { end_date: null, kind: "class_count", total_classes: 10 }), null);
});

const renewal = (overrides = {}) => ({ id: "m2", student_id: "s1", start_date: "2026-11-21", end_date: "2026-12-20", cancelled_at: null, ...overrides });

test("a renewal (ending later) both resolves and supersedes the old reminder: from the day it is saved the old membership is not the latest-ending one", () => {
  assert.equal(expiry("2026-11-25", {}, [renewal()]), null, "the renewal is Active on the 25th");
  assert.equal(expiry("2026-11-21", {}, [renewal()]), null, "its first day");
  assert.equal(expiry("2026-12-20", {}, [renewal()]), null, "its last day");
});

test("covering today resolves the reminder of the latest-ending membership itself - shown with a covering membership that does not end later", () => {
  // Same end date as the old one: both are latest-ending, so only covering today can resolve the old one.
  const covering = renewal({ start_date: "2026-11-01", end_date: END });
  assert.equal(isLatestEndingMembership(membership(), [covering]), true);
  assert.equal(expiry("2026-11-17", {}, [covering]), null, "the other membership covers today");
  // An open-ended membership never counts as latest-ending, but it can cover today.
  assert.equal(expiry("2026-11-25", {}, [renewal({ id: "m3", start_date: "2026-11-01", end_date: null })]), null);
});

test("a future-starting membership never resolves by covering today - but if it ends later it is the latest-ending one, so the old one has no reminder", () => {
  // Ends later, starts in the future: it does not cover today, yet the old membership is no longer the latest-ending one.
  const later = renewal({ start_date: "2026-12-05", end_date: "2027-01-04" });
  assert.equal(isResolvedByRenewal(membership(), [later], "2026-11-30"), false, "it does not cover today");
  assert.equal(isLatestEndingMembership(membership(), [later]), false);
  assert.equal(expiry("2026-11-18", {}, [later]), null);
  assert.equal(expiry("2026-11-30", {}, [later]), null, "during the gap as well");
  // Same end date, starts in the future: both are latest-ending, and it does not cover today, so the old reminder stays until it starts.
  const sameEnd = renewal({ start_date: "2026-11-19", end_date: END });
  assert.ok(expiry("2026-11-17", {}, [sameEnd]), "not yet started");
  assert.equal(expiry("2026-11-19", {}, [sameEnd]), null, "covers today from its first day");
});

test("a renewal that ends later and has already ended carries the reminder itself; the old membership still has none", () => {
  const all = [membership(), renewal()];
  assert.equal(expiry("2027-01-10", {}, all), null, "the old one: not the latest-ending");
  const renewalReminder = expiryReminderOf(renewal(), { today: "2027-01-10", studentMemberships: all });
  assert.equal(renewalReminder.membershipId, "m2");
  assert.equal(renewalReminder.daysUntilEnd, -21);
});

test("a cancelled renewal neither resolves nor supersedes: the old membership keeps its reminder", () => {
  assert.ok(expiry("2026-11-25", {}, [renewal({ cancelled_at: "2026-11-22T00:00:00Z" })]));
});

// ---- latest-ending membership (01-product.md §5 "Reminders") -----------------------------------------------------------------------------------

const ofStudent = (id, start_date, end_date, extra = {}) => ({ id, student_id: "s1", start_date, end_date, cancelled_at: null, payment_status: "paid", ...extra });

test("several expired memberships: only the latest-ending one has an expiry reminder", () => {
  const all = [ofStudent("jan", "2026-01-01", "2026-01-31"), ofStudent("feb", "2026-02-01", "2026-02-28"), ofStudent("mar", "2026-03-01", "2026-03-31")];
  const reminders = collectReminders({ memberships: all, today: "2026-06-01" });
  assert.deepEqual(reminders.map((reminder) => reminder.membershipId), ["mar"]);
});

test("an older membership inside its own window has no reminder while a later-ending membership exists", () => {
  const older = ofStudent("older", "2026-10-21", "2026-11-20");
  const later = ofStudent("later", "2026-11-21", "2026-12-20");
  assert.equal(expiryReminderOf(older, { today: "2026-11-17", studentMemberships: [older, later] }), null);
});

test("once the latest-ending membership has expired, older memberships still have no reminder - only the latest does", () => {
  const all = [ofStudent("older", "2026-10-21", "2026-11-20"), ofStudent("latest", "2026-11-21", "2026-12-20")];
  for (const today of ["2026-12-15", "2026-12-21", "2027-03-01"]) {
    assert.deepEqual(collectReminders({ memberships: all, today }).map((reminder) => reminder.membershipId), ["latest"], today);
  }
});

test("a cancelled membership with a later end date does not disqualify the earlier non-cancelled one", () => {
  const all = [ofStudent("kept", "2026-10-21", "2026-11-20"), ofStudent("cancelled", "2026-11-21", "2027-11-20", { cancelled_at: "2026-11-10T00:00:00Z" })];
  assert.equal(latestEndDateOf(all[0], all), "2026-11-20");
  assert.deepEqual(collectReminders({ memberships: all, today: "2026-11-17" }).map((reminder) => reminder.membershipId), ["kept"]);
});

test("a membership with no end date is ignored when finding the latest end date (it is never the latest-ending one)", () => {
  const all = [ofStudent("dated", "2026-10-21", "2026-11-20"), ofStudent("open", "2026-12-01", null, { kind: "class_count" })];
  assert.equal(latestEndDateOf(all[0], all), "2026-11-20");
  assert.equal(isLatestEndingMembership(all[1], all), false);
  assert.deepEqual(collectReminders({ memberships: all, today: "2026-11-17" }).map((reminder) => reminder.membershipId), ["dated"]);
});

test("two non-cancelled memberships sharing the latest end date both qualify - neither is picked over the other", () => {
  const all = [ofStudent("a", "2026-10-21", "2026-11-20"), ofStudent("b", "2026-11-01", "2026-11-20", { kind: "class_count" })];
  // b covers today on the 17th (it started on 1 Nov), so a is resolved by b, and b by a: test after both have ended.
  assert.deepEqual(collectReminders({ memberships: all, today: "2026-11-25" }).map((reminder) => reminder.membershipId), ["a", "b"]);
  assert.ok(isLatestEndingMembership(all[0], all) && isLatestEndingMembership(all[1], all));
});

test("no non-cancelled membership with an end date: no expiry reminder at all", () => {
  const all = [ofStudent("open", "2026-01-01", null), ofStudent("cancelled", "2026-01-01", "2026-02-01", { cancelled_at: "2026-01-15T00:00:00Z" })];
  assert.deepEqual(collectReminders({ memberships: all, today: "2026-11-25" }), []);
  assert.equal(latestEndDateOf(all[0], all), null);
});

test("payment reminders are untouched by the latest-ending rule: an older, superseded membership still has its own unpaid-balance reminder", () => {
  const all = [ofStudent("older", "2026-10-21", "2026-11-20", { payment_status: "partially_paid" }), ofStudent("later", "2026-11-21", "2026-12-20", { payment_status: "pending" })];
  const reminders = collectReminders({ memberships: all, today: "2026-11-17", balancePaiseById: { older: 100000, later: 300000 } });
  assert.deepEqual(reminders.map((reminder) => `${reminder.membershipId}:${reminder.type}`), ["older:payment", "later:payment"]);
});

test("only the same student's memberships decide the latest end date", () => {
  const mine = ofStudent("mine", "2026-10-21", "2026-11-20");
  const theirs = { ...ofStudent("theirs", "2026-11-21", "2027-11-20"), student_id: "s2" };
  assert.equal(latestEndDateOf(mine, [mine, theirs]), "2026-11-20");
  assert.ok(expiryReminderOf(mine, { today: "2026-11-17", studentMemberships: [mine, theirs] }));
});

test("the membership itself counts even when it is missing from the student list", () => {
  assert.equal(latestEndDateOf(membership(), []), END);
  assert.ok(expiry("2026-11-17", {}, []));
});

test("a membership of a DIFFERENT student never resolves it", () => {
  assert.ok(expiry("2026-11-25", {}, [renewal({ student_id: "s2" })]));
  assert.equal(isResolvedByRenewal(membership(), [renewal({ student_id: "s2" })], "2026-11-25"), false);
});

test("the membership itself never resolves its own reminder (it covers today until its end date)", () => {
  assert.ok(expiry("2026-11-17", {}, [membership()]));
  assert.equal(isResolvedByRenewal(membership(), [membership()], "2026-11-17"), false);
});

test("an open-ended membership of the same student that covers today resolves it too (covering today is the rule, whatever the kind)", () => {
  assert.equal(expiry("2026-11-25", {}, [renewal({ id: "m3", start_date: "2026-11-01", end_date: null })]), null);
});

test("the student's Active / Inactive status plays no part: an inactive student's reminder stays", () => {
  assert.ok(expiry("2026-11-25", { students: { status: "inactive" }, student_status: "inactive" }));
  assert.ok(expiryReminderOf({ ...membership(), students: { status: "inactive" } }, { today: "2026-11-17" }));
});

test("a membership with no student id is never resolved by anything", () => {
  assert.ok(expiry("2026-11-25", { student_id: null }, [renewal({ student_id: null })]));
});

// ---- payment ----------------------------------------------------------------------------------------------------------------------------------

const pay = (overrides, balancePaise) => paymentReminderOf(membership(overrides), { balancePaise });

test("Pending or Partially Paid with a positive balance is a payment reminder", () => {
  assert.deepEqual(pay({ payment_status: "pending" }, 300000), { type: "payment", membershipId: "m1", studentId: "s1", paymentStatus: "pending", balancePaise: 300000 });
  assert.deepEqual(pay({ payment_status: "partially_paid" }, 1), { type: "payment", membershipId: "m1", studentId: "s1", paymentStatus: "partially_paid", balancePaise: 1 });
  assert.deepEqual(PAYMENT_REMINDER_STATUSES, ["pending", "partially_paid"]);
});

test("Paid never has a payment reminder, even if a balance was supplied", () => {
  assert.equal(pay({ payment_status: "paid" }, 50000), null);
});

test("a zero, negative or missing balance is no reminder, whatever the status", () => {
  for (const status of ["pending", "partially_paid"]) {
    for (const balance of [0, -1, -50000, undefined, null, Number.NaN, "500"]) {
      assert.equal(pay({ payment_status: status }, balance), null, `${status} ${String(balance)}`);
    }
  }
});

test("a cancelled membership never has a payment reminder, even with a balance left", () => {
  assert.equal(pay({ payment_status: "pending", cancelled_at: "2026-11-01T10:00:00Z" }, 300000), null);
  assert.equal(pay({ payment_status: "partially_paid", cancelled_at: "2026-11-01T10:00:00Z" }, 100000), null);
});

test("dates play no part: an upcoming, an active and an expired membership with a balance all have one", () => {
  for (const [start_date, end_date] of [["2027-01-01", "2027-01-31"], ["2026-10-01", "2026-12-31"], ["2025-01-01", "2025-01-31"], ["2026-10-01", null]]) {
    assert.ok(pay({ payment_status: "pending", start_date, end_date }, 1000), `${start_date}..${end_date}`);
  }
});

test("an unknown or missing payment status is not a reminder", () => {
  for (const payment_status of [undefined, null, "", "Pending", "unpaid", "refunded"]) {
    assert.equal(pay({ payment_status }, 1000), null, String(payment_status));
  }
});

test("the balance is the existing payment calculation: amount less recorded payments, never below zero", () => {
  assert.equal(outstandingBalancePaise({ amount: 3000 }, []), 300000);
  assert.equal(outstandingBalancePaise({ amount: 3000 }, [{ amount: 1000 }, { amount: "500.50" }]), 149950);
  assert.equal(outstandingBalancePaise({ amount: 3000 }, [{ amount: 3000 }]), 0);
  assert.equal(outstandingBalancePaise({ amount: 3000 }, [{ amount: 3500 }]), 0, "an overpayment is no balance");
  assert.equal(outstandingBalancePaise({ amount: 3000 }, null), 300000);
});

test("paying the full balance removes the payment reminder (repeats daily until then: the rule has no date in it)", () => {
  const m = membership({ payment_status: "partially_paid" });
  const payments = [{ amount: 1000 }];
  assert.ok(paymentReminderOf(m, { balancePaise: outstandingBalancePaise(m, payments) }));
  payments.push({ amount: 2000 });
  assert.equal(paymentReminderOf(m, { balancePaise: outstandingBalancePaise(m, payments) }), null);
});

// ---- both together, and independent ------------------------------------------------------------------------------------------------------------

test("a membership with both conditions gets TWO separate reminders, expiry then payment", () => {
  const reminders = remindersForMembership(membership({ payment_status: "pending" }), { today: "2026-11-17", balancePaise: 300000 });
  assert.deepEqual(reminders.map((reminder) => reminder.type), ["expiry", "payment"]);
  assert.equal(reminders[0].daysUntilEnd, 3);
  assert.equal(reminders[1].balancePaise, 300000);
});

test("each condition alone gives only its own reminder; neither gives none", () => {
  assert.deepEqual(remindersForMembership(membership(), { today: "2026-11-17", balancePaise: 0 }).map((r) => r.type), ["expiry"]);
  assert.deepEqual(remindersForMembership(membership({ payment_status: "pending" }), { today: "2026-10-25", balancePaise: 5 }).map((r) => r.type), ["payment"]);
  assert.deepEqual(remindersForMembership(membership(), { today: "2026-10-25", balancePaise: 0 }), []);
});

test("a renewal resolves the old expiry reminder but leaves every payment reminder alone - its own and the renewal's", () => {
  const old = membership({ payment_status: "partially_paid" });
  const renewed = renewal({ payment_status: "pending" });
  const reminders = collectReminders({
    memberships: [old, renewed],
    today: "2026-11-25",
    balancePaiseById: new Map([
      ["m1", 100000],
      ["m2", 300000],
    ]),
  });
  assert.deepEqual(
    reminders.map((reminder) => `${reminder.membershipId}:${reminder.type}`),
    ["m1:payment", "m2:payment"],
    "the old membership keeps its unpaid balance reminder; only its expiry reminder is resolved"
  );
});

test("collectReminders: renewal context is per student, balances by id (Map or plain object), and a missing balance means no payment reminder", () => {
  const memberships = [
    membership({ id: "a", student_id: "s1", payment_status: "pending" }),
    membership({ id: "b", student_id: "s2", start_date: "2026-11-21", end_date: "2026-12-20" }),
    membership({ id: "c", student_id: "s2", end_date: "2026-11-18", payment_status: "pending" }),
  ];
  const reminders = collectReminders({ memberships, today: "2026-11-25", balancePaiseById: { a: 500 } });
  assert.deepEqual(
    reminders.map((reminder) => `${reminder.membershipId}:${reminder.type}`),
    ["a:expiry", "a:payment"],
    "s2's renewal (b) resolves c's expiry; c has no balance entry; s1 has no renewal"
  );
});

test("collectReminders never produces two reminders of the same type for one membership (calculated, so nothing can duplicate)", () => {
  const memberships = [membership({ payment_status: "pending" })];
  const reminders = collectReminders({ memberships, today: "2026-11-25", balancePaiseById: { m1: 100 } });
  const keys = reminders.map((reminder) => `${reminder.membershipId}:${reminder.type}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(collectReminders({ memberships: [], today: "2026-11-25" }), []);
  assert.deepEqual(collectReminders({ memberships: [null, undefined], today: "2026-11-25" }), []);
});

test("the reminder types are exactly expiry and payment", () => {
  assert.deepEqual(REMINDER_TYPES, { EXPIRY: "expiry", PAYMENT: "payment" });
});

// ---- dates: centre-local, never the machine's clock -----------------------------------------------------------------------------------------------

test("a centre-local today is required: without one the rules refuse rather than read the machine's clock", () => {
  for (const today of [undefined, null, "", "2026-11-5", "20261117", "not a date", new Date()]) {
    assert.throws(() => expiryReminderOf(membership(), { today }), TypeError, String(today));
    assert.throws(() => collectReminders({ memberships: [], today }), TypeError, String(today));
  }
});

test("near midnight the centre's date decides, not UTC: 23:30 UTC on 13 Nov is already 14 Nov in India - the first reminder day", () => {
  const instant = new Date("2026-11-13T23:30:00Z");
  const india = membershipToday(instant, "Asia/Kolkata");
  const utc = membershipToday(instant, "UTC");
  assert.equal(india, "2026-11-14");
  assert.equal(utc, "2026-11-13");
  assert.ok(expiry(india), "the centre has reached end date - 6");
  assert.equal(expiry(utc), null, "the UTC date is still a day early");
});

test("near midnight on the expiry date: 18:29 UTC is the last minute of the end date in India; 18:30 is the day after", () => {
  assert.equal(expiry(membershipToday(new Date("2026-11-20T18:29:00Z"), "Asia/Kolkata")).daysUntilEnd, 0);
  assert.equal(expiry(membershipToday(new Date("2026-11-20T18:30:00Z"), "Asia/Kolkata")).daysUntilEnd, -1);
});

test("the module is pure: no clock, no database, no network, no UI", () => {
  const source = readFileSync(new URL("./rules.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/new Date\(\)|Date\.now\(\)/.test(source), "no current time");
  assert.ok(!/supabase|fetch\(|"@\//.test(source), "no database, network or app-alias import");
  assert.ok(!/react|jsx|className/.test(source), "no UI");
});
