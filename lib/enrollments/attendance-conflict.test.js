// Run with `npm test` (Node's built-in test runner).
//
// Phase 16A step 6: an enrollment's start date, or a schedule/batch change date, cannot land on a day the student already has
// recorded class-session attendance. The lookup is tested against a fake query builder; the wiring (server-side, before any
// write, the right paths, nothing for end dates / status / instructors) is pinned from source - the project's way for server actions.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attendanceConflictMessage, findAttendanceOnDate } from "./attendance-conflict.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function fakeSupabase(result) {
  const calls = [];
  const builder = {
    from: (table) => (calls.push(["from", table]), builder),
    select: (...args) => (calls.push(["select", ...args]), builder),
    eq: (...args) => (calls.push(["eq", ...args]), builder),
    limit: (n) => (calls.push(["limit", n]), Promise.resolve(result)),
  };
  return { supabase: builder, calls };
}

test("the message is the approved wording with a readable date", () => {
  assert.equal(
    attendanceConflictMessage("2026-09-11"),
    "This student already has attendance recorded on Sep 11, 2026. Choose a later effective date.",
  );
});

test("conflict: attendance exists on the date", async () => {
  const { supabase } = fakeSupabase({ data: [{ id: "a1" }], error: null });
  assert.deepEqual(await findAttendanceOnDate(supabase, "s1", "2026-09-11"), { conflict: true, failed: false });
});

test("no conflict: no attendance on the date (a later date is accepted)", async () => {
  const { supabase } = fakeSupabase({ data: [], error: null });
  assert.deepEqual(await findAttendanceOnDate(supabase, "s1", "2026-09-12"), { conflict: false, failed: false });
});

test("lookup: reads only the attendance table, for that student and that session date, across all batches, one row at most", async () => {
  const { supabase, calls } = fakeSupabase({ data: [], error: null });
  await findAttendanceOnDate(supabase, "s1", "2026-09-11");
  assert.deepEqual(calls[0], ["from", "attendance"]);
  assert.deepEqual(calls[1], ["select", "id, class_sessions!inner(session_date)"]);
  assert.deepEqual(calls.filter((c) => c[0] === "eq"), [
    ["eq", "student_id", "s1"],
    ["eq", "class_sessions.session_date", "2026-09-11"],
  ]);
  assert.deepEqual(calls.at(-1), ["limit", 1]);
  // Not scoped to a batch or series, and not the class-count table.
  assert.ok(!calls.some((c) => /batch|schedule|class_count/.test(String(c[1]))));
});

test("a failed lookup is reported as failed, never as 'no conflict'", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { supabase } = fakeSupabase({ data: null, error: { code: "42501", message: "denied" } });
    assert.deepEqual(await findAttendanceOnDate(supabase, "s1", "2026-09-11"), { conflict: false, failed: true });
  } finally {
    console.error = original;
  }
});

test("no time-based logic: dates stay YYYY-MM-DD strings", () => {
  const text = code("./attendance-conflict.js");
  assert.doesNotMatch(text, /new Date\(|Date\.now|getHours|toISOString|T\d\d:/);
});

// ---- the wiring ------------------------------------------------------------------------------------------------------------

const ACTIONS = code("./actions.js");
const create = ACTIONS.slice(ACTIONS.indexOf("export async function createEnrollment"), ACTIONS.indexOf("export async function updateEnrollment"));
const update = ACTIONS.slice(ACTIONS.indexOf("export async function updateEnrollment"));

test("create: an enrollment's start date is checked on the server before the enrollment is inserted", () => {
  const check = create.indexOf('attendanceDateRefusal(supabase, studentId, result.data.effective_start_date, "effective_start_date"');
  assert.ok(check > 0);
  // The enrollment and its schedules are written by one call to create_enrollment (0060, S3).
  const write = create.indexOf('supabase.rpc("create_enrollment"');
  assert.ok(write > 0);
  assert.ok(check < write);
});

test("update: a CHANGED start date is checked, and an unchanged one is not re-judged", () => {
  assert.match(update, /if \(inputResult\.data\.effective_start_date !== stored\.effective_start_date\) \{\s+const startRefusal = await attendanceDateRefusal\(supabase, stored\.student_id, inputResult\.data\.effective_start_date, "effective_start_date"/);
});

test("update: the schedule / batch change date is checked, only when the selection changes", () => {
  const block = update.slice(update.indexOf("if (scheduleSelectionChanged) {"));
  assert.match(block, /validateScheduleChangeDate/);
  assert.match(block, /attendanceDateRefusal\(supabase, stored\.student_id, scheduleChangeDate, "schedule_effective_date"/);
});

test("update: every attendance check runs before any enrollment or assignment write; the stored student is the one checked", () => {
  // The enrollment and every assignment change are written by one call to change_enrollment (0060, S3).
  const firstWrite = update.indexOf('supabase.rpc("change_enrollment"');
  assert.ok(firstWrite > 0);
  for (const marker of ['"effective_start_date", formData)', '"schedule_effective_date", formData)']) {
    const at = update.indexOf(marker);
    assert.ok(at > 0 && at < firstWrite, marker);
  }
  assert.doesNotMatch(update, /attendanceDateRefusal\(supabase, studentId/);
});

test("the end date, status and instructors are never checked", () => {
  assert.doesNotMatch(ACTIONS, /attendanceDateRefusal\([^)]*effective_end_date/);
  assert.doesNotMatch(ACTIONS, /attendanceDateRefusal\([^)]*status/);
  assert.doesNotMatch(ACTIONS, /instructor/i);
});

test("a failed lookup refuses the save; the conflict is a field-level message", () => {
  const helper = ACTIONS.slice(ACTIONS.indexOf("async function attendanceDateRefusal"), ACTIONS.indexOf("export async function createEnrollment"));
  assert.match(helper, /if \(failed\) return \{ error: "Could not save the enrollment\. Try again\."/);
  assert.match(helper, /fieldErrors: \{ \[field\]: attendanceConflictMessage\(date\) \}/);
});
