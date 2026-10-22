// Run with `npm test` (Node's built-in test runner).
//
// The Capacity field of the Add / Edit Schedule form (S5): what is accepted, what the messages say, how a database refusal is shown,
// and when an edit changes nothing but the capacity.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPACITY_RANGE_MESSAGE,
  mapScheduleCapacityError,
  scheduleEditChangesOnlyCapacity,
  validateScheduleCapacity,
} from "./capacity-input.js";
import { MAX_SCHEDULE_CAPACITY } from "./capacity.js";
import { validateScheduleInput } from "./validation.js";

const ok = (raw) => validateScheduleCapacity(raw);

// ---- the field ------------------------------------------------------------------------------------------------------------

test("blank means unlimited: an empty or spaces-only field is null, and says it was submitted", () => {
  for (const raw of ["", "   ", "\t"]) {
    assert.deepEqual(ok(raw), { success: true, data: { provided: true, value: null } }, JSON.stringify(raw));
  }
});

test("a field that was not submitted at all is not 'unlimited': it is reported as not provided", () => {
  assert.deepEqual(ok(null), { success: true, data: { provided: false, value: null } });
  assert.deepEqual(ok(undefined), { success: true, data: { provided: false, value: null } });
});

test("whole numbers from 1 to 1000 are accepted, surrounding spaces and leading zeros ignored", () => {
  for (const [raw, value] of [["1", 1], ["20", 20], [" 20 ", 20], ["999", 999], ["1000", 1000], ["007", 7]]) {
    assert.deepEqual(ok(raw), { success: true, data: { provided: true, value } }, raw);
  }
});

test("zero and negative values are refused with a message that says what to do", () => {
  for (const raw of ["0", "-1", "-3", "-0", "00"]) {
    const result = ok(raw);
    assert.equal(result.success, false, raw);
    assert.equal(result.errors.capacity, "Capacity must be at least 1. Leave it blank for no limit.", raw);
  }
});

test("a value over the maximum is refused", () => {
  for (const raw of ["1001", "5000", "99999999999999999999"]) {
    assert.equal(ok(raw).errors.capacity, `Capacity can be at most ${MAX_SCHEDULE_CAPACITY}.`, raw);
  }
});

test("decimals are refused, even when they are a whole number written with a point", () => {
  for (const raw of ["1.5", "20.0", "2.", ".5", "-1.5"]) {
    assert.equal(ok(raw).errors.capacity, "Capacity must be a whole number.", raw);
  }
});

test("anything that is not a number is refused with the range message", () => {
  for (const raw of ["abc", "1e3", "12abc", "1,000", "+5", "0x10", "twenty", "1 000"]) {
    assert.equal(ok(raw).errors.capacity, CAPACITY_RANGE_MESSAGE, raw);
  }
  assert.equal(CAPACITY_RANGE_MESSAGE, "Enter a whole number from 1 to 1000, or leave it blank for no limit.");
});

test("the maximum is the database's (0060's schedule_series_capacity_valid)", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/0060_schedule_capacity.sql", import.meta.url), "utf8");
  assert.equal(MAX_SCHEDULE_CAPACITY, Number(/capacity between 1 and (\d+)/.exec(sql)[1]));
});

// ---- capacity never rides along in a schedule row ---------------------------------------------------------------------------

test("capacity is not part of validateScheduleInput's output, which is spread into schedules inserts", () => {
  const result = validateScheduleInput({
    batch_id: "b1",
    instructor_id: "i1",
    day_of_week: "monday",
    start_time: "06:00",
    end_time: "07:00",
    effective_from: "2026-11-01",
    effective_until: "",
    capacity: "20",
  });
  assert.equal(result.success, true);
  assert.equal(Object.hasOwn(result.data, "capacity"), false);
});

// ---- a refused capacity ------------------------------------------------------------------------------------------------------

test("a capacity below the places taken names the places taken and the smallest capacity allowed", () => {
  const message = mapScheduleCapacityError({
    code: "23514",
    message: "The capacity cannot be lowered to 2 because 3 places are taken. Set it to 3 or more, or end students' assignments first.",
  });
  assert.equal(message, "Capacity can't be lowered to 2: 3 places are taken now. Set it to 3 or more, or end some students' assignments first.");
});

