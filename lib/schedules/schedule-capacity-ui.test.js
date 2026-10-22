// Run with `npm test` (Node's built-in test runner).
//
// Schedule capacity management (S5): how the actions, the form and every screen use it. The actions and screens need the Next.js
// runtime, so they are pinned from source - the project's way. What each write sends, and how an answer is read, is tested for real
// in capacity-writes.test.js and capacity-input.test.js; this file pins the wiring around them. Whether the database refuses and
// accepts as intended is NOT shown here - that is 0060's verification script, run against a database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placesDisplay, scheduleCapacity } from "./capacity.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("lib/schedules/actions.js");
const sliceOf = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, from);
  const end = to ? source.indexOf(to, start + 1) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
};
const create = sliceOf(actions, "export async function createSchedule(", "\nasync function saveOwnCapacity");
const correct = sliceOf(actions, "async function correctUnusedSchedule(", "\nfunction revalidateScheduleViews");
const update = sliceOf(actions, "export async function updateSchedule(", "\nexport async function deactivateSchedule");

// ---- how a schedule's places read -------------------------------------------------------------------------------------------

test("places: a limited schedule reads taken / capacity, a full one is flagged, unlimited says Unlimited", () => {
  assert.deepEqual(placesDisplay(scheduleCapacity(20, 10)), { text: "10 / 20", isFull: false, unavailable: false });
  assert.deepEqual(placesDisplay(scheduleCapacity(20, 20)), { text: "20 / 20", isFull: true, unavailable: false });
  assert.deepEqual(placesDisplay(scheduleCapacity(1, 0)), { text: "0 / 1", isFull: false, unavailable: false });
  assert.deepEqual(placesDisplay(scheduleCapacity(null, 37)), { text: "Unlimited", isFull: false, unavailable: false });
});

test("places: when they could not be loaded nothing numeric is shown", () => {
  for (const places of [null, undefined]) {
    assert.deepEqual(placesDisplay(places), { text: null, isFull: false, unavailable: true });
  }
});

test("the places component shows a dash with an accessible 'unavailable', the Full badge, and no state of its own", () => {
  const component = code("app/schedule/schedule-places.js");
  assert.match(component, /view\.unavailable/);
  assert.match(component, /<span aria-hidden="true">—<\/span>\s+<span className="sr-only">Places unavailable<\/span>/);
  assert.match(component, /\{view\.isFull \? <Badge variant="danger">Full<\/Badge> : null\}/);
  assert.match(component, /\{view\.text\}/);
  assert.doesNotMatch(component, /useState|use client|\.capacity\b/);
});

// ---- Add Schedule: one capacity for every schedule it creates ---------------------------------------------------------------

test("Add: the capacity is validated with the other fields and its error is returned on the capacity field", () => {
  assert.match(create, /const capacityResult = validateScheduleCapacity\(formData\.get\("capacity"\)\);/);
  assert.match(create, /!capacityResult\.success/);
  assert.match(create, /\.\.\.\(capacityResult\.success \? null : capacityResult\.errors\),/);
});

test("Add: every schedule created - one per day x time slot - starts with the one capacity entered", () => {
  assert.match(create, /insertScheduleRows\(supabase, result\.data, rows, capacityResult\.data\.value\)/);
  const helper = sliceOf(actions, "async function insertScheduleRows(", "\nexport async function createSchedule");
  assert.match(helper, /createSeriesRows\(supabase, data\.batch_id, rows\.length, capacity\)/);
  // One series per row, then one schedule per row on its own series: the series count is the row count, all with that capacity.
  assert.match(helper, /series_id: series\.ids\[index\]/);
});

// ---- Edit Schedule: "Also creates" and Direct Edit inherit the capacity being saved ------------------------------------------------

const migration = read("supabase/migrations/0061_schedule_save_functions.sql");

