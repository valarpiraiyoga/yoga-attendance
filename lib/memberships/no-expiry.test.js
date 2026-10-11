// Run with `npm test` (Node's built-in test runner).
//
// Class-count memberships with no expiry have no end date (migration 0042). These tests cover Phase 3 of Class Count
// Attendance: the validity, status and labels are null-safe, "No expiry" is shown and the start date is kept, the list
// queries and summary counts include a membership with no end date, such a membership covers enrollments, the overlap
// pre-check is for duration memberships only, and the Class Count plan label and filter option exist - while a duration
// membership reads exactly as before.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveMembershipStatusOn, getMembershipValidity, getValidityLabel } from "./validity.js";
import { NO_EXPIRY_LABEL, formatEndDate, formatPeriod } from "./period.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const TODAY = "2026-09-21";
const status = (membership, today = TODAY) => deriveMembershipStatusOn(membership, today);
const validity = (membership, today = TODAY) => getMembershipValidity({ ...membership, status: status(membership, today) }, today);

// ---- status and validity ------------------------------------------------------------------------------------------------

test("a membership with no end date is Active from its start, never Expired, whatever the date", () => {
  const open = { start_date: "2026-09-01", end_date: null, cancelled_at: null };
  assert.equal(status(open, "2026-08-31"), "upcoming");
  assert.equal(status(open, "2026-09-01"), "active");
  assert.equal(status(open, "2026-09-21"), "active");
  assert.equal(status(open, "2035-01-01"), "active", "no end date, so it can never pass one");
  assert.equal(status({ ...open, cancelled_at: "2026-09-10T00:00:00Z" }), "cancelled", "cancellation still overrides");
});

test("an Active membership with no end date has no days left, no total and an empty bar - never NaN", () => {
  const result = validity({ start_date: "2026-09-01", end_date: null, cancelled_at: null });
  assert.deepEqual(
    { status: result.status, totalDays: result.totalDays, noExpiry: result.noExpiry, daysLeft: result.daysLeft, percentUsed: result.percentUsed },
    { status: "active", totalDays: null, noExpiry: true, daysLeft: null, percentUsed: 0 },
  );
  for (const value of Object.values(result)) assert.ok(!Number.isNaN(value));
});

test("an Upcoming membership with no end date still says when it starts", () => {
  const result = validity({ start_date: "2026-09-25", end_date: null, cancelled_at: null });
  assert.equal(result.status, "upcoming");
  assert.equal(result.startsInDays, 4);
  assert.equal(result.noExpiry, true);
  assert.equal(getValidityLabel(result).text, "Starts in 4 days");
});

test("the label for an Active membership with no end date is No expiry, in the card and the compact table cell", () => {
  const result = validity({ start_date: "2026-09-01", end_date: null, cancelled_at: null });
  assert.deepEqual(getValidityLabel(result), { text: "No expiry", tone: "default" });
  assert.deepEqual(getValidityLabel(result, { compact: true }), { text: "No expiry", tone: "default" });
});

test("a duration membership reads exactly as before (days left, total, percent, labels)", () => {
  const duration = { start_date: "2026-09-01", end_date: "2026-09-30", cancelled_at: null };
  const result = validity(duration);
  assert.equal(result.noExpiry, false);
  assert.equal(result.totalDays, 30);
  assert.equal(result.daysLeft, 10);
  assert.equal(result.percentUsed, 67);
  assert.deepEqual(getValidityLabel(result), { text: "10 days left", tone: "default" });
  assert.deepEqual(getValidityLabel(result, { compact: true }), { text: "10", tone: "default" });
  assert.equal(status(duration, "2026-09-30"), "active");
  assert.equal(status(duration, "2026-10-01"), "expired");
  assert.deepEqual(getValidityLabel(validity(duration, "2026-10-05")), { text: "Expired", tone: "danger" });
  assert.equal(getValidityLabel(validity(duration, "2026-10-05"), { compact: true }).text, "—");
});

// ---- period text -----------------------------------------------------------------------------------------------------------

test("the period keeps the start date and says No expiry when there is no end date", () => {
  assert.equal(NO_EXPIRY_LABEL, "No expiry");
  assert.equal(formatEndDate(null), "No expiry");
  assert.equal(formatEndDate(undefined), "No expiry");
  assert.equal(formatEndDate("2026-09-30"), "Sep 30, 2026");
  assert.equal(formatPeriod("2026-09-01", null), "Sep 01, 2026 – No expiry");
  // Unchanged for a duration membership: within a year and across years, and nothing without a start date.
  assert.equal(formatPeriod("2026-09-01", "2026-09-30"), "Sep 1 – Sep 30, 2026");
  assert.equal(formatPeriod("2026-12-01", "2027-01-30"), "Dec 01, 2026 – Jan 30, 2027");
  assert.equal(formatPeriod(null, "2026-09-30"), "—");
});

// ---- queries and counts ---------------------------------------------------------------------------------------------------------

