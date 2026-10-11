// Run with `npm test` (Node's built-in test runner).
//
// Migration 0045 (Class Count Attendance: attendance dates and reversals) and its verification script are SQL applied and
// run by hand in Supabase, so neither is executed here. These tests check what can be checked without a database: that the
// migration is additive and keeps every earlier signature, that the functions it re-creates are the earlier ones with ONLY
// the net-count change (so nothing else about recording, the list or the guards can have drifted), that the new date and
// reversal rules say what the approved documentation says, and that the verification script is rollback-only, preflighted,
// covers every behaviour, and expects the messages and SQLSTATEs the migration raises.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, "");
const squash = (sql) => noComments(sql).replace(/\s+/g, " ").trim();

const MIGRATION = read("../../supabase/migrations/0045_class_count_dates_and_reversals.sql");
const SQL = noComments(MIGRATION);
const M43 = read("../../supabase/migrations/0043_class_count_attendance.sql");
const M44 = read("../../supabase/migrations/0044_class_count_documents_and_guard.sql");
const SCRIPT = read("../../supabase/verification/verify_0045_class_count_dates_and_reversals_behavior.sql");
const SCRIPT_SQL = noComments(SCRIPT);

/** The body of a function (header to its closing `$$;`), comments removed, whitespace collapsed. `nth` picks among overloads. */
function functionText(sql, signaturePrefix, nth = 0) {
  let from = -1;
  for (let i = 0; i <= nth; i += 1) {
    from = sql.indexOf(`create or replace function public.${signaturePrefix}`, from + 1);
    assert.ok(from >= 0, `${signaturePrefix} #${nth}`);
  }
  const end = sql.indexOf("$$;", sql.indexOf("as $$", from));
  assert.ok(end > from);
  return squash(sql.slice(from, end + 3));
}

// ---- the migration ---------------------------------------------------------------------------------------------------------------

test("it is additive: it moves no data and drops or alters nothing", () => {
  // Outside the function bodies and the comment-on-function texts it runs no DML and drops nothing.
  const outsideBodies = SQL.replace(/\$\$[\s\S]*?\$\$/g, "$$$$").replace(/comment on [^;]*;/gi, "");
  assert.doesNotMatch(outsideBodies, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\s+table\b/i);
  assert.doesNotMatch(outsideBodies, /\bdrop\s+(table|column|function|schema|index|constraint)\b/i);
  // The only ALTER is switching row level security on for the new table.
  assert.deepEqual([...outsideBodies.matchAll(/alter table ([\w.]+) (\w+ \w+ \w+ \w+)/gi)].map((m) => `${m[1]} ${m[2]}`), [
    "public.class_count_attendance_reversals enable row level security",
  ]);
  assert.equal((outsideBodies.match(/alter table/gi) ?? []).length, 1);
  // The only table it creates is the reversals table.
  assert.deepEqual([...SQL.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1]), ["class_count_attendance_reversals"]);
  const functions = [...SQL.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
  assert.deepEqual(functions, [
    "class_count_attendance_reversals_readonly", "class_count_net_used", "class_count_attendance_guard",
    "record_class_count_attendance", "record_class_count_attendance", "reverse_class_count_attendance",
    "list_class_count_eligible", "memberships_class_count_history_guard",
  ]);
  // Session attendance is not touched.
  assert.doesNotMatch(SQL, /save_session_attendance|resolve_eligible_students|public\.attendance\b|class_sessions/);
});

