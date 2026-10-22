// Run with `npm test` (Node's built-in test runner).
//
// Instructor schedule conflicts (V1 Final Improvements, C2b; 01-product.md §7 "Conflicts"): the shared rule, the reading of the
// database's JSON DETAIL (migration 0062) and the message the Admin sees. Pure functions, tested by running them.

import test from "node:test";
import assert from "node:assert/strict";
import {
  conflictFromSchedule,
  datesOverlap,
  describeConflict,
  findInstructorConflict,
  findOverlappingSlots,
  instructorConflictMessage,
  parseConflictDetail,
  schedulesConflict,
  slotOverlapMessage,
  timesOverlap,
} from "./instructor-conflict.js";

const DETAIL = {
  reason: "instructor_conflict",
  conflict_schedule_id: "1698956f-abe6-4503-b4c9-f317b1fdd49a",
  batch_id: "5d1c2f64-0000-4000-8000-000000000001",
  batch_code: "HY",
  batch_name: "Hatha Yoga",
  day_of_week: "monday",
  start_time: "06:00",
  end_time: "07:00",
  effective_from: "2026-10-12",
  effective_until: null,
};
const detailText = (overrides = {}) => JSON.stringify({ ...DETAIL, ...overrides });
const GENERAL = "This instructor already has a class at an overlapping time on that day. Change the time, day, instructor or dates.";

// ---- the rule -----------------------------------------------------------------------------------------------------------------------

test("times: overlapping intervals overlap; back-to-back ones do not, on either side", () => {
  assert.equal(timesOverlap("06:00", "07:00", "06:30", "07:30"), true);
  assert.equal(timesOverlap("06:00", "08:00", "06:30", "07:00"), true, "one inside the other");
  assert.equal(timesOverlap("06:00", "07:00", "06:00", "07:00"), true, "identical");
  assert.equal(timesOverlap("06:00", "07:00", "07:00", "08:00"), false, "the second starts as the first ends");
  assert.equal(timesOverlap("07:00", "08:00", "06:00", "07:00"), false, "the second ends as the first starts");
  assert.equal(timesOverlap("06:00:00", "07:00:00", "06:30", "07:30"), true, "a database time and a form time compare as the same");
});

test("dates: endpoints are inclusive, and a missing end date is open-ended", () => {
  assert.equal(datesOverlap("2026-10-01", "2026-10-10", "2026-10-10", "2026-10-20"), true, "sharing only the last day overlaps");
  assert.equal(datesOverlap("2026-10-01", "2026-10-10", "2026-10-11", "2026-10-20"), false, "starting the day after does not");
  assert.equal(datesOverlap("2026-10-01", null, "2027-01-01", "2027-02-01"), true, "an open-ended period overlaps any later one");
  assert.equal(datesOverlap("2026-10-01", "", "2027-01-01", null), true, "an empty end date is open-ended too");
  assert.equal(datesOverlap("2026-10-01", "2026-10-10", "2026-09-01", "2026-09-30"), false, "an earlier period that has ended");
  assert.equal(datesOverlap("2026-10-11", null, "2026-09-01", "2026-10-10"), false, "an open-ended period against one ending the day before");
});

const base = {
  instructor_id: "i1",
  day_of_week: "monday",
  start_time: "06:00",
  end_time: "07:00",
  effective_from: "2026-10-01",
  effective_until: null,
};

test("two schedules conflict only when instructor, day, time AND dates all match up", () => {
  assert.equal(schedulesConflict(base, { ...base, start_time: "06:30", end_time: "07:30" }), true);
  assert.equal(schedulesConflict(base, { ...base, instructor_id: "i2" }), false, "a different instructor does not conflict");
  assert.equal(schedulesConflict(base, { ...base, day_of_week: "tuesday" }), false, "a different day does not conflict");
  assert.equal(schedulesConflict(base, { ...base, start_time: "07:00", end_time: "08:00" }), false, "back-to-back does not conflict");
  assert.equal(schedulesConflict({ ...base, effective_until: "2026-10-31" }, { ...base, effective_from: "2026-11-01" }), false, "dates that do not overlap");
  assert.equal(schedulesConflict({ ...base, effective_until: "2026-10-31" }, { ...base, effective_from: "2026-10-31" }), true, "sharing the last day");
});

test("a schedule's status plays no part: the rule never reads it", () => {
  assert.equal(schedulesConflict({ ...base, status: "inactive" }, { ...base, status: "active" }), true);
  assert.equal(schedulesConflict({ ...base, status: "inactive" }, { ...base, status: "inactive" }), true);
});

