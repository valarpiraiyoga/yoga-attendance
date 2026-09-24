// Run with `npm test` (Node's built-in test runner — no extra dependency).
//
// Covers the membership date rules at the centre-timezone boundary: a
// membership's status, days left and progress are evaluated on the centre's
// calendar date (Asia/Kolkata), not the server's UTC date, and stay in step
// with attendance eligibility (which compares membership dates to the
// session's own date and never to "today").

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveMembershipStatusOn, getMembershipValidity, getValidityLabel, membershipToday } from "./validity.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Instants (UTC) and the centre date each falls on.
const SEP_22_0342_IST = new Date("2026-09-21T22:12:00Z"); // 03:42 IST Sep 22 — UTC is still Sep 21
const SEP_21_NOON_IST = new Date("2026-09-21T06:30:00Z"); // 12:00 IST Sep 21
const SEP_21_2359_IST = new Date("2026-09-21T18:29:00Z"); // 23:59 IST Sep 21
const SEP_22_0000_IST = new Date("2026-09-21T18:30:00Z"); // 00:00 IST Sep 22

/** Status + validity exactly as Membership Detail computes them, at `now`. */
function detailAt(membership, now) {
  const today = membershipToday(now);
  const status = deriveMembershipStatusOn(membership, today);
  const validity = getMembershipValidity({ ...membership, status }, today);
  return { today, status, validity, label: getValidityLabel(validity).text };
}

/** Days used as Membership Detail shows "Used N of M days" (app/memberships/[id]/page.js `usedDays`). */
function usedDays({ status, totalDays, daysLeft }) {
  if (status === "active") return totalDays - daysLeft;
  if (status === "expired") return totalDays;
  return 0;
}

const membership = (start_date, end_date, cancelled_at = null) => ({ start_date, end_date, cancelled_at });

test("the centre date, not the UTC date, is the membership 'today'", () => {
  assert.equal(SEP_22_0342_IST.toISOString().slice(0, 10), "2026-09-21", "UTC is still the previous day (the old bug)");
  assert.equal(membershipToday(SEP_22_0342_IST), "2026-09-22");
  assert.equal(membershipToday(SEP_21_NOON_IST), "2026-09-21");
  assert.equal(membershipToday(SEP_21_2359_IST), "2026-09-21");
  assert.equal(membershipToday(SEP_22_0000_IST), "2026-09-22");
});

test("A: Sep 21 → Sep 21 at Sep 22 03:42 IST is Expired, 1 of 1 days used, 100%", () => {
  const d = detailAt(membership("2026-09-21", "2026-09-21"), SEP_22_0342_IST);
  assert.equal(d.status, "expired");
  assert.equal(d.label, "Expired");
  assert.equal(d.validity.daysLeft, null); // nothing remaining
  assert.equal(d.validity.totalDays, 1);
  assert.equal(usedDays({ ...d.validity, status: d.status }), 1);
  assert.equal(d.validity.percentUsed, 100);
});

test("B: Sep 21 → Sep 22 at Sep 22 03:42 IST is Active, 1 day left, 1 of 2 used, 50%", () => {
  const d = detailAt(membership("2026-09-21", "2026-09-22"), SEP_22_0342_IST);
  assert.equal(d.status, "active");
  assert.equal(d.validity.daysLeft, 1);
  assert.equal(d.validity.totalDays, 2);
  assert.equal(usedDays({ ...d.validity, status: d.status }), 1);
  assert.equal(d.validity.percentUsed, 50);
  assert.equal(d.label, "1 day left");
});

test("C: Sep 21 → Sep 21 during Sep 21 IST is Active, 1 total day, 1 day left, 0% used", () => {
  for (const now of [SEP_21_NOON_IST, SEP_21_2359_IST]) {
    const d = detailAt(membership("2026-09-21", "2026-09-21"), now);
    assert.equal(d.status, "active");
    assert.equal(d.validity.totalDays, 1);
    assert.equal(d.validity.daysLeft, 1);
    assert.equal(usedDays({ ...d.validity, status: d.status }), 0);
    assert.equal(d.validity.percentUsed, 0);
  }
});

