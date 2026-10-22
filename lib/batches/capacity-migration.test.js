// Run with `npm test` (Node's built-in test runner).
//
// Migration 0059 (batch capacity): what its SQL says and what the verification script covers. These are source pins: the behaviour
// itself is exercised by supabase/verification/verify_0059_batch_capacity_behavior.sql against a real database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchKnownJoinDateError } from "../students/join-date.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0059_batch_capacity.sql");
const script = read("../../supabase/verification/verify_0059_batch_capacity_behavior.sql");
const sql0051 = read("../../supabase/migrations/0051_enrollment_membership_date_rules.sql");
const code = sql.replace(/^\s*--.*$/gm, "");

// The body of one function, from its CREATE to the end of its dollar-quoted block.
function body(name) {
  const start = code.indexOf(`create or replace function public.${name}()`);
  assert.ok(start >= 0, name);
  return code.slice(start, code.indexOf("$$;", start));
}
const enrollmentGuard = body("batch_enrollments_capacity_guard");
const capacityGuard = body("batches_capacity_guard");

test("0059 is additive: one nullable column, no rewritten migration, no data change, no new table, policy or grant", () => {
  assert.match(code, /alter table public\.batches\s+add column if not exists capacity integer;/);
  assert.doesNotMatch(code, /capacity integer not null|set default/i);
  assert.doesNotMatch(code, /\bdrop (table|function|policy|column|constraint)\b/i);
  assert.doesNotMatch(code, /\b(insert into|delete from)\b/i);
  assert.doesNotMatch(code, /\bupdate public\.\w+/i);
  assert.doesNotMatch(code, /create (table|policy)|\bgrant\b|row level security/i);
});

test("it refuses to run without the batch and enrollment tables and centre_timezone()", () => {
  assert.match(code, /to_regclass\('public\.batches'\) is null or to_regclass\('public\.batch_enrollments'\) is null/);
  assert.match(code, /to_regprocedure\('public\.centre_timezone\(\)'\) is null/);
});

test("capacity is NULL (unlimited) or a whole number from 1 to 1000", () => {
  assert.match(code, /add constraint batches_capacity_valid\s+check \(capacity is null or capacity between 1 and 1000\)/);
});

test("occupancy: an active enrollment with no end date or ending on or after the centre's today - in both guards", () => {
  for (const guard of [enrollmentGuard, capacityGuard]) {
    assert.match(guard, /v_today\s+date := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/);
    assert.match(guard, /be\.status = 'active'\s+and \(be\.effective_end_date is null or be\.effective_end_date >= v_today\)/);
  }
});

test("occupancy ignores the student's status, memberships, payments, attendance and eligibility", () => {
  assert.doesNotMatch(code, /public\.students|memberships|payment|attendance|class_session|eligib|enrollment_schedules/i);
});

test("the enrollment guard fires on insert and on a change of status, batch or end date, and checks only writes that take a place", () => {
  assert.match(code, /before insert or update of status, batch_id, effective_end_date on public\.batch_enrollments/);
  // A write after which the enrollment occupies no place is never refused.
  assert.match(enrollmentGuard, /if new\.status <> 'active' or \(new\.effective_end_date is not null and new\.effective_end_date < v_today\) then\s+return new;/);
  // An enrollment that already held a place in the same batch takes no new one.
  assert.match(
    enrollmentGuard,
    /tg_op = 'UPDATE' and new\.batch_id = old\.batch_id and old\.status = 'active'\s+and \(old\.effective_end_date is null or old\.effective_end_date >= v_today\) then\s+return new;/,
  );
});

