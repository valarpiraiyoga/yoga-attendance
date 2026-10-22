// Run with `npm test` (Node's built-in test runner).
//
// Deleting a schedule version (migration 0063; 01-product.md §7 "Unused Schedules"): the decision the dialog makes (the database's own check, under
// locks, stays authoritative), how a refusal is worded, and - pinned from source, the project's way for SQL and for client components - what the
// migration and the dialog do.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DELETE_BLOCK_REASONS,
  USAGE_BLOCK_REASONS,
  blockReasonFromError,
  describeBlockReason,
  evaluateScheduleDeletion,
  evaluateScheduleUsage,
  usageFromRpc,
} from "./usage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const code = (...parts) => read(...parts).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const facts = (overrides = {}) =>
  usageFromRpc({
    schedule_id: "s2",
    series_id: "x1",
    batch_id: "b1",
    day_of_week: "monday",
    start_time: "06:00:00",
    end_time: "07:00:00",
    session_count: 0,
    version_count: 1,
    started_assignment_count: 0,
    unstarted_assignment_count: 0,
    affected_student_count: 0,
    unrecorded_past_occurrence_count: 0,
    ...overrides,
  });

const v = (id, from, until = null, created = "2026-01-01T00:00:00Z") => ({ id, effective_from: from, effective_until: until, created_at: created });
const decide = (scheduleId, versions, { own = 0, started = 0 } = {}) =>
  evaluateScheduleDeletion(facts({ started_assignment_count: started, version_count: versions.length }), { scheduleId, ownSessionCount: own, versions });

// ---- the series' only version: as before ------------------------------------------------------------------------------------------------

test("a class's only version with nothing recorded can be deleted, and the series goes with it", () => {
  assert.deepEqual(decide("s1", [v("s1", "2026-01-05")]), { canDelete: true, blockReason: null, seriesContinues: false, versionsRemaining: 0, previousEndDate: null });
});

test("a class's only version is still blocked by its own sessions, and by a started assignment", () => {
  assert.equal(decide("s1", [v("s1", "2026-01-05")], { own: 3 }).blockReason, "sessions");
  assert.equal(decide("s1", [v("s1", "2026-01-05")], { started: 2 }).blockReason, "started_assignments");
  assert.equal(decide("s1", [v("s1", "2026-01-05")], { own: 1, started: 2 }).blockReason, "sessions", "sessions are checked first");
});

// ---- the latest of several versions: now allowed -------------------------------------------------------------------------------------------

test("the LATEST version of a series can be deleted although earlier versions exist (they alone no longer block)", () => {
  const versions = [v("s1", "2026-01-05", "2026-06-30"), v("s2", "2026-07-01")];
  assert.deepEqual(decide("s2", versions), {
    canDelete: true,
    blockReason: null,
    seriesContinues: true,
    versionsRemaining: 1,
    previousEndDate: "2026-06-30",
  });
});

test("with other versions remaining a started assignment does not block: the series and its assignments stay", () => {
  const versions = [v("s1", "2026-01-05", "2026-06-30"), v("s2", "2026-07-01")];
  assert.equal(decide("s2", versions, { started: 5 }).canDelete, true);
});

test("the warning date is the PREVIOUS version's end date, and is null when it has none", () => {
  assert.equal(decide("s3", [v("s1", "2026-01-05", "2026-03-31"), v("s2", "2026-04-01", "2026-06-30"), v("s3", "2026-07-01")]).previousEndDate, "2026-06-30");
  assert.equal(decide("s2", [v("s1", "2026-01-05"), v("s2", "2026-07-01")]).previousEndDate, null);
  assert.equal(decide("s3", [v("s1", "2026-01-05", "2026-03-31"), v("s2", "2026-04-01", "2026-06-30"), v("s3", "2026-07-01")]).versionsRemaining, 2);
});

// ---- earlier and middle versions are protected ----------------------------------------------------------------------------------------------

test("an EARLIER or MIDDLE version cannot be deleted while a later one exists - no gap in the chain", () => {
  const versions = [v("s1", "2026-01-05", "2026-03-31"), v("s2", "2026-04-01", "2026-06-30"), v("s3", "2026-07-01")];
  assert.equal(decide("s1", versions).blockReason, "later_version");
  assert.equal(decide("s2", versions).blockReason, "later_version");
  assert.equal(decide("s3", versions).canDelete, true);
});

