// Run with `npm test` (Node's built-in test runner).
//
// Migration 0049 (V1 Fee Structure, FS-7 step 1: audited class-count expiry edits) is SQL applied and run by hand in Supabase, so it
// is not executed here, and nothing in this file shows how PostgreSQL will treat it. These tests pin what can be pinned without a
// database: that it adds one table and functions and updates no existing row, that the edit function is Admin-only and changes
// the expiry and writes its audit row together, that the guard refuses every other change of a class-count end_date, and that
// the approved rules (reason, No expiry, nothing else touched) are in the SQL text.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function normalize(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(:=|<=|>=|<>|->>|=|<|>)\s*/g, " $1 ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+;/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (text, fragment) => assert.ok(text.includes(normalize(fragment)), `missing: ${fragment}`);

const MIGRATIONS = "../../supabase/migrations/";
const FILE = "0049_class_count_expiry_edits.sql";
const RAW = read(`${MIGRATIONS}${FILE}`);
const SQL = normalize(RAW);
const SCRIPT_RAW = read("../../supabase/verification/verify_0049_class_count_expiry_edits_behavior.sql");
const SCRIPT = normalize(SCRIPT_RAW);

function functionText(name) {
  const from = RAW.indexOf(`create or replace function public.${name}(`);
  assert.ok(from >= 0, name);
  const to = RAW.indexOf("\n$$;", from);
  assert.ok(to > from, `${name} end`);
  return normalize(RAW.slice(from, to + 4));
}

test("0049 follows 0048 and checks that 0042-0045, 0048 and is_admin exist", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf(FILE) - 1], "0048_package_linked_memberships.sql");
  const pre = SQL.slice(0, SQL.indexOf("create table if not exists"));
  has(pre, "to_regclass('public.class_count_attendance_reversals') is null");
  has(pre, "to_regprocedure('public.memberships_package_guard()') is null");
  has(pre, "to_regprocedure('public.is_admin()') is null");
  has(pre, "to_regprocedure('public.memberships_sync_invoice()') is null");
  has(pre, "0049 needs migration 0030");
  // The header says what a later re-run of 0030 or 0048 undoes.
  assert.match(RAW, /RE-RUNNING OTHER MIGRATIONS[\s\S]*Re-apply 0049 after re-running either of them/);
});

