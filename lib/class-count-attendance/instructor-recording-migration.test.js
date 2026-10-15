// Migration 0053 (Instructor recording of class-count attendance): what its SQL says, that it changes the 0045 functions ONLY in
// their authorization, and what its verification script covers. Source pins - the behaviour itself is exercised by
// supabase/verification/verify_0053_instructor_class_count_recording_behavior.sql against a real database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0053_instructor_class_count_recording.sql");
const m45 = read("../../supabase/migrations/0045_class_count_dates_and_reversals.sql");
const script = read("../../supabase/verification/verify_0053_instructor_class_count_recording_behavior.sql");
const code = sql.replace(/^--.*$/gm, "");

function functionText(source, startMarker) {
  const a = source.indexOf(startMarker);
  assert.ok(a >= 0, `found ${startMarker}`);
  const b = source.indexOf("\n$$;\n", a);
  return source.slice(a, b + 5);
}
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `contains ${from.slice(0, 50)}`);
  return text.replace(from, () => to);
};

const RECORD = "create or replace function public.record_class_count_attendance(\n  p_membership_id uuid,\n  p_request_id    uuid,\n  p_attended_on   date\n)";
const LIST = "create or replace function public.list_class_count_eligible()";

test("0053 re-creates exactly two functions and adds nothing else", () => {
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((match) => match[1]), [
    "record_class_count_attendance",
    "list_class_count_eligible",
  ]);
  assert.doesNotMatch(code, /\b(create|alter|drop) (table|policy|trigger)\b|\bgrant (select|insert|update|delete|all) on\b|\bdrop function\b/i);
  // The only write anywhere is the recorder's own INSERT of the record (unchanged from 0045); the migration writes no row itself.
  assert.deepEqual([...code.matchAll(/\binsert into ([\w.]+)/gi)].map((match) => match[1]), ["public.class_count_attendance"]);
  assert.doesNotMatch(code, /\b(update public\.|delete from)\b/i);
});

test("reversal, expiry editing, the two-argument recorder and the history functions are not touched", () => {
  assert.doesNotMatch(code, /reverse_class_count_attendance|edit_class_count_expiry|list_class_count_attendance_(history|dates)/);
  assert.doesNotMatch(code, /create or replace function public\.class_count_net_used/);
  assert.doesNotMatch(code, /record_class_count_attendance\(\s*p_membership_id uuid,\s*p_request_id\s+uuid\s*\)/, "the two-argument form stays Admin only");
});

test("the recorder is 0045's function with only the opening authorization changed", () => {
  const original = functionText(m45, RECORD);
  const expected = swap(original, `begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
`, `begin
  -- Admin: any membership, as before. An active, linked Instructor: only a membership of a student that instructor is authorized
  -- for (class_count_student_visible, 0052). The membership is looked up here only to find its student, so an unknown membership
  -- and an unauthorized one are refused the same way (42501) and nothing is revealed about either. Everything after this check is
  -- the same for both roles.
  if not public.is_admin() then
    if public.current_instructor_id() is null
       or not public.class_count_student_visible((select m.student_id from public.memberships m where m.id = p_membership_id)) then
      raise exception 'Not authorized.' using errcode = '42501';
    end if;
  end if;
`);
  assert.equal(functionText(sql, RECORD), expected);
});

test("the eligible list is 0045's function with only authorization, the instructor's own students and the phone changed", () => {
  const original = functionText(m45, LIST);
  let expected = swap(original, `declare
  v_today date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
`, `declare
  v_today date;
  v_admin boolean;
begin
  v_admin := public.is_admin();
  if not v_admin and public.current_instructor_id() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
`);
  expected = swap(expected, `    s.full_name,
    s.phone,
    s.student_code,`, `    s.full_name,
    case when v_admin then s.phone end,
    s.student_code,`);
  expected = swap(expected, `    and m.total_classes - u.used > 0
  order by s.full_name, m.start_date, m.id;`, `    and m.total_classes - u.used > 0
    and (v_admin or public.class_count_student_visible(s.id))
  order by s.full_name, m.start_date, m.id;`);
  assert.equal(functionText(sql, LIST), expected);
});

