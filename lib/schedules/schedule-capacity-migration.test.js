// Run with `npm test` (Node's built-in test runner).
//
// Migration 0060 (schedule capacity, replacing 0059's batch capacity): what its SQL says and what the verification script covers.
// These are source pins: the behaviour itself is exercised by supabase/verification/verify_0060_schedule_capacity_behavior.sql
// against a real database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchKnownJoinDateError } from "../students/join-date.js";
import { validateScheduleChangeDate } from "../enrollments/validation.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0060_schedule_capacity.sql");
const script = read("../../supabase/verification/verify_0060_schedule_capacity_behavior.sql");
const code = sql.replace(/^\s*--.*$/gm, "");

// The body of one function, from its CREATE to the end of its dollar-quoted block.
function body(name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return code.slice(start, code.indexOf("$$;", start));
}

// ---- removing 0059's batch capacity ----------------------------------------------------------------------------------------

test("0059's batch capacity is removed only when no batch has one: checked under a table lock, before anything is dropped", () => {
  const start = code.indexOf("declare\n  v_set integer;");
  const end = code.indexOf("alter table public.schedule_series");
  assert.ok(start > 0 && end > start, "the 0059 removal block comes first");
  const block = code.slice(start, end);
  const lock = block.indexOf("lock table public.batches in access exclusive mode;");
  const count = block.indexOf("select count(*) from public.batches where capacity is not null");
  const abort = block.indexOf("raise exception '0060 stopped without changing anything");
  const firstDrop = block.indexOf("drop trigger if exists batch_enrollments_capacity_guard_trigger");
  assert.ok(lock > 0 && count > lock && abort > count && firstDrop > abort, "lock, count, abort, then drop");
  assert.match(block, /if v_set > 0 then/);
  // Never cleared or moved: no update of batches anywhere.
  assert.doesNotMatch(code, /update public\.batches\b/);
  for (const drop of [
    "drop trigger if exists batches_capacity_guard_trigger on public.batches;",
    "drop function if exists public.batch_enrollments_capacity_guard();",
    "drop function if exists public.batches_capacity_guard();",
    "alter table public.batches drop constraint if exists batches_capacity_valid;",
    "alter table public.batches drop column if exists capacity;",
  ]) {
    assert.ok(block.includes(drop), drop);
  }
  // The removal is the first thing that changes the database: no schedule capacity is added before it.
  assert.ok(code.indexOf("alter table public.batches drop column if exists capacity;") < code.indexOf("add column if not exists capacity integer"));
});

test("0059 itself is not edited by 0060's arrival (it still adds the batch capacity it always did)", () => {
  assert.match(read("../../supabase/migrations/0059_batch_capacity.sql"), /add column if not exists capacity integer;/);
});

// ---- the capacity ------------------------------------------------------------------------------------------------------------

test("schedule_series.capacity is nullable (unlimited) or a whole number from 1 to 1000", () => {
  assert.match(code, /alter table public\.schedule_series\s+add column if not exists capacity integer;/);
  assert.match(code, /add constraint schedule_series_capacity_valid\s+check \(capacity is null or capacity between 1 and 1000\)/);
  assert.doesNotMatch(code, /capacity integer not null|set default/i);
});

test("places taken: a current assignment of an active, current enrollment, on the centre's date - one definition", () => {
  const occupied = body("schedule_series_occupied_places");
  assert.match(occupied, /es\.schedule_series_id = p_series_id/);
  assert.match(occupied, /\(es\.effective_end_date is null or es\.effective_end_date >= p_today\)/);
  assert.match(occupied, /be\.status = 'active'/);
  assert.match(occupied, /\(be\.effective_end_date is null or be\.effective_end_date >= p_today\)/);
  // The student's status, memberships, payments and attendance play no part; the start date plays no part.
  assert.doesNotMatch(occupied, /students|membership|payment|attendance|effective_start_date/i);
  for (const name of ["schedule_series_capacity_check", "enrollment_schedules_capacity_check", "batch_enrollments_capacity_check", "schedule_series_capacity_guard", "change_enrollment"]) {
    assert.match(body(name), /v_today\s+date := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/, name);
  }
});

// ---- the checks ----------------------------------------------------------------------------------------------------------

