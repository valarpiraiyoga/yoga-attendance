// Run with `npm test` (Node's built-in test runner).
//
// Regression for a valid, effective, correctly-scheduled Monday class
// (observed: "Children Yoga", Monday 5:00-6:00 PM) silently disappearing
// from the Weekly Schedule calendar while identical Wednesday/Friday rows of
// the same recurring class, and a different Monday-morning class, rendered
// fine — and while List View kept showing the Monday row correctly.
//
// Root cause: `weekly-schedule.js`'s per-cell filter compared
// `schedule.day_of_week !== dayOfWeek` with plain strict equality against the
// canonical lower-case `DAYS_OF_WEEK` values. `validateScheduleInput`
// normalizes `day_of_week` (trim + lower-case) on every write, but nothing
// re-normalized it on this read path. A row whose stored value isn't already
// in that exact canonical form (data written before this normalization
// existed, or edited directly in the database) matches none of the seven day
// columns and vanishes from the whole grid — while List View/Card
// View/Schedule Details still show it correctly, because they render the day
// with `DAY_LABELS[value] ?? value`, which falls back to displaying whatever
// raw string it's given even when it doesn't match a known key.
//
// Fix: `scheduleAppliesOn` (lib/schedules/validation.js) normalizes
// `schedule.day_of_week` the same way before comparing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scheduleAppliesOn, DAYS_OF_WEEK } from "./validation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const MONDAY = "2026-09-14"; // a Monday
const WEDNESDAY = "2026-09-16";

function childrenYogaMonday(overrides = {}) {
  return {
    day_of_week: "monday",
    start_time: "17:00:00",
    end_time: "18:00:00",
    effective_from: "2026-01-05",
    effective_until: null,
    ...overrides,
  };
}

test("a schedule stored with the canonical lower-case day still applies on its weekday", () => {
  assert.equal(scheduleAppliesOn(childrenYogaMonday(), "monday", MONDAY), true);
});

test("REGRESSION: a schedule whose day_of_week is capitalized (e.g. 'Monday') is not silently dropped from every day column", () => {
  const schedule = childrenYogaMonday({ day_of_week: "Monday" });
  // Before the fix this returned false for every single weekday — the row
  // matched none of the seven day columns and disappeared from the whole grid.
  assert.equal(scheduleAppliesOn(schedule, "monday", MONDAY), true);
  for (const day of DAYS_OF_WEEK.filter((d) => d !== "monday")) {
    assert.equal(scheduleAppliesOn(schedule, day, MONDAY), false, `must not also match ${day}`);
  }
});

test("REGRESSION: stray whitespace around day_of_week does not hide the schedule either", () => {
  const schedule = childrenYogaMonday({ day_of_week: " monday " });
  assert.equal(scheduleAppliesOn(schedule, "monday", MONDAY), true);
});

test("REGRESSION: mixed case AND whitespace together still resolve correctly", () => {
  const schedule = childrenYogaMonday({ day_of_week: " MONDAY" });
  assert.equal(scheduleAppliesOn(schedule, "monday", MONDAY), true);
});

test("a schedule for a different weekday is correctly excluded, canonical or not", () => {
  assert.equal(scheduleAppliesOn(childrenYogaMonday(), "wednesday", WEDNESDAY), false);
  assert.equal(scheduleAppliesOn(childrenYogaMonday({ day_of_week: "Monday" }), "wednesday", WEDNESDAY), false);
});

// ---- effective-date semantics are unchanged by this fix --------------------

test("effective_from filtering is untouched: a date before effective_from is still excluded", () => {
  const schedule = childrenYogaMonday({ effective_from: "2026-10-01" });
  assert.equal(scheduleAppliesOn(schedule, "monday", MONDAY), false);
});

test("effective_until filtering is untouched: a date after effective_until is still excluded", () => {
  const schedule = childrenYogaMonday({ effective_until: "2026-01-01" });
  assert.equal(scheduleAppliesOn(schedule, "monday", MONDAY), false);
});

test("an open-ended schedule (effective_until null) still applies indefinitely", () => {
  assert.equal(scheduleAppliesOn(childrenYogaMonday({ effective_until: null }), "monday", MONDAY), true);
});

// ---- wiring: the Weekly Schedule grid actually uses the normalized check ---

test("weekly-schedule.js filters day columns through scheduleAppliesOn, not a raw !== comparison", () => {
  // Mirrors this project's existing technique (lib/schedules/usage.test.js)
  // for pinning behavior in a file that isn't practical to import under
  // plain Node (this one is a React component file with JSX) — reading its
  // source is simpler than standing up a JSX test harness for one assertion.
  const source = read("app", "schedule", "weekly-schedule.js");
  assert.ok(source.includes("scheduleAppliesOn(schedule, dayOfWeek, date)"));
  assert.ok(!/schedule\.day_of_week\s*!==\s*dayOfWeek/.test(source), "no raw un-normalized comparison remains");
});