test("every existing rule of the recorder is still in the body, for both roles", () => {
  const body = functionText(sql, RECORD);
  for (const rule of [
    "for update;",
    "Only a class-count membership can record class attendance.",
    "This membership is cancelled.",
    "This membership has not started yet.",
    "This membership has expired.",
    "The student is not active.",
    "The attendance date cannot be in the future.",
    "The attendance date cannot be before the membership starts.",
    "The attendance date cannot be after the membership ends.",
    "No classes remain on this membership.",
    "This request ID has already been used for another membership.",
    "This request ID has already been used with a different attendance date.",
    "'replayed', true",
    "p_request_id, auth.uid()",
  ]) {
    assert.ok(body.includes(rule), rule);
  }
});

test("a signed-in Instructor is checked in the database, and an unknown membership looks the same as an unauthorized one", () => {
  const body = functionText(sql, RECORD);
  assert.match(body, /if public\.current_instructor_id\(\) is null\s+or not public\.class_count_student_visible\(\(select m\.student_id from public\.memberships m where m\.id = p_membership_id\)\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/);
  assert.ok(body.indexOf("class_count_student_visible") < body.indexOf("for update"), "authorized before the row is locked or read");
});

test("both functions stay security definer with an empty search_path, and keep their grants", () => {
  assert.equal((code.match(/security definer\s+(stable\s+)?set search_path = ''/g) ?? []).length, 2);
  assert.equal((code.match(/revoke execute on function public\.record_class_count_attendance\(uuid, uuid, date\) from public, anon;/g) ?? []).length, 1);
  assert.equal((code.match(/grant execute on function public\.record_class_count_attendance\(uuid, uuid, date\) to authenticated;/g) ?? []).length, 1);
  assert.equal((code.match(/revoke execute on function public\.list_class_count_eligible\(\) from public, anon;/g) ?? []).length, 1);
  assert.equal((code.match(/grant execute on function public\.list_class_count_eligible\(\) to authenticated;/g) ?? []).length, 1);
  assert.equal((code.match(/\bgrant execute\b/g) ?? []).length, 2);
});

test("an Instructor's list carries no phone, and Instructors are kept to their own students", () => {
  const body = functionText(sql, LIST);
  assert.match(body, /case when v_admin then s\.phone end,/);
  assert.doesNotMatch(body, /\n\s+s\.phone,/);
  assert.match(body, /and \(v_admin or public\.class_count_student_visible\(s\.id\)\)/);
});

test("0053 needs 0052 and 0045, is independent of 0050 and 0051, and says to re-apply it after a re-run of 0043 or 0045", () => {
  assert.match(code, /class_count_student_visible \(migration 0052\)/);
  assert.match(sql, /Independent of 0050\s+\(reserved for FS-8\) and of 0051|independent of 0050/i);
  assert.match(sql, /re-apply 0053/);
});

test("the verification script is rollback-only and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.doesNotMatch(script, /disable trigger|alter table/i);
  assert.match(script, /P0 migration 0053 is applied/);
  for (const id of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "L1", "L2", "L3", "L4", "A1", "A2", "S1", "V1", "V2", "X1", "X2", "X3", "Z"]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /leftover_students/);
});

test("the application: only recording admits an Instructor, Renew stays Admin, the tab is offered to both", () => {
  const action = read("./actions.js");
  assert.match(action, /recordClassCount\(membershipId, requestId, attendedOn\) \{\s*await requireRole\(ROLES\.ADMIN, ROLES\.INSTRUCTOR\);/);
  assert.match(action, /reverseClassCount\(attendanceId, reason, requestId\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  const page = read("../../app/attendance/class-count/page.js");
  assert.match(page, /isAdmin \? listClassCountToRenew\(\) : Promise\.resolve\(\[\]\)/);
  assert.match(page, /\{toRenew\.length > 0 \? \(/, "the Renew section only renders when there are rows, and an Instructor's list is empty");
  assert.match(read("../../app/attendance/page.js"), /<AttendanceViewToggle active="today" showClassCount \/>/);
});

test("the section 6A ledger records 0053 as repository only until it is applied and verified", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0053` |"));
  assert.ok(row, "a 0053 row");
  assert.match(row, /Repository only — not applied, not verified/);
  assert.match(row, /Instructor/);
});
