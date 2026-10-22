// Run with `npm test` (Node's built-in test runner).
//
// Activating an inactive schedule (V1; 01-product.md §7 "Activation"). The rules are pure and tested by running them. The server action and
// the dialog need the Next.js runtime, so - the project's way, as in usage.test.js - their wiring is pinned from source, and what the database
// decides (the instructor-conflict trigger, migration 0062) is covered by that migration's own verification script.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ACTIVATE_ALREADY_ACTIVE_MESSAGE,
  ACTIVATE_DATE_REQUIRED_MESSAGE,
  ACTIVATE_NOT_INACTIVE_MESSAGE,
  ACTIVATE_PAST_MESSAGE,
  EDIT_INACTIVE_MESSAGE,
  activatedScheduleRow,
  validateActivation,
} from "./activation.js";
import { describeConflict, findInstructorConflict, instructorConflictMessage } from "./instructor-conflict.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const code = (...parts) => read(...parts).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const sliceOf = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, from);
  const end = to ? source.indexOf(to, start + 1) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
};

const TODAY = "2026-10-22";
const inactive = {
  id: "s1",
  status: "inactive",
  batch_id: "b1",
  instructor_id: "i1",
  day_of_week: "monday",
  start_time: "06:00:00",
  end_time: "07:00:00",
  effective_from: "2026-01-05",
  effective_until: "2026-09-30",
  series_id: "x1",
};

// ---- the rules ------------------------------------------------------------------------------------------------------------------------

test("an inactive schedule is activated from a valid new date, on the day it ended plus one or any later day", () => {
  assert.deepEqual(validateActivation(inactive, "2026-10-22", TODAY), { success: true, data: { effective_from: "2026-10-22" } });
  assert.deepEqual(validateActivation(inactive, "2026-12-01", TODAY), { success: true, data: { effective_from: "2026-12-01" } });
  assert.equal(validateActivation({ ...inactive, effective_until: "2026-10-21" }, TODAY, TODAY).success, true, "the day after it ended");
  assert.equal(validateActivation({ ...inactive, effective_until: null }, TODAY, TODAY).success, true, "an inactive schedule with no end date");
});

test("only an INACTIVE schedule can be activated - an active one is refused, never silently changed", () => {
  assert.deepEqual(validateActivation({ ...inactive, status: "active" }, "2026-12-01", TODAY), { success: false, error: ACTIVATE_NOT_INACTIVE_MESSAGE });
});

test("the date is required and must be a real date", () => {
  for (const value of ["", "   ", null, undefined, "2026-13-40", "22/10/2026", "tomorrow"]) {
    assert.deepEqual(validateActivation(inactive, value, TODAY), { success: false, error: ACTIVATE_DATE_REQUIRED_MESSAGE }, String(value));
  }
});

test("activation is never back-dated: a date before the centre's today is refused, today is allowed", () => {
  assert.deepEqual(validateActivation(inactive, "2026-10-21", TODAY), { success: false, error: ACTIVATE_PAST_MESSAGE });
  assert.equal(validateActivation(inactive, TODAY, TODAY).success, true);
});

test("the inactive schedule's own period is not reused: the new date must be AFTER the date it ended (inclusive end)", () => {
  const ended = { ...inactive, effective_until: "2026-11-15" };
  const sameDay = validateActivation(ended, "2026-11-15", TODAY);
  assert.equal(sameDay.success, false);
  assert.equal(sameDay.error, "Effective from must be after this schedule ended on Nov 15, 2026.");
  assert.equal(validateActivation(ended, "2026-11-10", TODAY).success, false);
  assert.equal(validateActivation(ended, "2026-11-16", TODAY).success, true);
});

test("a class that already has an active version covering the date cannot be activated again", () => {
  const running = [{ id: "s2", status: "active", effective_until: null }];
  assert.deepEqual(validateActivation(inactive, "2026-12-01", TODAY, running), { success: false, error: ACTIVATE_ALREADY_ACTIVE_MESSAGE });
  assert.equal(validateActivation(inactive, "2026-12-01", TODAY, [{ id: "s2", status: "active", effective_until: "2026-12-01" }]).success, false, "its last day is the chosen day");
  assert.equal(validateActivation(inactive, "2026-12-01", TODAY, [{ id: "s2", status: "active", effective_until: "2026-11-30" }]).success, true, "a version that ended before the date does not count");
  assert.equal(validateActivation(inactive, "2026-12-01", TODAY, [{ id: "s2", status: "inactive", effective_until: null }]).success, true, "an inactive version does not count");
});