test("Edit: the capacity, the schedule change and the extra days are ONE database call (0061); the capacity is sent only when the form sent one", () => {
  assert.match(update, /supabase\.rpc\("save_schedule_edit", \{/);
  assert.match(update, /p_set_capacity: capacityResult\.data\.provided,\s+p_capacity: capacityResult\.data\.value,\s+p_extra_days: extraDays,/);
  // The extra days are the weekdays other than this schedule's own, and the schedule is named by id.
  assert.match(update, /const extraDays = daysResult\.data\.filter\(\(day\) => day !== existing\.day_of_week\);/);
  assert.match(update, /p_schedule_id: id,/);
  // A refusal anywhere is shown and nothing was written, so nothing has to be put back.
  assert.match(update, /return refusedSave\(error, formData, \{ context: `Could not update schedule \$\{id\}` \}\);/);
});

test("Edit: schedules created on extra days start with the capacity being saved - decided inside the same transaction", () => {
  // The function hands the capacity just set - or, when none was supplied, the stored one - to every extra day it creates.
  assert.match(migration, /v_inherit := public\.schedule_series_apply_capacity\(v_schedule\.series_id, p_set_capacity, p_capacity\);/);
  assert.match(migration, /v_inherit, v_schedule\.day_of_week, p_extra_days/);
  const helper = sliceOf(migration, "create or replace function public.schedule_series_apply_capacity", "revoke execute");
  assert.match(helper, /if coalesce\(p_set, false\) then/);
  assert.match(helper, /return p_capacity;/);
  assert.match(helper, /select ss\.capacity into v_capacity from public\.schedule_series ss where ss\.id = p_series_id;\s+return v_capacity;/);
});

test("Direct Edit: the same call shape and the same rule - one atomic function, extra days inheriting the capacity being saved", () => {
  assert.match(correct, /supabase\.rpc\("save_unused_schedule_edit", \{/);
  assert.match(correct, /p_set_capacity: capacity\.provided,\s+p_capacity: capacity\.value,\s+p_extra_days: extraDays,/);
  assert.match(correct, /p_day_of_week: ownDay,/);
  assert.match(correct, /const extraDays = daysResult\.data\.filter\(\(day\) => day !== ownDay\);/);
  assert.match(update, /return correctUnusedSchedule\(\{ supabase, id, existing, result, daysResult, capacity: capacityResult\.data, formData \}\);/);
  const direct = sliceOf(migration, "create or replace function public.save_unused_schedule_edit", "revoke execute");
  assert.match(direct, /v_inherit := public\.schedule_series_apply_capacity\(/);
  assert.match(direct, /v_inherit, p_day_of_week, p_extra_days/);
});

// ---- the capacity-only path (the one place the application still writes a series itself) ----------------------------------------------------

test("Capacity only: the edited schedule's OWN series is set by id, a refusal is shown on the capacity field, anything else is the generic message", () => {
  const helper = sliceOf(actions, "async function saveOwnCapacity(", "\n// A refused atomic save");
  assert.match(helper, /setSeriesCapacity\(supabase, seriesId, capacity\)/);
  assert.match(helper, /fieldErrors: \{ capacity: change\.refused \}, values: submittedValues\(formData\)/);
  assert.match(helper, /error: SAVE_SCHEDULE_ERROR_MESSAGE/);
  assert.match(update, /const saved = await saveOwnCapacity\(\{ supabase, seriesId: existing\.series_id, capacity: capacityResult\.data\.value, formData \}\);/);
});

test("no best-effort compensation is left: nothing is written before a refusal, so nothing has to be put back", () => {
  for (const gone of ["undoCapacity", "restoreSeriesCapacity", "capacityForExtraDays", "insertSchedulesForDays", "readSeriesCapacity"]) {
    assert.ok(!actions.includes(gone), gone);
  }
  assert.ok(!code("lib/schedules/capacity-writes.js").includes("restoreSeriesCapacity"));
  // The only schedule writes left in Edit are inside the database functions.
  for (const body of [update, correct]) assert.doesNotMatch(body, /\.from\("schedules"\)\s*\.(insert|update)\(/);
});

test("Edit: a capacity-only change creates no version - it is decided before validation and writes nothing to schedules", () => {
  const start = update.indexOf("scheduleEditChangesOnlyCapacity(");
  assert.ok(start > 0 && start < update.indexOf("validateScheduleInput("), "judged before the dated fields are validated");
  const block = update.slice(update.lastIndexOf("if (", start - 40), update.indexOf("const result = validateScheduleInput("));
  assert.match(block, /capacityResult\.data\.provided/);
  assert.match(block, /const saved = await saveOwnCapacity\(/);
  assert.match(block, /redirect\(`\$\{schedulePath\(id\)\}\?success=updated`\);/);
  // No schedule write, no new version, no extra days in that block.
  assert.doesNotMatch(block, /\.from\("schedules"\)|\.insert\(|insertSchedulesForDays|rpc\(|subtractOneDayUTC/);
});

test("Edit: the stored schedule and its edit mode are read before the capacity-only decision", () => {
  const order = [
    update.indexOf('.from("schedules")'),
    update.indexOf("getScheduleDeleteImpact(id)"),
    update.indexOf("scheduleEditChangesOnlyCapacity("),
  ];
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], order.join(" < "));
  assert.match(update, /\.select\("batch_id, day_of_week, instructor_id, start_time, end_time, effective_from, effective_until, series_id"\)/);
});

test("capacity never reaches a schedules row: it is not read with the schedule fields, and no schedules write mentions it", () => {
  const readInput = sliceOf(actions, "function readScheduleInput(", "\nasync function insertScheduleRows");
  assert.doesNotMatch(readInput, /capacity/);
  // The only places `capacity` appears in a write are the series helpers (capacity-writes.js), never a schedules insert/update.
  for (const match of actions.matchAll(/\.from\("schedules"\)[\s\S]{0,220}?(\.insert|\.update)\(([^)]*)\)/g)) {
    assert.doesNotMatch(match[2], /capacity/, match[0]);
  }
  assert.doesNotMatch(code("lib/schedules/validation.js"), /capacity/);
});

test("deactivating, deleting and the session actions are untouched by capacity", () => {
  const rest = sliceOf(actions, "export async function deactivateSchedule(");
  assert.doesNotMatch(rest, /capacity/i);
  assert.match(actions, /supabase\.rpc\("delete_unused_schedule"/);
  assert.doesNotMatch(code("lib/enrollments/actions.js"), /schedule-capacity|capacity-writes|capacity-input/);
});

// ---- the form ----------------------------------------------------------------------------------------------------------------

const form = code("app/schedule/schedule-form.js");

test("form: one Capacity field - blank means unlimited - disabled and not submitted when the stored capacity could not be loaded", () => {
  assert.match(form, /const capacityEditable = isAddMode \|\| Boolean\(places\);/);
  assert.match(form, /id="capacity"\s+name="capacity"\s+type="text"\s+inputMode="numeric"/);
  assert.match(form, /placeholder="No limit"/);
  assert.match(form, /disabled=\{isPending \|\| !capacityEditable\}/);
  assert.match(form, /defaultValue=\{state\?\.values\?\.capacity \?\? \(places && !places\.isUnlimited \? String\(places\.capacity\) : ""\)\}/);
});

test("form: validated with the same rules as the server, and a refused value is shown on the field", () => {
  assert.match(form, /validateScheduleCapacity\(formData\.get\("capacity"\)\)/);
  assert.match(form, /if \(!capacity\.success\) errors\.capacity = capacity\.errors\.capacity;/);
  assert.match(form, /"capacity",\n\]\);/, "re-checked on blur and change");
  assert.match(form, /aria-invalid=\{Boolean\(fieldErrors\.capacity\)\}/);
  assert.match(form, /<p id="capacity-error" role="alert" className="text-small text-danger">/);
});

test("form: beside End Time on Edit; once, below the time slots, on Add (one capacity for every schedule it creates)", () => {
  const edit = sliceOf(form, '<div className="grid gap-5 sm:grid-cols-3">', "{isAddMode ? <div");
  assert.ok(edit.indexOf('htmlFor="end_time"') < edit.indexOf("{capacityField}"), "after End Time, in the same row");
  assert.match(form, /\{isAddMode \? <div className="sm:max-w-xs">\{capacityField\}<\/div> : null\}/);
  assert.match(form, /Every schedule created here starts with it\./);
});

test("form: Add is not made to wait for an effective date - and a capacity-only Edit does not need one either", () => {
  assert.match(form, /if \(changesOnlyCapacity\(formData\)\) delete errors\.effective_from;/);
  assert.match(form, /existing: \{ \.\.\.schedule, instructor_id: schedule\.instructors\?\.id \}/);
  assert.match(form, /direct: directEdit,/);
  assert.match(form, /Not needed when only the capacity changes\./);
});

test("form: Review states the capacity apart from the dated changes - 'from now' - and a capacity-only Review hides the dates", () => {
  assert.match(form, /capacityOnly: changesOnlyCapacity\(formData\),/);
  assert.match(form, /`\$\{capacityLabel\(reviewData\.capacity\.from\)\} → \$\{capacityLabel\(reviewData\.capacity\.to\)\}`/);
  assert.match(form, /Takes effect as soon as you save/);
  assert.match(form, /\(unchanged\)/);
  assert.match(form, /\{reviewData\.capacityOnly \? null : \(/);
  assert.match(form, /Only the capacity changes: it takes effect as soon as you save, and no new version of the schedule is created\./);
  const label = sliceOf(form, "const capacityLabel", "\n");
  assert.match(label, /"No limit"/);
});

test("form: a lowered capacity the database refuses comes back on the field, the other entries kept (values are redisplayed)", () => {
  assert.match(actions, /fieldErrors: \{ capacity: change\.refused \}, values: submittedValues\(formData\)/);
  assert.match(actions, /capacity: formData\.get\("capacity"\),/, "the submitted capacity is part of the values the form redisplays");
  assert.match(form, /const \[state, formAction, isPending\] = useActionState\(action, \{\}\);/);
});

test("form: the edit page loads the capacity and places, and hands them over - null when they cannot be read", () => {
  const edit = code("app/schedule/[id]/edit/page.js");
  assert.match(edit, /getScheduleCapacitiesForPicker\(\[schedule\.series_id\]\)/);
  assert.match(edit, /const places = capacities\?\.\[schedule\.series_id\] \?\? null;/);
  assert.match(edit, /places=\{places\}/);
});

// ---- display ----------------------------------------------------------------------------------------------------------------

test("data: the schedule list and a batch's schedules carry places, read once for all rows; the shared week list does not", () => {
  const data = code("lib/schedules/data.js");
  assert.match(data, /return \{ schedules: await attachSchedulePlaces\(schedules\), total: count \?\? 0, page, pageSize \};/);
  assert.match(data, /return attachSchedulePlaces\(data \?\? \[\]\);/);
  // listSchedulesForWeek also feeds attendance (non-Admin callers): its places are attached on the Admin-only page instead.
  const week = sliceOf(data, "export async function listSchedulesForWeek(", "\nconst JS_DAY_INDEX");
  assert.doesNotMatch(week, /attachSchedulePlaces/);
  assert.match(code("app/schedule/page.js"), /await attachSchedulePlaces\(await listSchedulesForWeek\(weekStart, weekEnd\)\)/);
  assert.doesNotMatch(sliceOf(data, "export async function getSchedule(", "\nexport async function listSchedulesForBatch"), /attachSchedulePlaces/);
});

test("data: one lookup for all the rows' series, versions of a series share its places, and an unreadable lookup gives null", () => {
  const loader = code("lib/schedules/capacity-data.js");
  const attach = sliceOf(loader, "export async function attachSchedulePlaces(");
  assert.match(attach, /getScheduleCapacitiesForPicker\(\[\.\.\.new Set\(rows\.map\(\(row\) => row\.series_id\)\.filter\(Boolean\)\)\]\)/);
  assert.match(attach, /places: capacities\?\.\[row\.series_id\] \?\? null/);
  assert.equal((attach.match(/getScheduleCapacitiesForPicker\(/g) ?? []).length, 1, "never one lookup per row");
});

test("list (table): a Places column after Instructor; (mobile): a Places line; every figure through SchedulePlaces", () => {
  const accordion = code("app/schedule/schedule-batch-accordion.js");
  assert.ok(accordion.indexOf(">Instructor</TableHead>") < accordion.indexOf(">Places</TableHead>"));
  assert.ok(accordion.indexOf(">Places</TableHead>") < accordion.indexOf(">Effective From</TableHead>"));
  assert.equal((accordion.match(/<SchedulePlaces places=\{schedule\.places\} \/>/g) ?? []).length, 2, "table row and mobile row");
});

test("weekly grid: the popup shows the schedule's places, and the card is labelled and flagged Full", () => {
  const context = code("app/schedule/schedule-context.js");
  assert.match(context, /places: schedule\?\.places,/);
  assert.match(context, /context\.places !== undefined \?/);
  assert.match(context, /<SchedulePlaces places=\{context\.places\} \/>/);

  const card = code("app/schedule/weekly-schedule-card.js");
  assert.match(card, /const places = placesDisplay\(schedule\.places\);/);
  assert.match(card, /places\.isFull \? ", full" : `, places \$\{places\.text\}`/);
  assert.match(card, /\{places\.isFull \? \(\s+<span className="hidden shrink-0 rounded-sm bg-danger\/10 px-1 font-semibold text-danger sm:inline" aria-hidden="true">\s+Full/);
});

test("Batch Details: the Schedules tab has a Places column and the Overview shows each class's places", () => {
  const row = code("app/batches/[id]/batch-schedule-row.js");
  assert.match(row, /<SchedulePlaces places=\{schedule\.places\} \/>/);
  const page = code("app/batches/[id]/schedules/page.js");
  assert.ok(page.indexOf(">Instructor</TableHead>") < page.indexOf(">Places</TableHead>") && page.indexOf(">Places</TableHead>") < page.indexOf(">Effective From</TableHead>"));
  assert.match(code("app/batches/[id]/weekly-schedule-overview.js"), /<SchedulePlaces places=\{schedule\.places\} className="text-small" \/>/);
});

test("there is no batch-wide capacity anywhere: the batch screens and forms mention none, and no batch figure is summed", () => {
  for (const path of ["app/batches/[id]/batch-header.js", "app/batches/batch-form.js", "app/batches/batch-card-item.js", "app/batches/batch-table.js", "lib/batches/data.js", "lib/batches/actions.js"]) {
    assert.doesNotMatch(code(path), /capacity/i, path);
  }
  assert.doesNotMatch(code("app/schedule/schedule-batch-group-card.js"), /places|capacity/i, "the batch summary card has no schedule rows, so no places");
});

test("the Weekly Schedule fits whatever width it is given: day cards no narrower than a time chip, seven across only when there is room", () => {
  const week = code("app/batches/[id]/weekly-schedule-overview.js");
  // Auto-fit columns of at least 9.75rem (a "6:00 AM – 7:00 AM" chip plus the card's padding), not viewport breakpoints: the section sits
  // beside the Students panel on one page and full width on another, so only its own width can say how many days fit.
  assert.match(week, /grid-cols-\[repeat\(auto-fit,minmax\(9\.75rem,1fr\)\)\]/);
  assert.doesNotMatch(week, /xl:grid-cols-7|sm:grid-cols-4/, "no viewport-based column count");
  // Every day keeps its own card, the chip never wraps (so it is never clipped), and each class's places stay visible under its time.
  assert.match(week, /whitespace-nowrap tabular-nums/);
  assert.match(week, /<li key=\{day\} className="flex min-w-0 flex-col/);
  assert.match(week, /<SchedulePlaces places=\{schedule\.places\} className="text-small" \/>/);
});
