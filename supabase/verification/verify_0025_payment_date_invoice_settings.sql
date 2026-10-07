-- ===========================================================================
-- Migration 0025 structural verification
-- Verifies supabase/migrations/0025_payment_date_invoice_settings.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0025. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL, INFO (a readout, never an assertion). Every PASS/FAIL row should be PASS.
-- ===========================================================================

begin transaction read only;

with
checks as (
  select 1 as seq, 'memberships.payment_date exists: date, nullable, no default' as check_name,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'memberships' and column_name = 'payment_date'
        and data_type = 'date' and is_nullable = 'YES' and column_default is null
    ) as ok, '' as detail
  union all
  select 2, 'constraint memberships_payment_date_only_when_paid exists',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.memberships'::regclass
        and conname = 'memberships_payment_date_only_when_paid' and contype = 'c'
        and pg_get_constraintdef(oid) like '%payment_status%paid%payment_date IS NULL%'
    ), ''
  union all
  select 3, 'no non-Paid membership carries a payment_date',
    not exists (select 1 from public.memberships where payment_status <> 'paid' and payment_date is not null), ''
  union all
  select 4, 'memberships gained no invoice_number / invoice_date / invoice_id column',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'memberships'
        and column_name in ('invoice_number', 'invoice_date', 'invoice_id')
    ), ''
  union all
  select 5, 'memberships_payment_rules_trigger exists (BEFORE, row-level, security definer, empty search_path)',
    exists (
      select 1 from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'public.memberships'::regclass
        and t.tgname = 'memberships_payment_rules_trigger'
        and not t.tgisinternal
        and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1
        and p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
    ), ''
  union all
  select 6, 'payment rules default to the centre timezone and never touch an already-Paid row',
    (
      select pg_get_functiondef(p.oid) like '%centre_timezone()%'
         and pg_get_functiondef(p.oid) like '%old.payment_status is distinct from ''paid''%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'memberships_payment_rules'
    ), ''
  union all
  select 7, 'invoice_settings exists with exactly one row (singleton)',
    (select count(*) = 1 from public.invoice_settings where singleton)
      and exists (
        select 1 from pg_constraint
        where conrelid = 'public.invoice_settings'::regclass and conname = 'invoice_settings_is_singleton'
      ), ''
  union all
  select 8, 'invoice_settings has the approved columns',
    (
      select count(*) = 12 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_settings'
        and column_name in (
          'singleton', 'starting_invoice_number', 'next_invoice_number', 'document_title',
          'tax_enabled', 'tax_name', 'tax_rate', 'terms', 'signatory_name',
          'signatory_designation', 'signature_path', 'updated_at'
        )
    ), ''
  union all
  select 9, 'invoice_settings duplicates no Center Profile field',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_settings'
        and column_name in ('name', 'address', 'phone', 'email', 'logo_url', 'timezone', 'currency')
    ), ''
  union all
  select 10, 'document_title defaults to invoice and allows only invoice / receipt',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_settings'
        and column_name = 'document_title' and is_nullable = 'NO' and column_default like '%invoice%'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoice_settings'::regclass
        and conname = 'invoice_settings_document_title_valid'
        and pg_get_constraintdef(oid) like '%invoice%receipt%'
    ), ''
  union all
  select 11, 'tax_enabled defaults to false',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_settings'
        and column_name = 'tax_enabled' and is_nullable = 'NO' and column_default = 'false'
    ), ''
  union all
  select 12, 'tax_rate is numeric(5,2), > 0 and < 100',
    exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.invoice_settings'::regclass and a.attname = 'tax_rate'
        and format_type(a.atttypid, a.atttypmod) = 'numeric(5,2)'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoice_settings'::regclass and conname = 'invoice_settings_tax_rate_range'
    ), ''
  union all
  select 13, 'starting / next numbers are bigint and positive when set',
    (
      select count(*) = 2 from pg_attribute a
      where a.attrelid = 'public.invoice_settings'::regclass
        and a.attname in ('starting_invoice_number', 'next_invoice_number')
        and format_type(a.atttypid, a.atttypmod) = 'bigint'
    )
    and exists (select 1 from pg_constraint where conname = 'invoice_settings_starting_positive')
    and exists (select 1 from pg_constraint where conname = 'invoice_settings_next_positive'), ''
  union all
  select 14, 'tax-enabled settings require a name and a rate',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoice_settings'::regclass and conname = 'invoice_settings_tax_complete'
    ), ''
  union all
  select 15, 'row level security is enabled on invoice_settings',
    (select relrowsecurity from pg_class where oid = 'public.invoice_settings'::regclass), ''
  union all
  select 16, 'invoice_settings has admin-only select and update policies and nothing else',
    (
      select count(*) = 2
        and count(*) filter (where cmd = 'SELECT' and qual like '%is_admin()%') = 1
        and count(*) filter (where cmd = 'UPDATE' and qual like '%is_admin()%' and with_check like '%is_admin()%') = 1
      from pg_policies where schemaname = 'public' and tablename = 'invoice_settings'
    ), ''
  union all
  select 17, 'authenticated: SELECT yes; INSERT / DELETE / TRUNCATE no; anon nothing',
    has_table_privilege('authenticated', 'public.invoice_settings', 'SELECT')
      and not has_table_privilege('authenticated', 'public.invoice_settings', 'INSERT')
      and not has_table_privilege('authenticated', 'public.invoice_settings', 'DELETE')
      and not has_table_privilege('authenticated', 'public.invoice_settings', 'TRUNCATE')
      and not has_table_privilege('anon', 'public.invoice_settings', 'SELECT')
      and not has_table_privilege('anon', 'public.invoice_settings', 'UPDATE'), ''
  union all
  select 18, 'next_invoice_number cannot be updated by a client; configuration columns can',
    not has_column_privilege('authenticated', 'public.invoice_settings', 'next_invoice_number', 'UPDATE')
      and has_column_privilege('authenticated', 'public.invoice_settings', 'starting_invoice_number', 'UPDATE')
      and has_column_privilege('authenticated', 'public.invoice_settings', 'terms', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.invoice_settings', 'UPDATE'), ''
  union all
  select 19, 'existing memberships still read and keep their own columns',
    (
      select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'memberships'
        and column_name in ('membership_code', 'amount', 'currency', 'payment_status')
    ), ''
  union all
  select 20, 'existing triggers on memberships are intact',
    (
      select count(*) = 2 from pg_trigger
      where tgrelid = 'public.memberships'::regclass and not tgisinternal
        and tgname in ('set_membership_code_trigger', 'prevent_membership_code_change_trigger')
    ), ''
  union all
  select 21, 'INFO: numbering configured?',
    true,
    coalesce((select 'starting_invoice_number = ' || starting_invoice_number from public.invoice_settings where starting_invoice_number is not null),
             'not configured (automatic issuing stays off until it is)')
  union all
  select 22, 'INFO: Paid memberships with no payment_date (existing memberships, deliberately not back-filled)',
    true,
    (select count(*)::text from public.memberships where payment_status = 'paid' and payment_date is null)
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
