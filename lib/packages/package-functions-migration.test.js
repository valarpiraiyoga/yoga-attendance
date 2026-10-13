// Run with `npm test` (Node's built-in test runner).
//
// Migration 0047 (V1 Fee Structure, FS-3: the package and fee functions) is SQL applied and run by hand in Supabase, so it
// is not executed here, and nothing in this file shows how PostgreSQL will treat it. These tests pin what can be pinned
// without a database: that it adds only functions, that each public function is Admin-only and writes exactly one audit
// event, and that the rules of the approved FS-3 acceptance criteria (order of writes, the transaction time, the
// currency, the reasons) are in the SQL text. Formatting is normalized, as in packages-migration.test.js.

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
const lacks = (text, fragment) => assert.ok(!text.includes(normalize(fragment)), `unexpected: ${fragment}`);

const MIGRATIONS = "../../supabase/migrations/";
const FILE = "0047_package_fee_functions.sql";
const RAW = read(`${MIGRATIONS}${FILE}`);
const SQL = normalize(RAW);
const BEHAVIOUR_RAW = read("../../supabase/verification/verify_0047_package_fee_functions_behavior.sql");
const BEHAVIOUR = normalize(BEHAVIOUR_RAW);

// Each public function with its signature (as granted) and the one event type it writes.
const PUBLIC = [
  ["create_package", "text, text, text, integer, text[]", ["package_created"]],
  ["update_package_details", "uuid, text, text", ["details_updated"]],
  ["update_package_terms", "uuid, integer, text[], text", ["terms_updated"]],
  ["set_package_status", "uuid, text, text", ["package_deactivated", "package_activated"]],
  ["schedule_fee_entry", "uuid, date, numeric, jsonb, text", ["fee_scheduled"]],
  ["edit_fee_entry", "uuid, date, numeric, jsonb, text", ["fee_edited"]],
  ["cancel_fee_entry", "uuid, text", ["fee_cancelled"]],
  ["correct_fee_entry", "uuid, numeric, jsonb, text", ["fee_corrected"]],
];

const HELPERS = [
  ["package_trim", "text"],
  ["package_clean_reason", "text"],
  ["package_clean_options", "text[]"],
  ["package_check_amount", "numeric"],
  ["package_today", ""],
  ["package_snapshot", "uuid"],
  ["package_fee_entry_snapshot", "uuid"],
  ["package_write_fee_discounts", "uuid, jsonb, text"],
  ["package_log_event", "uuid, uuid, text, text, jsonb, jsonb"],
];

/** The normalized body of one function: from its header to its closing `$$;`. */
function functionText(name) {
  const from = RAW.indexOf(`create or replace function public.${name}(`);
  assert.ok(from >= 0, name);
  const to = RAW.indexOf("\n$$;", from);
  assert.ok(to > from, `${name} end`);
  return normalize(RAW.slice(from, to + 4));
}

const eventsWritten = (body) => [...body.matchAll(/package_log_event\(/g)].length;

// ---- scope -------------------------------------------------------------------------------------------

test("0047 follows 0046 and checks that 0046, is_admin and centre_timezone exist", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf(FILE) - 1], "0046_packages_and_fee_history.sql");
  const pre = SQL.slice(0, SQL.indexOf("create or replace function"));
  has(pre, "to_regprocedure('public.package_events_guard()') is null");
  has(pre, "raise exception '0047 needs migration 0046");
  has(pre, "to_regprocedure('public.is_admin()') is null");
  has(pre, "to_regprocedure('public.centre_timezone()') is null");
});

