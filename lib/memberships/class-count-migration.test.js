// Run with `npm test` (Node's built-in test runner).
//
// Migration 0042 (class-count memberships: schema and eligibility isolation) and its verification script are SQL that
// is applied and run by hand in Supabase, so neither is executed here. These tests check what can be checked without a
// database: that the migration is additive (it moves no data and edits no earlier migration), that it adds exactly the
// constraints the approved design describes, that the re-created eligibility function is 0024's definition with ONE
// added condition, and that the verification script is rollback-only, covers every behaviour, and only names tables
// and columns the migrations really create.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, "");
const squash = (sql) => noComments(sql).replace(/\s+/g, " ").trim();

const MIGRATION = read("../../supabase/migrations/0042_class_count_memberships.sql");
const SQL = noComments(MIGRATION);
const SCRIPT = read("../../supabase/verification/verify_0042_class_count_memberships_behavior.sql");
const SCRIPT_SQL = noComments(SCRIPT);

// ---- the migration ----------------------------------------------------------------------------------------------------------

test("it is additive: it moves no data, and drops nothing but the constraints it replaces", () => {
  assert.doesNotMatch(SQL, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b/i);
  assert.doesNotMatch(SQL, /\bdrop\s+(table|column|function|trigger|schema|index)\b/i);
  const dropped = [...SQL.matchAll(/drop constraint if exists (\w+)/gi)].map((m) => m[1]).sort();
  assert.deepEqual(dropped, ["invoices_plan_valid", "memberships_no_overlap_per_student", "memberships_plan_valid"]);
  // Every added column has a constant default or is nullable, so no existing row is rewritten.
  assert.match(SQL, /add column if not exists kind text not null default 'duration'/);
  assert.match(SQL, /add column if not exists total_classes integer;/);
});

