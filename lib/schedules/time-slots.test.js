// Run with `npm test` (Node's built-in test runner).
//
// Add Schedule's "select multiple days AND create multiple time slots"
// requirement: each (day, time slot) combination is its own independent
// schedule record, never merged or deduplicated.
//
// `validateTimeSlots` (lib/schedules/validation.js) is tested directly as a
// pure function. The day × slot cross product and the "Edit's insert path is
// untouched" guarantee live in `createSchedule`/`updateSchedule`
// (lib/schedules/actions.js, "use server" — not importable under plain
// Node), so — matching this project's existing technique in
// lib/schedules/usage.test.js — those are pinned by reading the source and
// asserting on it, not by executing it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateTimeSlots } from "./validation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

// ---- validateTimeSlots -----------------------------------------------------

test("1 day x 1 time: a single valid slot succeeds", () => {
  const result = validateTimeSlots(["06:00"], ["07:00"]);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, [{ start_time: "06:00", end_time: "07:00" }]);
});

test("1 day x 2 times / 2+ days x 2 times: multiple valid slots all succeed, in order", () => {
  const result = validateTimeSlots(["06:00", "07:00"], ["07:00", "08:00"]);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, [
    { start_time: "06:00", end_time: "07:00" },
    { start_time: "07:00", end_time: "08:00" },
  ]);
});

test("no slots at all is refused, not silently treated as zero schedules", () => {
  const result = validateTimeSlots([], []);
  assert.equal(result.success, false);
  assert.equal(result.errors[0].start_time, "Add at least one time slot.");
});

test("a blank slot reports which field is missing, without touching the other slots", () => {
  const result = validateTimeSlots(["06:00", ""], ["07:00", "09:00"]);
  assert.equal(result.success, false);
  assert.deepEqual(result.errors[0], {});
  assert.equal(result.errors[1].start_time, "Start time is required.");
  assert.equal(result.errors[1].end_time, undefined);
});

test("end time must remain later than start time, same rule as the single-slot form", () => {
  const result = validateTimeSlots(["07:00"], ["06:00"]);
  assert.equal(result.success, false);
  assert.equal(result.errors[0].end_time, "End time must be later than start time.");
});

test("an invalid time string is rejected", () => {
  const result = validateTimeSlots(["25:00"], ["07:00"]);
  assert.equal(result.success, false);
  assert.equal(result.errors[0].start_time, "Enter a valid start time.");
});

test("duplicate/overlapping slots are NOT rejected or deduplicated — no such business rule exists", () => {
  const result = validateTimeSlots(["06:00", "06:00"], ["07:00", "07:00"]);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.deepEqual(result.data[0], result.data[1]);
});

test("removing a slot is just a shorter array — no index gaps, no special-casing needed", () => {
  // Simulates the form's removeTimeSlot: slot 1 removed from a 3-slot set.
  const starts = ["06:00", "07:00", "08:00"].filter((_, i) => i !== 1);
  const ends = ["07:00", "08:00", "09:00"].filter((_, i) => i !== 1);
  const result = validateTimeSlots(starts, ends);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, [
    { start_time: "06:00", end_time: "07:00" },
    { start_time: "08:00", end_time: "09:00" },
  ]);
});

// ---- wiring: createSchedule builds the day x slot cross product -----------

test("createSchedule validates the full time-slot array and crosses it with the chosen days", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("export async function createSchedule(");
  const body = actions.slice(start, actions.indexOf("\nexport async function", start + 1));

  assert.ok(body.includes('validateTimeSlots(formData.getAll("start_time"), formData.getAll("end_time"))'));
  assert.ok(body.includes("daysResult.data.flatMap("), "one row per day, each carrying every slot");
  assert.ok(body.includes("slotsResult.data.map("), "each day maps over every slot — the day x slot cross product");
  assert.ok(body.includes("insertScheduleRows("), "uses the generalized (day, slot) insert helper");
});

test("createSchedule reports per-slot errors separately from field errors", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("export async function createSchedule(");
  const body = actions.slice(start, actions.indexOf("\nexport async function", start + 1));
  assert.ok(/slotErrors:\s*slotsResult\.success \? null : slotsResult\.errors/.test(body));
});

// ---- functional safety: Edit / Direct Edit's insert path is untouched -----

test("updateSchedule (versioned and direct-edit) still uses insertSchedulesForDays, not the new multi-slot helper", () => {
  const actions = read("lib", "schedules", "actions.js");
  const updateBody = actions.slice(actions.indexOf("export async function updateSchedule("));
  const correctBody = actions.slice(actions.indexOf("async function correctUnusedSchedule("));

  assert.ok(updateBody.includes("insertSchedulesForDays(supabase, result.data, extraDays)"));
  assert.ok(correctBody.includes("insertSchedulesForDays(supabase, result.data, extraDays)"));
  assert.ok(!updateBody.slice(0, updateBody.indexOf("export async function deactivateSchedule")).includes("insertScheduleRows"));
});

test("insertSchedulesForDays (Edit's helper) still takes a plain list of days, unchanged", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("async function insertSchedulesForDays(");
  const body = actions.slice(start, actions.indexOf("\nexport async function createSchedule"));
  assert.ok(body.includes("async function insertSchedulesForDays(supabase, data, days)"));
  assert.ok(body.includes("days.map(() => ({ batch_id: data.batch_id }))"));
});

test("delete / direct-edit database calls are untouched by this change", () => {
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(actions.includes('supabase.rpc("delete_unused_schedule"'));
  assert.ok(actions.includes('supabase.rpc("correct_unused_schedule"'));
});

// ---- wiring: the form scopes Time Slots to Add only ------------------------

test("ScheduleForm only shows the repeatable Time Slots UI in Add mode; Edit keeps its single Start/End pair", () => {
  const form = read("app", "schedule", "schedule-form.js");
  assert.ok(form.includes("const isAddMode = !schedule;"));
  assert.ok(form.includes("{isAddMode ? ("), "Time Slots section is conditional on Add mode");
  assert.ok(form.includes('onClick={addTimeSlot}'));
  assert.ok(form.includes('value={startTime}') && form.includes('value={endTime}'), "Edit's original single pair is still there");
});

test("the Remove control is offered only once there is more than one time slot", () => {
  const form = read("app", "schedule", "schedule-form.js");
  assert.ok(form.includes("{timeSlots.length > 1 ? ("));
});

test("every slot's Start/End inputs share one name, the same repeated-field convention day_of_week already uses", () => {
  const form = read("app", "schedule", "schedule-form.js");
  const start = form.indexOf("{isAddMode ? (");
  const slotsSection = form.slice(start, form.indexOf("Remove", start));
  assert.ok(slotsSection.includes('name="start_time"'));
  assert.ok(slotsSection.includes('name="end_time"'));
});