test("the Active list filter and the summary counts include a membership with no end date", () => {
  const data = source("./data.js");
  const active = ".or(`end_date.is.null,end_date.gte.${today}`)";
  // The list's Active filter, and the summary's `active()` (which Expiring Soon builds on).
  assert.ok(data.includes(`.lte("start_date", today)\n      ${active}`), "list filter");
  assert.ok(data.includes(`.lte("start_date", today).or(\`end_date.is.null,end_date.gte.\${today}\`)`), "summary active()");
  assert.doesNotMatch(data, /\.gte\("end_date", today\)/, "no query still drops a null end date");
  // Expired and Expiring Soon never include one: a null end date fails `lt` and `lte`.
  assert.match(data, /query = query\.is\("cancelled_at", null\)\.lt\("end_date", today\)/);
  assert.match(data, /active\(\)\.lte\("end_date", cutoff\)/);
  assert.match(data, /count\(\)\.is\("cancelled_at", null\)\.lt\("end_date", today\)/);
});

test("the Students list Active filter counts an active membership with no end date", () => {
  const data = source("./data.js");
  assert.match(data, /row\.start_date <= today && \(row\.end_date == null \|\| today <= row\.end_date\)/);
  // Its Active / Expired / None summary and current-membership pick go through the status derivation, which is null-safe.
  const students = source("../students/data.js");
  assert.match(students, /deriveMembershipStatus\(membership, today\) === "active"/);
});

test("a membership with no end date covers every enrollment from its start", () => {
  const data = source("./data.js");
  assert.match(data, /const membershipEnd = membership\.end_date \?\? "9999-12-31";/);
  assert.match(data, /enrollment\.effective_start_date <= membershipEnd && enrollmentEnd >= membership\.start_date/);
});

test("the overlap pre-check is for duration memberships only, like the database constraint", () => {
  const actions = source("./actions.js");
  const check = actions.slice(actions.indexOf("async function hasOverlappingMembership"));
  assert.match(check.slice(0, 700), /\.eq\("student_id", studentId\)\s*\/\/[^\n]*\n\s*\.eq\("kind", "duration"\)\s*\.is\("cancelled_at", null\)\s*\.lte\("start_date", endDate\)\s*\.gte\("end_date", startDate\)/);
  // Creating and editing still validate an end date: the form is a duration form until Phase 4.
  assert.match(source("./validation.js"), /errors\.end_date = "End date is required\."/);
});

// ---- labels and screens ------------------------------------------------------------------------------------------------------------

test("the Class Count plan has a label, a list filter option and a valid filter value", () => {
  assert.match(source("../status.js"), /class_count: "Class Count",/);
  assert.match(source("../../app/memberships/membership-filters.js"), /\{ value: "class_count", label: "Class Count" \},\n\];/);
  assert.match(source("../../app/memberships/page.js"), /"custom", "class_count"\];/);
  assert.match(source("../../app/students/[id]/enrollments/new/page.js"), /class_count: "Class Count" \}/);
  // The create/edit form still offers only the five duration plans (Phase 4), and creation still validates against them.
  assert.deepEqual(
    [...source("../../app/memberships/membership-form.js").match(/const PLAN_OPTIONS = \[([\s\S]*?)\];/)[1].matchAll(/value: "(\w+)"/g)].map((m) => m[1]),
    ["monthly", "quarterly", "half_yearly", "annual", "custom"],
  );
  assert.match(source("./validation.js"), /export const MEMBERSHIP_PLANS = \["monthly", "quarterly", "half_yearly", "annual", "custom"\];/);
});

test("no screen formats a membership's end date in a way that breaks or hides the start date when it is null", () => {
  for (const [path, fragment] of [
    ["../../app/memberships/membership-card-item.js", "formatEndDate(membership.end_date)"],
    ["../../app/memberships/membership-table.js", "formatEndDate(membership.end_date)"],
    ["../../app/memberships/[id]/membership-history-row.js", "formatEndDate(entry.end_date)"],
    ["../../app/memberships/[id]/receipt/page.js", "formatEndDate(membership.end_date)"],
    ["../../app/students/[id]/enrollments/new/page.js", "formatEndDate(currentMembership.end_date)"],
  ]) {
    assert.ok(source(path).includes(fragment), `${path} uses the null-safe end date`);
  }
  // Student Details used its own period function, which threw on a null end date; it now uses the shared one.
  const student = source("../../app/students/[id]/page.js");
  assert.doesNotMatch(student, /function formatPeriod\(/);
  assert.match(student, /import \{ NO_EXPIRY_LABEL, formatPeriod \} from "@\/lib\/memberships\/period";/);
  assert.match(student, /: NO_EXPIRY_LABEL\s*: "No membership yet"/);
  // The card shows no "N / total days" and no bar for it; Membership Details shows No expiry and no bar.
  const card = source("../../app/memberships/membership-card-item.js");
  assert.match(card, /const showBar = validity\.status !== "cancelled" && \(classCount \? classCount\.total > 0 : !validity\.noExpiry\);/);
  assert.match(card, /\) : isActive && !validity\.noExpiry \? \(/);
  const details = source("../../app/memberships/[id]/page.js");
  assert.match(details, /const isOpenEnded = showProgress && validity\.noExpiry && !classCount;/);
  assert.match(details, /\{showProgress && !isOpenEnded \? \(/);
  assert.match(details, /: NO_EXPIRY_LABEL;/);
});

test("the validity code knows nothing of classes: class counts are shown by their own helper (Phase 4)", () => {
  assert.doesNotMatch(source("./validity.js"), /class_count_attendance|total_classes|record_class_count/);
  assert.doesNotMatch(source("./data.js"), /record_class_count|list_class_count_eligible/);
});
