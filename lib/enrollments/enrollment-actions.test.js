// Run with `npm test` (Node's built-in test runner).
//
// The enrollment actions (S3): every write goes through migration 0060's atomic create_enrollment / change_enrollment, with the
// existing checks still run first. The actions need the Next.js runtime, so they are pinned from source - the project's way - and
// the parameters they send are compared with the functions' own signatures in the migration.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = code("./actions.js");
const sql = read("../../supabase/migrations/0060_schedule_capacity.sql");

const createAction = actions.slice(actions.indexOf("export async function createEnrollment"), actions.indexOf("export async function updateEnrollment"));
const updateAction = actions.slice(actions.indexOf("export async function updateEnrollment"));

// The parameter names a function declares in 0060, in order.
function sqlParameters(name) {
  const match = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`).exec(sql);
  assert.ok(match, name);
  return match[1].split(",").map((part) => part.trim().split(/\s+/)[0]);
}

// The keys an action sends to supabase.rpc(name, {...}), in order.
function rpcKeys(source, name) {
  const match = new RegExp(`supabase\\.rpc\\("${name}", \\{([\\s\\S]*?)\\}\\);`).exec(source);
  assert.ok(match, `rpc ${name}`);
  return [...match[1].matchAll(/(p_\w+):/g)].map((m) => m[1]);
}

// ---- the writes ---------------------------------------------------------------------------------------------------------

test("createEnrollment writes through create_enrollment with exactly its parameters", () => {
  assert.deepEqual(rpcKeys(createAction, "create_enrollment"), sqlParameters("create_enrollment"));
  assert.match(createAction, /p_student_id: studentId,/);
  assert.match(createAction, /p_batch_id: result\.data\.batch_id,/);
  assert.match(createAction, /p_start_date: result\.data\.effective_start_date,/);
  assert.match(createAction, /p_end_date: result\.data\.effective_end_date,/);
  assert.match(createAction, /p_series_ids: scheduleResult\.data,/);
});

test("updateEnrollment writes through change_enrollment with exactly its parameters", () => {
  assert.deepEqual(rpcKeys(updateAction, "change_enrollment"), sqlParameters("change_enrollment"));
  assert.match(updateAction, /p_enrollment_id: id,/);
  assert.match(updateAction, /p_status: statusResult\.data,/);
  assert.match(updateAction, /p_series_ids: scheduleResult\.data,/);
  // Null when the selection is unchanged, which change_enrollment accepts (it asks for a date only when the selection changes).
  assert.match(updateAction, /p_change_date: scheduleChangeDate,/);
  assert.match(updateAction, /let scheduleChangeDate = null;/);
});

test("no direct writes are left: nothing can be half-saved", () => {
  assert.doesNotMatch(actions, /\.(insert|update|upsert|delete)\(/);
  assert.equal((actions.match(/supabase\.rpc\(/g) ?? []).length, 2);
  // The partial-save messages of the old multi-step edit are gone.
  assert.doesNotMatch(actions, /The enrollment was updated, but its schedule change could not be saved/);
});

test("the moved count is the one change_enrollment returns, and is reported as before", () => {
  assert.match(updateAction, /const movedAssignments = Number\(saved\?\.moved\) \|\| 0;/);
  assert.match(updateAction, /\?success=enrollment_updated\$\{movedAssignments > 0 \? `&moved=\$\{movedAssignments\}` : ""\}/);
  assert.match(sql, /return jsonb_build_object\('enrollment_id', p_enrollment_id, 'moved', v_moved\);/);
});

// ---- the checks that still run first -------------------------------------------------------------------------------------

test("permissions: both actions require the Admin before anything else", () => {
  for (const action of [createAction, updateAction]) {
    const body = action.slice(action.indexOf("{") + 1);
    assert.match(body.trimStart(), /^await requireRole\(ROLES\.ADMIN\);/);
  }
});

test("validation, the schedule-belongs-to-the-batch check, the join date and the attendance date still run before the write", () => {
  for (const [action, rpc] of [[createAction, "create_enrollment"], [updateAction, "change_enrollment"]]) {
    const write = action.indexOf(`supabase.rpc("${rpc}"`);
    for (const check of [
      "validateEnrollmentInput(",
      "validateScheduleSelection(",
      'fieldErrors: { schedule_series_ids: "Select schedules that belong to the chosen batch." }',
      "attendanceDateRefusal(",
    ]) {
      const at = action.indexOf(check);
      assert.ok(at >= 0 && at < write, `${rpc}: ${check} before the write`);
    }
  }
  assert.ok(createAction.indexOf('startBeforeJoinDateError("enrollment"') < createAction.indexOf('supabase.rpc("create_enrollment"'));
  assert.ok(updateAction.indexOf('changedStartBeforeJoinDateError("enrollment"') < updateAction.indexOf('supabase.rpc("change_enrollment"'));
  // A changed selection still needs a valid, not back-dated change date, and that date is checked for attendance.
  assert.ok(updateAction.indexOf("validateScheduleChangeDate(") < updateAction.indexOf('supabase.rpc("change_enrollment"'));
  assert.match(updateAction, /attendanceDateRefusal\(supabase, stored\.student_id, scheduleChangeDate, "schedule_effective_date", formData\)/);
});

test("guided Add Student flow: the success redirect is unchanged", () => {
  assert.match(createAction, /const guidedSuffix = formData\.get\("guided"\) === "1" \? "&guided=1" : "";/);
  assert.match(createAction, /redirect\(`\$\{studentPath\(studentId\)\}\?success=enrollment_added\$\{guidedSuffix\}`\);/);
});

// ---- errors ----------------------------------------------------------------------------------------------------------------

test("a refused write goes through saveRefusal: a mapped field error, or the generic message with the details only logged", () => {
  assert.match(createAction, /return saveRefusal\(error, formData, `\[enrollments\] Could not create enrollment for student \$\{studentId\}:`\);/);
  assert.match(updateAction, /return saveRefusal\(error, formData, `\[enrollments\] Could not update enrollment \$\{id\}:`\);/);

  const refusal = actions.slice(actions.indexOf("async function saveRefusal"), actions.indexOf("export async function createEnrollment"));
  assert.match(refusal, /const mapped = mapEnrollmentSaveError\(error, \{ scheduleLabel: label \}\);/);
  assert.match(refusal, /fieldErrors: \{ \[mapped\.field\]: mapped\.error \}/);
  assert.match(refusal, /console\.error\(logPrefix, error\?\.code, error\?\.message\);\s+return \{ error: SAVE_ERROR_MESSAGE, values: submittedValues\(formData\) \};/);
  // The database's own wording is never returned.
  assert.doesNotMatch(refusal, /error: error\.message|error\.details|error\.hint/);
});

test("a full schedule is named when it can be looked up, and the refusal stands if the lookup fails", () => {
  const refusal = actions.slice(actions.indexOf("async function saveRefusal"), actions.indexOf("export async function createEnrollment"));
  assert.match(refusal, /const seriesId = fullScheduleSeriesId\(error\);/);
  assert.match(refusal, /label = scheduleLabel\(\(await getRepresentativeSchedulesForSeries\(\[seriesId\]\)\)\.get\(seriesId\)\);/);
  assert.match(refusal, /\} catch \{\s+label = null;/);
});