test("one place taken reads in the singular", () => {
  const message = mapScheduleCapacityError({ code: "23514", message: "The capacity cannot be lowered to 0 because 1 places are taken. Set it to 1 or more, or end students' assignments first." });
  assert.match(message, /: 1 place is taken now\. Set it to 1 or more/);
});

test("the range constraint is the field's own range message; database wording is never shown", () => {
  const constraint = { code: "23514", message: 'new row for relation "schedule_series" violates check constraint "schedule_series_capacity_valid"' };
  assert.equal(mapScheduleCapacityError(constraint), CAPACITY_RANGE_MESSAGE);

  for (const error of [
    { code: "23514", message: 'violates check constraint "something_else"' },
    { code: "42501", message: "permission denied for table schedule_series" },
    { code: "23505", message: "duplicate key" },
    { code: "PGRST116", message: "no rows" },
    null,
    undefined,
  ]) {
    assert.equal(mapScheduleCapacityError(error), null, JSON.stringify(error));
  }
  const shown = mapScheduleCapacityError({ code: "23514", message: "The capacity cannot be lowered to 2 because 3 places are taken. Set it to 3 or more, or end students' assignments first." });
  assert.doesNotMatch(shown, /schedule_series|violates|constraint|relation/);
});

// ---- an edit that changes only the capacity ----------------------------------------------------------------------------------------

const EXISTING = {
  day_of_week: "monday",
  instructor_id: "i1",
  start_time: "06:00:00",
  end_time: "07:00:00",
  effective_from: "2026-09-01",
  effective_until: null,
};
const SAME = { days: ["monday"], instructor_id: "i1", start_time: "06:00", end_time: "07:00", effective_from: "", effective_until: "" };
const only = (submitted, direct = false) => scheduleEditChangesOnlyCapacity({ existing: EXISTING, submitted, direct });

test("a versioned edit with the same day, instructor, times and end date changes only the capacity - Effective From is ignored", () => {
  assert.equal(only(SAME), true);
  assert.equal(only({ ...SAME, effective_from: "2026-12-01" }), true, "a date typed for nothing is not a change");
  assert.equal(only({ ...SAME, start_time: "06:00:00", end_time: "07:00:00" }), true, "HH:MM and HH:MM:SS are the same time");
});

test("any real change makes it an ordinary versioned edit", () => {
  assert.equal(only({ ...SAME, instructor_id: "i2" }), false);
  assert.equal(only({ ...SAME, start_time: "07:00", end_time: "08:00" }), false);
  assert.equal(only({ ...SAME, end_time: "07:30" }), false);
  assert.equal(only({ ...SAME, effective_until: "2027-03-31" }), false);
  assert.equal(only({ ...SAME, start_time: "" }), false, "an emptied field is a change (and an error to report)");
});

test("an extra day is a change: it creates a schedule, so the edit is not capacity-only", () => {
  assert.equal(only({ ...SAME, days: ["monday", "tuesday"] }), false);
  assert.equal(only({ ...SAME, days: ["monday", "monday"] }), true);
  assert.equal(only({ ...SAME, days: [] }), false);
});

test("an end date that was set and is unchanged is not a change; clearing or adding one is", () => {
  const dated = { ...EXISTING, effective_until: "2027-03-31" };
  const run = (until) => scheduleEditChangesOnlyCapacity({ existing: dated, submitted: { ...SAME, effective_until: until } });
  assert.equal(run("2027-03-31"), true);
  assert.equal(run(""), false);
  assert.equal(run("2027-04-30"), false);
});

test("a direct edit (an unused schedule) also needs the same Effective From and exactly its own day", () => {
  assert.equal(only({ ...SAME, effective_from: "2026-09-01" }, true), true);
  assert.equal(only({ ...SAME, effective_from: "2026-09-15" }, true), false, "the start date is edited in place");
  assert.equal(only({ ...SAME, effective_from: "" }, true), false);
  assert.equal(only({ ...SAME, effective_from: "2026-09-01", days: ["tuesday"] }, true), false, "unticking the own day moves it");
  assert.equal(only({ ...SAME, effective_from: "2026-09-01", days: ["monday", "tuesday"] }, true), false);
});

test("nothing to compare means not capacity-only", () => {
  assert.equal(scheduleEditChangesOnlyCapacity({ existing: null, submitted: SAME }), false);
  assert.equal(scheduleEditChangesOnlyCapacity({ existing: EXISTING, submitted: null }), false);
});
