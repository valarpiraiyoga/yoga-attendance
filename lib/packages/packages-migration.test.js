// Run with `npm test` (Node's built-in test runner).
//
// Migration 0046 (V1 Fee Structure, FS-2: the package catalogue and fee history) and its two verification scripts are
// SQL applied and run by hand in Supabase, so none of it is executed here, and nothing in this file shows how PostgreSQL
// will treat the SQL. These tests pin what can be pinned without a database: that the migration is additive and adds
// only the five approved tables and their guards, that the approved decisions are in the SQL text, and that the
// verification scripts are rollback-only, preflighted and cover every behaviour.
//
// Harmless formatting is normalized before anything is compared (comments, whitespace, spacing around commas, brackets
// and operators), and the SQL is compared as small fragments, so reflowing a statement does not break a test and a test
// failure points at the one rule that changed.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** SQL without comments, whitespace collapsed, and one space around operators, after commas and inside brackets. */
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

/** Asserts that `fragment` (written in any reasonable formatting) occurs in the already-normalized `text`. */
function has(text, fragment, label = fragment) {
  assert.ok(text.includes(normalize(fragment)), `missing: ${label}`);
}

/** Asserts that `fragment` does NOT occur in the already-normalized `text`. */
function lacks(text, fragment, label = fragment) {
  assert.ok(!text.includes(normalize(fragment)), `unexpected: ${label}`);
}

const MIGRATIONS = "../../supabase/migrations/";
const VERIFICATION = "../../supabase/verification/";
const FILE = "0046_packages_and_fee_history.sql";

const RAW = read(`${MIGRATIONS}${FILE}`);
const SQL = normalize(RAW);
const STRUCTURE_RAW = read(`${VERIFICATION}verify_0046_packages_and_fee_history.sql`);
const BEHAVIOUR_RAW = read(`${VERIFICATION}verify_0046_packages_and_fee_history_behavior.sql`);
const STRUCTURE = normalize(STRUCTURE_RAW);
const BEHAVIOUR = normalize(BEHAVIOUR_RAW);

const TABLES = [
  "packages",
  "package_duration_options",
  "package_fee_entries",
  "package_fee_entry_discounts",
  "package_events",
];

const FUNCTIONS = [
  "package_tables_no_truncate",
  "packages_guard",
  "packages_touch_updated_at",
  "package_fee_entries_guard",
  "package_fee_entry_discounts_guard",
  "package_events_guard",
];

/** The normalized body of one trigger function, from its header to its closing `$$;`. */
function functionText(name) {
  const from = RAW.indexOf(`create or replace function public.${name}()`);
  assert.ok(from >= 0, name);
  const to = RAW.indexOf("\n$$;", from);
  assert.ok(to > from, `${name} end`);
  return normalize(RAW.slice(from, to + 4));
}

/** The normalized text of one create table statement. */
function tableText(name) {
  const from = RAW.indexOf(`create table if not exists public.${name} (`);
  assert.ok(from >= 0, name);
  const to = RAW.indexOf("\n);", from);
  assert.ok(to > from, `${name} end`);
  return normalize(RAW.slice(from, to + 3));
}

/** The text of one named constraint of a normalized create table statement (up to the next constraint). */
function constraintText(table, name) {
  const start = table.indexOf(`constraint ${name} `);
  assert.ok(start >= 0, `constraint ${name}`);
  const next = table.indexOf(", constraint ", start + 1);
  return table.slice(start, next < 0 ? undefined : next);
}

/** The names of the constraints of a table whose text matches. */
function constraintsMatching(table, pattern) {
  return [...table.matchAll(/constraint (\w+) /g)]
    .map((m) => m[1])
    .filter((name) => pattern.test(constraintText(table, name)));
}

// ---- Placement and scope -----------------------------------------------------------------------------

test("0046 follows 0045 and no earlier migration is edited", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  const at = files.indexOf(FILE);
  assert.ok(at > 0);
  assert.equal(files[at - 1], "0045_class_count_dates_and_reversals.sql");
});

test("0046 checks its dependencies first: is_admin (0002), centre_timezone and center_profile.currency (0024), auth.users", () => {
  const pre = SQL.slice(0, SQL.indexOf("create table if not exists public.packages"));
  has(pre, "to_regprocedure('public.is_admin()') is null");
  has(pre, "to_regprocedure('public.centre_timezone()') is null");
  has(pre, "table_name = 'center_profile' and column_name = 'currency'");
  has(pre, "to_regclass('auth.users') is null");
  has(pre, "raise exception '0046 needs migration 0002");
  has(pre, "raise exception '0046 needs migration 0024");
});

