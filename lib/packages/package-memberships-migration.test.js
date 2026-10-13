// Run with `npm test` (Node's built-in test runner).
//
// Migration 0048 (V1 Fee Structure, FS-5: package-linked memberships, pricing in the database, fee-conflict detection) is SQL
// applied and run by hand in Supabase, so it is not executed here. These tests pin what can be pinned without a database -
// that it adds columns, a CHECK, guards and functions and changes no existing row, and that the approved rules are in the
// SQL text. They prove nothing about how PostgreSQL treats the file; the behaviour script does, once it is run.

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
const FILE = "0048_package_linked_memberships.sql";
const RAW = read(`${MIGRATIONS}${FILE}`);
const SQL = normalize(RAW);
const BEHAVIOUR = normalize(read("../../supabase/verification/verify_0048_package_linked_memberships_behavior.sql"));

function functionText(name) {
  const from = RAW.indexOf(`create or replace function public.${name}(`);
  assert.ok(from >= 0, name);
  const to = RAW.indexOf("\n$$;", from);
  assert.ok(to > from, `${name} end`);
  return normalize(RAW.slice(from, to + 4));
}

test("0048 follows 0047 and checks that 0046, 0047 and 0042 are applied", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf(FILE) - 1], "0047_package_fee_functions.sql");
  const pre = SQL.slice(0, SQL.indexOf("alter table public.memberships"));
  has(pre, "to_regclass('public.packages') is null");
  has(pre, "to_regprocedure('public.package_clean_reason(text)') is null");
  has(pre, "column_name = 'kind'");
});

