-- ===========================================================================
-- Migration 0028 structural verification
-- Verifies supabase/migrations/0028_bank_accounts.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0028. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0028_bank_accounts_behavior.sql, which actually creates,
-- activates and deactivates accounts (and rolls back).
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
checks as (
  -- ---- table and columns ---------------------------------------------------
  select 1 as seq, 'bank_accounts exists with exactly the approved columns' as check_name,
    (
      select count(*) = 9 from information_schema.columns
      where table_schema = 'public' and table_name = 'bank_accounts'
        and column_name in ('id', 'bank_name', 'account_name', 'account_number', 'ifsc_code', 'branch',
                            'is_active', 'created_at', 'updated_at')
    )
    and (select count(*) = 9 from information_schema.columns where table_schema = 'public' and table_name = 'bank_accounts') as ok,
    '' as detail
  union all
  select 2, 'id is uuid default gen_random_uuid(); the text columns are text; timestamps are timestamptz',
    (
      select bool_and(ok) from (
        select format_type(atttypid, atttypmod) = 'uuid' as ok from pg_attribute where attrelid = 'public.bank_accounts'::regclass and attname = 'id'
        union all select pg_get_expr(d.adbin, d.adrelid) like '%gen_random_uuid()%'
          from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = 'public.bank_accounts'::regclass and a.attname = 'id'
        union all select format_type(atttypid, atttypmod) = 'text' from pg_attribute where attrelid = 'public.bank_accounts'::regclass and attname in ('bank_name', 'account_name', 'account_number', 'ifsc_code', 'branch')
        union all select format_type(atttypid, atttypmod) = 'timestamp with time zone' from pg_attribute where attrelid = 'public.bank_accounts'::regclass and attname in ('created_at', 'updated_at')
        union all select format_type(atttypid, atttypmod) = 'boolean' from pg_attribute where attrelid = 'public.bank_accounts'::regclass and attname = 'is_active'
      ) s
    ), ''
  union all
  select 3, 'bank_name, account_name, account_number, ifsc_code are required; branch is optional',
    (
      select count(*) = 4 from pg_attribute
      where attrelid = 'public.bank_accounts'::regclass and attname in ('bank_name', 'account_name', 'account_number', 'ifsc_code') and attnotnull
    )
    and not (select attnotnull from pg_attribute where attrelid = 'public.bank_accounts'::regclass and attname = 'branch'), ''
  union all
  select 4, 'is_active is NOT NULL and defaults to false (an account starts inactive)',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'bank_accounts' and column_name = 'is_active'
        and is_nullable = 'NO' and column_default = 'false'
    ), ''
  union all
  select 5, 'created_at / updated_at are NOT NULL with defaults',
    (
      select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'bank_accounts' and column_name in ('created_at', 'updated_at')
        and is_nullable = 'NO' and column_default like '%now()%'
    ), ''
  union all
  select 6, 'validation constraints: required values not blank, sensible lengths, branch NULL or not blank',
    (
      select count(*) = 5 from pg_constraint
      where conrelid = 'public.bank_accounts'::regclass and contype = 'c'
        and conname in ('bank_accounts_bank_name_valid', 'bank_accounts_account_name_valid', 'bank_accounts_account_number_valid',
                        'bank_accounts_ifsc_code_valid', 'bank_accounts_branch_valid')
    )
    and (
      select bool_and(position('btrim' in pg_get_constraintdef(oid)) > 0 and position('<=' in pg_get_constraintdef(oid)) > 0)
      from pg_constraint
      where conrelid = 'public.bank_accounts'::regclass and contype = 'c' and conname like 'bank_accounts_%_valid'
    ), ''
  -- ---- the active rule -------------------------------------------------------
  union all
  select 7, 'a partial UNIQUE index guarantees at most one active account',
    exists (
      select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'public.bank_accounts'::regclass and c.relname = 'bank_accounts_one_active'
        and i.indisunique and i.indpred is not null
        and pg_get_indexdef(i.indexrelid) like '%UNIQUE%(true)%WHERE%is_active%'
    ), ''
  union all
  select 8, 'nothing forces an active account: no check or trigger requires one, so zero active is valid',
    not exists (
      select 1 from pg_constraint
      where conrelid = 'public.bank_accounts'::regclass and contype = 'c' and position('is_active' in pg_get_constraintdef(oid)) > 0
    )
    and (select count(*) = 1 from pg_trigger where tgrelid = 'public.bank_accounts'::regclass and not tgisinternal), ''
  union all
  select 9, 'the current number of active accounts is 0 or 1 (and the index makes anything else impossible)',
    (select count(*) <= 1 from public.bank_accounts where is_active),
    (select count(*)::text from public.bank_accounts where is_active) || ' active of ' || (select count(*)::text from public.bank_accounts)
  -- ---- RLS and privileges -----------------------------------------------------
  union all
  select 10, 'row level security is enabled on bank_accounts',
    (select relrowsecurity from pg_class where oid = 'public.bank_accounts'::regclass), ''
  union all
  select 11, 'exactly three policies: admin-only SELECT, INSERT and UPDATE — and no DELETE policy',
    (
      select count(*) = 3
        and count(*) filter (where cmd = 'SELECT' and qual like '%is_admin()%') = 1
        and count(*) filter (where cmd = 'INSERT' and with_check like '%is_admin()%') = 1
        and count(*) filter (where cmd = 'UPDATE' and qual like '%is_admin()%' and with_check like '%is_admin()%') = 1
        and count(*) filter (where cmd in ('DELETE', 'ALL')) = 0
      from pg_policies where schemaname = 'public' and tablename = 'bank_accounts'
    ), ''
  union all
  select 12, 'authenticated: SELECT yes; table-level INSERT / UPDATE / DELETE / TRUNCATE no; anon nothing',
    has_table_privilege('authenticated', 'public.bank_accounts', 'SELECT')
      and not has_table_privilege('authenticated', 'public.bank_accounts', 'INSERT')
      and not has_table_privilege('authenticated', 'public.bank_accounts', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.bank_accounts', 'DELETE')
      and not has_table_privilege('authenticated', 'public.bank_accounts', 'TRUNCATE')
      and not has_table_privilege('anon', 'public.bank_accounts', 'SELECT')
      and not has_table_privilege('anon', 'public.bank_accounts', 'INSERT')
      and not has_table_privilege('anon', 'public.bank_accounts', 'UPDATE'), ''
  union all
  select 13, 'authenticated may INSERT and UPDATE the five detail columns',
    (
      select bool_and(has_column_privilege('authenticated', 'public.bank_accounts', c, 'INSERT')
                      and has_column_privilege('authenticated', 'public.bank_accounts', c, 'UPDATE'))
      from unnest(array['bank_name', 'account_name', 'account_number', 'ifsc_code', 'branch']) c
    ), ''
  union all
  select 14, 'a client can NEVER write is_active (not on INSERT, not on UPDATE), nor id or the timestamps',
    (
      select bool_and(not has_column_privilege('authenticated', 'public.bank_accounts', c, 'INSERT')
                      and not has_column_privilege('authenticated', 'public.bank_accounts', c, 'UPDATE'))
      from unnest(array['is_active', 'id', 'created_at', 'updated_at']) c
    ), ''
  -- ---- the functions -------------------------------------------------------------
  union all
  select 15, 'activate / deactivate are security definer with an empty search_path',
    (
      select count(*) = 2 and bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))
      from fn where proname in ('activate_bank_account', 'deactivate_bank_account')
    ), ''
  union all
  select 16, 'authenticated may execute them; anon may not',
    (
      select count(*) = 2 and bool_and(has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname in ('activate_bank_account', 'deactivate_bank_account')
    ), ''
  union all
  select 17, 'both check is_admin() first (42501) and report a missing account (P0002)',
    (
      select count(*) = 2 and bool_and(
        def like '%public.is_admin()%' and def like '%42501%' and def like '%P0002%'
        and position('public.is_admin()' in def) < position('invoice_settings' in def))
      from fn where proname in ('activate_bank_account', 'deactivate_bank_account')
    ), ''
  union all
  select 18, 'both take the invoice_settings row lock FOR UPDATE — the lock invoice issuing holds',
    (
      select count(*) = 2 and bool_and(def like '%from public.invoice_settings%where singleton%for update%')
      from fn where proname in ('activate_bank_account', 'deactivate_bank_account')
    )
    and (
      select def like '%from public.invoice_settings%where singleton%for update%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 19, 'activation deactivates the current account FIRST, then activates the requested one',
    (
      select position('set is_active = false' in def) > 0
         and position('set is_active = true' in def) > 0
         and position('set is_active = false' in def) < position('set is_active = true' in def)
         and def like '%where is_active and id <> p_id%'
      from fn where proname = 'activate_bank_account'
    ), ''
  union all
  select 20, 'deactivation only deactivates: it never activates another account',
    (
      select def like '%set is_active = false%' and def not like '%set is_active = true%'
      from fn where proname = 'deactivate_bank_account'
    ), ''
  -- ---- existing invoices are untouched ---------------------------------------------
  union all
  select 21, 'invoices has no bank columns (before 0029) or exactly the five snapshot columns (0029) — never a bank_account_id or a link',
    (
      select count(*) in (0, 5) from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name like '%bank%'
    )
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name like '%bank_account_id%')
    and (select count(*) in (34, 39) from information_schema.columns where table_schema = 'public' and table_name = 'invoices'), ''
  union all
  select 22, 'issue_invoice_core does not mention bank accounts (before 0029), or only reads the active account (0029)',
    (select def not ilike '%bank%' or def like '%from public.bank_accounts%where is_active%' from fn where proname = 'issue_invoice_core'), ''
  union all
  select 23, 'the invoice freeze, validate and delete triggers and the settings guard are all still in place',
    (
      select count(*) = 4 from pg_trigger
      where not tgisinternal and tgname in ('invoices_freeze_snapshot_trigger', 'invoices_validate_dates_trigger',
                                            'invoices_prevent_delete_trigger', 'invoice_settings_guard_trigger')
    ), ''
  union all
  select 24, 'no invoice refers to a bank account (there is no column that could)',
    not exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'f' and confrelid = 'public.bank_accounts'::regclass
    ), ''
  union all
  select 25, 'INFO: invoices / bank accounts / active accounts',
    true,
    (select count(*)::text from public.invoices) || ' invoices; '
      || (select count(*)::text from public.bank_accounts) || ' bank accounts; '
      || (select count(*)::text from public.bank_accounts where is_active) || ' active'
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