test("the inserted row is a NEW version of the same class: same batch, instructor, day, times and series, open-ended, no id, no status", () => {
  assert.deepEqual(activatedScheduleRow(inactive, "2026-12-01"), {
    batch_id: "b1",
    instructor_id: "i1",
    day_of_week: "monday",
    start_time: "06:00:00",
    end_time: "07:00:00",
    effective_from: "2026-12-01",
    effective_until: null,
    series_id: "x1",
  });
  assert.equal("status" in activatedScheduleRow(inactive, "2026-12-01"), false, "the status is the table's default, active");
  assert.equal("id" in activatedScheduleRow(inactive, "2026-12-01"), false);
});

test("the inactive schedule object is never modified by validating or building the row", () => {
  const before = JSON.stringify(inactive);
  validateActivation(inactive, "2026-12-01", TODAY);
  activatedScheduleRow(inactive, "2026-12-01");
  assert.equal(JSON.stringify(inactive), before);
});

// ---- instructor conflicts (the trigger is the authority; this is the app's side) ---------------------------------------------------------

const detail = JSON.stringify({
  reason: "instructor_conflict",
  conflict_schedule_id: "9d6b2f64-0000-4000-8000-000000000009",
  batch_code: "HY",
  batch_name: "Hatha Yoga",
  day_of_week: "monday",
  start_time: "06:00",
  end_time: "07:00",
  effective_from: "2026-10-12",
  effective_until: null,
});

test("a conflict the database refuses on activation is shown with the existing friendly message, and no id", () => {
  const message = instructorConflictMessage({ code: "23P01", message: "conflicting key value violates exclusion constraint", details: detail });
  assert.equal(
    message,
    "This instructor already has a class on Monday, 6:00 AM – 7:00 AM, in Hatha Yoga (HY), from Oct 12, 2026 with no end date. Change the time, day, instructor or dates."
  );
  assert.doesNotMatch(message, /9d6b2f64|23P01/);
  assert.equal(instructorConflictMessage({ code: "23P01", details: "" }), null, "without the payload it is not a conflict message");
});

test("the activated row follows the same conflict rule: an overlapping class of the instructor is a conflict, back-to-back is not", () => {
  const row = activatedScheduleRow(inactive, "2026-12-01");
  const proposed = [{ day_of_week: row.day_of_week, start_time: row.start_time, end_time: row.end_time }];
  const period = { effective_from: row.effective_from, effective_until: row.effective_until };
  const other = (start, end) => ({ day_of_week: "monday", start_time: start, end_time: end, effective_from: "2026-11-01", effective_until: null, batches: { name: "Hatha Yoga", code: "HY" } });

  const clash = findInstructorConflict(proposed, period, [other("06:30:00", "07:30:00")]);
  assert.ok(clash);
  assert.match(describeConflict(clash), /^This instructor already has a class on Monday/);
  assert.equal(findInstructorConflict(proposed, period, [other("07:00:00", "08:00:00")]), null, "starts as this one ends");
  assert.equal(findInstructorConflict(proposed, period, [other("05:00:00", "06:00:00")]), null, "ends as this one starts");
});

// ---- the action: what it writes ---------------------------------------------------------------------------------------------------------

const actions = code("lib", "schedules", "actions.js");
const activate = sliceOf(actions, "export async function activateSchedule(", "\nexport async function");

