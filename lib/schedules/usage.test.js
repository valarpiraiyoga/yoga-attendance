// Run with `npm test` (Node's built-in test runner — no extra dependency).
//
// The decision matrix for deleting and directly editing a schedule
// (01-product.md §7 "Unused Schedules — Direct Correction and Deletion").
//
// WHAT THIS FILE CAN AND CANNOT PROVE. The facts (session / version /
// assignment counts, "today") are computed by the database function
// `schedule_usage`, and the delete / direct edit are enforced by
// `delete_unused_schedule` / `correct_unused_schedule` (0021). There is no test
// database in this project, so:
//   - the rule's mapping from facts to "may delete / edit directly / why not"
//     and the wording are tested here as pure functions;
//   - the SQL is pinned by reading the migration (locks, order, centre date,
//     no table DELETE grant) — this guards regressions, it does not run it;
//   - the SQL itself was run against a real Postgres engine (PGlite) when the
//     feature was built (see the feature report) and is re-verified manually
//     against the project's own database — see "Manual DB QA" in that report.
// Cases that need a database are marked NEEDS DB below.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NOT_UNUSED_ERROR_CODES,
  blockReasonFromError,
  describeAffectedStudents,
  describeBlockReason,
  describeUnrecordedPastOccurrences,
  evaluateScheduleUsage,
  usageFromRpc,
} from "./usage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

// A `schedule_usage` payload for an unused schedule; each case overrides what differs.
const rpc = (over = {}) => ({
  schedule_id: "s1",
  series_id: "ser1",
  batch_id: "b1",
  day_of_week: "tuesday",
  start_time: "07:00:00",
  end_time: "08:00:00",
  session_count: 0,
  version_count: 1,
  started_assignment_count: 0,
  unstarted_assignment_count: 0,
  affected_student_count: 0,
  unrecorded_past_occurrence_count: 0,
  today: "2026-09-22",
  ...over,
});
const decide = (over) => evaluateScheduleUsage(usageFromRpc(rpc(over)));

test("1: an unused single-version schedule → edit directly, delete allowed", () => {
  const d = decide();
  assert.equal(d.canDelete, true);
  assert.equal(d.blockReason, null);
  assert.equal(d.editMode, "direct");
});

test("2: an unused future schedule → edit directly, delete allowed (nothing has elapsed)", () => {
  const d = decide({ unrecorded_past_occurrence_count: 0 });
  assert.equal(d.canDelete, true);
  assert.equal(d.editMode, "direct");
  assert.equal(d.unrecordedPastOccurrenceCount, 0);
});

test("3: unused with unstarted assignments → delete allowed, students counted, still edited directly", () => {
  const d = decide({ unstarted_assignment_count: 3, affected_student_count: 2 });
  assert.equal(d.canDelete, true);
  assert.equal(d.editMode, "direct");
  assert.equal(d.unstartedAssignmentCount, 3);
  assert.equal(d.affectedStudentCount, 2);
  assert.equal(describeAffectedStudents(2), "2 students are assigned to this schedule.");
  assert.equal(describeAffectedStudents(1), "1 student is assigned to this schedule.");
});

test("4/5/6: any class session blocks delete and direct edit — the rule counts sessions of every status", () => {
  // The database cannot tell the rule a session's status: one session row of ANY kind
  // (scheduled with no attendance, cancelled, holiday, completed with attendance) is sessionCount 1.
  const d = decide({ session_count: 1 });
  assert.equal(d.canDelete, false);
  assert.equal(d.blockReason, "sessions");
  assert.equal(d.editMode, "versioned");

  // NEEDS DB (verified on PGlite, re-verify manually): cancelled / holiday / completed+attendance rows
  // all produce session_count > 0 — pinned here by the SQL not filtering on status.
  const sql = read("supabase", "migrations", "0021_delete_unused_schedules.sql");
  const usageFn = sql.slice(sql.indexOf("create or replace function public.schedule_usage("), sql.indexOf("comment on function public.schedule_usage"));
  assert.match(usageFn, /from public\.class_sessions cs\s+join public\.schedules s on s\.id = cs\.schedule_id\s+where s\.series_id = v_schedule\.series_id;/);
  assert.ok(!/cs\.status/.test(usageFn), "session count must not filter by session status");
});

test("7: a started assignment blocks delete and direct edit", () => {
  const d = decide({ started_assignment_count: 1 });
  assert.equal(d.canDelete, false);
  assert.equal(d.blockReason, "started_assignments");
  assert.equal(d.editMode, "versioned");
});

test("8: more than one schedule version blocks delete and direct edit", () => {
  const d = decide({ version_count: 2 });
  assert.equal(d.canDelete, false);
  assert.equal(d.blockReason, "versions");
  assert.equal(d.editMode, "versioned");
});

