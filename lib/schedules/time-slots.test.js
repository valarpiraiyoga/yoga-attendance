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

// Instructor conflicts (V1 Final Improvements, C2b; 01-product.md §7 "Conflicts"): every slot applies to every ticked day for ONE
// instructor and ONE effective period, so two slots whose times overlap would give the instructor two classes at once on each day.

test("overlapping slots are rejected: the LATER slot gets the error, on its end time, naming the earlier one", () => {
  const result = validateTimeSlots(["06:00", "06:30"], ["07:00", "07:30"]);
  assert.equal(result.success, false);
  assert.deepEqual(result.errors[0], {});
  assert.deepEqual(Object.keys(result.errors[1]), ["end_time"]);
  assert.equal(
    result.errors[1].end_time,
    "Overlaps another time slot (6:00 AM – 7:00 AM). One instructor cannot teach two classes at the same time."
  );
});

test("identical slots are the extreme overlap and are rejected too (they are never silently deduplicated)", () => {
  const result = validateTimeSlots(["06:00", "06:00"], ["07:00", "07:00"]);
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(result.errors[1]), ["end_time"]);
});

test("back-to-back and separate slots are allowed and kept in order", () => {
  const result = validateTimeSlots(["06:00", "07:00", "18:00"], ["07:00", "08:00", "19:00"]);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.map((slot) => slot.start_time), ["06:00", "07:00", "18:00"]);
});

test("overlap is judged only between valid slots: a slot with its own error keeps that error and is not also called an overlap", () => {
  const result = validateTimeSlots(["06:00", "06:30", "06:15"], ["07:00", "", "06:45"]);
  assert.equal(result.success, false);
  assert.equal(result.errors[1].end_time, "End time is required.");
  assert.deepEqual(Object.keys(result.errors[2]), ["end_time"], "the third slot overlaps the first");
  assert.match(result.errors[2].end_time, /^Overlaps another time slot/);
});

test("a separate slot between two overlapping ones is not flagged, and the error lands on the later of the pair by its own index", () => {
  const result = validateTimeSlots(["06:00", "10:00", "06:30"], ["07:00", "11:00", "07:30"]);
  assert.deepEqual(result.errors.map((slot) => Object.keys(slot)), [[], [], ["end_time"]]);
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

// ---- instructor conflicts (C2b): the read-before-create check, the race fallback and Deactivate -----------

test("createSchedule checks the instructor's stored schedules BEFORE any series is created, and keeps the database as the final authority", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("export async function createSchedule(");
  const body = actions.slice(start, actions.indexOf("\nexport async function", start + 1));

  const readAt = body.indexOf("listSchedulesForInstructor(result.data.instructor_id)");
  const compare = body.indexOf("findInstructorConflict(rows, result.data, existingForInstructor)");
  const refuse = body.indexOf("describeConflict(clash)");
  const insert = body.indexOf("insertScheduleRows(");
  assert.ok(readAt > 0 && compare > readAt && refuse > compare && insert > refuse, "read, compare, refuse - all before the insert helper (which creates the series)");
  // A refusal is the usual { error, values } result, and a read that fails does not stop the save: the trigger decides.
  assert.match(body, /return \{ error: describeConflict\(clash\), values: submittedValues\(formData\) \};/);
  assert.match(body, /try \{\s*existingForInstructor = await listSchedulesForInstructor\([^)]*\);\s*\} catch \{\s*existingForInstructor = null;\s*\}/);
});

test("Add Schedule's insert maps the database's conflict refusal (the race fallback) and keeps its generic message for anything else", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("async function insertScheduleRows(");
  const body = actions.slice(start, actions.indexOf("\nexport async function createSchedule", start));
  const conflict = body.indexOf("instructorConflictMessage(error)");
  const generic = body.indexOf('"Could not save the schedule. Try again."', body.indexOf(".insert("));
  assert.ok(conflict > body.indexOf(".insert(") && generic > conflict, "the conflict is mapped before the generic message");
  assert.match(body, /if \(conflict\) return \{ error: conflict \};/);
});

test("Deactivate maps the database's conflict refusal (a later end date can create one) and keeps its generic message for anything else", () => {
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("export async function deactivateSchedule(");
  const body = actions.slice(start, actions.indexOf("\n/**", start + 1));
  assert.match(body, /const conflict = instructorConflictMessage\(error\);\s*if \(conflict\) return \{ error: conflict \};/);
  assert.ok(body.includes('"Could not deactivate the schedule. Try again."'));
  assert.ok(!body.includes("override"), "no override");
});

test("the instructor read is one narrow, read-only select of that instructor's schedules (any status) with their batch", () => {
  const data = read("lib", "schedules", "data.js");
  const start = data.indexOf("export async function listSchedulesForInstructor(");
  const body = data.slice(start, data.indexOf("\n/**", start + 1));
  assert.ok(body.includes('.from("schedules")') && body.includes('.eq("instructor_id", instructorId)'));
  assert.ok(body.includes("batches(name, code)"));
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(body) && !body.includes('.eq("status"'), "read only, and status is not a filter");
});

// ---- functional safety: Edit / Direct Edit's insert path is untouched -----

test("Edit Schedule (versioned and direct) saves through one atomic database call each, not the Add Schedule insert helper", () => {
  const actions = read("lib", "schedules", "actions.js");
  const updateBody = actions.slice(actions.indexOf("export async function updateSchedule("), actions.indexOf("export async function deactivateSchedule"));
  const correctBody = actions.slice(actions.indexOf("async function correctUnusedSchedule("), actions.indexOf("function revalidateScheduleViews"));

  // S5 / 0061: the capacity, the schedule change and every extra day are one transaction in the database.
  assert.ok(updateBody.includes('supabase.rpc("save_schedule_edit"'));
  assert.ok(correctBody.includes('supabase.rpc("save_unused_schedule_edit"'));
  assert.ok(updateBody.includes("p_extra_days: extraDays,") && correctBody.includes("p_extra_days: extraDays,"));
  // Neither path writes schedules or series itself, and neither uses Add Schedule's helper.
  for (const body of [updateBody, correctBody]) {
    assert.ok(!body.includes("insertScheduleRows"));
    assert.ok(!body.includes(".insert("));
  }
});

test("the Edit-only insert helper is gone: the atomic functions create the extra days; Add Schedule keeps insertScheduleRows", () => {
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(!actions.includes("insertSchedulesForDays("));
  assert.ok(actions.includes("async function insertScheduleRows(supabase, data, rows, capacity = null)"));
  assert.ok(actions.includes("createSeriesRows(supabase, data.batch_id, rows.length, capacity)"));
});

test("delete / direct-edit database calls: delete is unchanged; Direct Edit goes through the atomic function that wraps correct_unused_schedule", () => {
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(actions.includes('supabase.rpc("delete_unused_schedule"'));
  assert.ok(actions.includes('supabase.rpc("save_unused_schedule_edit"'));
  assert.match(read("supabase", "migrations", "0061_schedule_save_functions.sql"), /perform public\.correct_unused_schedule\(/);
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
