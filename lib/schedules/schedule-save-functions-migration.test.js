// Run with `npm test` (Node's built-in test runner).
//
// Migration 0061 (atomic Edit Schedule saves): what its SQL says, what the verification script covers, and how the application is wired
// to it. These are source pins: the behaviour itself - that a refusal rolls every write back, the lock order, the versioning - is
// exercised by supabase/verification/verify_0061_schedule_save_functions_behavior.sql against a real database. Nothing here shows
// the SQL runs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EFFECTIVE_FROM_PAST_MESSAGE } from "./save-errors.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0061_schedule_save_functions.sql");
const script = read("supabase/verification/verify_0061_schedule_save_functions_behavior.sql");
const code = sql.replace(/^\s*--.*$/gm, "");
const actions = read("lib/schedules/actions.js").replace(/^\s*\/\/.*$/gm, "");

// The body of one function, from its CREATE to the end of its dollar-quoted block.
function body(name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return code.slice(start, code.indexOf("$$;", start));
}
const edit = body("save_schedule_edit");
const direct = body("save_unused_schedule_edit");
const extras = body("schedule_add_extra_days");
const apply = body("schedule_series_apply_capacity");

// The parameter names a function declares, in order.
function sqlParameters(name) {
  const match = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`).exec(code);
  assert.ok(match, name);
  return match[1].split(",").map((part) => part.trim().split(/\s+/)[0]);
}
// The keys an action sends to supabase.rpc(name, {...}), in order.
function rpcKeys(name) {
  const match = new RegExp(`supabase\\.rpc\\("${name}", \\{([\\s\\S]*?)\\}\\);`).exec(actions);
  assert.ok(match, `rpc ${name}`);
  return [...match[1].matchAll(/(p_\w+):/g)].map((m) => m[1]);
}

// ---- scope -----------------------------------------------------------------------------------------------------------------------

test("0061 is additive: functions only - no table, column, policy, trigger or drop - and it replaces nothing of 0060 or 0021", () => {
  assert.doesNotMatch(code, /\b(create|alter|drop) (table|trigger|policy|index|type)\b|\badd column\b|\bdrop (function|column|constraint)\b/i);
  assert.doesNotMatch(code, /create or replace function public\.(correct_unused_schedule|delete_unused_schedule|schedule_series_capacity_guard|schedule_series_occupied_places|create_enrollment|change_enrollment)\b/);
  assert.equal((code.match(/create or replace function/g) ?? []).length, 4);
});

test("it refuses to run without the functions and column it builds on", () => {
  assert.match(code, /to_regprocedure\('public\.correct_unused_schedule\(uuid, text, uuid, time without time zone, time without time zone, date, date\)'\) is null/);
  assert.match(code, /column_name = 'capacity'/);
  assert.match(code, /to_regprocedure\('public\.centre_timezone\(\)'\) is null or to_regprocedure\('public\.is_admin\(\)'\) is null/);
});

test("nothing of enrollments, sessions, attendance, memberships, payments or documents is touched", () => {
  assert.doesNotMatch(code, /enrollment|class_session|attendance|membership|payment|invoice|eligib/i);
});

// ---- security --------------------------------------------------------------------------------------------------------------------

test("all four functions are security definer with an empty search_path", () => {
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length, 4);
});

test("both save functions check the Admin first, before any lock or write, and are callable by signed-in users only", () => {
  for (const [name, fn, signature] of [
    ["save_schedule_edit", edit, "uuid, uuid, time, time, date, date, boolean, integer, text[]"],
    ["save_unused_schedule_edit", direct, "uuid, text, uuid, time, time, date, date, boolean, integer, text[]"],
  ]) {
    const admin = fn.indexOf("if not public.is_admin() then\n    raise exception 'Not authorized.' using errcode = '42501';");
    assert.ok(admin > 0 && admin < fn.indexOf("for update"), `${name}: admin check before the first lock`);
    assert.ok(code.includes(`revoke execute on function public.${name}(${signature}) from public, anon;`), `${name} revoke`);
    assert.ok(code.includes(`grant execute on function public.${name}(${signature}) to authenticated;`), `${name} grant`);
  }
});

test("the two helpers are not callable by anyone but the functions that call them", () => {
  assert.ok(code.includes("revoke execute on function public.schedule_series_apply_capacity(uuid, boolean, integer) from public, anon, authenticated;"));
  assert.ok(code.includes("revoke execute on function public.schedule_add_extra_days(uuid, uuid, time, time, date, date, integer, text, text[]) from public, anon, authenticated;"));
  assert.doesNotMatch(code, /grant execute on function public\.schedule_(series_apply_capacity|add_extra_days)/);
});

// ---- the application is wired to exactly these signatures --------------------------------------------------------------------------

test("the application sends exactly the parameters each function declares, in order", () => {
  assert.deepEqual(rpcKeys("save_schedule_edit"), sqlParameters("save_schedule_edit"));
  assert.deepEqual(rpcKeys("save_unused_schedule_edit"), sqlParameters("save_unused_schedule_edit"));
});

test("an explicit 'unlimited' differs from an omitted capacity: the flag is separate from the value", () => {
  assert.match(actions, /p_set_capacity: capacityResult\.data\.provided,\s+p_capacity: capacityResult\.data\.value,/);
  assert.match(actions, /p_set_capacity: capacity\.provided,\s+p_capacity: capacity\.value,/);
  assert.match(apply, /if coalesce\(p_set, false\) then\s+update public\.schedule_series\s+set capacity = p_capacity/);
  assert.match(apply, /and capacity is distinct from p_capacity;/);
});

// ---- Edit Schedule (versioned or in place) ------------------------------------------------------------------------------------------

test("save_schedule_edit repeats the not-in-the-past rule with the application's own words", () => {
  assert.ok(edit.includes(`raise exception '${EFFECTIVE_FROM_PAST_MESSAGE}' using errcode = '22023';`));
  assert.match(edit, /if p_effective_from < v_today then/);
  assert.match(edit, /v_today\s+date := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/);
  assert.match(edit, /raise exception 'Schedule not found\.' using errcode = 'P0002';/);
});

test("save_schedule_edit versions exactly as the application did: in place when the date is on or before the current start, else close the day before and continue the SAME series", () => {
  assert.match(edit, /if p_effective_from <= v_schedule\.effective_from then/);
  // The two branches, by their structure (the pins read the SQL with its comments removed).
  const branchStart = edit.indexOf("if p_effective_from <= v_schedule.effective_from then");
  const elseAt = edit.indexOf("  else", branchStart);
  const endIf = edit.indexOf("end if;", elseAt);
  assert.ok(branchStart > 0 && elseAt > branchStart && endIf > elseAt, "an if/else with an in-place branch and a versioned branch");
  const inPlace = edit.slice(branchStart, elseAt);
  assert.match(inPlace, /update public\.schedules\s+set instructor_id\s+= p_instructor_id,\s+start_time\s+= p_start_time,\s+end_time\s+= p_end_time,\s+effective_from\s+= p_effective_from,\s+effective_until = p_effective_until,/);
  assert.doesNotMatch(inPlace, /insert into/, "no new version in place");
  const versioned = edit.slice(elseAt, endIf);
  assert.match(versioned, /set effective_until = p_effective_from - 1/);
  assert.match(versioned, /values \(v_schedule\.batch_id, p_instructor_id, v_schedule\.day_of_week, p_start_time, p_end_time, p_effective_from, p_effective_until, v_schedule\.series_id\)/);
  // The status is not written: a new version takes the table's default, as the application's insert did.
  assert.doesNotMatch(versioned, /status/);
});

test("save_schedule_edit changes the capacity before the schedule and creates the extra days last, inheriting the capacity being saved", () => {
  const apply = edit.indexOf("schedule_series_apply_capacity(");
  const firstScheduleWrite = edit.indexOf("update public.schedules");
  const extrasCall = edit.indexOf("schedule_add_extra_days(");
  assert.ok(apply > 0 && apply < firstScheduleWrite && firstScheduleWrite < extrasCall, "capacity, then schedule, then extras");
  assert.match(edit, /v_inherit, v_schedule\.day_of_week, p_extra_days/);
  assert.match(edit, /return jsonb_build_object\('id', v_saved, 'ids', v_ids, 'added', v_added\);/);
});

// ---- Direct Edit ---------------------------------------------------------------------------------------------------------------------

test("save_unused_schedule_edit delegates the correction to the existing function with its seven arguments, in its transaction", () => {
  assert.match(direct, /perform public\.correct_unused_schedule\(\s+p_schedule_id, p_day_of_week, p_instructor_id, p_start_time, p_end_time, p_effective_from, p_effective_until\s+\);/);
  const capacity = direct.indexOf("schedule_series_apply_capacity(");
  const correction = direct.indexOf("perform public.correct_unused_schedule(");
  const extrasCall = direct.indexOf("schedule_add_extra_days(");
  assert.ok(capacity > 0 && capacity < correction && correction < extrasCall, "capacity, then the correction, then extras");
  assert.match(direct, /v_inherit, p_day_of_week, p_extra_days/);
  assert.match(direct, /return jsonb_build_object\('id', p_schedule_id, 'batch_id', v_schedule\.batch_id, 'added', v_added\);/);
  // Its own checks stay: it is not wrapped in anything that would swallow correct_unused_schedule's errors.
  assert.doesNotMatch(direct, /exception\s+when/i);
});

// ---- all or nothing -------------------------------------------------------------------------------------------------------------------

test("no function catches an error, so any failure aborts the whole call and rolls back every write", () => {
  assert.doesNotMatch(code, /\bexception\s+when\b/i);
  assert.doesNotMatch(code, /\b(commit|rollback|savepoint)\b/i);
});

test("extra days: each gets its own series and schedule, a repeated day once; the own day or an empty day is refused (22023)", () => {
  assert.match(extras, /insert into public\.schedule_series \(batch_id, capacity\)\s+values \(p_batch_id, p_capacity\)/);
  assert.match(extras, /insert into public\.schedules \(batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, series_id\)/);
  assert.match(extras, /continue when v_day = any\(v_done\);/);
  assert.match(extras, /raise exception 'An extra day cannot be this schedule''s own day\.' using errcode = '22023';/);
  assert.match(extras, /raise exception 'Select valid days of the week\.' using errcode = '22023';/);
});

// ---- locking -----------------------------------------------------------------------------------------------------------------------------

test("lock order: the schedule row first, then its series - the order correct_unused_schedule and delete_unused_schedule use", () => {
  for (const [name, fn, level] of [["save_schedule_edit", edit, "for no key update"], ["save_unused_schedule_edit", direct, "for update"]]) {
    const schedule = fn.indexOf("from public.schedules\n  where id = p_schedule_id\n  for update;");
    const series = fn.indexOf(`from public.schedule_series\n  where id = v_schedule.series_id\n  ${level};`);
    assert.ok(schedule > 0 && series > schedule, `${name}: schedules row, then series (${level})`);
    assert.ok(series < fn.indexOf("schedule_series_apply_capacity("), `${name}: both locks before the first write`);
  }
});

test("lock levels: the versioned edit changes only the capacity so it takes NO KEY UPDATE (the enrollment functions' level); Direct Edit takes FOR UPDATE like correct_unused_schedule, so delegating needs no upgrade", () => {
  assert.doesNotMatch(edit, /schedule_series\s+where id = v_schedule\.series_id\s+for update/);
  assert.match(direct, /from public\.schedule_series\s+where id = v_schedule\.series_id\s+for update;/);
  // The existing functions this order is modelled on.
  const existing = read("supabase/migrations/0024_center_regional_settings.sql");
  const correct = existing.slice(existing.indexOf("create or replace function public.correct_unused_schedule"));
  assert.ok(correct.indexOf("from public.schedules\n  where id = p_schedule_id\n  for update;") < correct.indexOf("from public.schedule_series\n  where id = v_schedule.series_id\n  for update;"));
});

test("the header documents the lock order and why it is safe, and the READ COMMITTED condition", () => {
  assert.match(sql, /LOCK ORDER \(READ COMMITTED/);
  assert.match(sql, /the lock graph has no cycle/);
  assert.match(sql, /This is analysis, not a measurement/);
});

// ---- the verification script -------------------------------------------------------------------------------------------------------------

test("the verification script is rollback-only, runs nothing when 0061 is missing, and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.doesNotMatch(script, /disable trigger/i);
  assert.match(script, /P0 migration 0061 is applied/);
  for (const id of [
    "P0", "PF", "A1", "A2", "V1", "V2", "V3", "V4", "C1", "C2", "C3", "C4", "C5", "E1", "E2", "E3", "E4", "E5", "E6", "E7",
    "D1", "D2", "D3", "D4", "D5", "D6", "Z",
  ]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /CONCURRENCY IS NOT TESTED HERE/);
  assert.match(script, /two psql sessions at the default READ COMMITTED \(not two SQL editor tabs/);
  assert.match(script, /student_code sequence/);
  assert.match(script, /leftover_students/);
});

test("the verification script proves a refused call changed nothing by comparing every column before and after", () => {
  assert.match(script, /create function pg_temp\.shape\(p_batch uuid\)/);
  assert.match(script, /to_jsonb\(s\)::text/);
  assert.ok((script.match(/pg_temp\.shape\(b\) = snap/g) ?? []).length >= 8);
  // A call is made first and judged after - never inside the same AND as the digest comparison.
  assert.doesNotMatch(script, /pg_temp\.call_as\([^;]*\)\s+like\s+[^;]*\band\b\s+pg_temp\.shape/);
});