test("'later' is by effective from, then created at, then id - versions sharing a start date are ordered", () => {
  const versions = [v("a", "2026-07-01", null, "2026-06-01T00:00:00Z"), v("b", "2026-07-01", null, "2026-06-02T00:00:00Z")];
  assert.equal(decide("a", versions).blockReason, "later_version");
  assert.equal(decide("b", versions).canDelete, true);
  const sameInstant = [v("a", "2026-07-01"), v("b", "2026-07-01")];
  assert.equal(decide("a", sameInstant).blockReason, "later_version");
  assert.equal(decide("b", sameInstant).canDelete, true);
});

test("a version with sessions of its own is protected, but sessions of ANOTHER version do not block it", () => {
  const versions = [v("s1", "2026-01-05", "2026-06-30"), v("s2", "2026-07-01")];
  assert.equal(decide("s2", versions, { own: 1 }).blockReason, "sessions");
  // The earlier version's sessions are in the series-wide count (`schedule_usage`) but not in this version's own count.
  const withSeriesSessions = evaluateScheduleDeletion(facts({ session_count: 40, version_count: 2 }), { scheduleId: "s2", ownSessionCount: 0, versions });
  assert.equal(withSeriesSessions.canDelete, true);
});

test("status plays no part: the decision never reads it", () => {
  const versions = [{ ...v("s1", "2026-01-05", "2026-06-30"), status: "active" }, { ...v("s2", "2026-07-01", "2026-08-01"), status: "inactive" }];
  assert.equal(decide("s2", versions).canDelete, true);
});

// ---- Direct Edit keeps its own, stricter test -------------------------------------------------------------------------------------------------

test("Direct Edit's 'unused' is unchanged: several versions still mean a versioned edit, although the latest version can now be deleted", () => {
  const usage = evaluateScheduleUsage(facts({ version_count: 2 }));
  assert.equal(usage.editMode, "versioned");
  assert.equal(usage.blockReason, "versions");
  assert.equal(evaluateScheduleUsage(facts()).editMode, "direct");
});

// ---- wording -----------------------------------------------------------------------------------------------------------------------------

test("a later version is explained, and the reasons the database reports are all recognised", () => {
  assert.match(describeBlockReason("later_version"), /later version.*Delete the later version first/);
  assert.deepEqual(DELETE_BLOCK_REASONS, [...USAGE_BLOCK_REASONS, "later_version"]);
  for (const detail of DELETE_BLOCK_REASONS) assert.equal(blockReasonFromError({ details: detail }), detail);
  assert.equal(blockReasonFromError({ details: "something else" }), "sessions", "an unknown reason falls back as before");
  assert.equal(blockReasonFromError({}), "sessions");
  assert.deepEqual(USAGE_BLOCK_REASONS, ["sessions", "versions", "started_assignments"], "the shared (Direct Edit) list is untouched");
});

// ---- the migration -----------------------------------------------------------------------------------------------------------------------

const sql = read("supabase", "migrations", "0063_safe_schedule_version_deletion.sql");
const sqlCode = sql.replace(/^\s*--.*$/gm, "");
const fn = sqlCode.slice(sqlCode.indexOf("create or replace function public.delete_unused_schedule("));

test("0063 replaces only delete_unused_schedule: same signature, security and search path, no grant, table or other function changes", () => {
  assert.equal((sqlCode.match(/create or replace function/g) ?? []).length, 1);
  assert.match(fn, /create or replace function public\.delete_unused_schedule\(p_schedule_id uuid\)\s*returns jsonb\s*language plpgsql\s*security definer\s*set search_path = ''/);
  for (const forbidden of [/\bgrant\b/i, /\brevoke\b/i, /\balter table\b/i, /\bcreate table\b/i, /\bcreate trigger\b/i, /\bdrop\b/i, /function public\.(schedule_usage|correct_unused_schedule|schedules_instructor_conflict_guard)\(/]) {
    assert.doesNotMatch(sqlCode.replace(/to_regprocedure\([^)]*\)/g, ""), forbidden);
  }
});

test("0063 keeps the Admin check first and the lock order: the schedule row, then its series, both FOR UPDATE", () => {
  assert.ok(fn.indexOf("public.is_admin()") < fn.indexOf("for update"));
  const first = fn.indexOf("from public.schedules\n  where id = p_schedule_id\n  for update;");
  const second = fn.indexOf("from public.schedule_series\n  where id = v_schedule.series_id\n  for update;");
  assert.ok(first > 0 && second > first);
  assert.ok(fn.includes("errcode = '42501'") && fn.includes("errcode = 'P0002'"));
});

