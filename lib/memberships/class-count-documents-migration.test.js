// Run with `npm test` (Node's built-in test runner).
//
// Migration 0044 (class-count memberships: document wording and history integrity) and its verification script are SQL
// that is applied and run by hand in Supabase, so neither is executed here. These tests check what can be checked without
// a database: that each of the three document functions is its latest earlier definition TOKEN FOR TOKEN plus the one
// added `when 'class_count'` line (so issued-document behaviour, numbering, tax, snapshots and corrections cannot have
// drifted), that the guard trigger says what the approved design says, and that the verification script is rollback-only,
// covers every behaviour, and expects the messages and SQLSTATEs the migration raises.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, "");
const squash = (sql) => noComments(sql).replace(/\s+/g, " ").trim();

const MIGRATION = read("../../supabase/migrations/0044_class_count_documents_and_guard.sql");
const SQL = noComments(MIGRATION);
const SCRIPT = read("../../supabase/verification/verify_0044_class_count_documents_and_guard_behavior.sql");
const SCRIPT_SQL = noComments(SCRIPT);

const ADDED = "when 'class_count' then 'Class Count'";

/** A function from its `create or replace` to the end of its own `revoke execute` (comment and revoke included). */
function definition(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const revoke = sql.indexOf(`revoke execute on function public.${name}(`, start);
  assert.ok(revoke > start, `${name} has its revoke`);
  return squash(sql.slice(start, sql.indexOf(";", revoke) + 1));
}

// ---- the migration ------------------------------------------------------------------------------------------------------------

