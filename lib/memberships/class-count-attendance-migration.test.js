// Run with `npm test` (Node's built-in test runner).
//
// Migration 0043 (Class Count Attendance: recording and history) and its verification script are SQL that is applied and
// run by hand in Supabase, so neither is executed here. These tests check what can be checked without a database: that the
// migration is additive and touches nothing existing, that the table, grants, triggers and the two functions say what the
// approved design says (Admin only, locked membership, idempotent request ID, no stored counter, never below zero), that
// the verification script is rollback-only and covers every behaviour, and that the SQLSTATEs and messages the script
// expects are the ones the migration raises - so the script cannot silently drift from the schema it verifies.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, "");
const squash = (sql) => noComments(sql).replace(/\s+/g, " ").trim();

const MIGRATION = read("../../supabase/migrations/0043_class_count_attendance.sql");
const SQL = noComments(MIGRATION);
const SCRIPT = read("../../supabase/verification/verify_0043_class_count_attendance_behavior.sql");
const SCRIPT_SQL = noComments(SCRIPT);

/** One `create or replace function` body, from its header to its closing `$$;`, comments removed. */
function functionBody(name) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  assert.ok(end > start, name);
  return SQL.slice(start, end + 3);
}

// ---- the migration ------------------------------------------------------------------------------------------------------------