test("0048 changes no existing row and touches no earlier trigger, policy or grant", () => {
  const outsideFunctions = SQL.replace(/create or replace function[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(insert into|delete from|update public\.|truncate)/);
  assert.doesNotMatch(SQL, /\b(create table|create policy|drop table|drop column|drop constraint)/);
  assert.doesNotMatch(SQL, /grant (select|insert|update|delete|all) on/);
  // The only triggers are its own.
  const triggers = [...SQL.matchAll(/create (?:constraint )?trigger (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(triggers, ["invoices_package_membership_guard_trigger", "memberships_package_guard_trigger", "package_fee_entries_conflict_trigger"]);
});

test("every new membership column is nullable, so a legacy row is untouched", () => {
  const columns = SQL.match(/alter table public\.memberships add column if not exists[\s\S]*?;/)[0];
  assert.doesNotMatch(columns, /not null|default/);
  for (const name of ["package_id", "fee_entry_id", "package_name", "duration_months", "pricing_mode", "standard_fee", "package_discount",
    "individual_discount_type", "individual_discount_value", "individual_discount_amount", "individual_discount_reason_code",
    "individual_discount_note", "custom_fee_reason", "custom_fee_confirmed_by", "custom_fee_confirmed_at"]) {
    assert.ok(columns.includes(`add column if not exists ${name} `) || columns.includes(` ${name} `), name);
  }
});

test("the package and fee entry are foreign keys that tie the membership to its own package and type", () => {
  has(SQL, "foreign key (package_id, kind) references public.packages (id, kind)");
  has(SQL, "foreign key (package_id, fee_entry_id) references public.package_fee_entries (package_id, id)");
  assert.equal([...SQL.matchAll(/on delete restrict/g)].length >= 2, true);
});

test("the consistency CHECK is NULL-safe and covers legacy, standard and Custom Fee Plan rows", () => {
  const check = SQL.slice(SQL.indexOf("add constraint memberships_package_consistency"));
  has(check, "check (coalesce(");
  has(check, "false));");
  has(check, "amount = standard_fee - coalesce(package_discount, 0) - coalesce(individual_discount_amount, 0)");
  has(check, "pricing_mode = 'custom_fee_plan' and fee_entry_id is null and standard_fee is null and package_discount is null");
  has(check, "char_length(custom_fee_reason) between 3 and 500 and custom_fee_confirmed_at is not null");
  has(check, "individual_discount_reason_code in ('promotional_offer', 'returning_member', 'special_approval', 'other')");
  has(check, "(individual_discount_reason_code <> 'other' or individual_discount_note is not null)");
});

test("create_membership_from_package: Admin first, package locked FOR SHARE, deactivated package refused", () => {
  const body = functionText("create_membership_from_package");
  has(body, "language plpgsql security definer set search_path = ''");
  assert.ok(body.indexOf("begin if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;") > 0);
  has(body, "select * into v_pkg from public.packages where id = p_package_id for share;");
  has(body, "if v_pkg.status <> 'active' then raise exception 'This package is deactivated and cannot be chosen for a new membership.'");
});

test("create_membership_from_package: the end date is clamped calendar months minus one day, calculated in SQL", () => {
  const body = functionText("create_membership_from_package");
  has(body, "v_end := (p_start_date + make_interval(months => v_months))::date - 1;");
  has(body, "if p_end_date is not null then raise exception 'The end date of a duration membership is calculated.'");
  has(body, "v_months not between 1 and 120");
});

test("create_membership_from_package: the fee in effect on the start date, in the centre currency, never converted or fallen back", () => {
  const body = functionText("create_membership_from_package");
  has(body, "where e.package_id = v_pkg.id and e.cancelled_at is null and e.effective_from <= p_start_date order by e.effective_from desc limit 1;");
  has(body, "if v_entry.currency <> v_currency then raise exception");
  has(body, "No fee applies to this package on the start date. Schedule a fee, or use a Custom Fee Plan.");
});

test("create_membership_from_package: package discount of the largest standard duration, then the individual discount against the rest, half up", () => {
  const body = functionText("create_membership_from_package");
  has(body, "case when v_months >= 12 then 'annual' when v_months >= 6 then 'half_yearly' when v_months >= 3 then 'quarterly' end");
  has(body, "round(v_standard * v_disc.percent_value / 100, 2)");
  has(body, "round((v_standard - v_pkg_disc) * p_individual_value / 100, 2)");
  has(body, "if v_pkg_disc + v_ind_amount > v_standard then raise exception 'The discounts together cannot be more than the standard fee.'");
  has(body, "if v_final <= 0 then raise exception 'The final fee must be greater than 0.'");
});

test("a Custom Fee Plan: no discounts, a reason, explicit confirmation, no fee entry, and the Admin and time recorded", () => {
  const body = functionText("create_membership_from_package");
  has(body, "if v_has_ind then raise exception 'A Custom Fee Plan takes no discounts.'");
  has(body, "if p_confirmed is not true then raise exception 'Confirm the Custom Fee Plan before the membership is created.'");
  has(body, "case when v_mode = 'custom_fee_plan' then auth.uid() end, case when v_mode = 'custom_fee_plan' then now() end");
  has(body, "case when v_mode = 'standard' then v_entry.id end");
});

test("the guards: a package membership is created only by the function, never edited or linked directly", () => {
  const guard = functionText("memberships_package_guard");
  has(guard, "current_setting('yoga.package_membership_create', true)");
  has(guard, "An existing membership cannot be linked to a package.");
  has(guard, "The package, fee, discounts and terms of a package membership cannot be edited directly.");
  has(functionText("create_membership_from_package"), "perform set_config('yoga.package_membership_create', 'on', true);");
  has(functionText("create_membership_from_package"), "perform set_config('yoga.package_membership_create', '', true);");
  has(functionText("invoices_package_membership_guard"), "if new.payment_id is null and exists (select 1 from public.memberships m where m.id = new.membership_id and m.package_id is not null)");
});

test("fee conflicts: a DEFERRED trigger on every entry change, comparing the date that applies, refusing with the affected memberships", () => {
  has(SQL, "create constraint trigger package_fee_entries_conflict_trigger after insert or update on public.package_fee_entries deferrable initially deferred for each row");
  const core = functionText("package_fee_conflicts_core");
  has(core, "m.pricing_mode = 'standard' and m.cancelled_at is null");
  has(core, "e.effective_from is distinct from");
  has(functionText("package_fee_entries_conflict_check"), "using errcode = '55006', detail = v_list::text");
  has(functionText("package_fee_conflicts"), "if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;");
});

test("privileges: internal functions callable by no client role, the two public ones only by a signed-in user", () => {
  for (const name of ["package_fee_conflicts_core(uuid)", "package_fee_entries_conflict_check()", "memberships_package_guard()", "invoices_package_membership_guard()"]) {
    has(SQL, `revoke execute on function public.${name} from public, anon, authenticated;`);
  }
  has(SQL, "revoke execute on function public.package_fee_conflicts(uuid) from public, anon;");
  has(SQL, "grant execute on function public.package_fee_conflicts(uuid) to authenticated;");
  const signature = "uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text";
  has(SQL, `revoke execute on function public.create_membership_from_package(${signature}) from public, anon;`);
  has(SQL, `grant execute on function public.create_membership_from_package(${signature}) to authenticated;`);
});

test("the behaviour script is rollback-only, preflighted, forces the deferred check, and covers the acceptance criteria", () => {
  const raw = read("../../supabase/verification/verify_0048_package_linked_memberships_behavior.sql").replace(/--.*$/gm, "");
  assert.match(raw, /^\s*begin( isolation level repeatable read)?;/m);
  assert.match(raw, /^rollback;\s*$/m);
  assert.doesNotMatch(raw, /^\s*commit\s*;/im);
  has(BEHAVIOUR, "'P0 migration 0048 is applied");
  has(BEHAVIOUR, "set constraints public.package_fee_entries_conflict_trigger immediate");
  for (const id of ["A1", "P1", "P2", "P3", "E1", "E2", "E3", "D1", "D2", "D3", "F1", "F2", "F3", "C1", "C2", "C3", "G1", "G2", "G3", "G4", "X1", "X2", "X3", "X4", "K1", "K2", "K3", "U1", "Q1", "Q2", "Q3", "Q4", "L1", "L2"]) {
    assert.ok(BEHAVIOUR.includes(`'${id} `), id);
  }
});
