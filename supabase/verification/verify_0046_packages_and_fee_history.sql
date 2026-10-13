-- ===========================================================================
-- Migration 0046 verification (structure) - package catalogue and fee history (V1 Fee Structure, FS-2)
-- Verifies supabase/migrations/0046_packages_and_fee_history.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER 0046 is applied. It reads system catalogs, and counts the rows of the five new
-- tables (reported as INFO); it writes no row of any table. The only thing it writes is a temporary results table that
-- is dropped when the script ends, and the whole script ends in ROLLBACK. Run it as one transaction (`rollback;`
-- first if one is already open).
-- Behaviour: verify_0046_packages_and_fee_history_behavior.sql.
--
-- RUN IT AFTER EVERY RE-RUN OF 0046 as well. A re-run is not a repair tool: CREATE TABLE IF NOT EXISTS skips a table
-- that already exists, even one whose columns or constraints differ, so this script is what shows whether the schema is
-- as the migration describes. Read every FAIL.
--
-- WHAT IT CHECKS
--   P0  0046 is applied: the five tables, the six trigger functions and the ten triggers exist. If not, every other
--       check is skipped (NOT TESTED).
--   A   packages: the required columns, checks (name 2-100 trimmed, description at most 500, kind, status, class
--       allowance by kind), the (id, kind) key the composite foreign keys point at, and the case-insensitive unique
--       name index.
--   B   package_duration_options: the required columns, primary key, the five options, and the composite foreign key
--       that protects the package type (NO ACTION on update, RESTRICT on delete).
--   C   package_fee_entries: the required columns and numeric(10,2) money, currency format, amount by kind, the two
--       composite foreign keys (package type, and a correction within one package), the unique partial index on live
--       entries' dates, the one-replacement index and the lookup index.
--   D   package_fee_entry_discounts: the required columns, the three allowed options (no monthly, no custom), the
--       shape check, the composite foreign key to the entry's kind, and no tie to package_duration_options.
--   E   package_events: the required columns, the nine event types, reason, payload-shape, correction-reason and
--       cancel-reason checks, the composite foreign key to the fee entry of the event's own package, indexes.
--   F   Access: row-level security, every privilege revoked, authenticated holds SELECT only, anon holds nothing, the
--       Admin-only SELECT policy exists on each table, and no policy lets a client write. No client can write.
--   G   The history triggers and the truncate triggers: which table, when, for which events.
--   H   The six trigger functions: security definer, empty search_path, callable by no client role, and the rules
--       their bodies state (including the actor requirement and the in_effect check of package_events_guard, and the
--       transaction-time cancellation of a fee entry).
--   I   The migration's dependencies exist (public.is_admin, public.centre_timezone, center_profile.currency).
--
-- WHAT IT DOES NOT PROVE
--   Catalog checks show that objects exist with the expected definitions. They do not prove how the triggers and
--   constraints behave: that is what the behaviour script exercises. Counts of existing rows in the new tables are
--   reported as INFO only. Column checks ask for at least the required columns, and policy checks for the required
--   Admin SELECT policy plus "no write policy", so a later phase can extend these tables without this script changing.
--   It cannot show that an audit event exists for every change: 0046 does not guarantee that (see the migration's
--   AUDIT LIMITATION).
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED, INFO.
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

