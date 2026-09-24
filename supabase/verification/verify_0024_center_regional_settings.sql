-- ===========================================================================
-- Migration 0024 structural verification
-- Verifies supabase/migrations/0024_center_regional_settings.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0024. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and the single center_profile row.
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL. Every row should be PASS.
-- ===========================================================================

begin transaction read only;

with
cp as (
  select timezone, currency from public.center_profile where singleton
),
checks as (
  select 1 as seq, 'center_profile.timezone exists, not null, default Asia/Kolkata' as check_name,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'center_profile' and column_name = 'timezone'
        and is_nullable = 'NO' and column_default like '%Asia/Kolkata%'
    ) as ok, '' as detail
  union all
  select 2, 'center_profile.currency exists, not null, default INR',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'center_profile' and column_name = 'currency'
        and is_nullable = 'NO' and column_default like '%INR%'
    ), ''
  union all
  select 3, 'memberships.currency exists, not null, default INR',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'memberships' and column_name = 'currency'
        and is_nullable = 'NO' and column_default like '%INR%'
    ), ''
  union all
  select 4, 'the centre row has a valid time zone and currency',
    (select count(*) = 1 and bool_and(timezone in (select name from pg_timezone_names) and currency ~ '^[A-Z]{3}$') from cp),
    coalesce((select timezone || ' / ' || currency from cp), 'no center_profile row')
  union all
  select 5, 'no membership lacks a currency',
    not exists (select 1 from public.memberships where currency is null or currency !~ '^[A-Z]{3}$'), ''
  union all
  select 6, 'centre_timezone() and center_settings() exist and are callable by authenticated only',
    (
      select count(*) = 2 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('centre_timezone', 'center_settings')
        and has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('anon', p.oid, 'execute')
    ), ''
  union all
  select 7, 'centre_timezone() returns the saved zone',
    public.centre_timezone() = (select timezone from cp), public.centre_timezone()
  union all
  select 8, 'no rule function still hard-codes Asia/Kolkata',
    not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('resolve_eligible_students', 'save_session_attendance', 'schedule_usage',
                          'delete_unused_schedule', 'correct_unused_schedule')
        and pg_get_functiondef(p.oid) like '%''Asia/Kolkata''%'
    ), ''
  union all
  select 9, 'the unstarted-assignment delete policy uses the centre timezone',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'enrollment_schedules'
        and policyname = 'enrollment_schedules_delete_unstarted_admin'
        and qual like '%centre_timezone%'
    ), ''
)
select seq, check_name, case when ok then 'PASS' else 'FAIL' end as status, detail
from checks
union all
select 99, 'SUMMARY', case when bool_and(ok) then 'PASS' else 'FAIL' end,
  count(*) filter (where ok) || ' of ' || count(*) || ' checks passed'
from checks
order by seq;

rollback;