test("the reversals table is append-only: one reversal per record, one use per request ID, a trimmed 3-500 character reason", () => {
  const table = squash(SQL.slice(SQL.indexOf("create table if not exists public.class_count_attendance_reversals"), SQL.indexOf(");", SQL.indexOf("create table if not exists public.class_count_attendance_reversals")) + 2));
  assert.match(table, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(table, /attendance_id uuid not null references public\.class_count_attendance \(id\) on delete restrict/);
  assert.match(table, /reason text not null/);
  assert.match(table, /reversed_by uuid references auth\.users \(id\) on delete set null/);
  assert.match(table, /reversed_at timestamptz not null default now\(\)/);
  assert.match(table, /request_id uuid not null/);
  assert.match(table, /constraint class_count_attendance_reversals_attendance_key unique \(attendance_id\)/);
  assert.match(table, /constraint class_count_attendance_reversals_request_id_key unique \(request_id\)/);
  // Trimmed of ALL leading and trailing whitespace (spaces, tabs, newlines): a whitespace-only reason is refused whatever its length.
  assert.match(table, /constraint class_count_attendance_reversals_reason_valid check \(reason = regexp_replace\(reason, '\^\\s\+\|\\s\+\$', '', 'g'\) and length\(reason\) between 3 and 500\)/);
  assert.doesNotMatch(table, /btrim/);
});

test("a client can read the reversals and nothing else; the table is read-only even for the owner, but for clearing reversed_by", () => {
  assert.match(SQL, /alter table public\.class_count_attendance_reversals enable row level security/);
  assert.match(SQL, /revoke all on public\.class_count_attendance_reversals from public, anon, authenticated;\s+grant select on public\.class_count_attendance_reversals to authenticated;/);
  assert.match(SQL, /create policy "class_count_attendance_reversals_select_admin"\s+on public\.class_count_attendance_reversals\s+for select\s+to authenticated\s+using \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(SQL, /grant\s+(insert|update|delete|all|truncate)[^;]*on public\.class_count_attendance_reversals/i);
  const readonly = functionText(SQL, "class_count_attendance_reversals_readonly(");
  assert.match(readonly, /raise exception 'Class count attendance reversals cannot be changed or deleted\.' using errcode = '55006'/);
  assert.match(readonly, /if tg_op = 'UPDATE' then if old\.reversed_by is not null and new\.reversed_by is null and \(new\.id, new\.attendance_id, new\.reason, new\.reversed_at, new\.request_id\) is not distinct from \(old\.id, old\.attendance_id, old\.reason, old\.reversed_at, old\.request_id\) then return new;/);
  assert.match(SQL, /before update or delete on public\.class_count_attendance_reversals\s+for each row\s+execute function public\.class_count_attendance_reversals_readonly\(\)/);
  assert.match(SQL, /before truncate on public\.class_count_attendance_reversals\s+for each statement\s+execute function public\.class_count_attendance_reversals_readonly\(\)/);
});

test("net classes used - records not reversed - is defined once, and callable by no client role", () => {
  const net = functionText(SQL, "class_count_net_used(");
  assert.match(net, /returns integer language sql security definer set search_path = ''/);
  assert.match(net, /select count\(\*\)::integer from public\.class_count_attendance a where a\.membership_id = p_membership_id and not exists \( select 1 from public\.class_count_attendance_reversals r where r\.attendance_id = a\.id \)/);
  assert.doesNotMatch(net, /\bstable\b/, "volatile on purpose: it reads what is committed once the caller holds the membership lock");
  assert.match(SQL, /revoke execute on function public\.class_count_net_used\(uuid\) from public, anon, authenticated/);
});

test("the insert guard is 0043's guard with ONLY its count replaced by the net count", () => {
  const before = functionText(M43, "class_count_attendance_guard(");
  const after = functionText(SQL, "class_count_attendance_guard(");
  const swapped = before.replace(
    "select count(*) into v_used from public.class_count_attendance where membership_id = new.membership_id;",
    "v_used := public.class_count_net_used(new.membership_id);",
  );
  assert.notEqual(swapped, before, "the count statement was found");
  assert.equal(after, swapped);
});

test("the eligible list is 0043's list with ONLY its used count replaced by the net count", () => {
  const before = functionText(M43, "list_class_count_eligible(");
  const after = functionText(SQL, "list_class_count_eligible(");
  const swapped = before.replace(
    "where a.membership_id = m.id ) u",
    "where a.membership_id = m.id and not exists ( select 1 from public.class_count_attendance_reversals r where r.attendance_id = a.id ) ) u",
  );
  assert.notEqual(swapped, before, "the count was found");
  assert.equal(after, swapped);
});

test("recording takes a date: Admin, arguments, lock, replay, eligible now, the date rules, net balance, insert - in that order", () => {
  const body = functionText(SQL, "record_class_count_attendance(", 0);
  assert.match(body, /\(\s*p_membership_id uuid, p_request_id uuid, p_attended_on date \) returns jsonb language plpgsql security definer set search_path = ''/);
  const order = [
    "if not public.is_admin() then",
    "p_membership_id is null or p_request_id is null or p_attended_on is null",
    "where id = p_membership_id for update",
    "where request_id = p_request_id",
    "v_existing.membership_id <> p_membership_id",
    "v_existing.attended_on <> p_attended_on",
    "v_mem.kind is distinct from 'class_count'",
    "v_mem.cancelled_at is not null",
    "v_mem.start_date > v_today",
    "v_mem.end_date is not null and v_mem.end_date < v_today",
    "v_status is distinct from 'active'",
    "p_attended_on > v_today",
    "p_attended_on < v_mem.start_date",
    "v_mem.end_date is not null and p_attended_on > v_mem.end_date",
    "v_used := public.class_count_net_used(p_membership_id);\n".trim(),
    "if v_used >= v_mem.total_classes then",
    "insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id, recorded_by)",
  ].map((part) => body.indexOf(part));
  assert.ok(order.every((index) => index >= 0), `all found: ${order}`);
  // The replay's net count sits before the eligibility checks, so look for the later occurrence for the balance check.
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order.filter((_, i) => i !== 14), sorted.filter((index) => index !== order[14]), "in this order");
  assert.ok(body.lastIndexOf("v_used := public.class_count_net_used(p_membership_id);") > order[13]);
  // The record is stored with the CHOSEN date, never today.
  assert.match(body, /values \(p_membership_id, v_mem\.student_id, p_attended_on, p_request_id, auth\.uid\(\)\)/);
  assert.match(body, /'attended_on', p_attended_on,/);
  assert.doesNotMatch(body, /values \([^)]*v_today/);
  assert.doesNotMatch(body, /update public\.|delete from/);
});

test("every message and SQLSTATE of recording is the approved one; the eligibility messages are those of 0043", () => {
  const body = functionText(SQL, "record_class_count_attendance(", 0);
  for (const [message, code] of [
    ["Not authorized.", "42501"],
    ["A membership, a request ID and an attendance date are required.", "22023"],
    ["Membership not found.", "P0002"],
    ["This request ID has already been used for another membership.", "23505"],
    ["This request ID has already been used with a different attendance date.", "23505"],
    ["Only a class-count membership can record class attendance.", "22023"],
    ["This membership is cancelled.", "55000"],
    ["This membership has not started yet.", "55000"],
    ["This membership has expired.", "55000"],
    ["The student is not active.", "55000"],
    ["The attendance date cannot be in the future.", "22023"],
    ["The attendance date cannot be before the membership starts.", "22023"],
    ["The attendance date cannot be after the membership ends.", "22023"],
    ["No classes remain on this membership.", "55000"],
  ]) {
    assert.ok(body.includes(`raise exception '${message}' using errcode = '${code}'`), `${code} ${message}`);
  }
  for (const message of [
    "This membership is cancelled.", "This membership has not started yet.", "This membership has expired.", "The student is not active.",
    "No classes remain on this membership.", "Only a class-count membership can record class attendance.",
  ]) {
    assert.ok(M43.includes(message), `0043 already says: ${message}`);
  }
});

test("the two-argument record function is kept as a thin wrapper for today at the centre", () => {
  const wrapper = functionText(SQL, "record_class_count_attendance(", 1);
  assert.match(wrapper, /\( p_membership_id uuid, p_request_id uuid \) returns jsonb language plpgsql security definer set search_path = ''/);
  assert.match(wrapper, /return public\.record_class_count_attendance\( p_membership_id, p_request_id, \(now\(\) at time zone public\.centre_timezone\(\)\)::date \);/);
  // It keeps the checks and messages the two-argument function always had - Admin first, then missing arguments - and only
  // then hands a valid call to the date-aware function.
  const order = [
    "if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;",
    "if p_membership_id is null or p_request_id is null then raise exception 'A membership and a request ID are required.' using errcode = '22023'; end if;",
    "return public.record_class_count_attendance(",
  ].map((part) => wrapper.indexOf(part));
  assert.ok(order.every((index) => index >= 0), `all found: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // ... and they are exactly 0043's: same message, same code, same order.
  const original = functionText(M43, "record_class_count_attendance(");
  assert.ok(original.indexOf("raise exception 'Not authorized.'") < original.indexOf("raise exception 'A membership and a request ID are required.' using errcode = '22023'"));
  assert.ok(original.includes("raise exception 'A membership and a request ID are required.' using errcode = '22023'"));
  // The signature of 0043 is unchanged.
  assert.match(functionText(M43, "record_class_count_attendance("), /\( p_membership_id uuid, p_request_id uuid \) returns jsonb/);
  for (const signature of ["record_class_count_attendance(uuid, uuid, date)", "record_class_count_attendance(uuid, uuid)", "reverse_class_count_attendance(uuid, text, uuid)"]) {
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${escaped} from public, anon;\\s+grant execute on function public\\.${escaped} to authenticated;`), signature);
  }
});

