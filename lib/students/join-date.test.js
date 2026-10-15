import test from "node:test";
import assert from "node:assert/strict";
import {
  changedStartBeforeJoinDateError,
  joinDateLabel,
  joinDateMoveError,
  matchKnownJoinDateError,
  movedAssignmentsText,
  startBeforeJoinDateError,
  startDateChanged,
} from "./join-date.js";
import { preparePackageMembership } from "../packages/membership-creation.js";

test("a start date before the join date is refused, on or after it passes", () => {
  assert.match(startBeforeJoinDateError("enrollment", "2026-10-09", "2026-10-10"), /enrollment cannot start before the student joined \(Oct 10, 2026\)/);
  assert.match(startBeforeJoinDateError("membership", "2026-10-09", "2026-10-10"), /membership cannot start before/);
  assert.equal(startBeforeJoinDateError("enrollment", "2026-10-10", "2026-10-10"), null);
  assert.equal(startBeforeJoinDateError("enrollment", "2026-10-11", "2026-10-10"), null);
});

test("no join date or an unreadable date means no rule", () => {
  assert.equal(startBeforeJoinDateError("enrollment", "2026-10-01", null), null);
  assert.equal(startBeforeJoinDateError("enrollment", "", "2026-10-10"), null);
});

test("only a CHANGED start date is judged, so unrelated edits of an out-of-range record work", () => {
  assert.equal(startDateChanged("2026-10-01", "2026-10-01"), false);
  assert.equal(startDateChanged("2026-10-01", "2026-10-02"), true);
  assert.equal(startDateChanged(null, "2026-10-02"), true);
  assert.equal(changedStartBeforeJoinDateError("enrollment", { previousStart: "2026-10-01", nextStart: "2026-10-01", joinDate: "2026-10-10" }), null);
  assert.match(changedStartBeforeJoinDateError("enrollment", { previousStart: "2026-10-01", nextStart: "2026-10-05", joinDate: "2026-10-10" }), /cannot start before/);
  assert.equal(changedStartBeforeJoinDateError("enrollment", { previousStart: "2026-10-01", nextStart: "2026-10-10", joinDate: "2026-10-10" }), null);
});

test("a join date moved later is refused only past the start of a live record", () => {
  const base = { previousJoinDate: "2026-10-01", nextJoinDate: "2026-10-10" };
  assert.match(joinDateMoveError({ ...base, enrollmentStarts: ["2026-10-05"], membershipStarts: ["2026-10-01"] }), /1 active enrollment\(s\) and 1 membership\(s\).*earliest Oct 1, 2026/);
  assert.equal(joinDateMoveError({ ...base, enrollmentStarts: ["2026-10-10"], membershipStarts: [] }), null);
  assert.equal(joinDateMoveError({ ...base, enrollmentStarts: [], membershipStarts: [] }), null);
});

test("moving the join date earlier or not at all is never refused", () => {
  assert.equal(joinDateMoveError({ previousJoinDate: "2026-10-10", nextJoinDate: "2026-10-01", enrollmentStarts: ["2026-09-01"], membershipStarts: ["2026-09-01"] }), null);
  assert.equal(joinDateMoveError({ previousJoinDate: "2026-10-10", nextJoinDate: "2026-10-10", enrollmentStarts: ["2026-09-01"], membershipStarts: [] }), null);
});

test("the database messages are recognised and mapped to the right field", () => {
  const enr = matchKnownJoinDateError({ code: "23514", message: "The enrollment cannot start before the student joined (2026-10-10). Correct the join date in Edit Student first." });
  assert.equal(enr.field, "effective_start_date");
  assert.equal(matchKnownJoinDateError({ code: "23514", message: "The membership cannot start before the student joined (2026-10-10). x" }).field, "start_date");
  assert.equal(matchKnownJoinDateError({ code: "23514", message: "The join date cannot be moved to 2026-10-10 while ..." }).field, "join_date");
  assert.match(matchKnownJoinDateError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "enrollment_schedules_no_overlap"' }).error, /nothing was changed/);
  assert.match(matchKnownJoinDateError({ code: "23514", message: 'violates check constraint "enrollment_schedules_end_after_start"' }).error, /was not changed/);
});

test("an unrelated database error is not claimed", () => {
  assert.equal(matchKnownJoinDateError({ code: "23505", message: "duplicate key" }), null);
  assert.equal(matchKnownJoinDateError({ code: "23P01", message: "memberships_no_overlap_per_student" }), null);
  assert.equal(matchKnownJoinDateError(null), null);
});

test("the moved-assignments sentence is singular or plural, and silent for none", () => {
  assert.equal(movedAssignmentsText(1), "1 schedule assignment was moved to the new start date.");
  assert.equal(movedAssignmentsText("3"), "3 schedule assignments were moved to the new start date.");
  assert.equal(movedAssignmentsText(0), "");
  assert.equal(movedAssignmentsText("x"), "");
  assert.equal(movedAssignmentsText(undefined), "");
});

test("the label is a readable date", () => {
  assert.equal(joinDateLabel("2026-10-10"), "Oct 10, 2026");
});

test("a package membership starting before the join date gets a start_date error; on it, none", () => {
  const raw = { package_id: "pkg-1", duration_option: "quarterly", start_date: "2026-10-08" };
  const pkg = { id: "pkg-1", name: "Yoga Monthly", kind: "duration", status: "active", total_classes: null, options: ["quarterly"], feeEntries: [] };
  const args = { raw, pkg, centreCurrency: "INR", today: "2026-10-15", initialPaymentRaw: null };
  const refused = preparePackageMembership({ ...args, joinDate: "2026-10-10" });
  assert.equal(refused.success, false);
  assert.match(refused.errors.start_date, /cannot start before the student joined \(Oct 10, 2026\)/);
  assert.equal(preparePackageMembership({ ...args, joinDate: "2026-10-08" }).errors?.start_date, undefined);
  assert.equal(preparePackageMembership(args).errors?.start_date, undefined);
});
