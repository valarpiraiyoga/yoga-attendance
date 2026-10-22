// Run with `npm test` (Node's built-in test runner).
//
// How a refused Edit Schedule save is shown (migration 0061's atomic functions). The mapping is pure, so the answers a database can give
// are tested here for real: what the Admin sees for each, and that database wording is never shown.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFECTIVE_FROM_PAST_MESSAGE,
  SAVE_SCHEDULE_ERROR_MESSAGE,
  SCHEDULE_GONE_MESSAGE,
  SCHEDULE_HAS_HISTORY_MESSAGE,
  mapScheduleSaveError,
} from "./save-errors.js";
import { CAPACITY_RANGE_MESSAGE } from "./capacity-input.js";

const LOWERED = {
  code: "23514",
  message: "The capacity cannot be lowered to 5 because 12 places are taken. Set it to 12 or more, or end students' assignments first.",
};
const RANGE = { code: "23514", message: 'new row for relation "schedule_series" violates check constraint "schedule_series_capacity_valid"' };
const history = (details, message = "This schedule has earlier versions and cannot be edited directly.") => ({ code: "22023", message, details });

// ---- the capacity -----------------------------------------------------------------------------------------------------------------

test("a capacity below the places taken is a field error on the capacity, naming the places taken and the smallest capacity allowed", () => {
  for (const direct of [false, true]) {
    assert.deepEqual(mapScheduleSaveError(LOWERED, { direct }), {
      field: "capacity",
      error: "Capacity can't be lowered to 5: 12 places are taken now. Set it to 12 or more, or end some students' assignments first.",
    });
  }
});

test("a capacity out of range is the capacity field's own range message", () => {
  assert.deepEqual(mapScheduleSaveError(RANGE), { field: "capacity", error: CAPACITY_RANGE_MESSAGE });
});

// ---- the schedule ----------------------------------------------------------------------------------------------------------------

test("an unknown schedule (P0002) is 'no longer exists', for both functions", () => {
  for (const direct of [false, true]) {
    assert.deepEqual(mapScheduleSaveError({ code: "P0002", message: "Schedule not found." }, { direct }), { message: SCHEDULE_GONE_MESSAGE });
  }
  assert.equal(SCHEDULE_GONE_MESSAGE, "This schedule no longer exists.");
});

test("a date in the past is a field error on Effective From (the database repeats the form's rule with the same words)", () => {
  assert.deepEqual(mapScheduleSaveError({ code: "22023", message: "Effective from cannot be in the past." }), {
    field: "effective_from",
    error: "Effective from cannot be in the past.",
  });
  assert.equal(EFFECTIVE_FROM_PAST_MESSAGE, "Effective from cannot be in the past.");
});

// ---- Direct Edit: a schedule that has gained history -------------------------------------------------------------------------------

test("Direct Edit: correct_unused_schedule's refusals (22023 with a reason in DETAIL) keep their message", () => {
  for (const [details, message] of [
    ["sessions", "This schedule has session history and cannot be edited directly."],
    ["versions", "This schedule has earlier versions and cannot be edited directly."],
    ["started_assignments", "Students have already been assigned to this schedule, so it cannot be edited directly."],
  ]) {
    assert.deepEqual(mapScheduleSaveError(history(details, message), { direct: true }), { message: SCHEDULE_HAS_HISTORY_MESSAGE }, details);
  }
  assert.match(SCHEDULE_HAS_HISTORY_MESSAGE, /^This schedule now has history, so it can no longer be edited directly\. Reload the page/);
});

test("Direct Edit: the foreign-key backstops are the same refusal, as before", () => {
  for (const code of ["23001", "23503"]) {
    assert.deepEqual(mapScheduleSaveError({ code, message: "violates foreign key constraint" }, { direct: true }), { message: SCHEDULE_HAS_HISTORY_MESSAGE }, code);
  }
});

test("Direct Edit: a 22023 WITHOUT one of those reasons is another check of the save, never 'this schedule now has history'", () => {
  for (const error of [
    { code: "22023", message: "An extra day cannot be this schedule's own day." },
    { code: "22023", message: "Select valid days of the week.", details: "" },
    { code: "22023", message: "Effective from is required." },
  ]) {
    assert.equal(mapScheduleSaveError(error, { direct: true }), null, error.message);
  }
});

test("the history message belongs to Direct Edit only: a versioned edit never maps it", () => {
  assert.equal(mapScheduleSaveError(history("versions"), { direct: false }), null);
  assert.equal(mapScheduleSaveError({ code: "23503", message: "fk" }, { direct: false }), null);
});

// ---- anything else is never shown -------------------------------------------------------------------------------------------------

test("an unrecognised refusal returns null - the action logs it and shows only the generic message", () => {
  for (const error of [
    { code: "42501", message: "Not authorized." },
    { code: "23514", message: 'new row for relation "schedules" violates check constraint "schedules_day_of_week_check"' },
    { code: "23514", message: 'new row for relation "schedules" violates check constraint "schedules_end_after_start"' },
    { code: "PGRST202", message: "Could not find the function public.save_schedule_edit(...) in the schema cache" },
    { code: "42883", message: "function public.save_unused_schedule_edit(...) does not exist" },
    { code: "40P01", message: "deadlock detected" },
    { code: "XX000", message: "internal error" },
    null,
    undefined,
  ]) {
    assert.equal(mapScheduleSaveError(error), null, JSON.stringify(error));
    assert.equal(mapScheduleSaveError(error, { direct: true }), null, JSON.stringify(error));
  }
  assert.equal(SAVE_SCHEDULE_ERROR_MESSAGE, "Could not update the schedule. Try again.");
});

test("no message shown to the Admin carries database wording, SQL names or ids", () => {
  const shown = [
    mapScheduleSaveError(LOWERED).error,
    mapScheduleSaveError(RANGE).error,
    SCHEDULE_GONE_MESSAGE,
    SCHEDULE_HAS_HISTORY_MESSAGE,
    SAVE_SCHEDULE_ERROR_MESSAGE,
    EFFECTIVE_FROM_PAST_MESSAGE,
  ];
  for (const message of shown) {
    assert.doesNotMatch(message, /schedule_series|violates|constraint|relation|23514|SQLSTATE|public\./, message);
  }
});