test("the enrollment guard locks the batch row before it counts, never counts itself, and refuses at capacity", () => {
  const lock = enrollmentGuard.indexOf("from public.batches b where b.id = new.batch_id for no key update;");
  const count = enrollmentGuard.indexOf("select count(*) into v_occupied");
  assert.ok(lock > 0 && count > lock, "lock before count");
  assert.ok(enrollmentGuard.indexOf("if v_capacity is null then") > lock, "NULL capacity is unlimited");
  assert.match(enrollmentGuard, /be\.id <> new\.id/);
  assert.match(enrollmentGuard, /if v_occupied >= v_capacity then\s+raise exception 'The batch is full \(% of % places taken\)\./);
});

test("the capacity guard fires on a capacity change only, refuses only a value below the places taken, and leaves invalid values to the CHECK", () => {
  assert.match(code, /before update of capacity on public\.batches/);
  assert.match(capacityGuard, /if new\.capacity is null or new\.capacity < 1 or new\.capacity is not distinct from old\.capacity then\s+return new;/);
  assert.match(capacityGuard, /be\.batch_id = new\.id/);
  assert.match(capacityGuard, /if v_occupied > new\.capacity then\s+raise exception 'The capacity cannot be lowered to % because % places are taken\./);
  // Nothing is removed or deactivated to make room.
  assert.doesNotMatch(capacityGuard, /\bupdate\b|\bdelete\b/i);
});

test("both refusals are 23514 with messages the application can tell apart from the join-date rules", () => {
  assert.equal((code.match(/using errcode = '23514'/g) ?? []).length, 2);
  for (const message of [
    "The batch is full (2 of 2 places taken). Increase the batch capacity, or end or deactivate another enrollment, first.",
    "The capacity cannot be lowered to 2 because 3 places are taken. Set it to 3 or more, or end or deactivate enrollments first.",
  ]) {
    assert.equal(matchKnownJoinDateError({ code: "23514", message }), null, message);
  }
});

test("the guards are security definer with an empty search_path and are not callable by clients", () => {
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length, 2);
  assert.equal((code.match(/revoke execute on function public\.\w+\(\) from public, anon, authenticated/g) ?? []).length, 2);
});

test("lock order: the capacity trigger fires before the 0051 join-date trigger (BEFORE triggers fire in name order)", () => {
  // The names as each migration actually creates them on batch_enrollments - not fixed strings.
  const triggerOn = (text) =>
    [...text.replace(/^\s*--.*$/gm, "").matchAll(/create trigger (\w+)\s+before insert or update of [\w, ]+ on public\.batch_enrollments/g)].map((m) => m[1]);
  const [capacityTrigger] = triggerOn(sql);
  const [joinDateTrigger] = triggerOn(sql0051);
  assert.equal(capacityTrigger, "batch_enrollments_capacity_guard_trigger");
  assert.equal(joinDateTrigger, "batch_enrollments_join_date_guard_trigger");
  assert.ok(capacityTrigger < joinDateTrigger, `${capacityTrigger} must sort before ${joinDateTrigger}`);
  // 0051's guard is the one that takes the student row FOR SHARE: batch first, then student, never the other way round.
  assert.match(sql0051, /where s\.id = new\.student_id for share/);
  assert.doesNotMatch(sql0051.replace(/^\s*--.*$/gm, ""), /public\.batches/);
  assert.match(sql, /READ COMMITTED/);
});

test("the verification script is rollback-only, runs nothing when 0059 is missing, and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.doesNotMatch(script, /disable trigger/i);
  assert.match(script, /P0 migration 0059 is applied/);
  for (const id of [
    "V2", "V4", "V5", "V6", "V7", "V8", "N1", "F2", "F3", "F4", "O1", "O2", "O4", "O5", "O6", "R1", "R2", "R3", "M1", "M2",
    "X1", "X2", "X3", "X4", "X5", "U1", "U2", "U3", "U4", "T1", "T2", "T3", "C1", "C2", "C3", "C4",
    "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "A1", "Z",
  ]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /CONCURRENCY IS NOT TESTED HERE/);
  assert.match(script, /leftover_students/);
});

test("the verification script states what it really exercises: U1 does not fire the trigger; multi-row and combined writes are covered", () => {
  assert.match(script, /'U1 [^']*the capacity trigger does not fire for it/);
  // T1 and T3 are single statements over several rows; C1 and C3 change two occupancy columns in one UPDATE.
  assert.match(script, /values \(%L, %L, %L\), \(%L, %L, %L\), \(%L, %L, %L\)/);
  assert.match(script, /update public\.batch_enrollments set batch_id = %L where batch_id = %L/);
  assert.match(script, /set status = ''active'', batch_id = %L where id = %L/);
  assert.match(script, /set batch_id = %L, effective_end_date = null where id = %L/);
});

test("the manual concurrency procedure uses the centre's date, respects the join date and is READ COMMITTED only", () => {
  const procedure = script.slice(script.indexOf("CONCURRENCY IS NOT TESTED HERE"), script.indexOf("OUTPUT:"));
  assert.match(procedure, /select \(now\(\) at time zone public\.centre_timezone\(\)\)::date/);
  assert.match(procedure, /join_date is on or before the\s+--\s+centre's date/);
  assert.match(procedure, /READ\s+--\s+COMMITTED only/);
  assert.doesNotMatch(procedure, /values \([^)]*current_date\)/);
  assert.match(procedure, /never REPEATABLE READ/);
});