test("0047 adds functions only: no table, trigger, policy, grant on a table or drop, and no data statement outside a function", () => {
  assert.doesNotMatch(SQL, /\b(create table|alter table|create trigger|create policy|create index|drop )/);
  assert.doesNotMatch(SQL, /grant (select|insert|update|delete|all)/);
  const outsideFunctions = SQL.replace(/create or replace function[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(insert into|delete from|update public\.|truncate)/);
});

test("0047 creates exactly the eight public functions and nine internal helpers", () => {
  const created = [...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, [...PUBLIC.map(([name]) => name), ...HELPERS.map(([name]) => name)].sort());
});

test("no fee-conflict check and no membership link: that is FS-5", () => {
  assert.doesNotMatch(SQL, /public.memberships|membership_id/);
});

// ---- security ----------------------------------------------------------------------------------------

test("every public function is SECURITY DEFINER with an empty search_path and refuses a non-Admin (42501) before anything else", () => {
  for (const [name] of PUBLIC) {
    const body = functionText(name);
    has(body, "language plpgsql security definer set search_path = ''");
    has(body, "if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;");
    // The Admin check is the first statement of the body.
    assert.ok(body.includes("begin if not public.is_admin()"), `${name}: the Admin check opens the body`);
  }
});

test("the helpers are callable by no client role; the eight public functions only by a signed-in user", () => {
  for (const [name, signature] of HELPERS) {
    has(SQL, `revoke execute on function public.${name}(${signature}) from public, anon, authenticated;`);
    lacks(SQL, `grant execute on function public.${name}(`);
  }
  for (const [name, signature] of PUBLIC) {
    has(SQL, `revoke execute on function public.${name}(${signature}) from public, anon;`);
    has(SQL, `grant execute on function public.${name}(${signature}) to authenticated;`);
  }
});

// ---- one audit event per change ----------------------------------------------------------------------

test("each public function writes exactly one audit event, of the right type, and the helpers write none", () => {
  for (const [name, , types] of PUBLIC) {
    const body = functionText(name);
    assert.equal(eventsWritten(body), 1, `${name} writes one event`);
    for (const type of types) has(body, `'${type}'`);
  }
  for (const [name] of HELPERS.filter(([n]) => n !== "package_log_event")) {
    assert.equal(eventsWritten(functionText(name)), 0, name);
  }
  // Nothing but the logging helper writes an event row.
  assert.deepEqual([...SQL.matchAll(/insert into public\.package_events/g)].length, 1);
});

test("the event is written for the signed-in user, in the caller's transaction", () => {
  has(functionText("package_log_event"),
    "insert into public.package_events (package_id, fee_entry_id, event_type, actor, reason, before_state, after_state) values (p_package_id, p_entry_id, p_type, auth.uid(), p_reason, p_before, p_after);");
});

test("a change that changes nothing writes no event: details, terms, status and edit return early", () => {
  has(functionText("update_package_details"), "if v_pkg.name = v_name and v_pkg.description is not distinct from v_description then return; end if;");
  has(functionText("update_package_terms"), "if v_pkg.total_classes = p_total_classes then return; end if;");
  has(functionText("set_package_status"), "if v_pkg.status = p_status then return; end if;");
  has(functionText("edit_fee_entry"), "if v_after = v_before then return; end if;");
});

// ---- packages ----------------------------------------------------------------------------------------

test("a duration package keeps at least one offered option; a class-count package has none and has a class allowance", () => {
  const create = functionText("create_package");
  has(create, "if cardinality(v_options) = 0 then raise exception 'Select at least one duration option.'");
  has(create, "raise exception 'A class-count package has no duration options.'");
  has(create, "raise exception 'A duration package has no class allowance.'");
  has(create, "if p_total_classes is null or p_total_classes < 1 then raise exception 'Enter the number of classes, at least 1.'");
  const terms = functionText("update_package_terms");
  has(terms, "if cardinality(v_options) = 0 then raise exception 'Select at least one duration option.'");
});

test("package functions lock the package row first, and entry functions lock the package and then the entry", () => {
  for (const name of ["update_package_details", "update_package_terms", "set_package_status", "schedule_fee_entry"]) {
    has(functionText(name), "select * into v_pkg from public.packages where id = p_package_id for update;");
  }
  for (const name of ["edit_fee_entry", "cancel_fee_entry", "correct_fee_entry"]) {
    const body = functionText(name);
    has(body, "select * into v_pkg from public.packages where id = v_package_id for update;");
    has(body, "select * into v_entry from public.package_fee_entries where id = p_entry_id for update;");
    assert.ok(body.indexOf("from public.packages where id = v_package_id for update") < body.indexOf("from public.package_fee_entries where id = p_entry_id for update"), name);
  }
});

// ---- fee entries -------------------------------------------------------------------------------------

test("the currency is stamped from the centre profile; no function takes a currency", () => {
  for (const name of ["schedule_fee_entry", "edit_fee_entry"]) {
    const body = functionText(name);
    has(body, "select cp.currency into v_currency from public.center_profile cp where cp.singleton;");
    has(body, "raise exception 'The centre currency is not set.' using errcode = '55000'");
  }
  for (const [name, signature] of PUBLIC) assert.doesNotMatch(signature, /currency/, name);
  assert.doesNotMatch(SQL, /\bp_currency\b/);
});

test("scheduling: the amount is checked, the entry takes the package's type, the discounts follow, then one event", () => {
  const body = functionText("schedule_fee_entry");
  has(body, "perform public.package_check_amount(p_amount);");
  has(body, "insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, price, created_by) values (v_pkg.id, v_pkg.kind, p_effective_from, v_currency, case when v_pkg.kind = 'duration' then p_amount end, case when v_pkg.kind = 'class_count' then p_amount end, auth.uid())");
  assert.ok(body.indexOf("insert into public.package_fee_entries") < body.indexOf("package_write_fee_discounts"));
  assert.ok(body.indexOf("package_write_fee_discounts") < body.indexOf("package_log_event"));
});

test("editing: only a scheduled fee, and only to a date after today; the currency is stamped again", () => {
  const body = functionText("edit_fee_entry");
  has(body, "if v_entry.cancelled_at is not null then raise exception 'A cancelled fee entry cannot be changed.' using errcode = '55006'");
  has(body, "if v_entry.effective_from <= v_today then raise exception 'A fee entry in effect cannot be edited. Correct it instead.' using errcode = '55006'");
  has(body, "if p_effective_from <= v_today then raise exception 'A scheduled fee must take effect after today.");
  has(body, "set effective_from = p_effective_from, currency = v_currency");
});

test("cancelling: stamped with now(), a reason when the fee is in effect, and the event carries the before-snapshot only", () => {
  const body = functionText("cancel_fee_entry");
  has(body, "if v_entry.cancelled_at is not null then raise exception 'This fee entry is already cancelled.' using errcode = '55006'");
  has(body, "if v_entry.effective_from <= v_today and v_reason is null then raise exception 'Enter the reason for cancelling a fee that is in effect.' using errcode = '22023'");
  has(body, "set cancelled_at = now(), cancelled_by = auth.uid()");
  has(body, "'fee_cancelled', v_reason, v_before, null");
  assert.doesNotMatch(body, /clock_timestamp/);
});

test("the in_effect flag of the audit snapshot is the very rule 0046's trigger applies: the centre's date", () => {
  has(functionText("package_today"), "select (now() at time zone public.centre_timezone())::date;");
  has(functionText("package_fee_entry_snapshot"), "'in_effect', e.effective_from <= public.package_today()");
  // 0046's guards and trigger use the same expression.
  const m46 = normalize(read(`${MIGRATIONS}0046_packages_and_fee_history.sql`));
  has(m46, "(now() at time zone public.centre_timezone())::date");
  has(m46, "v_flag <> (v_effective <= v_today)::text");
});

test("correcting: reason required; a fee in effect only; CANCEL first, then the linked replacement, its discounts and one event", () => {
  const body = functionText("correct_fee_entry");
  has(body, "if v_reason is null then raise exception 'Enter the reason for the correction.' using errcode = '22023'");
  has(body, "if v_entry.effective_from > v_today then raise exception 'A fee that has not taken effect is edited, not corrected.' using errcode = '55006'");
  has(body, "if v_entry.cancelled_at is not null then raise exception 'A cancelled fee entry cannot be corrected.' using errcode = '55006'");

  const cancel = body.indexOf("set cancelled_at = now(), cancelled_by = auth.uid()");
  const insert = body.indexOf("insert into public.package_fee_entries");
  const discounts = body.indexOf("package_write_fee_discounts");
  const event = body.indexOf("package_log_event");
  assert.ok(cancel > 0 && cancel < insert, "the old entry is cancelled before the replacement is inserted");
  assert.ok(insert < discounts && discounts < event, "then the discounts, then the event");

  // The replacement keeps the package, the effective date and the currency, links to the entry it corrects, and returns its id.
  has(body, "values (v_entry.package_id, v_entry.package_kind, v_entry.effective_from, v_entry.currency,");
  has(body, "v_entry.id, auth.uid()) returning id into v_new_id");
  has(body, "perform public.package_log_event(v_pkg.id, v_new_id, 'fee_corrected', v_reason, v_before, v_after);");
  has(body, "return v_new_id;");
  // A correction that changes nothing is refused (and everything it did is rolled back).
  has(body, "raise exception 'The corrected fee is the same as the fee in effect.' using errcode = '22023'");
});

// ---- discounts ---------------------------------------------------------------------------------------

test("discounts: Quarterly, Half Yearly and Annual only, once each, a checked value; none for a class-count package", () => {
  const body = functionText("package_write_fee_discounts");
  has(body, "delete from public.package_fee_entry_discounts where entry_id = p_entry_id;");
  has(body, "if p_kind <> 'duration' then raise exception 'A class-count package has no package discounts.'");
  has(body, "v_option not in ('quarterly', 'half_yearly', 'annual')");
  has(body, "if v_option = any (v_seen) then raise exception 'A duration option can have only one package discount.'");
  has(body, "v_type not in ('fixed', 'percent')");
  has(body, "v_text !~ '^[0-9]+(\\.[0-9]{1,2})?$'");
  has(body, "(v_type = 'percent' and v_value > 100)");
  has(body, "case when v_type = 'fixed' then v_value end, case when v_type = 'percent' then v_value end");
});

test("amounts: greater than 0, at most two decimals, within numeric(10,2)", () => {
  has(functionText("package_check_amount"), "if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 100000000 then");
});

test("reasons: optional, trimmed, 3 to 500 characters", () => {
  has(functionText("package_clean_reason"), "if v_reason is not null and char_length(v_reason) not between 3 and 500 then raise exception 'The reason must be 3 to 500 characters.'");
});

// ---- the behaviour script ----------------------------------------------------------------------------

test("the behaviour script is rollback-only, preflighted, and covers each FS-3 acceptance criterion", () => {
  const code = BEHAVIOUR_RAW.replace(/--.*$/gm, "");
  assert.match(code, /^\s*begin;/m);
  assert.match(code, /^rollback;\s*$/m);
  assert.doesNotMatch(code, /^\s*commit\s*;/im);
  has(BEHAVIOUR, "'P0 migration 0047 is applied");
  has(BEHAVIOUR, "'P1 no package already has a fixture name");
  for (const id of ["F1", "C1", "C2", "C3", "D1", "D2", "T1", "T2", "S1", "S2", "E1", "E2", "E3", "E4", "X1", "X2", "X3", "X4", "K1", "K2", "K3", "K4", "K5", "Y1", "Y2", "Y3", "Y4", "Y5", "AU1", "AU2"]) {
    assert.ok(BEHAVIOUR.includes(`'${id} `), id);
  }
  // It calls the functions as an Admin, never writes the package tables directly, and checks the event of each change.
  assert.match(BEHAVIOUR, /set local role authenticated/);
  assert.doesNotMatch(BEHAVIOUR, /\b(insert into|update|delete from) public\.package_(events|fee_entries|fee_entry_discounts|duration_options)\b/);
  assert.doesNotMatch(BEHAVIOUR, /\b(insert into|update|delete from) public\.packages\b/);
  has(BEHAVIOUR, "event_type = 'fee_corrected'");
  has(BEHAVIOUR, "no event on failure");
});

test("the section 6A ledger records 0047 as repository only, not applied and not verified", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0047` |"));
  assert.ok(row, "a 0047 row exists");
  assert.match(row, /Repository only — not applied, not verified/);
  assert.match(row, /has \*\*not\*\* been run/);
});