test("it is additive: it moves no data and alters nothing that exists", () => {
  assert.doesNotMatch(SQL, /\bdelete\s+from\b|\btruncate\s+table\b|\bdrop\s+(table|column|function|schema|index)\b/i);
  // The only table it creates or changes is the new one; it never alters memberships, invoices or session attendance.
  assert.doesNotMatch(SQL, /alter table public\.(memberships|invoices|attendance|class_sessions|students)/i);
  assert.doesNotMatch(SQL, /update\s+public\.(?!class_count_attendance)/i);
  const created = [...SQL.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(created, ["class_count_attendance"]);
  const functions = [...SQL.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort();
  assert.deepEqual(functions, [
    "class_count_attendance_guard", "class_count_attendance_readonly", "list_class_count_eligible", "record_class_count_attendance",
  ]);
  // Session attendance and eligibility are not redefined.
  assert.doesNotMatch(SQL, /save_session_attendance|resolve_eligible_students|insert into public\.attendance\b/);
});

test("the table holds exactly the documented columns, with a unique request ID and restrict references", () => {
  const table = squash(SQL.slice(SQL.indexOf("create table if not exists public.class_count_attendance"), SQL.indexOf(");", SQL.indexOf("create table if not exists public.class_count_attendance")) + 2));
  assert.match(table, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(table, /membership_id uuid not null references public\.memberships \(id\) on delete restrict/);
  assert.match(table, /student_id uuid not null references public\.students \(id\) on delete restrict/);
  assert.match(table, /attended_on date not null/);
  assert.match(table, /request_id uuid not null/);
  assert.match(table, /recorded_by uuid references auth\.users \(id\) on delete set null/);
  assert.match(table, /created_at timestamptz not null default now\(\)/);
  assert.match(table, /constraint class_count_attendance_request_id_key unique \(request_id\)/);
  // No stored counter or running balance anywhere in the migration: remaining classes are derived.
  assert.doesNotMatch(SQL, /remaining_classes\s+integer|classes_remaining\s+integer\s*(,|\))\s*(default|check)|balance\s+integer|used_classes\s+integer/i);
});

test("a client can read the history and nothing else; there is no update or delete access", () => {
  assert.match(SQL, /alter table public\.class_count_attendance enable row level security/);
  assert.match(SQL, /revoke all on public\.class_count_attendance from public, anon, authenticated;\s+grant select on public\.class_count_attendance to authenticated;/);
  assert.match(SQL, /create policy "class_count_attendance_select_admin"\s+on public\.class_count_attendance\s+for select\s+to authenticated\s+using \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(SQL, /grant\s+(insert|update|delete|all|truncate)[^;]*on public\.class_count_attendance/i);
  assert.doesNotMatch(SQL, /create policy[^;]*for\s+(insert|update|delete|all)/i);
});

test("the history is read-only even for the owner, except clearing recorded_by", () => {
  const body = squash(functionBody("class_count_attendance_readonly"));
  assert.match(body, /raise exception 'Class count attendance history cannot be changed or deleted\.' using errcode = '55006'/);
  // The single exception: recorded_by cleared and every other column unchanged; OLD/NEW only touched for an UPDATE.
  assert.match(body, /if tg_op = 'UPDATE' then if old\.recorded_by is not null and new\.recorded_by is null and \(new\.id, new\.membership_id, new\.student_id, new\.attended_on, new\.request_id, new\.created_at\) is not distinct from \(old\.id, old\.membership_id, old\.student_id, old\.attended_on, old\.request_id, old\.created_at\) then return new;/);
  assert.ok(body.indexOf("tg_op = 'UPDATE'") < body.indexOf("old.recorded_by"), "OLD is read only inside the UPDATE branch (a truncate trigger has no OLD)");
  assert.match(SQL, /before update or delete on public\.class_count_attendance\s+for each row\s+execute function public\.class_count_attendance_readonly\(\)/);
  assert.match(SQL, /before truncate on public\.class_count_attendance\s+for each statement\s+execute function public\.class_count_attendance_readonly\(\)/);
});

test("the guard locks the membership and refuses a row that is not a class-count membership of that student with a class left", () => {
  const body = squash(functionBody("class_count_attendance_guard"));
  assert.match(body, /from public\.memberships where id = new\.membership_id for update/);
  assert.match(body, /v_mem\.kind is distinct from 'class_count' then raise exception 'Only a class-count membership can record class attendance\.' using errcode = '22023'/);
  assert.match(body, /v_mem\.student_id is distinct from new\.student_id then raise exception 'The student is not the student of this membership\.' using errcode = '22023'/);
  assert.match(body, /if v_used >= v_mem\.total_classes then raise exception 'No classes remain on this membership\.' using errcode = '55000'/);
  assert.match(SQL, /before insert on public\.class_count_attendance\s+for each row\s+execute function public\.class_count_attendance_guard\(\)/);
  for (const fn of ["class_count_attendance_readonly", "class_count_attendance_guard"]) {
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated`), fn);
  }
});

test("record_class_count_attendance is Admin only, locks first, replays before validating, and records one class", () => {
  const body = squash(functionBody("record_class_count_attendance"));
  assert.match(SQL, /record_class_count_attendance\(\s+p_membership_id uuid,\s+p_request_id\s+uuid\s*\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
  // Order: Admin check, arguments, lock the membership, replay, then the validations, then the insert.
  const order = [
    "if not public.is_admin() then",
    "p_membership_id is null or p_request_id is null",
    "where id = p_membership_id for update",
    "where request_id = p_request_id",
    "v_mem.kind is distinct from 'class_count'",
    "v_mem.cancelled_at is not null",
    "v_mem.start_date > v_today",
    "v_mem.end_date is not null and v_mem.end_date < v_today",
    "v_status is distinct from 'active'",
    "if v_used >= v_mem.total_classes then",
    "insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id, recorded_by)",
  ].map((part) => body.indexOf(part));
  assert.ok(order.every((index) => index >= 0), `all found: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in this order");
  // The messages and SQLSTATEs.
  for (const [message, code] of [
    ["Not authorized.", "42501"],
    ["A membership and a request ID are required.", "22023"],
    ["Membership not found.", "P0002"],
    ["This request ID has already been used for another membership.", "23505"],
    ["Only a class-count membership can record class attendance.", "22023"],
    ["This membership is cancelled.", "55000"],
    ["This membership has not started yet.", "55000"],
    ["This membership has expired.", "55000"],
    ["The student is not active.", "55000"],
    ["No classes remain on this membership.", "55000"],
  ]) {
    assert.ok(body.includes(`raise exception '${message}' using errcode = '${code}'`), `${code} ${message}`);
  }
  // It records one class, for the centre's day, by the calling user, and derives every count from the rows.
  assert.match(body, /v_today := \(now\(\) at time zone public\.centre_timezone\(\)\)::date/);
  assert.match(body, /values \(p_membership_id, v_mem\.student_id, v_today, p_request_id, auth\.uid\(\)\)/);
  assert.match(body, /select count\(\*\) into v_used from public\.class_count_attendance where membership_id = p_membership_id/);
  assert.match(body, /'classes_remaining', v_mem\.total_classes - v_used - 1/);
  assert.match(body, /'replayed', true/);
  assert.match(body, /'replayed', false/);
  // It never touches anything but the new table.
  assert.doesNotMatch(body, /update public\.|delete from/);
  assert.equal((body.match(/insert into public\./g) ?? []).length, 1);
});

test("list_class_count_eligible is Admin only and applies every condition", () => {
  const body = squash(functionBody("list_class_count_eligible"));
  assert.match(body, /security definer stable set search_path = ''/);
  assert.match(body, /if not public\.is_admin\(\) then raise exception 'Not authorized\.' using errcode = '42501'/);
  for (const condition of [
    "m.kind = 'class_count'",
    "m.cancelled_at is null",
    "s.status = 'active'",
    "m.start_date <= v_today",
    "(m.end_date is null or m.end_date >= v_today)",
    "m.total_classes - u.used > 0",
  ]) {
    assert.ok(body.includes(condition), condition);
  }
  assert.match(body, /select count\(\*\)::integer as used from public\.class_count_attendance a where a\.membership_id = m\.id/);
  assert.match(body, /v_today := \(now\(\) at time zone public\.centre_timezone\(\)\)::date/);
});

test("the two callable functions are closed to anon and open to signed-in users", () => {
  for (const signature of ["record_class_count_attendance(uuid, uuid)", "list_class_count_eligible()"]) {
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${escaped} from public, anon;\\s+grant execute on function public\\.${escaped} to authenticated;`), signature);
  }
});

test("it builds on 0042 and leaves session attendance exactly as 0042 left it", () => {
  const m42 = read("../../supabase/migrations/0042_class_count_memberships.sql");
  // The columns the functions read are the ones 0042 adds.
  for (const column of ["kind", "total_classes"]) assert.match(m42, new RegExp(`add column if not exists ${column}\\b`), column);
  assert.match(m42, /create or replace function public\.resolve_eligible_students\(/);
  // 0043 does not define any function that an earlier migration defined.
  for (const name of ["is_admin", "centre_timezone"]) assert.doesNotMatch(SQL, new RegExp(`create or replace function public\\.${name}\\(`), name);
  assert.match(read("../../supabase/migrations/0002_instructors.sql"), /function public\.is_admin\(\)/);
  assert.match(read("../../supabase/migrations/0024_center_regional_settings.sql"), /function public\.centre_timezone\(\)/);
  assert.match(read("../../supabase/migrations/0006_students.sql"), /check \(status in \('active', 'inactive'\)\)/);
});

// ---- the verification script ---------------------------------------------------------------------------------------------------

test("the script runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SCRIPT_SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SCRIPT_SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SCRIPT_SQL.indexOf("begin;") < SCRIPT_SQL.indexOf("rollback;"));
  assert.doesNotMatch(SCRIPT_SQL, /\bcommit\b(?!\s+drop)/i);
  assert.doesNotMatch(SCRIPT_SQL, /\bsavepoint\b|\brelease\b/i);
  assert.match(SCRIPT_SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.ok(SCRIPT_SQL.indexOf("'SUMMARY'") < SCRIPT_SQL.lastIndexOf("rollback;"));
  for (const heading of ["-- PREREQUISITES", "-- SAFETY - ROLLBACK ONLY", "-- LIMITATIONS", "-- AFTER THE ROLLBACK"]) assert.ok(SCRIPT.includes(heading), heading);
  assert.match(SCRIPT, /Concurrency[^\n]*NOT tested/);
});

test("it checks that 0043 is applied first, and builds nothing before that check passes", () => {
  const body = SCRIPT_SQL.slice(SCRIPT_SQL.indexOf("do $$"));
  const p0 = body.indexOf("P0 migration 0043 is applied");
  assert.ok(p0 > 0);
  for (const early of ["pg_temp.student(", "pg_temp.mem("]) {
    assert.ok(body.indexOf(early) > p0, `${early} comes after P0`);
  }
  assert.match(SCRIPT_SQL, /if not v_ready then\s+perform pg_temp\.skip\('T \/ R \/ V \/ A \/ G \/ H \/ L \/ D', 'migration 0043 \(or 0042\) is not applied'\);/);
  // The anonymous helper clears the legacy identity setting, so it cannot inherit the Admin's identity.
  assert.match(SCRIPT_SQL, /perform set_config\('request\.jwt\.claim\.sub', '', true\);\s+execute 'set local role anon'/);
});

test("it covers every requested behaviour", () => {
  for (const id of [
    "P0 ",
    "T1 ", "T2 ", "T3 ", "T4 ", "T5 ", "T6 ", "T7 ", "T8 ", "T9 ",
    "R1 ", "R2 ", "R3 ", "R4 ", "R5 ", "R6 ", "R7 ", "R8 ", "R9 ",
    "V1 ", "V2 ", "V3 ", "V4 ", "V5 ", "V6 ", "V7 ",
    "A1 ", "A2 ", "A3 ",
    "G1 ", "G2 ", "G3 ", "G4 ",
    "H1 ", "H2 ", "H3 ", "H4 ", "H5 ",
    "L1 ", "L2 ", "L3 ", "L4 ", "L5 ", "L6 ",
    "D1 ", "D2 ", "D3 ", "D4 ", "D5 ",
    "Z1 ", "Z2 ", "Z3 ", "Z4 ",
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  assert.match(SCRIPT_SQL, /'PASS' else 'FAIL'/);
  assert.match(SCRIPT_SQL, /'NOT TESTED'/);
  assert.match(SCRIPT_SQL, /'ALL PASS' else 'FAILURES'/);
});

test("it writes only disposable ZZVERIFY fixtures and the history rows recorded for them", () => {
  assert.match(SCRIPT_SQL, /'ZZVERIFY '/);
  assert.doesNotMatch(SCRIPT_SQL, /MEM-0000\d\d|YC-0000\d\d/);
  const inserts = new Set([...SCRIPT_SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...inserts].sort(), ["class_count_attendance", "memberships", "students"]);
  // The only mutations of existing-table rows are the refusals it checks on the history table, which is itself fixture-only
  // at that point (the whole transaction is rolled back).
  const updates = new Set([...SCRIPT_SQL.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...updates], ["class_count_attendance"]);
  assert.match(SCRIPT_SQL, /truncate public\.class_count_attendance/);
  assert.doesNotMatch(SCRIPT_SQL, /\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  // Fingerprints of everything that exists are compared at the end.
  for (const [table, hash] of [["memberships", "v_mem_hash"], ["invoices", "v_inv_hash"], ["attendance", "v_att_hash"], ["class_count_attendance", "v_cca_hash"]]) {
    assert.match(SCRIPT_SQL, new RegExp(`from public\\.${table}\\b`), table);
    assert.ok(SCRIPT_SQL.indexOf(`${hash}0`) < SCRIPT_SQL.indexOf(`${hash}1`) && SCRIPT_SQL.includes(`${hash}0 = ${hash}1`), hash);
  }
});

test("the messages and SQLSTATEs the script expects are the ones the migration raises", () => {
  const raised = new Set([...SQL.matchAll(/raise exception '([^']+)' using errcode = '(\w+)'/g)].map((m) => `${m[2]} ${m[1]}`));
  const expected = [
    "23505 This request ID has already been used for another membership.",
    "55000 No classes remain on this membership.",
    "22023 Only a class-count membership can record class attendance.",
    "55000 This membership is cancelled.",
    "55000 This membership has expired.",
    "55000 This membership has not started yet.",
    "55000 The student is not active.",
    "P0002 Membership not found.",
    "22023 A membership and a request ID are required.",
  ];
  for (const text of expected) {
    assert.ok(SCRIPT_SQL.includes(`'${text}'`), `the script expects: ${text}`);
    assert.ok(raised.has(text), `the migration raises: ${text}`);
  }
  // SQLSTATE-only expectations: 55006 (history), 42501 (access), 22023 (guard).
  assert.ok(raised.has("55006 Class count attendance history cannot be changed or deleted."));
  assert.ok((SCRIPT_SQL.match(/like '55006 %'/g) ?? []).length >= 4);
  assert.ok(SCRIPT_SQL.includes("= '42501'") && SCRIPT_SQL.includes("'ERR:42501'"));
  // The result keys it reads exist in the function's result.
  const body = squash(functionBody("record_class_count_attendance"));
  for (const key of ["attendance_id", "membership_id", "student_id", "attended_on", "total_classes", "classes_used", "classes_remaining", "replayed"]) {
    assert.ok(body.includes(`'${key}'`), key);
  }
  for (const key of ["classes_remaining", "classes_used", "total_classes", "replayed", "attendance_id", "membership_id"]) {
    assert.ok(SCRIPT_SQL.includes(`'${key}'`), `the script reads ${key}`);
  }
});

test("the figures it expects follow from its own setup", () => {
  // A: 3 classes, fixed validity; B: 2 classes, no expiry; M: a duration plus a class-count membership of 2.
  assert.match(SCRIPT_SQL, /v_ma := pg_temp\.mem\(v_sa, 'class_count', v_today - 5, v_today \+ 20, 3\)/);
  assert.match(SCRIPT_SQL, /v_mb := pg_temp\.mem\(v_sb, 'class_count', v_today - 5, null, 2\)/);
  assert.match(SCRIPT_SQL, /v_mm_cc := pg_temp\.mem\(v_sm, 'class_count', v_today - 5, v_today \+ 20, 2\)/);
  assert.match(SCRIPT_SQL, /v_mc := pg_temp\.mem\(v_sc, 'class_count', v_today - 5, v_today \+ 20, 3, true\)/);
  assert.match(SCRIPT_SQL, /v_mx := pg_temp\.mem\(v_sx, 'class_count', v_today - 60, v_today - 30, 3\)/);
  assert.match(SCRIPT_SQL, /v_mf := pg_temp\.mem\(v_sf, 'class_count', v_today \+ 5, v_today \+ 30, 3\)/);
  assert.match(SCRIPT_SQL, /pg_temp\.student\('0043 I inactive', '9000430007', 'inactive'\)/);
  // The list expects exactly A, B and M's class-count membership before anything is recorded; "2|0|2|true" is B's row.
  assert.match(SCRIPT_SQL, /unnest\(array\[v_ma, v_mb, v_mm_cc\]\)/);
  assert.match(SCRIPT_SQL, /v_out = '2\|0\|2\|true'/);
  assert.match(SCRIPT_SQL, /v_out = '3\|2\|1'/);
  // Two recordings on A leave 1; the third leaves 0; the fourth request is refused.
  assert.match(SCRIPT_SQL, /'classes_remaining'\) = '2'/);
  assert.match(SCRIPT_SQL, /'classes_remaining'\) = '1' and pg_temp\.field\(v_json, 'replayed'\) = 'false' and pg_temp\.used\(v_ma\) = 2/);
  assert.match(SCRIPT_SQL, /'classes_remaining'\) = '0' and pg_temp\.used\(v_ma\) = 3/);
});

test("every table, column and function the script uses exists in the migrations", () => {
  const columns = ["0006_students", "0008_memberships", "0022_phone_country_code", "0024_center_regional_settings", "0042_class_count_memberships"]
    .map((name) => read(`../../supabase/migrations/${name}.sql`))
    .join("\n");
  for (const column of ["full_name", "phone", "phone_country_code", "join_date", "status", "student_id", "plan", "start_date", "end_date", "amount", "payment_status", "currency", "cancelled_at", "kind", "total_classes"]) {
    assert.match(columns, new RegExp(`\\b${column}\\b`), column);
  }
  // The two columns the script's fixtures rely on that arrived after the first memberships and students migrations.
  assert.match(read("../../supabase/migrations/0022_phone_country_code.sql"), /alter table public\.students\s+add column if not exists phone_country_code text/);
  assert.match(read("../../supabase/migrations/0024_center_regional_settings.sql"), /alter table public\.memberships\s+add column if not exists currency text not null default 'INR'/);
  assert.match(SCRIPT_SQL, /insert into public\.memberships \(student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency, cancelled_at\)/);
  for (const fn of ["record_class_count_attendance", "list_class_count_eligible", "centre_timezone", "resolve_eligible_students", "save_session_attendance"]) {
    assert.ok(SCRIPT_SQL.includes(fn), fn);
  }
  assert.match(read("../../supabase/migrations/0024_center_regional_settings.sql"), /function public\.save_session_attendance\(\s+p_class_session_id uuid,\s+p_marks jsonb\s+\)/);
  assert.match(SCRIPT_SQL, /to_regprocedure\('public\.save_session_attendance\(uuid, jsonb\)'\)/);
});