test("0049 changes no existing row: its only statements outside functions create objects", () => {
  const outsideFunctions = SQL.replace(/create or replace function[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(insert into|delete from|update public\.|truncate public)/);
  assert.doesNotMatch(SQL, /\b(drop table|drop column|drop constraint)/);
  assert.doesNotMatch(SQL, /alter table public\.(?!class_count_expiry_edits )/, "only its own table is altered");
  assert.doesNotMatch(SQL, /grant (insert|update|delete|all) on/);
});

test("the audit table records membership, previous and new expiry (NULL = No expiry), reason, editor and time", () => {
  const table = SQL.slice(SQL.indexOf("create table if not exists public.class_count_expiry_edits"), SQL.indexOf("comment on table"));
  has(table, "membership_id uuid not null references public.memberships (id) on delete restrict");
  has(table, "previous_expiry date,");
  has(table, "new_expiry date,");
  has(table, "reason text not null");
  has(table, "edited_by uuid references auth.users (id) on delete set null");
  has(table, "edited_at timestamptz not null default now()");
  has(table, "check (previous_expiry is distinct from new_expiry)");
  has(table, "reason = regexp_replace(reason, '^\\s+|\\s+$', '', 'g') and length(reason) between 3 and 500");
});

test("the history is Admin-readable only, never writable by a client, and append-only even for the owner", () => {
  has(SQL, "alter table public.class_count_expiry_edits enable row level security;");
  has(SQL, "revoke all on public.class_count_expiry_edits from public, anon, authenticated;");
  has(SQL, "grant select on public.class_count_expiry_edits to authenticated;");
  has(SQL, "using (public.is_admin())");
  const readonly = functionText("class_count_expiry_edits_readonly");
  has(readonly, "raise exception 'Class count expiry edits cannot be changed or deleted.' using errcode = '55006';");
  has(readonly, "old.edited_by is not null and new.edited_by is null");
  has(SQL, "before update or delete on public.class_count_expiry_edits for each row");
  has(SQL, "before truncate on public.class_count_expiry_edits for each statement");
});

test("edit_class_count_expiry: Admin first, a trimmed 3-500 character reason, the row locked, the rules, nothing else changed", () => {
  const body = functionText("edit_class_count_expiry");
  has(body, "language plpgsql security definer set search_path = ''");
  assert.ok(body.indexOf("begin if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;") > 0, "the Admin check opens the body");
  has(body, "v_reason := regexp_replace(coalesce(p_reason, ''), '^\\s+|\\s+$', '', 'g');");
  has(body, "if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';");
  has(body, "select * into v_mem from public.memberships where id = p_membership_id for update;");
  has(body, "if v_mem.kind <> 'class_count' then raise exception 'Only a class-count membership has an expiry to edit.' using errcode = '55000';");
  has(body, "if p_new_expiry is not null and p_new_expiry < v_mem.start_date then raise exception 'The expiry date cannot be before the start date.' using errcode = '22023';");
  has(body, "if p_new_expiry is not distinct from v_mem.end_date then raise exception 'The expiry is unchanged.' using errcode = '22023';");
  // The edit changes end_date and nothing else of the membership, then writes its audit row.
  has(body, "update public.memberships set end_date = p_new_expiry where id = v_mem.id;");
  assert.equal([...body.matchAll(/update public\./g)].length, 1, "one update only");
  assert.doesNotMatch(body, /class_count_attendance|total_classes|amount|reversal/, "no attendance, allowance, fee or reversal is touched");
  has(body, "insert into public.class_count_expiry_edits (membership_id, previous_expiry, new_expiry, reason, edited_by) values (v_mem.id, v_mem.end_date, p_new_expiry, v_reason, auth.uid()) returning id into v_id;");
  assert.ok(body.indexOf("perform set_config('yoga.class_count_expiry_edit', v_mem.id::text, true);") < body.indexOf("update public.memberships"), "the flag is set before the update");
  assert.ok(body.indexOf("update public.memberships") < body.indexOf("perform set_config('yoga.class_count_expiry_edit', '', true);"), "and cleared right after it");
  assert.ok(body.indexOf("perform set_config('yoga.class_count_expiry_edit', '', true);") < body.indexOf("insert into public.class_count_expiry_edits"));
  has(body, "return v_id;");
});

test("the guard refuses every other change of a class-count end_date, for any role", () => {
  const guard = functionText("memberships_class_count_expiry_guard");
  has(guard, "(old.kind = 'class_count' or new.kind = 'class_count') and new.end_date is distinct from old.end_date and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') <> old.id::text");
  has(guard, "using errcode = '55006'");
  has(SQL, "create trigger memberships_class_count_expiry_guard_trigger before update on public.memberships for each row");
  // Not a security-definer trigger that could be bypassed by role: it is a plain row trigger on every update of memberships.
  assert.doesNotMatch(guard, /is_admin|auth\.uid/);
});

test("0048's package guard is re-created with the one exemption and every other protection intact", () => {
  const next = functionText("memberships_package_guard");
  const previous = normalize(read(`${MIGRATIONS}0048_package_linked_memberships.sql`));
  const previousGuard = previous.slice(previous.indexOf("create or replace function public.memberships_package_guard()"), previous.indexOf("comment on function public.memberships_package_guard()"));
  // The same refusals, with the same messages and codes.
  for (const message of [
    "A package membership is created with create_membership_from_package().",
    "An existing membership cannot be linked to a package.",
    "The package, fee, discounts and terms of a package membership cannot be edited directly.",
  ]) {
    assert.ok(previousGuard.includes(message) && next.includes(message), message);
  }
  // The one change: end_date is read from OLD while this membership's expiry edit is in progress.
  has(next, "v_expiry_edit := old.kind = 'class_count' and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') = old.id::text;");
  has(next, "v_new_end := case when v_expiry_edit then old.end_date else new.end_date end;");
  assert.equal([...next.matchAll(/v_new_end/g)].length, 4, "declared, defined, and used in both comparisons");
  for (const column of ["new.amount", "new.currency", "new.package_id", "new.fee_entry_id", "new.standard_fee", "new.total_classes", "new.start_date", "new.package_discount"]) {
    assert.ok(next.includes(column), column + " is still compared");
  }
});

test("an expiry edit never rewrites an issued membership-level receipt; every other sync still fires", () => {
  has(SQL, "create trigger memberships_sync_invoice_trigger after update of amount, plan, start_date, end_date on public.memberships for each row when (");
  has(SQL, "(old.amount is distinct from new.amount or old.plan is distinct from new.plan or old.start_date is distinct from new.start_date or old.end_date is distinct from new.end_date) and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') <> old.id::text");
  has(SQL, "execute function public.memberships_sync_invoice();");
});

test("privileges: the edit only for a signed-in user; every internal function callable by no client role", () => {
  has(SQL, "revoke execute on function public.edit_class_count_expiry(uuid, date, text) from public, anon;");
  has(SQL, "grant execute on function public.edit_class_count_expiry(uuid, date, text) to authenticated;");
  for (const name of ["class_count_expiry_edits_readonly()", "memberships_class_count_expiry_guard()"]) {
    has(SQL, `revoke execute on function public.${name} from public, anon, authenticated;`);
  }
});

test("the behaviour script is rollback-only, preflighted, and covers the FS-7 acceptance criteria", () => {
  const code = SCRIPT_RAW.replace(/--.*$/gm, "");
  assert.match(code, /^\s*begin isolation level repeatable read;/m);
  assert.match(code, /^rollback;\s*$/m);
  assert.doesNotMatch(code, /^\s*commit\s*;/im);
  has(SCRIPT, "'P0 migration 0049 is applied");
  has(SCRIPT, "package already has a fixture name (ZZVERIFY 0049");
  assert.doesNotMatch(SCRIPT_RAW, /v_pkg_ok/, "the package-linked scenarios always run: 0049 cannot be applied without 0048");
  for (const id of ["PF", "A1", "A2", "A4", "A5", "E1", "E2", "E3", "E4", "E5", "E6", "V1", "V2", "V3", "V4", "V5", "V6", "G1", "G2", "G3", "G4", "G5", "H1", "H2", "H3", "H4", "K1", "K2", "K3", "Z"]) {
    assert.ok(SCRIPT.includes(`'${id} `), id);
  }
  // It calls the edit function as an Admin and never writes the audit table or the end date of a class-count membership itself,
  // except to prove the guard refuses it.
  const writes = SCRIPT_RAW.split("\n").filter((line) => /insert into public\.class_count_expiry_edits/.test(line));
  assert.equal(writes.length, 1, "the history is written only by the function, but one statement proves a direct write is refused");
  assert.match(writes[0], /pg_temp\.as_user\(v_admin/);
  assert.match(SCRIPT, /set local role authenticated/);
});

test("the section 6A ledger records 0049 as applied, with the reported behaviour result", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0049` |"));
  assert.ok(row, "a 0049 row exists");
  assert.match(row, /Applied to `yoga-attendance-demo`; behaviour script passed — 40 passed, 0 failed, 0 not tested/);
  assert.match(row, /reported by the user/);
  assert.match(row, /If migration 0030 or 0048 is re-run afterwards, re-apply 0049/);
});