test("the status flips at the centre's midnight (00:00 IST), not at 00:00 UTC", () => {
  const m = membership("2026-09-21", "2026-09-21");
  assert.equal(detailAt(m, SEP_21_2359_IST).status, "active");
  assert.equal(detailAt(m, SEP_22_0000_IST).status, "expired");
  // 05:30 IST = 00:00 UTC: the old UTC reading only flipped here.
  assert.equal(detailAt(m, new Date("2026-09-22T00:00:00Z")).status, "expired");
});

test("D: a future membership is Upcoming", () => {
  const d = detailAt(membership("2026-09-25", "2026-10-24"), SEP_22_0342_IST);
  assert.equal(d.status, "upcoming");
  assert.equal(d.validity.startsInDays, 3);
  assert.equal(d.label, "Starts in 3 days");
  assert.equal(d.validity.percentUsed, 0);
});

test("a membership starting today (centre date) is Active, not Upcoming, in the UTC-lag window", () => {
  const d = detailAt(membership("2026-09-22", "2026-09-23"), SEP_22_0342_IST);
  assert.equal(d.status, "active");
  assert.equal(d.validity.daysLeft, 2);
  assert.equal(d.validity.percentUsed, 0);
});

test("E: a membership spanning today is Active with correct days left and progress", () => {
  const d = detailAt(membership("2026-09-10", "2026-09-30"), SEP_22_0342_IST);
  assert.equal(d.status, "active");
  assert.equal(d.validity.totalDays, 21);
  assert.equal(d.validity.daysLeft, 9); // Sep 22..30 inclusive
  assert.equal(usedDays({ ...d.validity, status: d.status }), 12); // Sep 10..21
  assert.equal(d.validity.percentUsed, 57); // round(12 / 21)
  assert.equal(d.label, "9 days left");
});

test("both ends are inclusive", () => {
  const m = membership("2026-09-10", "2026-09-20");
  assert.equal(deriveMembershipStatusOn(m, "2026-09-09"), "upcoming");
  assert.equal(deriveMembershipStatusOn(m, "2026-09-10"), "active");
  assert.equal(deriveMembershipStatusOn(m, "2026-09-20"), "active");
  assert.equal(deriveMembershipStatusOn(m, "2026-09-21"), "expired");
});

test("cancellation still overrides every date-derived status", () => {
  const cancelled = membership("2026-09-10", "2026-09-30", "2026-09-20T10:00:00Z");
  assert.equal(detailAt(cancelled, SEP_22_0342_IST).status, "cancelled");
  assert.equal(deriveMembershipStatusOn(cancelled, "2026-08-01"), "cancelled");
});

// ---- Attendance eligibility is unchanged and still date-of-session based ----------------------------------

// The eligibility SQL (supabase/migrations/0015_class_session_eligible_students.sql, the current
// resolve_eligible_students) — its membership predicate, mirrored here for the boundary example.
const coversSessionDate = (m, sessionDate) => m.start_date <= sessionDate && m.end_date >= sessionDate;

test("attendance: Sep 21 → Sep 21 membership is not eligible for a Sep 22 session (and is for Sep 21)", () => {
  const m = membership("2026-09-21", "2026-09-21");
  assert.equal(coversSessionDate(m, "2026-09-22"), false);
  assert.equal(coversSessionDate(m, "2026-09-21"), true);
});

test("attendance eligibility SQL still compares membership dates to the session date and never to today", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", "0015_class_session_eligible_students.sql"), "utf8");
  const start = sql.indexOf("create or replace function public.resolve_eligible_students(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assert.ok(body.includes("and m.start_date <= p_session_date"));
  assert.ok(body.includes("and m.end_date >= p_session_date"));
  assert.ok(!/current_date|now\(\)|localtimestamp/i.test(body), "eligibility must not depend on the clock");
});

test("no migration was added for this change: membership status is still derived, never stored", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", "0008_memberships.sql"), "utf8");
  assert.ok(/derived from start_date\/end_date in the data\s+-- layer/.test(sql));
});

// ---- Wiring guard: the data layer reads its "today" from the centre helper ---------------------------------

test("lib/memberships/data.js takes its 'today' from the centre-timezone helper, not UTC", () => {
  const src = readFileSync(join(ROOT, "lib", "memberships", "data.js"), "utf8");
  assert.ok(/export function todayDateString\(\) \{\s*return membershipToday\(\);\s*\}/.test(src));
  assert.ok(!/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(src), "no UTC 'today' left in the membership data layer");
});