test("it touches only memberships, invoices and the one eligibility function", () => {
  const altered = new Set([...SQL.matchAll(/alter table public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...altered].sort(), ["invoices", "memberships"]);
  const functions = [...SQL.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(functions, ["resolve_eligible_students"]);
  // No document, payment or attendance-saving function is re-created, and nothing about class recording is added.
  assert.doesNotMatch(SQL, /issue_invoice_core|sync_invoice_from_membership|record_membership_payment|save_session_attendance|class_count_attendance/);
});

test("kind and total_classes carry the approved constraints", () => {
  assert.match(SQL, /memberships_kind_valid\s+check \(kind in \('duration', 'class_count'\)\)/);
  assert.match(
    squash(SQL),
    /memberships_total_classes_by_kind check \( \(kind = 'class_count' and total_classes is not null and total_classes > 0\) or \(kind = 'duration' and total_classes is null\) \)/,
  );
  assert.match(SQL, /memberships_kind_matches_plan\s+check \(\(kind = 'class_count'\) = \(plan = 'class_count'\)\)/);
});

test("the end date is optional in the column and required for a duration membership", () => {
  assert.match(SQL, /memberships_end_date_by_kind\s+check \(kind = 'class_count' or end_date is not null\)/);
  assert.match(SQL, /alter table public\.memberships\s+alter column end_date drop not null/);
  assert.match(SQL, /alter table public\.invoices\s+alter column period_end drop not null/);
  // The requirement is added BEFORE the column is relaxed, so a duration row can never be left without an end date.
  assert.ok(SQL.indexOf("memberships_end_date_by_kind") < SQL.indexOf("alter column end_date drop not null"));
  // The existing "end not before start" checks are not touched (they pass when there is no end date).
  assert.doesNotMatch(SQL, /memberships_end_after_start|invoices_period_end_after_start/);
});

test("both plan lists keep the five existing plans and add class_count", () => {
  const before = read("../../supabase/migrations/0031_membership_plans.sql");
  assert.match(before, /check \(plan in \('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'\)\)/);
  const lists = [...SQL.matchAll(/check \(plan in \(([^)]*)\)\)/g)].map((m) => m[1]);
  assert.equal(lists.length, 2);
  for (const list of lists) {
    assert.equal(list, "'monthly', 'quarterly', 'half_yearly', 'annual', 'custom', 'class_count'");
  }
  assert.match(SQL, /alter table public\.memberships\s+add constraint memberships_plan_valid/);
  assert.match(SQL, /alter table public\.invoices\s+add constraint invoices_plan_valid/);
});

test("the overlap constraint keeps its name, range and cancelled exclusion, and gains only the duration scope", () => {
  const original = squash(read("../../supabase/migrations/0008_memberships.sql"));
  assert.match(
    original,
    /add constraint memberships_no_overlap_per_student exclude using gist \( student_id with =, daterange\(start_date, end_date, '\[\]'\) with && \) where \(cancelled_at is null\);/,
  );
  assert.match(
    squash(SQL),
    /add constraint memberships_no_overlap_per_student exclude using gist \( student_id with =, daterange\(start_date, end_date, '\[\]'\) with && \) where \(cancelled_at is null and kind = 'duration'\);/,
  );
  // The application names this constraint to turn the database refusal into a field error, so it must not be renamed.
  assert.match(read("./actions.js"), /memberships_no_overlap_per_student/);
});

test("resolve_eligible_students is 0024's definition with exactly one added condition", () => {
  const functionText = (sql, from, to) => {
    const start = sql.indexOf(from);
    assert.ok(start >= 0, from);
    const end = to ? sql.indexOf(to, start) : sql.length;
    assert.ok(end > start, to);
    return squash(sql.slice(start, end));
  };
  const signature = "create or replace function public.resolve_eligible_students(";
  const previous = functionText(read("../../supabase/migrations/0024_center_regional_settings.sql"), signature, "create or replace function public.save_session_attendance(");
  const next = functionText(MIGRATION, signature, "comment on function public.resolve_eligible_students");

  assert.ok(next.includes("and m.kind = 'duration'"));
  assert.equal(next.split("m.kind").length - 1, 1, "the kind is mentioned once");
  assert.equal(next.replace(" and m.kind = 'duration'", ""), previous, "everything else is 0024's, token for token");

  // The pieces that matter to existing behaviour are all still there: authorization, the frozen set, the series
  // assignment, the cancelled-as-of-the-date rule and the tie-break.
  for (const part of [
    "public.is_admin() or public.can_access_session(p_schedule_id, p_session_date)",
    "cs.eligibility_snapshot_at",
    "from public.class_session_eligible_students e",
    "es.schedule_series_id = v_series_id",
    "p_session_date < (m.cancelled_at at time zone public.centre_timezone())::date",
    "order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc",
  ]) {
    assert.ok(next.includes(part), part);
  }
});

test("0024 is still the latest definition of the function the migration replaces", () => {
  // If a later migration (0025-0041) redefined it, 0042 would silently undo that change.
  const names = [
    "0025_payment_date_invoice_settings", "0026_invoices", "0027_invoice_prefix", "0028_bank_accounts", "0029_invoice_bank_account_snapshot",
    "0030_invoice_membership_sync", "0031_membership_plans", "0032_system_usage", "0033_membership_service_details", "0034_membership_payments",
    "0035_tax_invoice_preferences", "0036_payment_documents", "0037_invoice_corrections", "0038_payment_amount_edits",
    "0039_prevent_duplicate_documents", "0040_edit_payment_details", "0041_gstin_settings",
  ];
  for (const name of names) {
    assert.doesNotMatch(read(`../../supabase/migrations/${name}.sql`), /function public\.resolve_eligible_students\(/, name);
  }
});

test("earlier migrations still say what they said (0042 supersedes them without editing them)", () => {
  assert.match(read("../../supabase/migrations/0008_memberships.sql"), /end_date\s+date not null,/);
  assert.match(read("../../supabase/migrations/0026_invoices.sql"), /period_end\s+date not null,/);
  assert.match(read("../../supabase/migrations/0031_membership_plans.sql"), /memberships_plan_valid/);
});

// ---- the verification script ------------------------------------------------------------------------------------------------

test("the script runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SCRIPT_SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SCRIPT_SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SCRIPT_SQL.indexOf("begin;") < SCRIPT_SQL.indexOf("rollback;"));
  assert.doesNotMatch(SCRIPT_SQL, /\bcommit\b(?!\s+drop)/i);
  assert.doesNotMatch(SCRIPT_SQL, /\bsavepoint\b|\brelease\b/i);
  assert.match(SCRIPT_SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.ok(SCRIPT_SQL.indexOf("'SUMMARY'") < SCRIPT_SQL.lastIndexOf("rollback;"));
  assert.match(SCRIPT, /-- SAFETY - ROLLBACK ONLY/);
  assert.match(SCRIPT, /-- PREREQUISITES/);
  assert.match(SCRIPT, /-- LIMITATIONS/);
});

test("it checks that 0042 is applied first, and builds nothing before that check passes", () => {
  const p0 = SCRIPT_SQL.indexOf("P0 migration 0042 is applied");
  assert.ok(p0 > 0);
  const body = SCRIPT_SQL.slice(SCRIPT_SQL.indexOf("do $$"));
  const first = (needle) => body.indexOf(needle);
  assert.ok(first("pg_temp.student(") > first("if not v_ready then"), "no fixture before the readiness branch");
  assert.ok(first("insert into public.batches") > first("if not v_ready then"));
  assert.match(SCRIPT_SQL, /if not v_ready then\s+perform pg_temp\.skip\('C \/ K \/ O \/ E', 'migration 0042 is not applied'\);/);
});

test("it covers every behaviour of the migration", () => {
  for (const id of [
    "P0 ",
    "C1 ", "C2 ", "C3 ", "C4 ", "C5 ", "C6 ",
    "K1 ", "K2 ", "K3 ", "K4 ", "K5 ", "K6 ", "K7 ", "K8 ",
    "O1 ", "O2 ", "O3 ", "O4 ", "O5 ", "O6 ", "O7 ",
    "E0 ", "E1 ", "E2 ", "E3 ", "E4 ", "E5 ", "E6 ", "E7 ", "E8 ", "E9 ", "E10 ",
    "Z1 ", "Z2 ", "Z3 ",
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  assert.match(SCRIPT_SQL, /'PASS' else 'FAIL'/);
  assert.match(SCRIPT_SQL, /'NOT TESTED'/);
  assert.match(SCRIPT_SQL, /'ALL PASS' else 'FAILURES'/);
});

test("it writes only disposable ZZVERIFY fixtures, and fingerprints what exists", () => {
  const inserts = new Set([...SCRIPT_SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual(
    [...inserts].sort(),
    ["batch_enrollments", "batches", "class_session_eligible_students", "class_sessions", "enrollment_schedules", "memberships", "schedule_series", "schedules", "students"],
  );
  assert.doesNotMatch(SCRIPT_SQL, /\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  assert.doesNotMatch(SCRIPT_SQL, /MEM-0000\d\d|YC-0000\d\d/);
  assert.match(SCRIPT_SQL, /'ZZVERIFY '/);
  for (const table of ["memberships", "invoices", "attendance"]) {
    assert.match(SCRIPT_SQL, new RegExp(`from public\\.${table}`), table);
  }
  for (const hash of ["v_mem_hash", "v_inv_hash", "v_att_hash"]) {
    assert.ok(SCRIPT_SQL.indexOf(`${hash}0`) < SCRIPT_SQL.indexOf(`${hash}1`) && SCRIPT_SQL.includes(`${hash}0 = ${hash}1`), hash);
  }
  // The AFTER-ROLLBACK cleanup check and the before/after-migration comparison are documented.
  assert.match(SCRIPT, /-- AFTER THE ROLLBACK/);
  assert.match(SCRIPT, /BEFORE \/ AFTER THE MIGRATION/);
});

test("the expectations in the script follow from its own setup", () => {
  // Five eligibility fixtures plus one with no membership; only the two with a duration membership are returned.
  for (const label of ["0042 E duration", "0042 E class-count fixed", "0042 E class-count no expiry", "0042 E both", "0042 E cancelled duration + class-count", "0042 E no membership"]) {
    assert.ok(SCRIPT.includes(`'${label}'`), label);
  }
  assert.match(SCRIPT_SQL, /unnest\(array\[v_s1, v_s2, v_s3, v_s4, v_s5, v_s7\]\)/);
  assert.match(SCRIPT_SQL, /unnest\(array\[v_s1, v_s4\]\)/);
  // The result columns it expects are the function's.
  assert.match(
    SCRIPT_SQL,
    /TABLE\(student_id uuid, full_name text, phone text, student_code text, membership_start_date date, membership_end_date date\)/,
  );
  // The SQLSTATEs: 23514 check violation, 23P01 exclusion violation.
  assert.ok((SCRIPT_SQL.match(/= '23514'/g) ?? []).length >= 8);
  assert.ok((SCRIPT_SQL.match(/= '23P01'/g) ?? []).length >= 2);
  // Overlap between two class-count memberships is only reported, never asserted: no rule is decided for it.
  assert.match(SCRIPT_SQL, /pg_temp\.info\('O7 two overlapping class-count memberships of one student'/);
});

test("every table and column the script writes exists in the migrations", () => {
  const all = [
    "0006_students", "0005_batches", "0007_batch_enrollments", "0009_schedules", "0010_class_sessions", "0013_schedule_assignment", "0015_class_session_eligible_students",
  ].map((name) => read(`../../supabase/migrations/${name}.sql`)).join("\n");
  for (const table of ["students", "batches", "schedule_series", "schedules", "batch_enrollments", "enrollment_schedules", "class_sessions", "class_session_eligible_students"]) {
    assert.match(all, new RegExp(`create table (if not exists )?public\\.${table}\\b`), table);
  }
  assert.match(all, /eligibility_snapshot_at timestamptz/);
  for (const column of ["membership_start_date", "membership_end_date", "provenance", "class_session_id", "student_id"]) {
    assert.match(read("../../supabase/migrations/0015_class_session_eligible_students.sql"), new RegExp(`\\b${column}\\b`), column);
  }
  // The membership columns the script writes, including the two 0042 adds and the currency column it shares with 0040's fixtures.
  assert.match(SCRIPT_SQL, /insert into public\.memberships \(student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency, cancelled_at\)/);
  assert.match(read("../../supabase/migrations/0033_membership_service_details.sql") + read("../../supabase/migrations/0026_invoices.sql"), /\bcurrency\b/);
});