test("9: elapsed unrecorded occurrences do not block delete — the count is returned for the warning", () => {
  const d = decide({ unrecorded_past_occurrence_count: 3 });
  assert.equal(d.canDelete, true);
  assert.equal(d.editMode, "direct");
  assert.equal(d.unrecordedPastOccurrenceCount, 3);
  assert.equal(
    describeUnrecordedPastOccurrences(3),
    "3 past occurrences were never recorded and will no longer appear after this schedule is deleted."
  );
  assert.equal(
    describeUnrecordedPastOccurrences(1),
    "1 past occurrence was never recorded and will no longer appear after this schedule is deleted."
  );
  // It must never claim attendance existed.
  assert.ok(!/attendance/i.test(describeUnrecordedPastOccurrences(3)));
});

test("the first failing condition is the reported reason: sessions, then versions, then started assignments", () => {
  assert.equal(decide({ session_count: 2, version_count: 3, started_assignment_count: 4 }).blockReason, "sessions");
  assert.equal(decide({ version_count: 3, started_assignment_count: 4 }).blockReason, "versions");
  assert.equal(decide({ started_assignment_count: 4 }).blockReason, "started_assignments");
});

test("unstarted assignments and past occurrences never change the decision on their own", () => {
  const d = decide({ unstarted_assignment_count: 5, affected_student_count: 5, unrecorded_past_occurrence_count: 40 });
  assert.equal(d.canDelete, true);
  assert.equal(d.editMode, "direct");
});

test("blocked wording explains what must be preserved and never offers delete", () => {
  assert.match(describeBlockReason("sessions"), /recorded\/materialized session history and must be preserved/);
  assert.match(describeBlockReason("versions"), /earlier versions/);
  assert.match(describeBlockReason("started_assignments"), /assigned to this schedule/);
  assert.match(describeBlockReason(undefined), /session history/); // unknown → the safest message
});

test("a write function's refusal is read from the error", () => {
  assert.equal(blockReasonFromError({ code: "22023", details: "versions" }), "versions");
  assert.equal(blockReasonFromError({ code: "22023", details: "started_assignments" }), "started_assignments");
  assert.equal(blockReasonFromError({ code: "23001" }), "sessions", "the foreign-key backstop reads as session history");
  for (const code of ["22023", "23001", "23503"]) assert.ok(NOT_UNUSED_ERROR_CODES.has(code));
  assert.ok(!NOT_UNUSED_ERROR_CODES.has("42501"), "an authorization failure is not 'not deletable'");
});

test("counts are numbers even when the RPC returns strings", () => {
  const facts = usageFromRpc(rpc({ session_count: "0", version_count: "1", unrecorded_past_occurrence_count: "2" }));
  assert.equal(facts.sessionCount, 0);
  assert.equal(facts.versionCount, 1);
  assert.equal(facts.unrecordedPastOccurrenceCount, 2);
});

// ---- 10: centre time -------------------------------------------------------------------------------

test("10: the business date is the centre's (Asia/Kolkata); started = before today, unstarted = today or later", () => {
  const sql = read("supabase", "migrations", "0021_delete_unused_schedules.sql");
  assert.ok(sql.includes("(now() at time zone 'Asia/Kolkata')::date"));
  assert.ok(!/current_date|localtimestamp|at time zone 'utc'/i.test(sql), "no UTC / server-date business logic");

  // The same boundary 0020 uses to decide which assignments may be withdrawn (start >= today).
  assert.ok(sql.includes("count(*) filter (where es.effective_start_date <  v_today)"), "started = starts before today");
  assert.ok(sql.includes("count(*) filter (where es.effective_start_date >= v_today)"), "unstarted = starts today or later");
  const earlier = read("supabase", "migrations", "0020_withdraw_unstarted_schedule_assignments.sql");
  assert.ok(earlier.includes("effective_start_date >= (timezone('Asia/Kolkata', now()))::date"));
  assert.ok(sql.includes("where schedule_series_id = v_schedule.series_id\n    and effective_start_date >= v_today;"));

  // The application never supplies a date to the write functions.
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(!/delete_unused_schedule", \{[^}]*p_today/.test(actions));
});

// ---- 11: race protection and privileges --------------------------------------------------------------

test("11: the write functions lock the schedule then its series, then re-check before writing", () => {
  const sql = read("supabase", "migrations", "0021_delete_unused_schedules.sql");
  for (const name of ["delete_unused_schedule(p_schedule_id uuid)", "correct_unused_schedule("]) {
    const start = sql.indexOf(`create or replace function public.${name}`);
    const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start + 10) + 2));
    const lockSchedule = body.indexOf("where id = p_schedule_id\n  for update;");
    const lockSeries = body.indexOf("from public.schedule_series\n  where id = v_schedule.series_id\n  for update;");
    const recheck = body.indexOf("public.schedule_usage(p_schedule_id, v_today)");
    const firstWrite = Math.min(...["delete from", "update public.schedules"].map((w) => body.indexOf(w)).filter((i) => i >= 0));
    assert.ok(lockSchedule > 0 && lockSeries > lockSchedule, `${name}: schedule locked, then series`);
    assert.ok(recheck > lockSeries, `${name}: re-check happens after both locks`);
    assert.ok(firstWrite > recheck, `${name}: nothing is written before the re-check`);
    assert.ok(body.includes("public.is_admin()"), `${name}: admin only`);
    for (const reason of ["sessions", "versions", "started_assignments"]) {
      assert.ok(body.includes(`detail = '${reason}'`), `${name}: refuses with reason ${reason}`);
    }
  }
});