test("activateSchedule only INSERTS a new version: it never updates or deletes a schedule, a session or attendance, and sets no status", () => {
  assert.equal((activate.match(/\.insert\(/g) ?? []).length, 1);
  assert.ok(activate.includes(".insert(activatedScheduleRow(existing, checked.data.effective_from))"));
  for (const forbidden of [".update(", ".delete(", ".upsert(", '.from("class_sessions")', '.from("attendance', '.from("enrollment_schedules")', '.from("schedule_series")', ".rpc(", "status:"]) {
    assert.ok(!activate.includes(forbidden), `no ${forbidden}`);
  }
});

test("activateSchedule is Admin-only first, validates against the centre's today and the series' other versions BEFORE writing", () => {
  assert.ok(activate.indexOf("requireRole(ROLES.ADMIN)") > 0 && activate.indexOf("requireRole(ROLES.ADMIN)") < activate.indexOf(".from("));
  const check = activate.indexOf("validateActivation(existing, effectiveFrom, await getCentreToday(), versions ?? [])");
  assert.ok(check > 0 && check < activate.indexOf(".insert("));
  assert.ok(activate.includes('.eq("series_id", existing.series_id)') && activate.includes('.neq("id", id)'));
});

test("activateSchedule maps the database's conflict refusal (the trigger stays authoritative), logs anything else, and redirects only on success", () => {
  const insertAt = activate.indexOf(".insert(");
  assert.match(activate, /const conflict = instructorConflictMessage\(error\);\s*if \(conflict\) return \{ error: conflict \};/);
  assert.ok(activate.indexOf("instructorConflictMessage(error)") > insertAt);
  assert.ok(activate.indexOf("redirect(") > activate.indexOf("instructorConflictMessage(error)"));
  assert.ok(activate.includes("?success=activated"));
});

test("only the explicit action can create an active version of an inactive schedule: editing one with an effective date is refused", () => {
  const update = sliceOf(actions, "export async function updateSchedule(", "export async function deactivateSchedule");
  const direct = update.indexOf('if (usage.editMode === "direct") {');
  const guard = update.indexOf('if (existing.status === "inactive") {');
  const rpc = update.indexOf('supabase.rpc("save_schedule_edit"');
  assert.ok(direct > 0 && guard > direct && rpc > guard, "after the capacity-only and in-place paths, before the versioned save");
  assert.match(update, /if \(existing\.status === "inactive"\) \{\s*return \{ error: EDIT_INACTIVE_MESSAGE, values: submittedValues\(formData\) \};/);
  assert.match(EDIT_INACTIVE_MESSAGE, /^This schedule is inactive\. Activate it first/);
  // Nothing in the actions writes an 'active' status: a new version gets it from the table's default, and only activateSchedule inserts for an inactive one.
  assert.ok(!/status:\s*"active"/.test(actions));
});

// ---- the dialog and the page --------------------------------------------------------------------------------------------------------------

const dialog = code("app", "schedule", "[id]", "activate-schedule.js");

test("the dialog defaults the date to the page's today, asks for confirmation, and saves nothing until Activate is confirmed", () => {
  assert.match(dialog, /useState\(today\)/);
  assert.equal((dialog.match(/activateSchedule\(/g) ?? []).length, 1, "the action is called in one place");
  assert.ok(dialog.indexOf("activateSchedule(scheduleId, effectiveFrom)") > dialog.indexOf("function runActivate()"));
  assert.match(dialog, /onConfirm=\{runActivate\}/);
  assert.match(dialog, /<Button type="button" onClick=\{\(\) => setConfirmOpen\(true\)\}/, "the button only opens the dialog");
});

test("cancelling or closing the dialog changes nothing and puts the date back to today", () => {
  const close = sliceOf(dialog, "function handleOpenChange(open)", "function runActivate()");
  assert.ok(close.includes("setEffectiveFrom(today)") && close.includes("setError(null)"));
  assert.ok(!close.includes("activateSchedule("));
  assert.match(dialog, /onOpenChange=\{handleOpenChange\}/);
});

test("a refusal stays in the dialog (the date can be changed) and shows the action's message as it is", () => {
  assert.match(dialog, /if \(result\?\.error\) setError\(result\.error\);/);
  assert.match(dialog, /role="alert"/);
});

test("Schedule Details shows Activate for an inactive schedule only, with the centre's today", () => {
  const header = code("app", "schedule", "[id]", "schedule-header.js");
  assert.ok(header.includes('isInactive: schedule.status === "inactive"'));
  assert.match(header, /<ActivateSchedule\s+scheduleId=\{schedule\.id\}\s+isInactive=\{isInactive\}\s+today=\{today\}/);
  assert.match(dialog, /if \(!isInactive\) \{\s*return null;\s*\}/);
  const page = code("app", "schedule", "[id]", "page.js");
  assert.ok(page.includes("const today = await getCentreToday();") && page.includes("<ScheduleHeader schedule={schedule} today={today} />"));
  assert.ok(page.includes('activated: "Schedule activated successfully."'));
});

// ---- what stays as it was --------------------------------------------------------------------------------------------------------------------

test("Deactivate and Delete are unchanged", () => {
  const deactivate = sliceOf(actions, "export async function deactivateSchedule(", "\nexport async function");
  assert.ok(deactivate.includes('.update({ effective_until: trimmedUntil, status: "inactive" })'));
  assert.ok(deactivate.includes('"This schedule is already inactive."'));
  assert.ok(actions.includes('supabase.rpc("delete_unused_schedule"'));
  const deactivateUi = code("app", "schedule", "[id]", "deactivate-schedule.js");
  assert.ok(deactivateUi.includes("if (!isActive) {"));
});

test("future sessions follow the status and the effective period: nothing is projected for an inactive schedule, and a new version projects from its own start", () => {
  const data = code("lib", "schedules", "data.js");
  const project = sliceOf(data, "export function projectUpcomingSessions(", "\n}\n");
  assert.ok(project.includes('if (schedule.status !== "active") return [];'));
  assert.ok(project.includes("const windowStart = schedule.effective_from > today ? schedule.effective_from : today;"));
  assert.ok(project.includes("schedule.effective_until && schedule.effective_until < horizonDate"));
  // A session is only ever materialised from the schedule version whose own dates contain the session date (0014), so the new version
  // owns the days from its Effective From and the inactive one keeps its own.
  const materialize = read("supabase", "migrations", "0014_instructor_attendance_access.sql");
  assert.ok(materialize.includes("p_session_date < v_schedule.effective_from"));
  assert.ok(materialize.includes("p_session_date > v_schedule.effective_until"));
});