// ---- Add Schedule's own slots ---------------------------------------------------------------------------------------------------------

test("slots of one form: an overlapping later slot is reported with the earlier one it overlaps", () => {
  const slots = [
    { start_time: "06:00", end_time: "07:00" },
    { start_time: "06:30", end_time: "07:30" },
    { start_time: "09:00", end_time: "10:00" },
  ];
  assert.deepEqual(findOverlappingSlots(slots), [{ index: 1, with: 0 }]);
});

test("slots of one form: back-to-back and separate slots are fine, identical ones are not", () => {
  assert.deepEqual(findOverlappingSlots([{ start_time: "06:00", end_time: "07:00" }, { start_time: "07:00", end_time: "08:00" }]), []);
  assert.deepEqual(findOverlappingSlots([{ start_time: "06:00", end_time: "07:00" }, { start_time: "18:00", end_time: "19:00" }]), []);
  assert.deepEqual(findOverlappingSlots([{ start_time: "06:00", end_time: "07:00" }, { start_time: "06:00", end_time: "07:00" }]), [{ index: 1, with: 0 }]);
});

test("slots of one form: a blank, invalid or missing slot is skipped (its own validation reports it) and gaps keep their indexes", () => {
  const slots = [
    { start_time: "06:00", end_time: "07:00" },
    null,
    { start_time: "", end_time: "" },
    { start_time: "06:15", end_time: "06:45" },
    { start_time: "08:00", end_time: "07:00" },
  ];
  assert.deepEqual(findOverlappingSlots(slots), [{ index: 3, with: 0 }]);
});

// ---- the read-before-create check ----------------------------------------------------------------------------------------------------------

const stored = (overrides = {}) => ({
  id: "s1",
  instructor_id: "i1",
  day_of_week: "monday",
  start_time: "06:00:00",
  end_time: "07:00:00",
  effective_from: "2026-10-12",
  effective_until: null,
  status: "inactive",
  batches: { name: "Hatha Yoga", code: "HY" },
  ...overrides,
});
const period = { effective_from: "2026-11-01", effective_until: null };
const row = (day, start, end) => [{ day_of_week: day, start_time: start, end_time: end }];

test("pre-check: a proposed class overlapping a stored one (any status) is found and described from the stored row", () => {
  assert.deepEqual(findInstructorConflict(row("monday", "06:30", "07:30"), period, [stored()]), {
    batch_name: "Hatha Yoga",
    batch_code: "HY",
    day_of_week: "monday",
    start_time: "06:00:00",
    end_time: "07:00:00",
    effective_from: "2026-10-12",
    effective_until: null,
  });
});

test("pre-check: any one of the proposed day x slot rows is enough", () => {
  const rows = [...row("tuesday", "06:00", "07:00"), ...row("monday", "06:00", "07:00")];
  assert.ok(findInstructorConflict(rows, period, [stored()]));
});

test("pre-check: no conflict for another day, back-to-back, or a stored period that ended before the new one starts", () => {
  assert.equal(findInstructorConflict(row("tuesday", "06:00", "07:00"), period, [stored()]), null);
  assert.equal(findInstructorConflict(row("monday", "07:00", "08:00"), period, [stored()]), null);
  assert.equal(findInstructorConflict(row("monday", "06:00", "07:00"), period, [stored({ effective_until: "2026-10-31" })]), null);
  assert.equal(findInstructorConflict(row("monday", "06:00", "07:00"), period, []), null);
  assert.equal(findInstructorConflict(row("monday", "06:00", "07:00"), period, null), null, "nothing could be read: no pre-check, the database decides");
});

test("pre-check: inclusive endpoint - a stored period ending on the new start day still conflicts", () => {
  assert.ok(findInstructorConflict(row("monday", "06:00", "07:00"), period, [stored({ effective_until: "2026-11-01" })]));
});

test("conflictFromSchedule keeps what the message needs and no id", () => {
  assert.equal("id" in conflictFromSchedule(stored()), false);
  assert.equal(conflictFromSchedule(stored({ batches: null })).batch_name, null);
});

// ---- reading the database's DETAIL -----------------------------------------------------------------------------------------------------------

test("parseConflictDetail reads a valid instructor-conflict payload", () => {
  const parsed = parseConflictDetail(detailText());
  assert.equal(parsed.day_of_week, "monday");
  assert.equal(parsed.batch_name, "Hatha Yoga");
  assert.equal(parsed.effective_until, null);
  assert.equal("conflict_schedule_id" in parsed, false, "the id is not carried into anything shown");
});