test("the series check locks the series before it counts, and refuses only when the places taken EXCEED the capacity", () => {
  const check = body("schedule_series_capacity_check");
  const lock = check.indexOf("where ss.id = p_series_id for no key update;");
  const count = check.indexOf("v_occupied := public.schedule_series_occupied_places(p_series_id, v_today);");
  assert.ok(lock > 0 && count > lock, "lock before count");
  assert.match(check, /if not found or v_capacity is null then\s+return;/);
  assert.match(check, /if v_occupied > v_capacity then\s+raise exception 'The schedule is full \(capacity %\)\./);
  assert.match(check, /errcode = '23514'/);
  assert.match(check, /detail = format\('schedule_series_id=%s/);
});

test("the checks run at commit (deferrable, initially deferred) on every write that can take a place", () => {
  assert.match(code, /create constraint trigger enrollment_schedules_capacity_check\s+after insert or update of schedule_series_id, effective_end_date, batch_enrollment_id on public\.enrollment_schedules\s+deferrable initially deferred\s+for each row/);
  assert.match(code, /create constraint trigger batch_enrollments_capacity_check\s+after update of status, effective_end_date on public\.batch_enrollments\s+deferrable initially deferred\s+for each row/);
});

test("the checks re-read the row as it stands at commit and check only what then takes a place", () => {
  const assignment = body("enrollment_schedules_capacity_check");
  assert.match(assignment, /where es\.id = new\.id/);
  assert.doesNotMatch(assignment, /\bold\./);
  assert.match(assignment, /if found then\s+perform public\.schedule_series_capacity_check\(v_series\);/);
  const enrollment = body("batch_enrollments_capacity_check");
  assert.match(enrollment, /where be\.id = new\.id and be\.status = 'active'/);
  assert.doesNotMatch(enrollment, /\bold\./);
  assert.match(enrollment, /order by es\.schedule_series_id\s+loop\s+perform public\.schedule_series_capacity_check\(v_series\);/);
});

test("a capacity cannot be lowered below the places taken; invalid values are left to the CHECK; nothing is removed", () => {
  assert.match(code, /before update of capacity on public\.schedule_series/);
  const guard = body("schedule_series_capacity_guard");
  assert.match(guard, /if new\.capacity is null or new\.capacity < 1 or new\.capacity is not distinct from old\.capacity then\s+return new;/);
  assert.match(guard, /if v_occupied > new\.capacity then\s+raise exception 'The capacity cannot be lowered to % because % places are taken\./);
  assert.doesNotMatch(guard, /\b(update|delete|insert)\b/i);
});

// ---- the atomic enrollment functions ---------------------------------------------------------------------------------------

test("both functions are Admin only and judge the whole transaction: checks deferred at the start, forced before returning", () => {
  for (const name of ["create_enrollment", "change_enrollment"]) {
    const fn = body(name);
    assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/, name);
    const deferred = fn.indexOf("set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check deferred;");
    const immediate = fn.lastIndexOf("set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;");
    const firstWrite = Math.min(...["insert into", "update public.", "delete from"].map((w) => fn.indexOf(w)).filter((i) => i >= 0));
    assert.ok(deferred > 0 && deferred < firstWrite, `${name}: deferred before any write`);
    assert.ok(immediate > firstWrite && fn.indexOf("return", immediate) > immediate, `${name}: forced before returning`);
  }
});

test("both functions lock every series they touch, in id order, before writing anything", () => {
  const create = body("create_enrollment");
  assert.ok(create.indexOf("order by ss.id for no key update;") < create.indexOf("insert into public.batch_enrollments"));
  const change = body("change_enrollment");
  const lock = change.indexOf("where ss.id = any(v_series) or ss.id = any(v_current)\n  order by ss.id\n  for no key update;");
  assert.ok(lock > 0 && lock < change.indexOf("update public.batch_enrollments"));
  // The assignments are written in series id order too.
  assert.match(create, /from unnest\(v_series\) as s order by s;/);
  assert.match(change, /from unnest\(v_add\) as s order by s;/);
});

test("the selection rules and their messages are the application's own (createEnrollment / updateEnrollment)", () => {
  const selection = body("enrollment_series_selection");
  const actions = read("../enrollments/actions.js");
  for (const message of ["Select schedules that belong to the chosen batch."]) {
    assert.ok(selection.includes(`'${message}'`), message);
    assert.ok(actions.includes(`"${message}"`), `actions.js: ${message}`);
  }
  assert.match(selection, /raise exception 'Select at least one schedule\.' using errcode = '22023';/);
  assert.match(selection, /ss\.batch_id = p_batch_id\)\s+<> cardinality\(v_series\)/);

  const change = body("change_enrollment");
  const invalid = validateScheduleChangeDate("", "2026-10-22").errors.schedule_effective_date;
  const backDated = validateScheduleChangeDate("2026-10-21", "2026-10-22").errors.schedule_effective_date;
  assert.ok(change.includes(`raise exception '${invalid}'`), invalid);
  assert.ok(change.includes(`raise exception '${backDated}'`), backDated);
  assert.match(change, /if p_change_date < v_today then/);
});

test("change_enrollment does exactly what updateEnrollment does with the assignments", () => {
  const change = body("change_enrollment");
  // What is assigned now: not ended before today (updateEnrollment's .or(effective_end_date.is.null, ...gte.today)).
  assert.match(change, /\(es\.effective_end_date is null or es\.effective_end_date >= v_today\)/);
  // A schedule change date is needed only when the selection changes.
  assert.match(change, /if cardinality\(v_close_ids\) > 0 or cardinality\(v_add\) > 0 then/);
  // Dropped: closed the day before the change date, or withdrawn when they start on or after it - read after the cascade.
  assert.match(change, /if v_row\.effective_start_date < p_change_date then\s+update public\.enrollment_schedules set effective_end_date = p_change_date - 1 where id = v_row\.id;\s+else\s+delete from public\.enrollment_schedules where id = v_row\.id;/);
  assert.ok(change.indexOf("update public.batch_enrollments") < change.indexOf("for v_row in"), "the enrollment is saved (and the 0051 cascade runs) first");
  // Added: from the change date. The 0051 moved count: initial assignments now on the new start.
  assert.match(change, /select p_enrollment_id, s, p_change_date from unnest\(v_add\)/);
  assert.match(change, /p_start_date is distinct from v_stored\.effective_start_date and p_batch_id = v_stored\.batch_id/);
  assert.match(change, /es\.id = any\(v_initial_ids\) and es\.effective_start_date = p_start_date/);
  assert.match(change, /return jsonb_build_object\('enrollment_id', p_enrollment_id, 'moved', v_moved\);/);
  // createEnrollment: every selected schedule from the enrollment's own start.
  assert.match(body("create_enrollment"), /select v_enrollment, s, p_start_date from unnest\(v_series\)/);
});

test("grants: the two functions are callable by signed-in users (Admin-checked inside); the helpers by nobody", () => {
  assert.match(code, /grant execute on function public\.create_enrollment\(uuid, uuid, date, date, uuid\[\]\) to authenticated;/);
  assert.match(code, /grant execute on function public\.change_enrollment\(uuid, uuid, date, date, text, uuid\[\], date\) to authenticated;/);
  for (const helper of [
    "schedule_series_occupied_places(uuid, date)", "schedule_series_capacity_check(uuid)", "enrollment_schedules_capacity_check()",
    "batch_enrollments_capacity_check()", "schedule_series_capacity_guard()", "enrollment_series_selection(uuid, uuid[])",
  ]) {
    assert.ok(code.includes(`revoke execute on function public.${helper} from public, anon, authenticated;`), helper);
  }
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length, 8);
});

// ---- what is not touched ----------------------------------------------------------------------------------------------------

test("eligibility, sessions, attendance, schedule versions, memberships, payments and documents are not touched", () => {
  assert.doesNotMatch(code, /resolve_eligible_students|class_session|attendance|eligib|membership|payment|invoice/i);
  assert.doesNotMatch(code, /public\.schedules\b/);
  assert.doesNotMatch(code, /create (table|policy)|alter policy|drop policy|row level security/i);
});

test("the capacity errors can be told apart from the join-date errors the application already maps", () => {
  for (const message of [
    "The schedule is full (capacity 2). Increase the schedule's capacity, or end another student's assignment to it, first.",
    "The capacity cannot be lowered to 2 because 3 places are taken. Set it to 3 or more, or end students' assignments first.",
  ]) {
    assert.equal(matchKnownJoinDateError({ code: "23514", message }), null, message);
  }
});

test("the header states the READ COMMITTED condition and the abort-without-changes rule", () => {
  assert.match(sql, /Under REPEATABLE READ or SERIALIZABLE the limit is NOT\s+--\s+guaranteed/);
  assert.match(sql, /the migration stops with an error before changing anything/);
});

// ---- the verification script ------------------------------------------------------------------------------------------------

test("the verification script is rollback-only, fires the deferred checks itself, and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.doesNotMatch(script, /disable trigger/i);
  assert.match(script, /set constraints public\.enrollment_schedules_capacity_check, public\.batch_enrollments_capacity_check immediate;/);
  for (const id of [
    "P0", "B1", "PF", "V2", "V4", "V5", "V6", "V7", "V8", "N1", "F1", "F2", "F3", "F4", "O1", "O2", "O3", "O4", "O5", "S1", "S2",
    "R1", "R2", "R3", "X1", "X2", "X3", "X4", "Y1", "Y2", "Y3", "Y4", "U1", "U2", "U3", "U4", "M1", "M2", "T1", "T2",
    "D1", "D2", "D3", "D4", "D5", "D6", "CR0", "CR1", "CR2", "CR3", "CR4", "CR5", "CR6",
    "CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8", "CH9", "Z",
  ]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /CONCURRENCY IS NOT TESTED HERE/);
  assert.match(script, /two psql sessions \(not two SQL editor tabs/);
  assert.match(script, /student_code sequence/);
  assert.match(script, /leftover_students/);
});