test("11: no table-level DELETE is granted; the functions are executable by signed-in users only", () => {
  const sql = read("supabase", "migrations", "0021_delete_unused_schedules.sql");
  assert.ok(!/grant\s+[^;]*\bdelete\b[^;]*\bon\b/i.test(sql.replace(/--.*$/gm, "")), "no GRANT … DELETE");
  assert.ok(!/create policy/i.test(sql.replace(/--.*$/gm, "")), "no new RLS policy");
  for (const fn of ["schedule_usage(uuid, date)", "delete_unused_schedule(uuid)", "correct_unused_schedule(uuid, text, uuid, time, time, date, date)"]) {
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `${fn} granted to authenticated`);
    assert.ok(sql.includes(`revoke execute on function public.${fn} from public, anon;`), `${fn} revoked from anon/public`);
  }
});

test("11: the server action only ever deletes through the locked database function", () => {
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(actions.includes('supabase.rpc("delete_unused_schedule"'));
  assert.ok(actions.includes('supabase.rpc("correct_unused_schedule"'));
  assert.ok(!/from\("schedules"\)\s*\.delete\(/.test(actions), "no direct table delete");
  // Every write path is admin-gated before it reaches the database.
  for (const fn of ["deleteSchedule", "previewScheduleDelete"]) {
    const start = actions.indexOf(`export async function ${fn}(`);
    assert.ok(actions.slice(start, start + 200).includes("await requireRole(ROLES.ADMIN);"), `${fn} requires admin`);
  }
});

test("a schedule that gained history after the dialog opened is refused, not deleted (server-side re-check is authoritative)", () => {
  // The dialog's preview and the delete are separate calls; only the latter decides. The action turns the
  // database's refusal into the blocked state rather than trusting the earlier preview.
  const actions = read("lib", "schedules", "actions.js");
  const start = actions.indexOf("export async function deleteSchedule(");
  const body = actions.slice(start);
  assert.ok(/NOT_UNUSED_ERROR_CODES\.has\(error\.code\)[\s\S]*blocked: true/.test(body));
  assert.ok(!body.includes("getScheduleDeleteImpact"), "deleteSchedule does not consult the preview");

  const dialog = read("app", "schedule", "delete-schedule-dialog.js");
  assert.ok(/result\?\.blocked[\s\S]*setBlockedReason/.test(dialog), "the dialog switches to the blocked state");
});

// ---- wiring -------------------------------------------------------------------------------------------

test("the schedule menu offers Delete Schedule last, below a divider, as a destructive item", () => {
  const menu = read("app", "schedule", "schedule-card-menu.js");
  // Item labels, not the header comment: the JSX text sits after the `>` of each item.
  const at = (label) => menu.search(new RegExp(`\\n\\s+${label}\\n`));
  const view = at("View Schedule");
  const edit = at("Edit Schedule");
  const viewBatch = at("View Batch");
  const del = at("Delete Schedule");
  assert.ok(view > 0 && view < edit && edit < viewBatch && viewBatch < del, "View, Edit, View Batch, then Delete");
  assert.match(menu, /<DropdownMenuSeparator \/>\s*<DropdownMenuItem variant="destructive"/);
});

test("Edit Schedule frees the day only for a schedule the server calls unused", () => {
  const page = read("app", "schedule", "[id]", "edit", "page.js");
  assert.ok(page.includes("editMode={usage.editMode}"));
  const form = read("app", "schedule", "schedule-form.js");
  assert.ok(form.includes('const directEdit = Boolean(schedule) && editMode === "direct";'));
  assert.ok(form.includes("const lockedDay = schedule && !directEdit ? schedule.day_of_week : null;"));

  // The versioned path is unchanged: back-dating is still refused, and the direct path is taken first only when unused.
  const actions = read("lib", "schedules", "actions.js");
  assert.ok(actions.includes('if (usage.editMode === "direct") {'));
  assert.ok(actions.includes("Effective from cannot be in the past."));
  assert.ok(actions.indexOf('usage.editMode === "direct"') < actions.indexOf("Effective from cannot be in the past."));
});