test("parseConflictDetail refuses anything that is not an instructor conflict - it never throws", () => {
  for (const details of [
    null,
    undefined,
    "",
    "   ",
    "not json",
    "{broken",
    "[]",
    "null",
    "42",
    JSON.stringify({ reason: "something_else", day_of_week: "monday" }),
    JSON.stringify({ day_of_week: "monday", start_time: "06:00" }),
    JSON.stringify([{ reason: "instructor_conflict" }]),
    { reason: "instructor_conflict" },
    "Key (schedule_series_id)=(abc) conflicts with existing key",
    "schedule_series_id=2b6d1a0e-0000-4000-8000-000000000001",
  ]) {
    assert.equal(parseConflictDetail(details), null, JSON.stringify(details));
  }
});

test("parseConflictDetail ignores values of the wrong type instead of showing them", () => {
  const parsed = parseConflictDetail(
    JSON.stringify({ reason: "instructor_conflict", batch_name: 5, day_of_week: "monday", start_time: ["06:00"], end_time: "07:00", effective_from: {} })
  );
  assert.equal(parsed.batch_name, null);
  assert.equal(parsed.start_time, null);
  assert.equal(parsed.effective_from, null);
  assert.equal(parsed.day_of_week, "monday");
});

// ---- the message -------------------------------------------------------------------------------------------------------------------------

test("describeConflict: day, time range, batch (name and code), period - open-ended says 'with no end date'", () => {
  assert.equal(
    describeConflict(parseConflictDetail(detailText())),
    "This instructor already has a class on Monday, 6:00 AM – 7:00 AM, in Hatha Yoga (HY), from Oct 12, 2026 with no end date. Change the time, day, instructor or dates."
  );
});

test("describeConflict: a closed period gives both dates", () => {
  assert.equal(
    describeConflict(parseConflictDetail(detailText({ effective_until: "2026-12-31", day_of_week: "friday", start_time: "18:30", end_time: "19:30" }))),
    "This instructor already has a class on Friday, 6:30 PM – 7:30 PM, in Hatha Yoga (HY), from Oct 12, 2026 to Dec 31, 2026. Change the time, day, instructor or dates."
  );
});

test("describeConflict: parts the details do not carry are left out", () => {
  assert.equal(
    describeConflict(parseConflictDetail(detailText({ batch_name: null, batch_code: "HY", effective_from: null }))),
    "This instructor already has a class on Monday, 6:00 AM – 7:00 AM, in HY. Change the time, day, instructor or dates."
  );
  assert.equal(
    describeConflict(parseConflictDetail(detailText({ batch_name: "Hatha Yoga", batch_code: null }))),
    "This instructor already has a class on Monday, 6:00 AM – 7:00 AM, in Hatha Yoga, from Oct 12, 2026 with no end date. Change the time, day, instructor or dates."
  );
  assert.equal(describeConflict(parseConflictDetail(detailText({ day_of_week: null }))), GENERAL);
  assert.equal(describeConflict(null), GENERAL);
});

test("describeConflict never shows an id, a SQLSTATE or database wording", () => {
  const message = describeConflict(parseConflictDetail(detailText()));
  assert.doesNotMatch(message, /1698956f|5d1c2f64|[0-9a-f]{8}-[0-9a-f]{4}|23P01|SQLSTATE|constraint|violat|exclusion|trigger|schedules\b|public\./i);
});

test("instructorConflictMessage needs BOTH the SQLSTATE and a valid payload", () => {
  const good = { code: "23P01", message: "This instructor already has a class at an overlapping time on that day.", details: detailText() };
  assert.match(instructorConflictMessage(good), /^This instructor already has a class on Monday/);
  assert.equal(instructorConflictMessage({ ...good, code: "23514" }), null, "another code with the payload is not trusted");
  assert.equal(instructorConflictMessage({ ...good, details: "" }), null, "the code without the payload is not trusted either");
  assert.equal(instructorConflictMessage({ code: "23P01", details: JSON.stringify({ reason: "other" }) }), null);
  assert.equal(instructorConflictMessage(null), null);
  assert.equal(instructorConflictMessage(undefined), null);
});

test("slotOverlapMessage names the earlier slot's time and no database wording", () => {
  assert.equal(
    slotOverlapMessage({ start_time: "06:00", end_time: "07:00" }),
    "Overlaps another time slot (6:00 AM – 7:00 AM). One instructor cannot teach two classes at the same time."
  );
});
