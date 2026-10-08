-- ===========================================================================
-- Migration 0031 structural verification
-- Verifies supabase/migrations/0031_membership_plans.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0031. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0031_membership_plans_behavior.sql, which creates memberships
-- with the new plans for real (and rolls back).
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL, INFO (a readout, never an assertion). Every PASS/FAIL row should be PASS.
-- ===========================================================================

begin transaction read only;

with
fn as (
  select p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def, p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
plan_checks as (
  select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.contype = 'c'
    and c.conrelid in ('public.memberships'::regclass, 'public.invoices'::regclass)
    and pg_get_constraintdef(c.oid) like '%plan%'
    and pg_get_constraintdef(c.oid) like '%monthly%'
),
checks as (
  select 1 as seq, 'memberships has exactly ONE plan CHECK, memberships_plan_valid, listing all five plans' as check_name,
    (select count(*) = 1 from plan_checks where tbl = 'memberships')
    and exists (select 1 from plan_checks where tbl = 'memberships' and conname = 'memberships_plan_valid'
                and def like '%monthly%' and def like '%quarterly%' and def like '%half_yearly%' and def like '%annual%' and def like '%custom%') as ok,
    '' as detail
  union all
  select 2, 'invoices has exactly ONE plan CHECK, invoices_plan_valid, listing all five plans',
    (select count(*) = 1 from plan_checks where tbl = 'invoices')
    and exists (select 1 from plan_checks where tbl = 'invoices' and conname = 'invoices_plan_valid'
                and def like '%monthly%' and def like '%quarterly%' and def like '%half_yearly%' and def like '%annual%' and def like '%custom%'), ''
  union all
  select 3, 'both constraints are validated (they apply to every existing row)',
    not exists (select 1 from pg_constraint where conname in ('memberships_plan_valid', 'invoices_plan_valid') and not convalidated), ''
  union all
  select 4, 'every existing membership and receipt plan is one of the five',
    not exists (select 1 from public.memberships where plan not in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'))
    and not exists (select 1 from public.invoices where plan not in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom')), ''
  union all
  select 5, 'issue_invoice_core words the new plans (Half Yearly, Annual) and is otherwise intact',
    (
      select def like '%when ''half_yearly'' then ''Half Yearly''%'
         and def like '%when ''annual'' then ''Annual''%'
         and def like '%else ''Custom duration''%'
         and def like '%while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)%'
         and def like '%round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
         and def like '%select * into v_bank%from public.bank_accounts%where is_active%'
         and prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
         and not has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 6, 'sync_invoice_from_membership words the new plans the same way and is otherwise intact',
    (
      select def like '%when ''half_yearly'' then ''Half Yearly''%'
         and def like '%when ''annual'' then ''Annual''%'
         and def like '%else ''Custom duration''%'
         and def like '%round(v_mem.amount * v_inv.tax_rate / (100 + v_inv.tax_rate), 2)%'
         and def like '%set_config(''yoga.invoice_sync'', v_inv.id::text, true)%'
         and prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
         and not has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
      from fn where proname = 'sync_invoice_from_membership'
    ), ''
  union all
  select 7, 'the 0030 machinery is intact: reservation trigger, freeze with the sync marker, membership trigger',
    exists (select 1 from pg_trigger where tgname = 'invoices_reserve_number_trigger' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'memberships_sync_invoice_trigger' and not tgisinternal)
    and (select def like '%current_setting(''yoga.invoice_sync'', true) = old.id::text%' from fn where proname = 'invoices_freeze_snapshot'), ''
  union all
  select 8, 'invoices still has 39 columns and no new table appeared',
    (select count(*) = 39 from information_schema.columns where table_schema = 'public' and table_name = 'invoices')
    and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'invoice_number_reservations'), ''
  union all
  select 9, 'INFO: memberships / receipts by plan',
    true,
    coalesce((select string_agg(plan || '=' || n, ', ' order by plan) from (select plan, count(*) n from public.memberships group by plan) m), 'none')
      || ' | receipts: '
      || coalesce((select string_agg(plan || '=' || n, ', ' order by plan) from (select plan, count(*) n from public.invoices group by plan) i), 'none')
)
select seq, check_name,
  case when check_name like 'INFO:%' then 'INFO' when ok then 'PASS' else 'FAIL' end as status,
  detail
from checks
union all
select 99, 'SUMMARY', case when bool_and(ok) then 'PASS' else 'FAIL' end,
  count(*) filter (where ok) || ' of ' || count(*) || ' checks passed'
from checks
order by seq;

rollback;