test("it is additive: it moves no data and changes nothing it does not name", () => {
  // Outside the function bodies (which are the earlier definitions, proven below) it runs no DML and drops nothing.
  const outsideBodies = SQL.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(outsideBodies, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b/i);
  assert.doesNotMatch(outsideBodies, /\bdrop\s+(table|column|function|schema|index)\b|alter table/i);
  // The guard's own body only reads.
  const guard = SQL.slice(SQL.indexOf("create or replace function public.memberships_class_count_history_guard()"));
  assert.doesNotMatch(guard.slice(0, guard.indexOf("$$;", guard.indexOf("as $$")) ), /\binsert\b|\bupdate\b|\bdelete\b/i);
  const functions = [...SQL.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(functions, ["issue_invoice_core", "issue_payment_document_core", "sync_invoice_from_membership", "memberships_class_count_history_guard"]);
});

test("each document function is its latest earlier definition plus exactly one added line", () => {
  const m41 = read("../../supabase/migrations/0041_gstin_settings.sql");
  const m36 = read("../../supabase/migrations/0036_payment_documents.sql");
  for (const [name, source] of [
    ["issue_invoice_core", m41],
    ["issue_payment_document_core", m41],
    ["sync_invoice_from_membership", m36],
  ]) {
    const before = definition(source, name);
    const after = definition(MIGRATION, name);
    assert.ok(after.includes(ADDED), `${name} has the class_count wording`);
    assert.equal(after.split("'class_count'").length - 1, 1, `${name}: one class_count branch`);
    assert.equal(after.replace(` ${ADDED}`, ""), before, `${name}: everything else is the earlier definition, token for token`);
    // The new branch sits straight before the existing fall-through, so no plan reads differently.
    assert.ok(after.includes(`${ADDED} else 'Custom duration' end || ' Membership'`), name);
  }
});

test("those are the latest definitions: no later migration redefines them before 0044", () => {
  const names = ["issue_invoice_core", "issue_payment_document_core", "sync_invoice_from_membership"];
  const later = ["0042_class_count_memberships", "0043_class_count_attendance"];
  const after0041 = [];
  for (const file of later) after0041.push([file, read(`../../supabase/migrations/${file}.sql`)]);
  for (const [file, text] of after0041) for (const name of names) assert.doesNotMatch(text, new RegExp(`function public\\.${name}\\(`), `${file} ${name}`);
  // And issue_payment_document_core / issue_invoice_core in 0041 are the last ones, sync in 0036 (nothing in 0037-0041 redefines it).
  for (const file of ["0037_invoice_corrections", "0038_payment_amount_edits", "0039_prevent_duplicate_documents", "0040_edit_payment_details", "0041_gstin_settings"]) {
    assert.doesNotMatch(read(`../../supabase/migrations/${file}.sql`), /function public\.sync_invoice_from_membership\(/, file);
  }
  for (const file of ["0042_class_count_memberships", "0043_class_count_attendance"]) {
    assert.doesNotMatch(read(`../../supabase/migrations/${file}.sql`), /function public\.issue_(invoice|payment_document)_core\(/, file);
  }
});

test("the privileges of the three functions are re-stated as they were: callable by no client role", () => {
  for (const signature of ["issue_invoice_core(uuid, date)", "issue_payment_document_core(uuid, date, text, uuid)", "sync_invoice_from_membership(uuid)"]) {
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(SQL, new RegExp(`revoke execute on function public\\.${escaped} from public, anon, authenticated;`), signature);
  }
});

test("the guard: after classes are recorded the kind and student are fixed, and the class total cannot go below them", () => {
  const body = squash(SQL.slice(SQL.indexOf("create or replace function public.memberships_class_count_history_guard()")));
  assert.match(body, /security definer set search_path = ''/);
  assert.match(body, /select count\(\*\) into v_used from public\.class_count_attendance where membership_id = old\.id;/);
  assert.match(body, /if v_used = 0 then return new;/);
  assert.match(body, /new\.kind is distinct from old\.kind then raise exception 'The type of a membership with recorded classes cannot be changed\.' using errcode = '55006'/);
  assert.match(body, /new\.student_id is distinct from old\.student_id then raise exception 'The student of a membership with recorded classes cannot be changed\.' using errcode = '55006'/);
  assert.match(body, /new\.total_classes is distinct from old\.total_classes and \(new\.total_classes is null or new\.total_classes < v_used\) then raise exception 'The class total cannot be less than the classes already recorded\.' using errcode = '23514'/);
  assert.match(body, /create trigger memberships_class_count_history_guard_trigger before update of kind, student_id, total_classes on public\.memberships for each row execute function public\.memberships_class_count_history_guard\(\)/);
  assert.match(SQL, /revoke execute on function public\.memberships_class_count_history_guard\(\) from public, anon, authenticated/);
});

test("it builds on 0042 and 0043", () => {
  assert.match(read("../../supabase/migrations/0042_class_count_memberships.sql"), /add column if not exists total_classes integer/);
  assert.match(read("../../supabase/migrations/0043_class_count_attendance.sql"), /create table if not exists public\.class_count_attendance/);
  assert.match(SQL, /public\.class_count_attendance/);
});

// ---- the verification script ----------------------------------------------------------------------------------------------------

test("the script runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SCRIPT_SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SCRIPT_SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SCRIPT_SQL.indexOf("begin;") < SCRIPT_SQL.indexOf("rollback;"));
  assert.doesNotMatch(SCRIPT_SQL, /\bcommit\b(?!\s+drop)/i);
  assert.doesNotMatch(SCRIPT_SQL, /\bsavepoint\b|\brelease\b/i);
  assert.match(SCRIPT_SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.ok(SCRIPT_SQL.indexOf("'SUMMARY'") < SCRIPT_SQL.lastIndexOf("rollback;"));
  for (const heading of ["-- PREREQUISITES", "-- SAFETY - ROLLBACK ONLY", "-- LIMITATIONS", "-- AFTER THE ROLLBACK"]) assert.ok(SCRIPT.includes(heading), heading);
});

test("it checks that 0044 is applied first, and builds nothing before that check passes", () => {
  const body = SCRIPT_SQL.slice(SCRIPT_SQL.indexOf("do $$"));
  const p0 = body.indexOf("P0 migration 0044 is applied");
  assert.ok(p0 > 0);
  for (const early of ["pg_temp.student(", "pg_temp.mem(", "pg_temp.pay(", "update public.invoice_settings"]) {
    assert.ok(body.indexOf(early) > p0, `${early} comes after P0`);
  }
  assert.match(SCRIPT_SQL, /elsif v_admin is null then\s+perform pg_temp\.skip\('W \/ G', 'needs an Admin profile'\)/);
  // Nothing in it is resolved when the block starts (a %rowtype of a table that may not exist yet).
  assert.doesNotMatch(SCRIPT_SQL, /class_count_attendance%rowtype/);
});

test("it covers every behaviour of the migration", () => {
  for (const id of [
    "P0 ",
    "W0 ", "W1 ", "W2 ", "W3 ", "W4 ", "W5 ", "W6 ", "W7 ",
    "G0 ", "G1 ", "G2 ", "G3 ", "G4 ", "G5 ", "G6 ", "G7 ", "G8 ", "G9 ", "G10 ",
    "Z1 ", "Z2 ", "Z3 ", "Z4 ",
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  assert.match(SCRIPT_SQL, /'PASS' else 'FAIL'/);
  assert.match(SCRIPT_SQL, /'NOT TESTED'/);
  assert.match(SCRIPT_SQL, /'ALL PASS' else 'FAILURES'/);
});

test("it writes only disposable ZZVERIFY fixtures (and the numbering for this run), and fingerprints what exists", () => {
  assert.match(SCRIPT_SQL, /'ZZVERIFY '/);
  assert.doesNotMatch(SCRIPT_SQL, /MEM-0000\d\d|YC-0000\d\d/);
  const inserts = new Set([...SCRIPT_SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...inserts].sort(), ["memberships", "students"]);
  // The only direct updates: invoice_settings (numbering for this run, rolled back) and fixture memberships.
  const updates = new Set([...SCRIPT_SQL.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...updates].sort(), ["invoice_settings", "memberships"]);
  assert.doesNotMatch(SCRIPT_SQL, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  for (const [table, hash] of [["memberships", "v_mem_hash"], ["invoices", "v_inv_hash"], ["membership_payments", "v_pay_hash"], ["class_count_attendance", "v_cca_hash"]]) {
    assert.match(SCRIPT_SQL, new RegExp(`from public\\.${table}\\b`), table);
    assert.ok(SCRIPT_SQL.indexOf(`${hash}0`) < SCRIPT_SQL.indexOf(`${hash}1`) && SCRIPT_SQL.includes(`${hash}0 = ${hash}1`), hash);
  }
});

test("the descriptions, messages and SQLSTATEs the script expects are the ones the migration produces", () => {
  // The wording: 'Class Count' || ' Membership' for class_count; the earlier ones are unchanged.
  assert.ok(SCRIPT_SQL.includes("'Class Count Membership|class_count|'"));
  assert.ok(SCRIPT_SQL.includes("'Monthly Membership|monthly|'"));
  assert.ok(SCRIPT_SQL.includes("'Custom duration Membership|custom|'"));
  const raised = new Set([...SQL.matchAll(/raise exception '([^']+)' using errcode = '(\w+)'/g)].map((m) => `${m[2]} ${m[1]}`));
  for (const text of [
    "55006 The type of a membership with recorded classes cannot be changed.",
    "55006 The student of a membership with recorded classes cannot be changed.",
    "23514 The class total cannot be less than the classes already recorded.",
  ]) {
    assert.ok(raised.has(text), `the migration raises: ${text}`);
    const message = text.slice(text.indexOf(" ") + 1);
    assert.ok(SCRIPT_SQL.includes(message), `the script expects: ${message}`);
  }
  // The period end of a no-expiry membership stays NULL on the document; a fixed validity keeps its end date.
  assert.ok(SCRIPT_SQL.includes("|NULL'"));
  assert.match(SCRIPT_SQL, /\(v_today \+ 25\)::text/);
});

test("every function and column the script uses exists in the migrations", () => {
  const all = ["0034_membership_payments", "0035_tax_invoice_preferences", "0036_payment_documents", "0037_invoice_corrections", "0041_gstin_settings", "0043_class_count_attendance"]
    .map((name) => read(`../../supabase/migrations/${name}.sql`))
    .join("\n");
  for (const fn of ["record_membership_payment", "issue_payment_document", "correct_payment_document", "issue_invoice", "record_class_count_attendance"]) {
    assert.match(all, new RegExp(`function public\\.${fn}\\(`), fn);
  }
  assert.match(SCRIPT_SQL, /public\.record_membership_payment\(%L::uuid, %L::date, %L::jsonb, false\)/);
  assert.match(SCRIPT_SQL, /public\.issue_payment_document\(%L::uuid\)/);
  assert.match(SCRIPT_SQL, /public\.correct_payment_document\(%L::uuid, %L\)/);
  assert.match(SCRIPT_SQL, /public\.record_class_count_attendance\(%L::uuid, gen_random_uuid\(\)\)/);
  assert.match(SCRIPT_SQL, /insert into public\.memberships \(student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency\)/);
});
