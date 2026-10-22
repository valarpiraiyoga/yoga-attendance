// Run with `npm test` (Node's built-in test runner).
//
// A refused enrollment save (create_enrollment / change_enrollment, migration 0060) is shown as a field error the Admin can act
// on, or as the generic message - never as database wording.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_ENROLLMENT_MESSAGE,
  SAVE_ERROR_MESSAGE,
  fullScheduleSeriesId,
  isCapacityLoweredError,
  isScheduleFullError,
  mapEnrollmentSaveError,
  scheduleLabel,
} from "./save-errors.js";

const SERIES = "0b6f3c0a-1d2e-4f5a-9b8c-7d6e5f4a3b2c";
const FULL = {
  code: "23514",
  message: "The schedule is full (capacity 20). Increase the schedule's capacity, or end another student's assignment to it, first.",
  details: `schedule_series_id=${SERIES} places_needed=21 capacity=20`,
};
const LOWERED = {
  code: "23514",
  message: "The capacity cannot be lowered to 2 because 3 places are taken. Set it to 3 or more, or end students' assignments first.",
};

// ---- schedule full -------------------------------------------------------------------------------------------------------

test("a full schedule is a field error on the schedule field, naming the schedule when it is known", () => {
  assert.deepEqual(mapEnrollmentSaveError(FULL, { scheduleLabel: "Monday 6:00 AM – 7:00 AM" }), {
    field: "schedule_series_ids",
    error: "The Monday 6:00 AM – 7:00 AM schedule is full (capacity 20). Raise its capacity first, or choose another schedule. Places held by future-dated enrollments and schedule changes count.",
  });
});

test("a full schedule that could not be named still says what to do", () => {
  const mapped = mapEnrollmentSaveError(FULL);
  assert.equal(mapped.field, "schedule_series_ids");
  assert.match(mapped.error, /^One of the selected schedules is full \(capacity 20\)\. Raise its capacity first/);
});

test("the full schedule's series id comes from the error detail, only to look its name up - it is never shown", () => {
  assert.equal(fullScheduleSeriesId(FULL), SERIES);
  assert.equal(fullScheduleSeriesId({ ...FULL, details: undefined }), null);
  assert.equal(fullScheduleSeriesId({ ...FULL, details: "schedule_series_id=not-a-uuid" }), null);
  assert.equal(fullScheduleSeriesId(LOWERED), null);
  for (const label of [null, "Monday 6:00 AM – 7:00 AM"]) {
    const { error } = mapEnrollmentSaveError(FULL, { scheduleLabel: label });
    assert.doesNotMatch(error, new RegExp(SERIES));
    assert.doesNotMatch(error, /schedule_series_id|places_needed|Increase the schedule's capacity, or end another/);
  }
});

test("only 0060's exact refusals are recognised as capacity errors", () => {
  assert.equal(isScheduleFullError(FULL), true);
  assert.equal(isScheduleFullError({ ...FULL, code: "23505" }), false);
  assert.equal(isScheduleFullError({ code: "23514", message: "The batch is full (2 of 2 places taken)." }), false);
  assert.equal(isCapacityLoweredError(LOWERED), true);
  assert.equal(isCapacityLoweredError(FULL), false);
});

test("a capacity-lowered refusal is not an enrollment-form error (it belongs to the schedule form, S5)", () => {
  assert.equal(mapEnrollmentSaveError(LOWERED), null);
});

// ---- the existing rules, unchanged ------------------------------------------------------------------------------------------

test("the join-date rules and the start-date cascade's refusals map exactly as before (matchKnownJoinDateError)", () => {
  const before = { code: "23514", message: "The enrollment cannot start before the student joined (2026-01-01). Correct the join date in Edit Student first." };
  assert.deepEqual(mapEnrollmentSaveError(before), { field: "effective_start_date", error: before.message });

  const endsBefore = { code: "23514", message: 'new row for relation "enrollment_schedules" violates check constraint "enrollment_schedules_end_after_start"' };
  assert.equal(mapEnrollmentSaveError(endsBefore).field, "effective_start_date");
  assert.doesNotMatch(mapEnrollmentSaveError(endsBefore).error, /violates|constraint|relation/);

  const overlap = { code: "23P01", message: 'conflicting key value violates exclusion constraint "enrollment_schedules_no_overlap"' };
  assert.equal(mapEnrollmentSaveError(overlap).field, "effective_start_date");
  assert.doesNotMatch(mapEnrollmentSaveError(overlap).error, /violates|constraint/);
});

test("a second active enrollment in the same batch is a field error on the batch", () => {
  assert.deepEqual(mapEnrollmentSaveError({ code: "23505", message: 'duplicate key value violates unique constraint "batch_enrollments_one_active_per_batch"' }), {
    field: "batch_id",
    error: DUPLICATE_ENROLLMENT_MESSAGE,
  });
});

test("the selection and change-date refusals are the application's own messages, on their own fields", () => {
  for (const [message, field] of [
    ["Select at least one schedule.", "schedule_series_ids"],
    ["Select schedules that belong to the chosen batch.", "schedule_series_ids"],
    ["Enter a valid date for the schedule change.", "schedule_effective_date"],
    ["The schedule change cannot be back-dated.", "schedule_effective_date"],
  ]) {
    assert.deepEqual(mapEnrollmentSaveError({ code: "22023", message }), { field, error: message }, message);
  }
});

// ---- anything else is never shown -------------------------------------------------------------------------------------------

test("an unrecognised refusal returns null - the action logs it and shows only the generic message", () => {
  for (const error of [
    { code: "22023", message: "some other invalid parameter" },
    { code: "23514", message: 'new row for relation "batch_enrollments" violates check constraint "batch_enrollments_end_after_start"' },
    { code: "42501", message: "Not authorized." },
    { code: "P0002", message: "Enrollment not found." },
    { code: "PGRST202", message: "Could not find the function public.create_enrollment(...) in the schema cache" },
    { code: "42883", message: "function public.change_enrollment(...) does not exist" },
    { code: "XX000", message: "internal error" },
    null,
    undefined,
  ]) {
    assert.equal(mapEnrollmentSaveError(error), null, JSON.stringify(error));
  }
  assert.equal(SAVE_ERROR_MESSAGE, "Could not save the enrollment. Try again.");
});

// ---- naming a schedule ---------------------------------------------------------------------------------------------------------

test("a schedule is named by weekday and time range; one that cannot be named returns null", () => {
  assert.equal(scheduleLabel({ day_of_week: "monday", start_time: "06:00", end_time: "07:00" }), "Monday 6:00 AM – 7:00 AM");
  assert.equal(scheduleLabel({ day_of_week: "friday", start_time: "17:00:00", end_time: "18:00:00" }), "Friday 5:00 PM – 6:00 PM");
  assert.equal(scheduleLabel(null), null);
  assert.equal(scheduleLabel(undefined), null);
  assert.equal(scheduleLabel({ day_of_week: "monday" }), null);
});
