// Run with `npm test` (Node's built-in test runner).
//
// Migration 0057 (student communications) pinned from source, plus the application wiring: authorization and access restrictions
// in the database, staff attribution from auth.uid(), the follow-up rules, and the Student Details panel. The behaviour against a
// real database is exercised by supabase/verification/verify_0057_student_communications_behavior.sql (rollback only).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL_RAW = read("../../supabase/migrations/0057_student_communications.sql");
const SQL = SQL_RAW.replace(/^\s*--.*$/gm, "");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

function fn(name) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  const end = SQL.indexOf("$$;", start);
  return SQL.slice(start, end);
}

// ---- the table and its access ------------------------------------------------------------------------------------------------

test("one new table; RLS on; only SELECT granted, never insert, update or delete", () => {
  assert.match(SQL, /create table if not exists public\.student_communications \(/);
  assert.match(SQL, /alter table public\.student_communications enable row level security;/);
  assert.match(SQL, /revoke all on public\.student_communications from public, anon, authenticated;/);
  assert.match(SQL, /grant select on public\.student_communications to authenticated;/);
  assert.doesNotMatch(SQL, /grant[^;]*(insert|update|delete)[^;]*student_communications/i);
  assert.doesNotMatch(SQL, /create policy[^;]*for (insert|update|delete|all)\b/i);
});

test("direct reads are Admin only; scoped reads go through the list function", () => {
  assert.match(SQL, /create policy "student_communications_select_admin"\s+on public\.student_communications\s+for select\s+to authenticated\s+using \(public\.is_admin\(\)\);/);
});

test("it changes no existing table, policy or function", () => {
  const altered = [...SQL.matchAll(/alter table (public\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ["public.student_communications"]);
  const created = [...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, ["complete_student_follow_up", "list_student_communications", "record_student_communication", "student_communication_actor"]);
  assert.doesNotMatch(SQL, /drop (table|function)/i);
});

test("the follow-up is all or nothing, pending carries no completion, completed carries when and by whom", () => {
  assert.match(SQL, /constraint student_communications_follow_up_complete check/);
  assert.match(SQL, /constraint student_communications_follow_up_completion check/);
  assert.match(SQL, /constraint student_communications_follow_up_completed check/);
  assert.match(SQL, /follow_up_status\s+text check \(follow_up_status in \('pending', 'completed'\)\)/);
  assert.match(SQL, /communication_type in \('phone_call', 'whatsapp', 'in_person', 'other'\)/);
  assert.match(SQL, /created_at\s+timestamptz not null default now\(\)/);
  assert.match(SQL, /updated_at\s+timestamptz not null default now\(\)/);
});

// ---- the functions -----------------------------------------------------------------------------------------------------------------

test("every function is SECURITY DEFINER with an empty search_path; anon cannot execute any", () => {
  for (const name of ["record_student_communication", "complete_student_follow_up", "list_student_communications", "student_communication_actor"]) {
    const body = fn(name);
    assert.match(body, /security definer\s+set search_path = ''/, name);
  }
  for (const sig of ["record_student_communication(uuid, timestamp, text, text, text, date, text)", "complete_student_follow_up(uuid)", "list_student_communications(uuid)"]) {
    assert.ok(SQL.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(SQL.includes(`grant execute on function public.${sig} to authenticated;`), sig);
  }
  assert.ok(SQL.includes("revoke execute on function public.student_communication_actor() from public, anon, authenticated;"));
});

test("authorization: Admin, or an Instructor for an authorized student (the 0052 rule); unknown students refused the same way", () => {
  for (const name of ["record_student_communication", "list_student_communications"]) {
    const body = fn(name);
    assert.match(body, /not exists \(select 1 from public\.students s where s\.id = p_student_id\)/, name);
    assert.match(body, /not public\.class_count_student_visible\(p_student_id\)/, name);
    assert.match(body, /errcode = '42501'/, name);
  }
  assert.match(fn("complete_student_follow_up"), /not public\.class_count_student_visible\(v_row\.student_id\)/);
  // The authorization runs before any validation.
  const record = fn("record_student_communication");
  assert.ok(record.indexOf("'42501'") < record.indexOf("'22023'"));
});

test("staff attribution comes from auth.uid(), never from a parameter", () => {
  const record = fn("record_student_communication");
  const params = record.slice(0, record.indexOf("returns uuid"));
  assert.doesNotMatch(params, /recorded_by|staff|user/i);
  assert.match(record, /into v_user, v_name, v_role from public\.student_communication_actor\(\) a;\s+if v_user is null/);
  assert.match(record, /\n\s+v_user, v_name, v_role,\n/);
  assert.match(fn("student_communication_actor"), /select auth\.uid\(\)/);
  const complete = fn("complete_student_follow_up");
  assert.match(complete, /follow_up_completed_by = v_user,/);
  // A caller who is not staff is refused before any row is read or locked.
  assert.ok(complete.indexOf("if v_user is null then") < complete.indexOf("for update;"));
  assert.doesNotMatch(SQL, /v_actor\b/);
});

test("record: the date is the centre's local time, not in the future; a follow-up date not before the communication date", () => {
  const record = fn("record_student_communication");
  assert.match(record, /v_at := p_communicated_at at time zone v_tz;/);
  assert.match(record, /if v_at > now\(\) \+ interval '5 minutes' then/);
  assert.match(record, /if p_follow_up_date < \(v_at at time zone v_tz\)::date then/);
  assert.match(record, /case when v_has_fu then 'pending' end/);
});

test("complete: only a pending follow-up; date and note untouched; no new communication; row locked", () => {
  const complete = fn("complete_student_follow_up");
  assert.match(complete, /for update;/);
  assert.match(complete, /if v_row\.follow_up_status is null then/);
  assert.match(complete, /if v_row\.follow_up_status = 'completed' then/);
  const update = complete.slice(complete.indexOf("update public.student_communications"));
  assert.doesNotMatch(update, /follow_up_date\s*=|follow_up_note\s*=|subject\s*=|notes\s*=|communicated_at\s*=/);
  assert.doesNotMatch(complete, /insert into/);
});

test("list: newest first with a stable tie-break", () => {
  assert.match(fn("list_student_communications"), /order by c\.communicated_at desc, c\.created_at desc, c\.id desc;/);
});

// ---- the application ------------------------------------------------------------------------------------------------------------

test("actions: staff only, the database functions only, and no staff ID is ever sent", () => {
  const actions = code("./actions.js");
  assert.match(actions, /^"use server";/);
  // Record, complete and (migration 0058) edit.
  assert.equal((actions.match(/await requireRole\(ROLES\.ADMIN, ROLES\.INSTRUCTOR\);/g) ?? []).length, 3);
  assert.match(actions, /\.rpc\("record_student_communication", \{/);
  assert.match(actions, /\.rpc\("complete_student_follow_up", \{ p_communication_id: communicationId \}\)/);
  assert.doesNotMatch(actions, /recorded_by|p_staff|p_user|\.from\("student_communications"\)/);
  // Validated before the database is called.
  assert.ok(actions.indexOf("validateCommunicationInput(") < actions.indexOf('.rpc("record_student_communication"'));
});

test("data: reads only through the authorizing list function", () => {
  const data = code("./data.js");
  assert.match(data, /import "server-only";/);
  assert.match(data, /\.rpc\("list_student_communications", \{ p_student_id: studentId \}\)/);
  assert.doesNotMatch(data, /\.from\("student_communications"\)/);
});

test("Student Details: the Admin-only page shows the history panel, which never takes the page down", () => {
  const page = code("../../app/students/[id]/page.js");
  assert.match(page, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(page, /listStudentCommunications\(id\)\.catch\(\(error\) => \{\s+unstable_rethrow\(error\);\s+return null;/);
  assert.match(page, /<CommunicationHistory/);
});

test("history panel: Add Communication, a Pending/Completed badge, and Mark as Completed only on a pending follow-up", () => {
  const history = code("../../app/students/[id]/communications/communication-history.js");
  assert.match(history, /<AddCommunication/);
  assert.match(history, /No communication records have been added for this student yet\./);
  assert.match(history, /followUp\.status === "pending" \? \(/);
  assert.match(history, /<CompleteFollowUp/);
  const form = code("../../app/students/[id]/communications/add-communication.js");
  assert.match(form, /draft\.followUp \? \(/);
  for (const label of ["Date & Time", "Communication Type", "Subject", "Communication Notes", "Add Follow-up", "Follow-up Date", "Follow-up Note"]) {
    assert.ok(form.includes(label), label);
  }
});