test("0046 creates exactly the five approved tables, in dependency order", () => {
  assert.deepEqual([...SQL.matchAll(/create table if not exists public\.(\w+) \(/g)].map((m) => m[1]), TABLES);
});

test("0046 is additive: it alters no existing table, drops nothing and writes no row", () => {
  // The only ALTER TABLE statements are the row-level security switches of its own tables.
  assert.deepEqual(
    [...SQL.matchAll(/alter table public\.(\w+) (\w+)/g)].map((m) => `${m[1]} ${m[2]}`),
    TABLES.map((t) => `${t} enable`)
  );
  assert.doesNotMatch(SQL, /\bdrop (table|column|constraint|index|function)\b/);
  assert.doesNotMatch(SQL, /\bdrop policy (?!if exists)/);
  assert.doesNotMatch(SQL, /\bdrop trigger (?!if exists)/);
  // Outside the trigger functions (whose bodies only raise, return or read) there is no data statement.
  const outsideFunctions = SQL.replace(/create or replace function[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(insert into|delete from|truncate table|update public\.)/);
});

/** The migration header as running text: comment markers removed and every run of whitespace one space. */
const HEADER = RAW.slice(0, RAW.indexOf("-- 0. Preconditions")).replace(/\n-- ?/g, " ").replace(/\s+/g, " ");

test("the header says how to re-run it: one transaction, and that IF NOT EXISTS does not repair drift", () => {
  assert.match(HEADER, /Re-run this file as ONE transaction/);
  assert.match(HEADER, /NOT a repair tool/);
  assert.match(HEADER, /skips a table that already exists, even one whose columns or constraints differ/);
  assert.match(HEADER, /run verify_0046_packages_and_fee_history\.sql/);
});

test("the header states what the triggers do and do not prevent, and does not overclaim owner-level protection", () => {
  assert.match(HEADER, /refuse ordinary statements from EVERY role, including the table owner/);
  assert.match(HEADER, /do NOT stop someone who owns a table \(or is a superuser\) from deliberately disabling or replacing the triggers/);
  assert.doesNotMatch(HEADER, /protected even from the table owner/);
});

test("the header states the audit-existence limitation and the write-ordering rules for the next phase", () => {
  assert.match(HEADER, /does NOT guarantee that an audit event exists for every change/);
  assert.match(HEADER, /write exactly one event for each change, in the same transaction/);
  assert.match(HEADER, /Uniqueness is immediate, not deferred/);
  assert.match(HEADER, /cancel the old entry BEFORE it inserts the replacement/);
  assert.match(HEADER, /swap needs a temporary date/);
  assert.match(HEADER, /stamp cancelled_at with now\(\)/);
});

test("0046 creates no function a client can call: only the six trigger functions, all hidden from clients", () => {
  assert.deepEqual([...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), FUNCTIONS);
  for (const name of FUNCTIONS) {
    has(functionText(name), "returns trigger language plpgsql security definer set search_path = ''", name);
    has(SQL, `revoke execute on function public.${name}() from public, anon, authenticated;`, name);
    lacks(SQL, `grant execute on function public.${name}`, name);
  }
});

test("no trigger function combines the operation with a NEW or OLD field in one boolean expression", () => {
  // IF tg_op = 'UPDATE' AND new.x ... would read NEW in a DELETE if the operands were not evaluated left to right.
  // Every branch on the operation is a plain IF with the field tests nested inside it.
  for (const name of FUNCTIONS) {
    assert.doesNotMatch(functionText(name), /tg_op = '\w+' (and|or) /, name);
    assert.doesNotMatch(functionText(name), / (and|or) tg_op = '\w+'/, name);
  }
});

// ---- packages --------------------------------------------------------------------------------------------

test("packages: the name is required, trimmed, 2 to 100 characters", () => {
  const c = constraintText(tableText("packages"), "packages_name_valid");
  has(c, "name = regexp_replace(name, '^\\s+|\\s+$', '', 'g')");
  has(c, "char_length(name) between 2 and 100");
  has(tableText("packages"), "name text not null");
});

test("packages: the description is optional, trimmed, 1 to 500 characters", () => {
  const c = constraintText(tableText("packages"), "packages_description_valid");
  has(c, "description is null");
  has(c, "description = regexp_replace(description, '^\\s+|\\s+$', '', 'g')");
  has(c, "char_length(description) between 1 and 500");
});

test("packages: type and status values, and the class allowance by type", () => {
  const t = tableText("packages");
  has(constraintText(t, "packages_kind_valid"), "kind in ('duration', 'class_count')");
  has(constraintText(t, "packages_status_valid"), "status in ('active', 'inactive')");
  has(t, "status text not null default 'active'");
  const c = constraintText(t, "packages_total_classes_by_kind");
  has(c, "kind = 'class_count' and total_classes is not null and total_classes > 0");
  has(c, "kind = 'duration' and total_classes is null");
});

test("packages: names are unique ignoring case across active and inactive packages", () => {
  has(SQL, "create unique index if not exists packages_name_unique on public.packages (lower(name));");
  assert.doesNotMatch(SQL.match(/create unique index if not exists packages_name_unique[^;]*;/)[0], /where/);
});

test("packages: (id, kind) is unique, the target of the composite foreign keys that protect the package type", () => {
  has(tableText("packages"), "constraint packages_id_kind_key unique (id, kind)");
});

test("no package can be deleted in V1: the guard refuses every delete and nothing grants DELETE", () => {
  const body = functionText("packages_guard");
  has(body, "if tg_op = 'DELETE' then raise exception 'A package cannot be deleted. Deactivate it instead.' using errcode = '55006';");
  has(SQL, "create trigger packages_guard_trigger before update or delete on public.packages for each row execute function public.packages_guard();");
  assert.doesNotMatch(SQL, /grant [^;]*\bdelete\b/);
});

test("packages: updated_at is maintained by a trigger, and id and created_at never change", () => {
  has(functionText("packages_touch_updated_at"), "new.updated_at := now();");
  has(SQL, "create trigger packages_touch_updated_at_trigger before update on public.packages");
  has(functionText("packages_guard"), "new.id is distinct from old.id or new.created_at is distinct from old.created_at");
});

// ---- the composite foreign keys ---------------------------------------------------------------------

test("package type is protected by composite foreign keys: NO ACTION on update, RESTRICT on delete", () => {
  const options = tableText("package_duration_options");
  has(options, "package_kind text not null default 'duration'");
  has(constraintText(options, "package_duration_options_kind_valid"), "check (package_kind = 'duration')");
  has(constraintText(options, "package_duration_options_package_fkey"),
    "foreign key (package_id, package_kind) references public.packages (id, kind) on update no action on delete restrict");

  has(constraintText(tableText("package_fee_entries"), "package_fee_entries_package_fkey"),
    "foreign key (package_id, package_kind) references public.packages (id, kind) on update no action on delete restrict");

  has(constraintText(tableText("package_fee_entry_discounts"), "package_fee_entry_discounts_entry_fkey"),
    "foreign key (entry_id, entry_kind) references public.package_fee_entries (id, package_kind) on update no action on delete restrict");
});

test("no foreign key of the five tables cascades", () => {
  for (const name of TABLES) assert.doesNotMatch(tableText(name), /on (update|delete) cascade/, name);
});

// ---- duration options -------------------------------------------------------------------------------

test("package_duration_options: the five options, one row per option and package", () => {
  const t = tableText("package_duration_options");
  has(t, "constraint package_duration_options_pkey primary key (package_id, duration_option)");
  has(constraintText(t, "package_duration_options_option_valid"),
    "duration_option in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom')");
});

// ---- fee entries ------------------------------------------------------------------------------------

test("package_fee_entries: effective date and currency", () => {
  const t = tableText("package_fee_entries");
  has(t, "effective_from date not null");
  has(t, "currency text not null");
  has(constraintText(t, "package_fee_entries_currency_format"), "check (currency ~ '^[A-Z]{3}$')");
});

test("package_fee_entries: exactly one amount, by package type", () => {
  const t = tableText("package_fee_entries");
  has(t, "monthly_fee numeric(10, 2)");
  has(t, "price numeric(10, 2)");
  const c = constraintText(t, "package_fee_entries_amount_by_kind");
  has(c, "package_kind = 'duration' and monthly_fee is not null and monthly_fee > 0 and price is null");
  has(c, "package_kind = 'class_count' and price is not null and price > 0 and monthly_fee is null");
});

test("package_fee_entries: no global cap on the amounts beyond the numeric(10,2) column", () => {
  const c = constraintText(tableText("package_fee_entries"), "package_fee_entries_amount_by_kind");
  assert.doesNotMatch(c, /(monthly_fee|price) (<|<=|between) /);
  assert.deepEqual(constraintsMatching(tableText("package_fee_entries"), /(monthly_fee|price) (<|<=|between) /), []);
});

test("package_fee_entries: no two live entries of a package share a date, whatever their currency; a cancelled one frees its date", () => {
  has(SQL, "create unique index if not exists package_fee_entries_package_date_unique on public.package_fee_entries (package_id, effective_from) where cancelled_at is null;");
});

test("package_fee_entries: a correction is a linked replacement - one per entry, within one package, never itself", () => {
  const t = tableText("package_fee_entries");
  has(t, "corrects_entry_id uuid");
  has(constraintText(t, "package_fee_entries_corrects_not_self"), "check (corrects_entry_id is null or corrects_entry_id <> id)");
  has(t, "constraint package_fee_entries_package_id_key unique (package_id, id)");
  has(t, "constraint package_fee_entries_id_kind_key unique (id, package_kind)");
  has(constraintText(t, "package_fee_entries_corrects_fkey"),
    "foreign key (package_id, corrects_entry_id) references public.package_fee_entries (package_id, id) on delete restrict");
  has(SQL, "create unique index if not exists package_fee_entries_corrects_unique on public.package_fee_entries (corrects_entry_id) where corrects_entry_id is not null;");
});

test("package_fee_entries: cancellation is recorded, and the actors may go to null when a user account is deleted", () => {
  const t = tableText("package_fee_entries");
  has(t, "cancelled_at timestamptz");
  has(t, "cancelled_by uuid references auth.users (id) on delete set null");
  has(t, "created_by uuid references auth.users (id) on delete set null");
  has(constraintText(t, "package_fee_entries_cancelled_consistent"), "check (cancelled_by is null or cancelled_at is not null)");
});

test("the fee-entry guard: never deleted, created uncancelled, a correction replaces a cancelled entry of the same package", () => {
  const body = functionText("package_fee_entries_guard");
  has(body, "if tg_op = 'DELETE' then raise exception 'A fee entry cannot be deleted. Cancel it instead.' using errcode = '55006'");
  has(body, "if tg_op = 'INSERT' then");
  has(body, "if new.cancelled_at is not null or new.cancelled_by is not null then raise exception 'A fee entry is created uncancelled.'");
  has(body, "where e.id = new.corrects_entry_id and e.package_id = new.package_id");
  has(body, "if not found or v_target is null then raise exception 'A correction replaces a cancelled fee entry of the same package.'");
});

test("the fee-entry guard: identity and the correction link never change; an actor may only go to null", () => {
  const body = functionText("package_fee_entries_guard");
  has(body, "(new.id, new.package_id, new.package_kind, new.created_at, new.corrects_entry_id) is distinct from (old.id, old.package_id, old.package_kind, old.created_at, old.corrects_entry_id)");
  has(body, "new.created_by is distinct from old.created_by and new.created_by is not null");
});

test("the fee-entry guard: an entry in effect (the centre's date) is never edited, a cancelled entry is final", () => {
  const body = functionText("package_fee_entries_guard");
  has(body, "v_today date := (now() at time zone public.centre_timezone())::date");
  has(body, "if v_core_changed and old.effective_from <= v_today then raise exception 'A fee entry in effect cannot be edited. Correct it instead.'");
  has(body, "if old.cancelled_at is not null then if new.cancelled_at is distinct from old.cancelled_at or v_core_changed");
  has(body, "raise exception 'A cancelled fee entry cannot be changed.'");
  has(body, "v_core_changed := (new.effective_from, new.currency, new.monthly_fee, new.price) is distinct from (old.effective_from, old.currency, old.monthly_fee, old.price)");
  has(SQL, "create trigger package_fee_entries_guard_trigger before insert or update or delete on public.package_fee_entries for each row execute function public.package_fee_entries_guard();");
});

test("the fee-entry guard: a cancellation is its own step and is stamped with the transaction time", () => {
  const body = functionText("package_fee_entries_guard");
  has(body, "if new.cancelled_at is not null then if v_core_changed then raise exception 'A fee entry is cancelled as it is; it cannot be edited in the same step.'");
  has(body, "if new.cancelled_at <> now() then raise exception 'A fee entry is cancelled at the current time.' using errcode = '55006'");
});

// ---- discounts ---------------------------------------------------------------------------------------

test("package_fee_entry_discounts: only quarterly, half_yearly and annual - never Monthly or Custom", () => {
  const c = constraintText(tableText("package_fee_entry_discounts"), "package_fee_entry_discounts_option_valid");
  has(c, "duration_option in ('quarterly', 'half_yearly', 'annual')");
  assert.doesNotMatch(c, /monthly|custom/);
});

test("package_fee_entry_discounts: fixed or percentage, with the amount that goes with the type", () => {
  const t = tableText("package_fee_entry_discounts");
  has(t, "fixed_amount numeric(10, 2)");
  has(t, "percent_value numeric(5, 2)");
  has(constraintText(t, "package_fee_entry_discounts_type_valid"), "discount_type in ('fixed', 'percent')");
  const shape = constraintText(t, "package_fee_entry_discounts_shape");
  has(shape, "discount_type = 'fixed' and fixed_amount is not null and fixed_amount > 0 and percent_value is null");
  has(shape, "discount_type = 'percent' and percent_value is not null and percent_value > 0 and percent_value <= 100 and fixed_amount is null");
  has(t, "constraint package_fee_entry_discounts_pkey primary key (entry_id, duration_option)");
});

test("discounts are NOT tied to the offered options: Custom pricing can use a configured discount of a standard duration the package does not offer", () => {
  assert.doesNotMatch(tableText("package_fee_entry_discounts"), /package_duration_options/);
});

test("the discount guard: frozen when the entry is cancelled, or in effect and not created in this transaction", () => {
  const body = functionText("package_fee_entry_discounts_guard");
  has(body, "raise exception 'The discounts of a cancelled fee entry cannot be changed.'");
  has(body, "if v_entry.effective_from <= v_today and v_entry.created_at <> now() then raise exception 'The discounts of a fee entry in effect cannot be changed. Correct the entry instead.'");
  has(body, "if tg_op = 'UPDATE' then if new.entry_id is distinct from old.entry_id then raise exception 'A discount cannot be moved to another fee entry.'");
  has(SQL, "create trigger package_fee_entry_discounts_guard_trigger before insert or update or delete on public.package_fee_entry_discounts for each row execute function public.package_fee_entry_discounts_guard();");
});

test("the discount guard reads the entry id in plain branches: OLD for a delete, NEW otherwise", () => {
  const body = functionText("package_fee_entry_discounts_guard");
  has(body, "if tg_op = 'DELETE' then v_entry_id := old.entry_id; else v_entry_id := new.entry_id; end if;");
});

// ---- events ------------------------------------------------------------------------------------------

test("package_events: nine event types, a trimmed 3-500 character reason, JSON object states", () => {
  const t = tableText("package_events");
  const types = constraintText(t, "package_events_type_valid");
  for (const type of ["package_created", "details_updated", "terms_updated", "package_activated", "package_deactivated",
    "fee_scheduled", "fee_edited", "fee_cancelled", "fee_corrected"]) {
    has(types, `'${type}'`);
  }
  const reason = constraintText(t, "package_events_reason_valid");
  has(reason, "reason is null");
  has(reason, "reason = regexp_replace(reason, '^\\s+|\\s+$', '', 'g')");
  has(reason, "char_length(reason) between 3 and 500");
  const states = constraintText(t, "package_events_state_objects");
  has(states, "jsonb_typeof(before_state) = 'object'");
  has(states, "jsonb_typeof(after_state) = 'object'");
});

test("package_events: what each event type carries is checked", () => {
  const shape = constraintText(tableText("package_events"), "package_events_shape");
  has(shape, "when event_type = 'package_created' then before_state is null and after_state is not null and fee_entry_id is null");
  has(shape, "when event_type = 'fee_scheduled' then before_state is null and after_state is not null and fee_entry_id is not null");
  has(shape, "when event_type in ('fee_edited', 'fee_corrected') then before_state is not null and after_state is not null and fee_entry_id is not null");
  has(shape, "when event_type = 'fee_cancelled' then before_state is not null and after_state is null and fee_entry_id is not null");
  has(shape, "else false end");
});

test("package_events: a reason is required for a correction and for cancelling a fee in effect - and for nothing else", () => {
  const t = tableText("package_events");
  has(constraintText(t, "package_events_correction_reason_required"), "check (event_type <> 'fee_corrected' or reason is not null)");
  // The flag must be present and true/false; a CHECK that evaluates to NULL passes, so both are coalesced to false.
  has(constraintText(t, "package_events_cancel_flag_required"),
    "check (event_type <> 'fee_cancelled' or coalesce((before_state ->> 'in_effect') in ('true', 'false'), false))");
  has(constraintText(t, "package_events_cancel_reason_required"),
    "check (event_type <> 'fee_cancelled' or reason is not null or coalesce((before_state ->> 'in_effect') = 'false', false))");
  // These two are the ONLY constraints that make a reason mandatory, so scheduling and editing a fee need none.
  assert.deepEqual(
    constraintsMatching(t, /reason is not null/).sort(),
    ["package_events_cancel_reason_required", "package_events_correction_reason_required"]
  );
});

test("package_events: an event can only name a fee entry of its OWN package (composite foreign key)", () => {
  const t = tableText("package_events");
  has(constraintText(t, "package_events_fee_entry_fkey"),
    "foreign key (package_id, fee_entry_id) references public.package_fee_entries (package_id, id) on delete restrict");
  lacks(t, "fee_entry_id uuid references", "a single-column foreign key on fee_entry_id");
  has(t, "package_id uuid not null references public.packages (id) on delete restrict");
});

test("package_events: who and when - the actor is nullable only for the user-deletion path, and required on INSERT by the trigger", () => {
  const t = tableText("package_events");
  has(t, "occurred_at timestamptz not null default now()");
  has(t, "actor uuid references auth.users (id) on delete set null");
  has(functionText("package_events_guard"),
    "if tg_op = 'INSERT' then if new.actor is null then raise exception 'A package event records who made the change.' using errcode = '23502';");
});

test("package_events: the trigger checks the in_effect flag against the fee entry and the centre's date", () => {
  const body = functionText("package_events_guard");
  has(body, "v_today date := (now() at time zone public.centre_timezone())::date");
  has(body, "if new.event_type = 'fee_cancelled' then v_flag := new.before_state ->> 'in_effect';");
  has(body, "if v_flag in ('true', 'false') then");
  has(body, "where e.id = new.fee_entry_id and e.package_id = new.package_id");
  has(body, "if v_flag <> (v_effective <= v_today)::text then raise exception 'The in_effect flag of a fee_cancelled event does not match the fee entry.' using errcode = '23514'");
  // A missing flag, entry or package is left to the CHECK constraints and the foreign key, which refuse them.
  has(body, "if found then");
});

test("package_events never change: update and delete refused, except the actor going to null", () => {
  const body = functionText("package_events_guard");
  has(body, "if tg_op = 'UPDATE' then if old.actor is not null then if new.actor is null then");
  has(body, "(new.id, new.package_id, new.fee_entry_id, new.event_type, new.occurred_at, new.reason, new.before_state, new.after_state) is not distinct from (old.id, old.package_id, old.fee_entry_id, old.event_type, old.occurred_at, old.reason, old.before_state, old.after_state)");
  has(body, "raise exception 'Package events cannot be changed or deleted.' using errcode = '55006'");
  has(SQL, "create trigger package_events_guard_trigger before insert or update or delete on public.package_events for each row execute function public.package_events_guard();");
});

test("none of the five tables can be truncated", () => {
  has(functionText("package_tables_no_truncate"), "raise exception 'Package tables cannot be truncated.' using errcode = '55006'");
  for (const name of TABLES) {
    has(SQL, `create trigger ${name}_no_truncate_trigger before truncate on public.${name} for each statement execute function public.package_tables_no_truncate();`, name);
  }
});

// ---- access ------------------------------------------------------------------------------------------

test("every table: RLS on, every privilege revoked, SELECT only for authenticated, one Admin-only SELECT policy", () => {
  for (const name of TABLES) {
    has(SQL, `alter table public.${name} enable row level security;`, name);
    has(SQL, `revoke all on public.${name} from public, anon, authenticated;`, name);
    has(SQL, `grant select on public.${name} to authenticated;`, name);
    has(SQL, `drop policy if exists "${name}_select_admin" on public.${name};`, name);
    has(SQL, `create policy "${name}_select_admin" on public.${name} for select to authenticated using (public.is_admin());`, name);
  }
  assert.equal([...SQL.matchAll(/create policy /g)].length, 5);
});

test("no client can write: no INSERT, UPDATE, DELETE or TRUNCATE is granted, and nothing is granted to anon", () => {
  const grants = [...SQL.matchAll(/grant [^;]*;/g)].map((m) => m[0]);
  assert.equal(grants.length, 5);
  for (const g of grants) assert.match(g, /^grant select on public\.\w+ to authenticated;$/);
  assert.doesNotMatch(SQL, /grant [^;]*\b(insert|update|delete|truncate|all)\b/);
  assert.doesNotMatch(SQL, /\bto anon\b/);
});

// ---- the verification scripts ------------------------------------------------------------------------

test("both verification scripts exist and end in ROLLBACK, never COMMIT", () => {
  for (const [name, script] of [["structure", STRUCTURE_RAW], ["behaviour", BEHAVIOUR_RAW]]) {
    const code = script.replace(/--.*$/gm, "");
    assert.match(code, /^\s*begin( isolation level repeatable read)?;/m, name);
    assert.match(code, /^rollback;\s*$/m, name);
    assert.doesNotMatch(code, /^\s*commit\s*;/im, name);
    assert.match(code, /create temp table _verify_results/, name);
    assert.match(code, /'NOT TESTED'/, name);
    assert.match(code, /'SUMMARY'/, name);
  }
});

test("the structure script writes no row of any real table and checks everything it should", () => {
  assert.doesNotMatch(STRUCTURE, /\b(insert into public\.|update public\.|delete from public\.|create table public\.|alter table public\.)/);
  has(STRUCTURE, "'P0 migration 0046 is applied");
  for (const id of ["A1", "B4", "C5", "C6", "C9", "C10", "D3", "D5", "D6", "E5", "E6", "E7b", "E7d", "F1", "F2", "F3", "F4", "G", "H1", "H2", "H5b", "H7", "H10", "H11", "I1"]) {
    assert.ok(STRUCTURE.includes(`'${id} `), id);
  }
  assert.match(STRUCTURE, /pg_get_triggerdef/);
  has(STRUCTURE, "has_table_privilege('anon'");
  has(STRUCTURE, "'BEFORE INSERT OR DELETE OR UPDATE ON%FOR EACH ROW%package_events_guard()'");
});

test("the structure script asks for the required columns and the Admin policy, not exact sets - so a later phase can extend the tables", () => {
  assert.match(STRUCTURE, /create function pg_temp\.has_columns/);
  assert.doesNotMatch(STRUCTURE, /columns_are/);
  assert.doesNotMatch(STRUCTURE, /count\(\*\) = 1 from pg_policies/);
  // ... while still requiring the Admin SELECT policy and no write policy and no client write privilege.
  has(STRUCTURE, "policyname = t || '_select_admin' and cmd = 'SELECT'");
  has(STRUCTURE, "not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT')");
  has(STRUCTURE, "not has_table_privilege('authenticated', 'public.' || t, 'insert')");
});

test("the structure script tells the reader to run it after every re-run", () => {
  assert.match(STRUCTURE_RAW, /RUN IT AFTER EVERY RE-RUN OF 0046/);
  assert.match(STRUCTURE_RAW, /CREATE TABLE IF NOT EXISTS skips a table\s*\n--\s*that already exists/);
});

test("the behaviour script is preflighted, rollback-only, uses disposable fixtures and covers every behaviour", () => {
  has(BEHAVIOUR, "'P0 migration 0046 is applied");
  has(BEHAVIOUR, "'P1 no package already has a fixture name");
  assert.match(BEHAVIOUR_RAW, /ROLLBACK ONLY/);
  assert.match(BEHAVIOUR, /'ZZVERIFY 0046/);
  for (const prefix of ["N1", "N2", "K6", "K9", "K10", "K11", "O3", "E10", "E11", "G5", "G8", "G11b", "G11c", "G12", "C1", "C2", "C3", "C4",
    "D7", "D7b", "D7c", "D13", "D14", "D21", "V1", "V1b", "V8a", "V8b", "V10", "V13", "V14", "V15", "V17", "V26", "V28", "V31",
    "A1", "A3", "A4", "A5", "A8", "A9", "Z "]) {
    assert.ok(BEHAVIOUR.includes(`'${prefix}`), prefix);
  }
  for (const state of ["'23505'", "'23514'", "'23503'", "'23502'", "'55006'", "'42501'"]) assert.ok(BEHAVIOUR.includes(state), state);
  // Existing data is fingerprinted before and after.
  has(BEHAVIOUR, "insert into _fingerprints");
  has(BEHAVIOUR, "before_hash = after_hash");
  for (const table of ["memberships", "membership_payments", "invoices", "invoice_settings", "center_profile", "students"]) {
    assert.ok(BEHAVIOUR.includes(`'${table}'`), table);
  }
  // It writes only the new package tables, as the owner, and never an existing business table.
  assert.doesNotMatch(BEHAVIOUR, /\b(insert into|update|delete from) public\.(memberships|membership_payments|invoices|invoice_settings|center_profile|students|batches|attendance)\b/);
  assert.match(BEHAVIOUR_RAW, /AFTER THE ROLLBACK/);
  assert.match(BEHAVIOUR_RAW, /leftover_packages/);
});

test("the behaviour script takes its legacy-data fingerprints from one snapshot (repeatable read) and says what they prove", () => {
  assert.match(BEHAVIOUR_RAW, /^begin isolation level repeatable read;/m);
  assert.match(BEHAVIOUR_RAW, /does not show that applying the migration changed nothing/);
});

test("the behaviour script exercises the access model as Admin, Instructor and anonymous", () => {
  assert.match(BEHAVIOUR, /set local role authenticated/);
  assert.match(BEHAVIOUR, /set local role anon/);
  assert.match(BEHAVIOUR, /role = 'instructor'/);
  assert.match(BEHAVIOUR, /role = 'admin'/);
});

test("the behaviour script reports skipped Instructor checks explicitly instead of dropping them", () => {
  assert.match(BEHAVIOUR, /pg_temp\.skip\('A3 an Instructor sees no rows of any package table'/);
  assert.match(BEHAVIOUR, /pg_temp\.skip\('A9 an Instructor cannot write any package table'/);
});

test("the behaviour script never casts a result to an integer unless it is all digits", () => {
  const code = BEHAVIOUR_RAW.replace(/--.*$/gm, "");
  const casts = [...code.matchAll(/::int\b/g)];
  assert.ok(casts.length > 0);
  for (const cast of casts) {
    const before = code.slice(Math.max(0, cast.index - 90), cast.index);
    assert.match(before, /case when \w+ ~ '\^\[0-9\]\+\$' then \w+$/, `unguarded cast near: ${before.slice(-60)}`);
  }
});

test("the behaviour script tests the discount shape with rows that do not exist yet, expecting the specific check violation", () => {
  has(BEHAVIOUR, "'D7 a fixed discount cannot also carry a percentage (a half_yearly row that does not exist yet)', v_c = '23514'");
  has(BEHAVIOUR, "'D7b a percentage discount cannot also carry a fixed amount', v_c = '23514'");
  has(BEHAVIOUR, "'D7c a fixed discount needs its amount', v_c = '23514'");
  assert.doesNotMatch(BEHAVIOUR, /v_c in \('23514', '23505'\)/);
});

test("the behaviour script covers the cross-package audit reference, the missing actor, and the in_effect check", () => {
  has(BEHAVIOUR, "'V8a an event cannot name a fee entry of ANOTHER package (composite foreign key, 23503)', v_c = '23503'");
  has(BEHAVIOUR, "'V1b an event without an actor is refused when it is written (not-null violation, 23502)', v_c = '23502'");
  has(BEHAVIOUR, "to skip the reason, is refused by the trigger (23514)', v_c = '23514'");
  has(BEHAVIOUR, "reporting in_effect = true for a SCHEDULED fee is refused too");
});

// ---- the ledger and the plan -------------------------------------------------------------------------

test("the section 6A ledger records 0046, and does not mark it catalog-confirmed without evidence", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0046` |"));
  assert.ok(row, "a 0046 row exists");
  const cells = row.split("|").map((c) => c.trim());
  const [, , status, , , notVerified] = cells;
  assert.match(status, /Repository only|Applied to|Recorded only|Catalog-confirmed/);
  assert.ok(notVerified && notVerified !== "—", "the row says what has not been verified");
  if (/Catalog-confirmed/.test(status)) {
    // Allowed only once the verification has run, and the row then names the evidence and its date.
    assert.match(row, /verify_0046_packages_and_fee_history\.sql/);
    assert.match(row, /\d{4}-\d{2}-\d{2}/);
  }
});

test("the plan gives FS-3 acceptance criteria for audit events and for the order of writes", () => {
  const plan = read("../../docs/04-development-plan.md");
  const from = plan.indexOf("**FS-3 acceptance criteria");
  assert.ok(from >= 0, "an FS-3 acceptance criteria block exists");
  // Markdown emphasis and code ticks are not part of the wording being pinned.
  const block = plan.slice(from, from + 3500).replace(/[*`]/g, "").replace(/\s+/g, " ");
  assert.match(block, /exactly one audit event/i);
  assert.match(block, /same transaction/);
  assert.match(block, /does not guarantee/);
  assert.match(block, /cancel the old entry before inserting the replacement/);
  assert.match(block, /now\(\)/);
});