test("reversing: Admin, a trimmed 3-500 character reason, lock, replay, once only - and no check of the membership's status", () => {
  const body = functionText(SQL, "reverse_class_count_attendance(");
  assert.match(body, /\( p_attendance_id uuid, p_reason text, p_request_id uuid \) returns jsonb language plpgsql security definer set search_path = ''/);
  const order = [
    "if not public.is_admin() then",
    "p_attendance_id is null or p_request_id is null",
    "v_reason := regexp_replace(coalesce(p_reason, ''), '^\\s+|\\s+$', '', 'g');",
    "length(v_reason) < 3 or length(v_reason) > 500",
    "from public.class_count_attendance where id = p_attendance_id;",
    "where id = v_att.membership_id for update;",
    "where request_id = p_request_id;",
    "v_existing.attendance_id <> p_attendance_id",
    "where r.attendance_id = p_attendance_id",
    "insert into public.class_count_attendance_reversals (attendance_id, reason, reversed_by, request_id)",
  ].map((part) => body.indexOf(part));
  assert.ok(order.every((index) => index >= 0), `all found: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "in this order");
  for (const [message, code] of [
    ["Not authorized.", "42501"],
    ["An attendance record and a request ID are required.", "22023"],
    ["Enter a reason of 3 to 500 characters.", "22023"],
    ["Attendance record not found.", "P0002"],
    ["This request ID has already been used for another attendance record.", "23505"],
    ["This class has already been reversed.", "55000"],
  ]) {
    assert.ok(body.includes(`raise exception '${message}' using errcode = '${code}'`), `${code} ${message}`);
  }
  assert.match(body, /values \(p_attendance_id, v_reason, auth\.uid\(\), p_request_id\)/);
  // A reversal corrects a record that exists: it never looks at the membership's cancellation, dates or the student.
  assert.doesNotMatch(body, /cancelled_at|start_date|end_date|v_today|students|kind/);
  // It never edits or removes the original record.
  assert.doesNotMatch(body, /update public\.|delete from|insert into public\.class_count_attendance \(/);
  assert.match(body, /'classes_remaining', v_mem\.total_classes - v_used/);
});

test("the memberships guard: the freeze of kind and student follows ANY record; the class-total floor follows the NET count", () => {
  const guard = functionText(SQL, "memberships_class_count_history_guard(");
  assert.match(guard, /select count\(\*\) into v_history from public\.class_count_attendance where membership_id = old\.id;/);
  assert.match(guard, /if v_history = 0 then return new;/);
  assert.match(guard, /new\.kind is distinct from old\.kind then raise exception 'The type of a membership with recorded classes cannot be changed\.' using errcode = '55006'/);
  assert.match(guard, /new\.student_id is distinct from old\.student_id then raise exception 'The student of a membership with recorded classes cannot be changed\.' using errcode = '55006'/);
  assert.match(guard, /v_used := public\.class_count_net_used\(old\.id\);/);
  assert.match(guard, /new\.total_classes is distinct from old\.total_classes and \(new\.total_classes is null or new\.total_classes < v_used\) then raise exception 'The class total cannot be less than the classes already recorded\.' using errcode = '23514'/);
  // The same messages as 0044, and the trigger of 0044 is untouched (the function is replaced in place).
  for (const message of [
    "The type of a membership with recorded classes cannot be changed.", "The student of a membership with recorded classes cannot be changed.",
    "The class total cannot be less than the classes already recorded.",
  ]) assert.ok(M44.includes(message), message);
  assert.doesNotMatch(SQL, /create trigger memberships_class_count_history_guard_trigger/);
});

// ---- the verification script ---------------------------------------------------------------------------------------------------------

test("the script runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SCRIPT_SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SCRIPT_SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SCRIPT_SQL.indexOf("begin;") < SCRIPT_SQL.indexOf("rollback;"));
  assert.doesNotMatch(SCRIPT_SQL, /\bcommit\b(?!\s+drop)/i);
  assert.doesNotMatch(SCRIPT_SQL, /\bsavepoint\b|\brelease\b/i);
  assert.match(SCRIPT_SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.match(SCRIPT_SQL, /create temp table _fixture_ids[\s\S]*?on commit drop;/);
  assert.ok(SCRIPT_SQL.indexOf("'SUMMARY'") < SCRIPT_SQL.lastIndexOf("rollback;"));
  for (const heading of ["-- PREREQUISITES", "-- SAFETY - ROLLBACK ONLY", "-- LIMITATIONS", "-- AFTER THE ROLLBACK"]) assert.ok(SCRIPT.includes(heading), heading);
  assert.match(SCRIPT, /Concurrency[\s\S]*?NOT[\s\S]{0,12}tested/);
});

test("it checks that 0045 is applied and that its phone numbers are free before creating anything, and resolves no table at block start", () => {
  const body = SCRIPT_SQL.slice(SCRIPT_SQL.indexOf("do $$"));
  const p0 = body.indexOf("P0 migration 0045 is applied");
  const p1 = body.indexOf("P1 none of the fixture phone numbers");
  assert.ok(p0 > 0 && p1 > p0);
  for (const early of ["pg_temp.student(", "pg_temp.mem(", "insert into _fixture_ids"]) {
    assert.ok(body.indexOf(early) > p1, `${early} comes after the preflight`);
  }
  for (let n = 1; n <= 11; n += 1) assert.ok(SCRIPT.includes(`'90004500${String(n).padStart(2, "0")}'`), `phone ${n}`);
  assert.match(SCRIPT_SQL, /elsif v_clash > 0 then\s+perform pg_temp\.skip\('T \/ D \/ E \/ W \/ R \/ X \/ F \/ A', 'preflight P1 failed/);
  assert.doesNotMatch(SCRIPT_SQL.replace(/--[^\n]*$/gm, ""), /%rowtype/, "only a comment may mention it");
  assert.match(SCRIPT_SQL, /create function pg_temp\.net\(p_membership uuid\)\s+returns integer language plpgsql/);
});

test("it covers every behaviour of the migration", () => {
  for (const id of [
    "P0 ", "P1 ",
    "T1 ", "T2 ", "T3 ", "T4 ", "T5 ", "T6 ", "T7 ", "T8 ", "T9 ", "T10 ", "T11 ", "T12 ",
    "D1 ", "D2 ", "D3 ", "D4 ", "D5 ", "D6 ", "D7 ", "D8 ", "D9 ", "D10 ", "D11 ",
    "E1 ", "E2 ", "E3 ", "E4 ", "E5 ", "E6 ", "E7 ",
    "W1 ", "W2 ",
    "R0 ", "R0b ", "R1 ", "R2 ", "R2b ", "R3 ", "R4 ", "R5 ", "R5b ", "R6 ", "R7 ", "R8 ", "R8b ", "R9 ", "R9b ",
    "X1 ", "X2 ",
    "F0 ", "F1 ", "F2 ", "F3 ", "F4 ", "G0 ", "G1 ", "G2 ", "G3 ",
    "A1 ", "A2 ", "A3 ",
    "Z1 ", "Z2 ", "Z3 ", "Z4 ",
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  assert.match(SCRIPT_SQL, /'PASS' else 'FAIL'/);
  assert.match(SCRIPT_SQL, /'NOT TESTED'/);
  assert.match(SCRIPT_SQL, /'ALL PASS' else 'FAILURES'/);
});

test("it writes only disposable ZZVERIFY fixtures, tracked by id, and fingerprints everything that existed before", () => {
  assert.match(SCRIPT_SQL, /'ZZVERIFY '/);
  assert.doesNotMatch(SCRIPT_SQL, /MEM-0000\d\d|YC-0000\d\d/);
  const inserts = new Set([...SCRIPT_SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]));
  // students and memberships are fixtures; the reversals inserts are the table-level reason checks, every one of which must fail.
  assert.deepEqual([...inserts].sort(), ["class_count_attendance_reversals", "memberships", "students"]);
  const updates = new Set([...SCRIPT_SQL.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...updates].sort(), ["class_count_attendance_reversals", "memberships"]);
  assert.doesNotMatch(SCRIPT_SQL, /\bdelete\s+from\s+public\.(?!class_count_attendance_reversals)|\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  assert.match(SCRIPT_SQL, /insert into _fixture_ids \(tbl, id\) select 'students', x from unnest\(v_s\)/);
  assert.match(SCRIPT_SQL, /insert into _fixture_ids \(tbl, id\) select 'memberships', x from unnest\(v_m\)/);
  for (const [table, hash] of [["memberships", "v_mem_hash"], ["attendance", "v_att_hash"], ["class_count_attendance", "v_cca_hash"], ["class_count_attendance_reversals", "v_rev_hash"]]) {
    assert.match(SCRIPT_SQL, new RegExp(`from public\\.${table}\\b`), table);
    assert.ok(SCRIPT_SQL.indexOf(`${hash}0`) < SCRIPT_SQL.indexOf(`${hash}1`) && SCRIPT_SQL.includes(`${hash}0 = ${hash}1`), hash);
  }
  // Before the run: every row, no exclusion.
  assert.match(SCRIPT_SQL, /into v_mem_hash0 from public\.memberships m;/);
  assert.match(SCRIPT_SQL, /into v_cca_hash0 from public\.class_count_attendance c;/);
});

test("the messages and SQLSTATEs the script expects are the ones the migration raises", () => {
  const raised = new Set([...SQL.matchAll(/raise exception '([^']+)' using errcode = '(\w+)'/g)].map((m) => `${m[2]} ${m[1]}`));
  for (const text of [
    "22023 A membership, a request ID and an attendance date are required.",
    "22023 The attendance date cannot be in the future.",
    "22023 The attendance date cannot be before the membership starts.",
    "23505 This request ID has already been used with a different attendance date.",
    "55000 No classes remain on this membership.",
    "55000 This membership is cancelled.",
    "55000 This membership has expired.",
    "55000 This membership has not started yet.",
    "55000 The student is not active.",
    "22023 Only a class-count membership can record class attendance.",
    "P0002 Membership not found.",
    "22023 Enter a reason of 3 to 500 characters.",
    "23505 This request ID has already been used for another attendance record.",
    "55000 This class has already been reversed.",
    "P0002 Attendance record not found.",
    "55006 The type of a membership with recorded classes cannot be changed.",
    "55006 The student of a membership with recorded classes cannot be changed.",
    "23514 The class total cannot be less than the classes already recorded.",
  ]) {
    assert.ok(raised.has(text), `the migration raises: ${text}`);
    assert.ok(SCRIPT_SQL.includes(text.slice(text.indexOf(" ") + 1)), `the script expects: ${text}`);
  }
  assert.ok(raised.has("55006 Class count attendance reversals cannot be changed or deleted."));
  assert.ok((SCRIPT_SQL.match(/like '55006 %'/g) ?? []).length >= 3);
  // The result keys it reads exist in the functions' results.
  const record = functionText(SQL, "record_class_count_attendance(", 0);
  const reverse = functionText(SQL, "reverse_class_count_attendance(");
  for (const key of ["attendance_id", "attended_on", "classes_used", "classes_remaining", "replayed"]) {
    assert.ok(record.includes(`'${key}'`) && reverse.includes(key === "attendance_id" ? `'${key}'` : `'${key}'`), key);
  }
});

test("the cleanup query finds the fixtures by their exact phone numbers", () => {
  const cleanup = SCRIPT.slice(SCRIPT.lastIndexOf("-- AFTER THE ROLLBACK"));
  assert.doesNotMatch(cleanup, /like 'ZZVERIFY/);
  for (let n = 1; n <= 11; n += 1) assert.ok(cleanup.includes(`'90004500${String(n).padStart(2, "0")}'`), `phone ${n}`);
  for (const column of ["leftover_students", "leftover_memberships", "leftover_records", "leftover_reversals"]) assert.ok(cleanup.includes(column), column);
});

test("whitespace-only reasons - tabs and newlines included - are checked in the script, in the function and in the table", () => {
  assert.ok(SCRIPT.includes("E'\\t\\n\\t\\r\\n  '"), "tabs, newlines and spaces only");
  assert.ok(SCRIPT.includes("E'\\n\\n\\n\\n'"), "newlines only");
  assert.ok(SCRIPT.includes("E'\\tab\\n'"), "whitespace around a too-short value");
  assert.ok(SCRIPT.includes("E''\\t\\n\\t''") && SCRIPT.includes("E''abc\\n''"), "the table's own check");
});

test("the 0043 script's truncate check accepts only a refusal - by the trigger (55006) or the new foreign key (0A000) - and still needs CASCADE refused", () => {
  const script = read("../../supabase/verification/verify_0043_class_count_attendance_behavior.sql");
  const h3 = script.slice(script.indexOf("v_msg := pg_temp.run_owner('truncate public.class_count_attendance');"), script.indexOf("'H4 "));
  assert.match(h3, /\(v_msg like '55006 %' or v_msg like '0A000 %'\) and v_out like '55006 %' and pg_temp\.used\(v_ma\) = 3 and pg_temp\.used\(v_mb\) = 2/);
  assert.match(h3, /pg_temp\.run_owner\('truncate public\.class_count_attendance cascade'\)/);
  assert.match(h3, /to_regclass\('public\.class_count_attendance_reversals'\) is null/);
  // Success, or any other code, is not accepted.
  assert.doesNotMatch(h3, /like 'OK|= 'OK'|0A000 %'\) or|\|\| true/);
  // The migration that adds the foreign key is the one the check is about.
  assert.match(SQL, /attendance_id\s+uuid not null references public\.class_count_attendance \(id\) on delete restrict/);
});
