-- ===========================================================================
-- Migration 0029 structural verification
-- Verifies supabase/migrations/0029_invoice_bank_account_snapshot.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0029. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0029_invoice_bank_snapshot_behavior.sql, which actually issues
-- invoices with and without an active bank account (and rolls back).
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
  -- ---- columns ---------------------------------------------------------------
  select 1 as seq, 'invoices has the five bank snapshot columns: text, nullable, no default' as check_name,
    (
      select count(*) = 5 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices'
        and column_name in ('bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc_code', 'bank_branch')
        and data_type = 'text' and is_nullable = 'YES' and column_default is null
    ) as ok, '' as detail
  union all
  select 2, 'invoices now has 39 columns: the 34 before plus exactly those five',
    (select count(*) = 39 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'), ''
  union all
  select 3, 'there is NO bank_account_id and NO foreign key to bank_accounts: the snapshot is not a live link',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name like '%bank_account_id%')
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'f' and confrelid = 'public.bank_accounts'::regclass
    )
    and (select count(*) = 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f'), ''
  union all
  select 4, 'invoices_bank_snapshot_valid: no bank detail at all, or the four required details together, with the bank_accounts limits',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and conname = 'invoices_bank_snapshot_valid' and contype = 'c'
        and position('<= 100' in pg_get_constraintdef(oid)) > 0
        and position('<= 34' in pg_get_constraintdef(oid)) > 0
        and position('<= 20' in pg_get_constraintdef(oid)) > 0
        and position('btrim' in pg_get_constraintdef(oid)) > 0
        and position('IS NULL' in pg_get_constraintdef(oid)) > 0
    ), ''
  union all
  select 5, 'the limits equal bank_accounts (names and branch 100, number 34, IFSC 20)',
    (
      select bool_and(position(l in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'invoices_bank_snapshot_valid')) > 0)
      from unnest(array['length(bank_name) <= 100', 'length(bank_account_name) <= 100', 'length(bank_account_number) <= 34',
                        'length(bank_ifsc_code) <= 20', 'length(bank_branch) <= 100']) l
    )
    and (
      select bool_and(position(l in (select string_agg(pg_get_constraintdef(oid), ' ') from pg_constraint where conrelid = 'public.bank_accounts'::regclass and contype = 'c')) > 0)
      from unnest(array['length(bank_name) <= 100', 'length(account_name) <= 100', 'length(account_number) <= 34',
                        'length(ifsc_code) <= 20', 'length(branch) <= 100']) l
    ), ''
  -- ---- issuing -----------------------------------------------------------------
  union all
  select 6, 'issue_invoice_core copies the active bank account into the five columns',
    (
      select def like '%bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch%'
         and def like '%v_bank.bank_name, v_bank.account_name, v_bank.account_number, v_bank.ifsc_code, v_bank.branch%'
         and def like '%from public.bank_accounts%where is_active%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 7, 'with no active account the snapshot is simply NULL: the account is read with a plain SELECT INTO, not STRICT, and nothing raises',
    (
      select def like '%select * into v_bank%' and def not ilike '%into strict%' and def not ilike '%bank account%not found%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 8, 'the account is read AFTER the invoice_settings row is locked FOR UPDATE (the lock the bank-account functions take)',
    (
      select position('from public.invoice_settings' in def) > 0
         and position('for update' in substr(def, position('from public.invoice_settings' in def))) > 0
         and position('from public.invoice_settings' in def) < position('from public.bank_accounts' in def)
         and position('from public.memberships' in def) < position('from public.invoice_settings' in def)
      from fn where proname = 'issue_invoice_core'
    )
    and (
      select count(*) = 2 and bool_and(def like '%from public.invoice_settings%where singleton%for update%')
      from fn where proname in ('activate_bank_account', 'deactivate_bank_account')
    ), ''
  union all
  select 9, 'the account is read once, with no second lock and no lock on the account row',
    (
      select (length(def) - length(replace(def, 'public.bank_accounts', ''))) / length('public.bank_accounts') = 2
         and def not like '%from public.bank_accounts%for update%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 10, 'the counter logic is intact: counter row, skip used numbers, advance in the same transaction',
    (
      select def like '%coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number)%'
         and def like '%while exists (select 1 from public.invoices where invoice_number = v_candidate) loop%'
         and def like '%next_invoice_number = v_candidate + 1%'
         and def not ilike '%max(%' and def not ilike '%nextval%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 11, 'the tax calculation and the prefix copy are intact',
    (
      select def like '%round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
         and def like '%v_taxable := v_mem.amount - v_tax_amount%'
         and def like '%v_settings.invoice_prefix%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 12, 'the date rules, the Paid / payment-date / one-invoice rules and the lock order are intact',
    (
      select def like '%v_invoice_date < v_mem.payment_date%'
         and def like '%v_invoice_date > v_today%'
         and def like '%Only a Paid membership can be invoiced.%'
         and def like '%An invoice has already been issued for this membership.%'
         and def like '%Invoice numbering has not been configured.%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 13, 'issue_invoice_core is still security definer, empty search_path, executable by no client role',
    (
      select count(*) = 1 and bool_and(
        prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
        and not has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname = 'issue_invoice_core'
    ), ''
  -- ---- the freeze and the edit ---------------------------------------------------
  union all
  select 14, 'the freeze compares the whole row and exempts only number, date, updated_at — so the bank snapshot is protected, unchanged',
    (
      select def like '%to_jsonb(new) - ''invoice_number'' - ''invoice_date'' - ''updated_at''%'
         and def not ilike '%bank%' and def like '%55006%'
      from fn where proname = 'invoices_freeze_snapshot'
    )
    and exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'invoices_freeze_snapshot_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16), ''
  union all
  select 15, 'update_invoice_details still writes only number, date and updated_at, and does not mention the bank',
    (
      select def like '%set invoice_number = p_invoice_number,%invoice_date = p_invoice_date,%updated_at = now()%'
         and def not ilike '%bank%'
      from fn where proname = 'update_invoice_details'
    ), ''
  union all
  select 16, 'issue_invoice and the other invoice triggers are unchanged (no bank mention, all in place)',
    (select count(*) = 1 and bool_and(def not ilike '%bank%') from fn where proname = 'issue_invoice')
    and (
      select count(*) = 4 from pg_trigger
      where not tgisinternal and tgname in ('invoices_validate_dates_trigger', 'invoices_prevent_delete_trigger',
                                            'invoice_settings_guard_trigger', 'memberships_auto_issue_invoice_trigger')
    ), ''
  -- ---- security ---------------------------------------------------------------------
  union all
  select 17, 'clients still cannot write invoices: SELECT only, no column UPDATE on any bank snapshot column; anon nothing',
    has_table_privilege('authenticated', 'public.invoices', 'SELECT')
      and not has_table_privilege('authenticated', 'public.invoices', 'INSERT')
      and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.invoices', 'DELETE')
      and (
        select bool_and(not has_column_privilege('authenticated', 'public.invoices', c, 'UPDATE')
                        and not has_column_privilege('authenticated', 'public.invoices', c, 'INSERT'))
        from unnest(array['bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc_code', 'bank_branch']) c
      )
      and not has_table_privilege('anon', 'public.invoices', 'SELECT'), ''
  union all
  select 18, 'invoices still has exactly one policy: admin-only SELECT',
    (
      select count(*) = 1 and count(*) filter (where cmd = 'SELECT' and qual like '%is_admin()%') = 1
      from pg_policies where schemaname = 'public' and tablename = 'invoices'
    ), ''
  -- ---- bank accounts untouched ----------------------------------------------------------
  union all
  select 19, 'bank_accounts is untouched: same one-active index, three admin policies, no delete, the two functions',
    exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'bank_accounts' and indexname = 'bank_accounts_one_active')
    and (select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'bank_accounts')
    and not has_table_privilege('authenticated', 'public.bank_accounts', 'DELETE')
    and not has_column_privilege('authenticated', 'public.bank_accounts', 'is_active', 'UPDATE')
    and (select count(*) = 2 from fn where proname in ('activate_bank_account', 'deactivate_bank_account')), ''
  -- ---- existing data -------------------------------------------------------------------
  union all
  select 20, 'no invoice has a partial snapshot (all five NULL, or the four required present)',
    not exists (
      select 1 from public.invoices
      where not (
        (bank_name is null and bank_account_name is null and bank_account_number is null and bank_ifsc_code is null and bank_branch is null)
        or (bank_name is not null and bank_account_name is not null and bank_account_number is not null and bank_ifsc_code is not null)
      )
    ), ''
  union all
  select 21, 'invoice_number is still bigint with its unique index, and the prefix column is still there',
    exists (select 1 from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'invoice_number' and format_type(atttypid, atttypmod) = 'bigint')
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'invoices' and indexname = 'invoices_invoice_number_unique')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_prefix'), ''
  union all
  select 22, 'INFO: invoices / invoices with a bank snapshot / active accounts',
    true,
    (select count(*)::text from public.invoices) || ' invoices; '
      || (select count(*)::text from public.invoices where bank_name is not null) || ' with a bank snapshot; '
      || (select count(*)::text from public.bank_accounts where is_active) || ' active account(s)'
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
