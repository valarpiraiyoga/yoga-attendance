// Migration 0052 (Instructor read access to class-count attendance history): what its SQL says and what its verification script
// covers. Source pins - the behaviour itself is exercised by
// supabase/verification/verify_0052_instructor_class_count_history_behavior.sql against a real database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0052_instructor_class_count_history.sql");
const script = read("../../supabase/verification/verify_0052_instructor_class_count_history_behavior.sql");
const code = sql.replace(/^--.*$/gm, "");

const FUNCTIONS = ["class_count_student_visible", "list_class_count_attendance_history", "list_class_count_attendance_dates"];

test("0052 only adds three functions: no table, column, policy, trigger or grant on a table, and no earlier function is replaced", () => {
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)/g)].map((match) => match[1]), FUNCTIONS);
  assert.doesNotMatch(code, /\b(create|alter|drop) (table|policy|trigger)\b|\bgrant (select|insert|update|delete|all) on\b|\bdrop function\b/i);
  assert.doesNotMatch(code, /\b(insert into|update public\.|delete from)\b/i, "read-only: no data is written");
});

test("the recording, reversal and eligible-list functions are not touched", () => {
  assert.doesNotMatch(code, /record_class_count_attendance|reverse_class_count_attendance|list_class_count_eligible/);
  assert.doesNotMatch(code, /report_session_facts|resolve_eligible_students|save_session_attendance/);
});

test("every function is security definer with an empty search_path", () => {
  assert.equal((code.match(/security definer\s+(stable\s+)?set search_path = ''/g) ?? []).length, 3);
  assert.equal((code.match(/language plpgsql/g) ?? []).length, 3);
});

test("privileges: the rule is internal, the two reads are for signed-in users only", () => {
  assert.match(code, /revoke execute on function public\.class_count_student_visible\(uuid\) from public, anon, authenticated;/);
  assert.match(code, /revoke execute on function public\.list_class_count_attendance_history\(date, date, text, integer\) from public, anon;/);
  assert.match(code, /grant execute on function public\.list_class_count_attendance_history\(date, date, text, integer\) to authenticated;/);
  assert.match(code, /revoke execute on function public\.list_class_count_attendance_dates\(date, date, integer\) from public, anon;/);
  assert.match(code, /grant execute on function public\.list_class_count_attendance_dates\(date, date, integer\) to authenticated;/);
  assert.equal((code.match(/\bgrant execute\b/g) ?? []).length, 2, "nothing else is granted");
});

test("the authorization rule: Admin all; an active Instructor only a current enrollment and assignment on their series, or attendance on their session", () => {
  const rule = code.slice(code.indexOf("create or replace function public.class_count_student_visible"), code.indexOf("comment on function public.class_count_student_visible"));
  assert.match(rule, /if public\.is_admin\(\) then\s+return true;/);
  assert.match(rule, /v_instructor := public\.current_instructor_id\(\);\s+if v_instructor is null or p_student_id is null then\s+return false;/);
  assert.match(rule, /v_today := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/);
  assert.match(rule, /be\.status = 'active'/);
  assert.match(rule, /be\.effective_start_date <= v_today\s+and \(be\.effective_end_date is null or be\.effective_end_date >= v_today\)/);
  assert.match(rule, /es\.effective_start_date <= v_today\s+and \(es\.effective_end_date is null or es\.effective_end_date >= v_today\)/);
  assert.match(rule, /sc\.series_id = es\.schedule_series_id/);
  assert.match(rule, /sc\.instructor_id = v_instructor\s+and sc\.status = 'active'/);
  assert.match(rule, /cs\.instructor_id = v_instructor/);
  assert.match(rule, /a\.student_id = p_student_id/);
});