create function pg_temp.rec(p_test text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test,
          case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $f$;

create function pg_temp.skip(p_test text, p_why text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'NOT TESTED', p_why);
end $f$;

create function pg_temp.info(p_test text, p_detail text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'INFO', p_detail);
end $f$;

-- A table has AT LEAST these columns. (Not an exact set: a later phase may add a column to one of these tables without
-- this script having to change.)
create function pg_temp.has_columns(p_table text, p_expected text[])
returns boolean language sql as $f$
  select not exists (
    select 1 from unnest(p_expected) c
    where not exists (
      select 1 from information_schema.columns k
      where k.table_schema = 'public' and k.table_name = p_table and k.column_name::text = c));
$f$;

-- The definition of one constraint of a table, or NULL.
create function pg_temp.condef(p_table text, p_name text)
returns text language sql as $f$
  select pg_get_constraintdef(c.oid)
  from pg_constraint c
  where c.conrelid = ('public.' || p_table)::regclass and c.conname = p_name;
$f$;

-- The type of one column as the catalog prints it, e.g. numeric(10,2).
create function pg_temp.coltype(p_table text, p_column text)
returns text language sql as $f$
  select format_type(a.atttypid, a.atttypmod)
  from pg_attribute a
  where a.attrelid = ('public.' || p_table)::regclass and a.attname = p_column and not a.attisdropped;
$f$;

-- One foreign key of a table: referenced table, number of columns, update and delete actions.
create function pg_temp.fk_is(p_table text, p_name text, p_ref text, p_cols int, p_upd "char", p_del "char")
returns boolean language sql as $f$
  select exists (
    select 1 from pg_constraint c
    where c.conrelid = ('public.' || p_table)::regclass and c.conname = p_name and c.contype = 'f'
      and c.confrelid = ('public.' || p_ref)::regclass
      and array_length(c.conkey, 1) = p_cols
      and c.confupdtype = p_upd and c.confdeltype = p_del);
$f$;

do $$
declare
  v_ready boolean;
  v_tables text[] := array['packages', 'package_duration_options', 'package_fee_entries',
                           'package_fee_entry_discounts', 'package_events'];
  v_functions text[] := array[
    'public.package_tables_no_truncate()', 'public.packages_guard()', 'public.packages_touch_updated_at()',
    'public.package_fee_entries_guard()', 'public.package_fee_entry_discounts_guard()', 'public.package_events_guard()'];
  t   text;
  f   text;
  v_def text;
  v_src text;
begin
  -- P0. Is 0046 applied? ---------------------------------------------------------------------------------------------
  v_ready := (select bool_and(to_regclass('public.' || x) is not null) from unnest(v_tables) x)
         and (select bool_and(to_regprocedure(x) is not null) from unnest(v_functions) x)
         and (select count(*) = 10 from pg_trigger
              where not tgisinternal
                and tgname in ('packages_guard_trigger', 'packages_touch_updated_at_trigger',
                               'package_fee_entries_guard_trigger', 'package_fee_entry_discounts_guard_trigger',
                               'package_events_guard_trigger', 'packages_no_truncate_trigger',
                               'package_duration_options_no_truncate_trigger', 'package_fee_entries_no_truncate_trigger',
                               'package_fee_entry_discounts_no_truncate_trigger', 'package_events_no_truncate_trigger'));
  perform pg_temp.rec('P0 migration 0046 is applied (the five package tables, the six trigger functions and the ten triggers)',
    coalesce(v_ready, false),
    case when coalesce(v_ready, false) then '' else 'apply 0046 first; every check below is skipped' end);

  if not coalesce(v_ready, false) then
    perform pg_temp.skip('A - I', 'migration 0046 is not applied');
    return;
  end if;

  -- I. Dependencies -------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('I1 the migration''s dependencies exist: public.is_admin(), public.centre_timezone() and center_profile.currency',
    to_regprocedure('public.is_admin()') is not null
    and to_regprocedure('public.centre_timezone()') is not null
    and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'center_profile' and column_name = 'currency'), '');

  -- A. packages ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 packages has its required columns',
    pg_temp.has_columns('packages', array['id', 'name', 'description', 'kind', 'total_classes', 'status', 'created_at', 'updated_at', 'created_by']), '');
  perform pg_temp.rec('A2 name is required, trimmed and 2 to 100 characters',
    coalesce(pg_temp.condef('packages', 'packages_name_valid') like '%regexp_replace(name%'
             and pg_temp.condef('packages', 'packages_name_valid') like '%char_length(name) >= 2%'
             and pg_temp.condef('packages', 'packages_name_valid') like '%char_length(name) <= 100%', false)
    and (select attnotnull from pg_attribute where attrelid = 'public.packages'::regclass and attname = 'name'),
    coalesce(pg_temp.condef('packages', 'packages_name_valid'), 'constraint missing'));
  perform pg_temp.rec('A3 description is optional, trimmed and at most 500 characters',
    coalesce(pg_temp.condef('packages', 'packages_description_valid') like '%description IS NULL%'
             and pg_temp.condef('packages', 'packages_description_valid') like '%char_length(description) >= 1%'
             and pg_temp.condef('packages', 'packages_description_valid') like '%char_length(description) <= 500%', false),
    coalesce(pg_temp.condef('packages', 'packages_description_valid'), 'constraint missing'));
  perform pg_temp.rec('A4 kind is duration or class_count; status is active or inactive, default active',
    coalesce(pg_temp.condef('packages', 'packages_kind_valid') like '%duration%'
             and pg_temp.condef('packages', 'packages_kind_valid') like '%class_count%'
             and pg_temp.condef('packages', 'packages_status_valid') like '%active%'
             and pg_temp.condef('packages', 'packages_status_valid') like '%inactive%', false)
    and (select column_default like '''active''%' from information_schema.columns
         where table_schema = 'public' and table_name = 'packages' and column_name = 'status'), '');
  perform pg_temp.rec('A5 the class allowance is set (greater than 0) for class_count and null for duration',
    coalesce(pg_temp.condef('packages', 'packages_total_classes_by_kind') like '%class_count%'
             and pg_temp.condef('packages', 'packages_total_classes_by_kind') like '%total_classes > 0%'
             and pg_temp.condef('packages', 'packages_total_classes_by_kind') like '%duration%'
             and pg_temp.condef('packages', 'packages_total_classes_by_kind') like '%total_classes IS NULL%', false),
    coalesce(pg_temp.condef('packages', 'packages_total_classes_by_kind'), 'constraint missing'));
  perform pg_temp.rec('A6 UNIQUE (id, kind) exists - the target of the composite foreign keys',
    pg_temp.condef('packages', 'packages_id_kind_key') = 'UNIQUE (id, kind)', coalesce(pg_temp.condef('packages', 'packages_id_kind_key'), 'missing'));
  perform pg_temp.rec('A7 package names are unique ignoring case, across active and inactive packages',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'packages_name_unique'
              and indexdef like '%UNIQUE%' and indexdef like '%lower(name)%' and indexdef not like '%WHERE%'),
    coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'packages_name_unique'), 'index missing'));
  perform pg_temp.rec('A8 created_by references auth.users and is set to null when that user is deleted',
    exists (select 1 from pg_constraint c where c.conrelid = 'public.packages'::regclass and c.contype = 'f'
              and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'n'), '');

  -- B. package_duration_options -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('B1 package_duration_options has its required columns',
    pg_temp.has_columns('package_duration_options', array['package_id', 'package_kind', 'duration_option']), '');
  perform pg_temp.rec('B2 its primary key is (package_id, duration_option)',
    pg_temp.condef('package_duration_options', 'package_duration_options_pkey') = 'PRIMARY KEY (package_id, duration_option)',
    coalesce(pg_temp.condef('package_duration_options', 'package_duration_options_pkey'), 'missing'));
  perform pg_temp.rec('B3 the five options are monthly, quarterly, half_yearly, annual and custom, and package_kind is always duration',
    coalesce(pg_temp.condef('package_duration_options', 'package_duration_options_option_valid') like '%monthly%'
             and pg_temp.condef('package_duration_options', 'package_duration_options_option_valid') like '%quarterly%'
             and pg_temp.condef('package_duration_options', 'package_duration_options_option_valid') like '%half_yearly%'
             and pg_temp.condef('package_duration_options', 'package_duration_options_option_valid') like '%annual%'
             and pg_temp.condef('package_duration_options', 'package_duration_options_option_valid') like '%custom%'
             and pg_temp.condef('package_duration_options', 'package_duration_options_kind_valid') like '%duration%', false), '');
  perform pg_temp.rec('B4 (package_id, package_kind) references packages (id, kind): NO ACTION on update, RESTRICT on delete - the package type cannot change while options exist',
    pg_temp.fk_is('package_duration_options', 'package_duration_options_package_fkey', 'packages', 2, 'a', 'r'), '');

  -- C. package_fee_entries -------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('C1 package_fee_entries has its required columns',
    pg_temp.has_columns('package_fee_entries', array['id', 'package_id', 'package_kind', 'effective_from', 'currency', 'monthly_fee', 'price',
                                                      'corrects_entry_id', 'cancelled_at', 'cancelled_by', 'created_at', 'created_by']), '');
  perform pg_temp.rec('C2 monthly_fee and price are numeric(10,2) - the same limit as memberships.amount',
    pg_temp.coltype('package_fee_entries', 'monthly_fee') = 'numeric(10,2)'
    and pg_temp.coltype('package_fee_entries', 'price') = 'numeric(10,2)'
    and pg_temp.coltype('memberships', 'amount') = 'numeric(10,2)',
    coalesce(pg_temp.coltype('package_fee_entries', 'monthly_fee'), '?') || ' / ' || coalesce(pg_temp.coltype('package_fee_entries', 'price'), '?'));
  perform pg_temp.rec('C3 currency is a three-letter upper-case ISO code',
    coalesce(pg_temp.condef('package_fee_entries', 'package_fee_entries_currency_format') like '%^[A-Z]{3}$%', false),
    coalesce(pg_temp.condef('package_fee_entries', 'package_fee_entries_currency_format'), 'constraint missing'));
  perform pg_temp.rec('C4 a duration entry has a monthly_fee greater than 0 and no price; a class_count entry has a price greater than 0 and no monthly_fee',
    coalesce(pg_temp.condef('package_fee_entries', 'package_fee_entries_amount_by_kind') like '%monthly_fee > %'
             and pg_temp.condef('package_fee_entries', 'package_fee_entries_amount_by_kind') like '%price > %'
             and pg_temp.condef('package_fee_entries', 'package_fee_entries_amount_by_kind') like '%duration%'
             and pg_temp.condef('package_fee_entries', 'package_fee_entries_amount_by_kind') like '%class_count%', false),
    coalesce(pg_temp.condef('package_fee_entries', 'package_fee_entries_amount_by_kind'), 'constraint missing'));
  perform pg_temp.rec('C5 (package_id, package_kind) references packages (id, kind): NO ACTION on update, RESTRICT on delete',
    pg_temp.fk_is('package_fee_entries', 'package_fee_entries_package_fkey', 'packages', 2, 'a', 'r'), '');
  perform pg_temp.rec('C6 a correction link (package_id, corrects_entry_id) references the entries of the SAME package, RESTRICT on delete',
    pg_temp.fk_is('package_fee_entries', 'package_fee_entries_corrects_fkey', 'package_fee_entries', 2, 'a', 'r'), '');
  perform pg_temp.rec('C7 the keys the other foreign keys point at exist: UNIQUE (id, package_kind) and UNIQUE (package_id, id)',
    pg_temp.condef('package_fee_entries', 'package_fee_entries_id_kind_key') = 'UNIQUE (id, package_kind)'
    and pg_temp.condef('package_fee_entries', 'package_fee_entries_package_id_key') = 'UNIQUE (package_id, id)', '');
  perform pg_temp.rec('C8 an entry cannot correct itself, and cancelled_by never exists without cancelled_at',
    coalesce(pg_temp.condef('package_fee_entries', 'package_fee_entries_corrects_not_self') like '%corrects_entry_id <> id%'
             and pg_temp.condef('package_fee_entries', 'package_fee_entries_cancelled_consistent') like '%cancelled_by IS NULL%'
             and pg_temp.condef('package_fee_entries', 'package_fee_entries_cancelled_consistent') like '%cancelled_at IS NOT NULL%', false), '');
  perform pg_temp.rec('C9 live entries of a package cannot share an effective date (unique partial index, currency not part of the key)',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'package_fee_entries_package_date_unique'
              and indexdef like '%UNIQUE%' and indexdef like '%(package_id, effective_from)%' and indexdef like '%WHERE (cancelled_at IS NULL)%'),
    coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'package_fee_entries_package_date_unique'), 'index missing'));
  perform pg_temp.rec('C10 an entry has at most one replacement (unique partial index on corrects_entry_id)',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'package_fee_entries_corrects_unique'
              and indexdef like '%UNIQUE%' and indexdef like '%(corrects_entry_id)%' and indexdef like '%WHERE (corrects_entry_id IS NOT NULL)%'),
    coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'package_fee_entries_corrects_unique'), 'index missing'));
  perform pg_temp.rec('C11 the lookup index (package_id, effective_from DESC) exists',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'package_fee_entries_package_effective_idx'
              and indexdef like '%(package_id, effective_from DESC)%'), '');

  -- D. package_fee_entry_discounts -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('D1 package_fee_entry_discounts has its required columns',
    pg_temp.has_columns('package_fee_entry_discounts', array['entry_id', 'entry_kind', 'duration_option', 'discount_type', 'fixed_amount', 'percent_value']), '');
  perform pg_temp.rec('D2 its primary key is (entry_id, duration_option); fixed_amount is numeric(10,2) and percent_value numeric(5,2)',
    pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_pkey') = 'PRIMARY KEY (entry_id, duration_option)'
    and pg_temp.coltype('package_fee_entry_discounts', 'fixed_amount') = 'numeric(10,2)'
    and pg_temp.coltype('package_fee_entry_discounts', 'percent_value') = 'numeric(5,2)', '');
  perform pg_temp.rec('D3 only quarterly, half_yearly and annual can have a package discount - never monthly or custom',
    coalesce(pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid') like '%quarterly%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid') like '%half_yearly%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid') like '%annual%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid') not like '%monthly%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid') not like '%custom%', false),
    coalesce(pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_option_valid'), 'constraint missing'));
  perform pg_temp.rec('D4 a fixed discount is greater than 0 with no percentage; a percentage is greater than 0 and at most 100 with no fixed amount',
    coalesce(pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_shape') like '%fixed_amount > %'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_shape') like '%percent_value > %'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_shape') like '%percent_value <= %100%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_type_valid') like '%fixed%'
             and pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_type_valid') like '%percent%', false),
    coalesce(pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_shape'), 'constraint missing'));
  perform pg_temp.rec('D5 (entry_id, entry_kind) references package_fee_entries (id, package_kind): only a duration entry can have discounts',
    pg_temp.fk_is('package_fee_entry_discounts', 'package_fee_entry_discounts_entry_fkey', 'package_fee_entries', 2, 'a', 'r')
    and coalesce(pg_temp.condef('package_fee_entry_discounts', 'package_fee_entry_discounts_kind_valid') like '%duration%', false), '');
  perform pg_temp.rec('D6 discounts are NOT tied to the offered options: no foreign key from package_fee_entry_discounts to package_duration_options',
    not exists (select 1 from pg_constraint c where c.conrelid = 'public.package_fee_entry_discounts'::regclass and c.contype = 'f'
                  and c.confrelid = 'public.package_duration_options'::regclass), '');

  -- E. package_events -----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('E1 package_events has its required columns',
    pg_temp.has_columns('package_events', array['id', 'package_id', 'fee_entry_id', 'event_type', 'occurred_at', 'actor', 'reason', 'before_state', 'after_state']), '');
  perform pg_temp.rec('E2 the nine event types',
    (select bool_and(pg_temp.condef('package_events', 'package_events_type_valid') like '%' || x || '%')
     from unnest(array['package_created', 'details_updated', 'terms_updated', 'package_activated', 'package_deactivated',
                       'fee_scheduled', 'fee_edited', 'fee_cancelled', 'fee_corrected']) x), '');
  perform pg_temp.rec('E3 a reason is trimmed and 3 to 500 characters when present',
    coalesce(pg_temp.condef('package_events', 'package_events_reason_valid') like '%char_length(reason) >= 3%'
             and pg_temp.condef('package_events', 'package_events_reason_valid') like '%char_length(reason) <= 500%'
             and pg_temp.condef('package_events', 'package_events_reason_valid') like '%reason IS NULL%', false),
    coalesce(pg_temp.condef('package_events', 'package_events_reason_valid'), 'constraint missing'));
  perform pg_temp.rec('E4 before and after are JSON objects when present, and each event type carries what it must (shape check)',
    coalesce(pg_temp.condef('package_events', 'package_events_state_objects') like '%jsonb_typeof(before_state)%'
             and pg_temp.condef('package_events', 'package_events_state_objects') like '%jsonb_typeof(after_state)%'
             and pg_temp.condef('package_events', 'package_events_shape') like '%fee_entry_id IS NOT NULL%'
             and pg_temp.condef('package_events', 'package_events_shape') like '%package_created%', false), '');
  perform pg_temp.rec('E5 a correction always needs a reason',
    coalesce(pg_temp.condef('package_events', 'package_events_correction_reason_required') like '%fee_corrected%'
             and pg_temp.condef('package_events', 'package_events_correction_reason_required') like '%reason IS NOT NULL%', false), '');
  perform pg_temp.rec('E6 cancelling a fee needs a reason when it was in effect, and the event must say whether it was (in_effect flag)',
    coalesce(pg_temp.condef('package_events', 'package_events_cancel_flag_required') like '%in_effect%'
             and pg_temp.condef('package_events', 'package_events_cancel_reason_required') like '%in_effect%'
             and pg_temp.condef('package_events', 'package_events_cancel_reason_required') like '%reason IS NOT NULL%'
             and pg_temp.condef('package_events', 'package_events_cancel_reason_required') like '%fee_cancelled%', false), '');
  perform pg_temp.rec('E7a package_id references packages, RESTRICT on delete',
    exists (select 1 from pg_constraint c where c.conrelid = 'public.package_events'::regclass and c.contype = 'f'
              and c.confrelid = 'public.packages'::regclass and c.confdeltype = 'r'), '');
  perform pg_temp.rec('E7b (package_id, fee_entry_id) references (package_id, id) of package_fee_entries - an event can only name a fee entry of its OWN package - RESTRICT on delete',
    pg_temp.fk_is('package_events', 'package_events_fee_entry_fkey', 'package_fee_entries', 2, 'a', 'r'), '');
  perform pg_temp.rec('E7c actor references auth.users and is set to null when that user account is deleted',
    exists (select 1 from pg_constraint c where c.conrelid = 'public.package_events'::regclass and c.contype = 'f'
              and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'n'), '');
  perform pg_temp.rec('E7d no foreign key from package_events points at package_fee_entries (id) alone',
    not exists (select 1 from pg_constraint c where c.conrelid = 'public.package_events'::regclass and c.contype = 'f'
                  and c.confrelid = 'public.package_fee_entries'::regclass and array_length(c.conkey, 1) = 1), '');
  perform pg_temp.rec('E8 the history indexes exist',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'package_events_package_idx'
              and indexdef like '%(package_id, occurred_at DESC)%')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'package_events_fee_entry_idx'
                  and indexdef like '%(fee_entry_id)%'), '');

  -- F. Access ---------------------------------------------------------------------------------------------------------------------------
  foreach t in array v_tables loop
    perform pg_temp.rec('F1 ' || t || ': row-level security is enabled',
      (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), '');
    perform pg_temp.rec('F2 ' || t || ': authenticated may only SELECT; anon holds no privilege at all',
      has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('authenticated', 'public.' || t, 'insert')
      and not has_table_privilege('authenticated', 'public.' || t, 'update')
      and not has_table_privilege('authenticated', 'public.' || t, 'delete')
      and not has_table_privilege('authenticated', 'public.' || t, 'truncate')
      and not has_table_privilege('authenticated', 'public.' || t, 'references')
      and not has_table_privilege('authenticated', 'public.' || t, 'trigger')
      and not has_table_privilege('anon', 'public.' || t, 'select')
      and not has_table_privilege('anon', 'public.' || t, 'insert')
      and not has_table_privilege('anon', 'public.' || t, 'update')
      and not has_table_privilege('anon', 'public.' || t, 'delete')
      and not has_table_privilege('anon', 'public.' || t, 'truncate'), '');
    perform pg_temp.rec('F3 ' || t || ': the Admin SELECT policy ' || t || '_select_admin exists, for authenticated, using is_admin()',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and policyname = t || '_select_admin' and cmd = 'SELECT' and roles::text = '{authenticated}'
                and qual like '%is_admin()%'), '');
    -- Not "exactly one policy": any further policy must still be a SELECT, and none may be open to anon or to everyone
    -- (a policy that lets a client write would be a policy for INSERT, UPDATE, DELETE or ALL).
    perform pg_temp.rec('F4 ' || t || ': no policy lets a client write (every policy is a SELECT)',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT'), '');
  end loop;

  -- G. Triggers -----------------------------------------------------------------------------------------------------------------------------
  for t, f, v_def in
    select * from (values
      ('packages', 'packages_guard_trigger', 'BEFORE DELETE OR UPDATE ON%FOR EACH ROW%packages_guard()'),
      ('packages', 'packages_touch_updated_at_trigger', 'BEFORE UPDATE ON%FOR EACH ROW%packages_touch_updated_at()'),
      ('package_fee_entries', 'package_fee_entries_guard_trigger', 'BEFORE INSERT OR DELETE OR UPDATE ON%FOR EACH ROW%package_fee_entries_guard()'),
      ('package_fee_entry_discounts', 'package_fee_entry_discounts_guard_trigger', 'BEFORE INSERT OR DELETE OR UPDATE ON%FOR EACH ROW%package_fee_entry_discounts_guard()'),
      ('package_events', 'package_events_guard_trigger', 'BEFORE INSERT OR DELETE OR UPDATE ON%FOR EACH ROW%package_events_guard()'),
      ('packages', 'packages_no_truncate_trigger', 'BEFORE TRUNCATE ON%FOR EACH STATEMENT%package_tables_no_truncate()'),
      ('package_duration_options', 'package_duration_options_no_truncate_trigger', 'BEFORE TRUNCATE ON%FOR EACH STATEMENT%package_tables_no_truncate()'),
      ('package_fee_entries', 'package_fee_entries_no_truncate_trigger', 'BEFORE TRUNCATE ON%FOR EACH STATEMENT%package_tables_no_truncate()'),
      ('package_fee_entry_discounts', 'package_fee_entry_discounts_no_truncate_trigger', 'BEFORE TRUNCATE ON%FOR EACH STATEMENT%package_tables_no_truncate()'),
      ('package_events', 'package_events_no_truncate_trigger', 'BEFORE TRUNCATE ON%FOR EACH STATEMENT%package_tables_no_truncate()')
    ) as x(tbl, trg, pattern)
  loop
    perform pg_temp.rec('G ' || t || ': trigger ' || f,
      exists (select 1 from pg_trigger g
              where g.tgrelid = ('public.' || t)::regclass and g.tgname = f and not g.tgisinternal and g.tgenabled <> 'D'
                and pg_get_triggerdef(g.oid) like '%' || v_def || '%'), '');
  end loop;

  -- H. Trigger functions -----------------------------------------------------------------------------------------------------------------
  foreach f in array v_functions loop
    perform pg_temp.rec('H1 ' || f || ' is security definer with an empty search_path',
      exists (select 1 from pg_proc p where p.oid = to_regprocedure(f) and p.prosecdef
                and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), '');
    perform pg_temp.rec('H2 ' || f || ' is callable by no client role',
      not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), '');
  end loop;

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.packages_guard()');
  perform pg_temp.rec('H3 packages_guard refuses deleting a package and changing its id or creation time (55006)',
    v_src like '%cannot be deleted%' and v_src like '%55006%' and v_src like '%new.id is distinct from old.id%', '');

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.package_fee_entries_guard()');
  perform pg_temp.rec('H4 package_fee_entries_guard: no delete, uncancelled on insert, a correction replaces a cancelled entry of the same package',
    v_src like '%cannot be deleted%' and v_src like '%created uncancelled%'
    and v_src like '%correction replaces a cancelled fee entry of the same package%', '');
  perform pg_temp.rec('H5 package_fee_entries_guard: an entry in effect (centre date) cannot be edited, a cancelled entry is final, an actor may go to null',
    v_src like '%public.centre_timezone()%' and v_src like '%in effect cannot be edited%'
    and v_src like '%cancelled fee entry cannot be changed%' and v_src like '%new.created_by is not null%', '');
  perform pg_temp.rec('H5b package_fee_entries_guard: a cancellation is stamped with the transaction time (cancelled_at must equal now())',
    v_src like '%new.cancelled_at <> now()%' and v_src like '%cancelled at the current time%', '');

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.package_fee_entry_discounts_guard()');
  perform pg_temp.rec('H6 package_fee_entry_discounts_guard: frozen when the entry is cancelled, or in effect and not created in this transaction',
    v_src like '%cancelled fee entry cannot be changed%' and v_src like '%created_at <> now()%'
    and v_src like '%public.centre_timezone()%', '');

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.package_events_guard()');
  perform pg_temp.rec('H7 package_events_guard: nothing changes except the actor going to null',
    v_src like '%old.actor is not null%' and v_src like '%new.actor is null%' and v_src like '%cannot be changed or deleted%', '');
  perform pg_temp.rec('H10 package_events_guard: an event needs an actor when it is written (23502)',
    v_src like '%new.actor is null%' and v_src like '%records who made the change%' and v_src like '%23502%', '');
  perform pg_temp.rec('H11 package_events_guard: a fee_cancelled event''s in_effect flag is checked against the fee entry and the centre date (23514)',
    v_src like '%public.centre_timezone()%' and v_src like '%before_state ->> ''in_effect''%'
    and v_src like '%effective_from%' and v_src like '%does not match the fee entry%' and v_src like '%23514%', '');

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.packages_touch_updated_at()');
  perform pg_temp.rec('H8 packages_touch_updated_at sets updated_at', v_src like '%new.updated_at := now()%', '');

  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.package_tables_no_truncate()');
  perform pg_temp.rec('H9 package_tables_no_truncate refuses truncation', v_src like '%cannot be truncated%' and v_src like '%55006%', '');

  -- Existing rows (INFO only: none is expected before the write functions exist) --------------------------------------------------------------
  perform pg_temp.info('DATA', format('%s package(s), %s option row(s), %s fee entr(ies), %s discount row(s), %s event(s)',
    (select count(*) from public.packages), (select count(*) from public.package_duration_options),
    (select count(*) from public.package_fee_entries), (select count(*) from public.package_fee_entry_discounts),
    (select count(*) from public.package_events)));
  perform pg_temp.info('REFERENCES', format('%s foreign key(s) from tables outside this migration reference the new tables (none until the membership link of a later phase)',
    (select count(*) from pg_constraint c
      where c.contype = 'f'
        and c.confrelid in (select ('public.' || x)::regclass from unnest(v_tables) x)
        and c.conrelid not in (select ('public.' || x)::regclass from unnest(v_tables) x))));
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;