test("0063 checks THIS version's sessions, then 'later_version', then branches on whether other versions remain - after the locks", () => {
  const lock = fn.indexOf("from public.schedule_series\n  where id = v_schedule.series_id\n  for update;");
  const own = fn.indexOf("from public.class_sessions\n  where schedule_id = p_schedule_id;");
  const later = fn.indexOf("detail = 'later_version'");
  const branch = fn.indexOf("if v_others > 0 then");
  assert.ok(lock > 0 && own > lock && later > own && branch > later);
  assert.ok(!fn.includes("join public.schedules s on s.id = cs.schedule_id"), "no series-wide session count");
  assert.ok(fn.includes("(s.effective_from, s.created_at, s.id) > (v_schedule.effective_from, v_schedule.created_at, v_schedule.id)"));
  assert.ok(fn.includes("detail = 'sessions'") && fn.includes("errcode = '22023'"));
});

test("0063: with other versions remaining only the schedule row is deleted - never the series or an assignment; the last version keeps its old rules", () => {
  const others = fn.slice(fn.indexOf("if v_others > 0 then"), fn.indexOf("\n  else\n"));
  assert.match(others, /delete from public\.schedules\s+where id = p_schedule_id;/);
  assert.ok(!others.includes("enrollment_schedules") && !others.includes("schedule_series"), "the series and its assignments stay");
  const last = fn.slice(fn.indexOf("\n  else\n"));
  assert.ok(last.includes("public.schedule_usage(p_schedule_id, v_today)"));
  assert.ok(last.includes("started_assignment_count") && last.includes("detail = 'started_assignments'"));
  assert.ok(last.includes("delete from public.enrollment_schedules") && last.includes("effective_start_date >= v_today"));
  assert.ok(last.includes("delete from public.schedule_series ss") && last.includes("not exists (select 1 from public.schedules s where s.series_id = ss.id)"));
});

test("0063 never looks at the schedule's status", () => {
  assert.doesNotMatch(fn, /\bstatus\b/);
});

// ---- the app -----------------------------------------------------------------------------------------------------------------------------

test("the delete impact read keeps editMode from the series-wide test and takes canDelete / blockReason from the version decision", () => {
  const data = code("lib", "schedules", "data.js");
  const impact = data.slice(data.indexOf("export async function getScheduleDeleteImpact("), data.indexOf("export async function getRepresentativeSchedulesForSeries"));
  assert.ok(impact.includes('.from("class_sessions")') && impact.includes('.eq("schedule_id", scheduleId)'));
  assert.ok(impact.includes('.eq("series_id", facts.seriesId)'));
  assert.ok(impact.includes("const usage = evaluateScheduleUsage(facts);"));
  assert.match(impact, /return \{ \.\.\.usage, canDelete: deletion\.canDelete, blockReason: deletion\.blockReason, deletion \};/);
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(impact), "read only");
});

test("the dialog explains that only the latest version goes, that earlier versions and assignments remain, and when the class will end; the old warnings stay", () => {
  const dialog = code("app", "schedule", "delete-schedule-dialog.js");
  assert.ok(dialog.includes("Only the latest version is deleted"));
  assert.match(dialog, /and the students assigned to this class\s*will remain\./);
  assert.ok(dialog.includes("The class will end earlier") && dialog.includes("formatDate(deletion.previousEndDate)"));
  assert.match(dialog, /\{seriesContinues && deletion\.previousEndDate \? \(/);
  // The unstarted-assignment warning only applies when the series goes with the schedule.
  assert.match(dialog, /\{!seriesContinues && impact\.affectedStudentCount > 0 \? \(/);
  assert.ok(dialog.includes("describeUnrecordedPastOccurrences(impact.unrecordedPastOccurrenceCount)"));
  // The blocked state shows the actual reason, including a later version.
  assert.ok(dialog.includes("description={describeBlockReason(blockReason)}"));
  assert.ok(dialog.includes('blockReason === "later_version"'));
});

test("deleteSchedule still goes only through the database function and maps its reasons", () => {
  const actions = code("lib", "schedules", "actions.js");
  assert.ok(actions.includes('supabase.rpc("delete_unused_schedule", { p_schedule_id: id })'));
  assert.ok(actions.includes("blockReasonFromError(error)"));
  assert.ok(!/from\("schedules"\)\s*\.delete\(/.test(actions), "no direct table delete");
});