test("both reads authorize in SQL before returning anything, and an Instructor's rows go through the rule", () => {
  assert.equal((code.match(/if not v_admin and public\.current_instructor_id\(\) is null then\s+raise exception 'Not authorized\.' using errcode = '42501';/g) ?? []).length, 2);
  assert.equal((code.match(/\(v_admin or public\.class_count_student_visible\(a\.student_id\)\)/g) ?? []).length, 3, "history + both date branches");
  assert.doesNotMatch(code, /auth\.uid\(\)/, "the caller is never taken from a parameter or re-derived outside the helpers");
});

test("an Instructor never gets the reversal reason or time; an Admin does", () => {
  assert.match(code, /case when v_admin then r\.reversed_at end,\s+case when v_admin then r\.reason end,/);
  assert.doesNotMatch(code, /r\.reason,|r\.reversed_at,/, "no unconditional reason or time column");
  assert.match(code, /\(r\.id is not null\),/, "the Reversed status is always returned");
});

test("the history returns no contact, recorder or amount columns", () => {
  const result = code.slice(code.indexOf("returns table ("), code.indexOf("language plpgsql"));
  assert.doesNotMatch(result, /phone|email|recorded_by|reversed_by|amount|notes/i);
  const select = code.slice(code.indexOf("return query\n  select a.id"), code.indexOf("order by a.attended_on desc, a.created_at desc\n  limit v_limit"));
  assert.doesNotMatch(select, /s\.phone|s\.email|a\.recorded_by|r\.reversed_by|m\.amount/);
});

test("the search narrows: a plain substring match, a length limit, and the rule is in the same WHERE", () => {
  assert.match(code, /v_term := lower\(btrim\(coalesce\(p_q, ''\)\)\);/);
  assert.match(code, /if length\(v_term\) > 100 then/);
  assert.match(code, /position\(v_term in lower\(s\.full_name\)\) > 0\s+or position\(v_term in lower\(m\.membership_code\)\) > 0/);
  assert.doesNotMatch(code, /\bilike\b|\blike\b/i, "no wildcard is interpreted");
});

test("the row limit is clamped and total_count counts the whole authorized range", () => {
  assert.match(code, /v_limit := least\(greatest\(coalesce\(p_limit, 500\), 1\), 500\);/);
  assert.match(code, /count\(\*\) over \(\)/);
  assert.match(code, /v_limit := least\(greatest\(coalesce\(p_limit, 200\), 1\), 500\);/);
  assert.match(code, /if p_from is null or p_to is null or p_from > p_to then/);
});

test("0052 does not depend on the reserved 0050 or on 0051, and says how to re-run", () => {
  assert.match(sql, /Independent of 0050 \(reserved for FS-8\) and of 0051/);
  assert.match(sql, /Idempotent: CREATE OR REPLACE/);
});

test("the verification script is rollback-only, skips when 0052 is missing, and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.doesNotMatch(script, /disable trigger|alter table/i, "no trigger is disabled, so no idle requirement");
  assert.match(script, /P0 migration 0052 is applied/);
  for (const id of ["A1", "A2", "A3", "I1", "I2", "I3", "I4", "I5", "V1", "V2", "S1", "S2", "S3", "S4", "S5", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "L1", "L2", "C1", "T1", "T2", "T3", "U1", "U2", "U3", "X1", "X2", "X3", "X4", "X5", "X6", "R1", "Z"]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /leftover_students/);
  assert.match(script, /two ACTIVE instructors linked to a login/i);
});

test("the script builds its fixtures with the real Admin functions and never writes the class-count tables directly", () => {
  assert.match(script, /record_class_count_attendance\(%L, gen_random_uuid\(\), %L::date\)/);
  assert.match(script, /reverse_class_count_attendance\(%L, 'ZZVERIFY reversal reason'/);
  assert.doesNotMatch(script, /insert into public\.class_count_attendance|update public\.class_count_attendance|delete from public\.class_count_attendance/);
  assert.equal((script.match(/update public\.instructors set status/g) ?? []).length, 2, "the one deliberate change, and its restoration");
});
