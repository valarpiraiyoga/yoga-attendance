-- ===========================================================================
-- Migration 0030 structural verification
-- Verifies supabase/migrations/0030_invoice_membership_sync.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0030. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0030_invoice_membership_sync_behavior.sql, which edits
-- memberships and receipts for real (and rolls back).
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
  -- ---- the reservation table -----------------------------------------------
  select 1 as seq, 'invoice_number_reservations exists: invoice_number bigint PRIMARY KEY, invoice_id uuid NOT NULL, reserved_at' as check_name,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_number_reservations' and column_name = 'invoice_number' and data_type = 'bigint' and is_nullable = 'NO')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_number_reservations' and column_name = 'invoice_id' and data_type = 'uuid' and is_nullable = 'NO')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_number_reservations' and column_name = 'reserved_at')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoice_number_reservations'::regclass and contype = 'p'
                and pg_get_constraintdef(oid) = 'PRIMARY KEY (invoice_number)') as ok, '' as detail
  union all
  select 2, 'the table has exactly those three columns (no audit system)',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_number_reservations'), ''
  union all
  select 3, 'invoice_id references invoices(id), ON DELETE RESTRICT, DEFERRABLE INITIALLY DEFERRED',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoice_number_reservations'::regclass and contype = 'f'
        and confrelid = 'public.invoices'::regclass and confdeltype = 'r' and condeferrable and condeferred
    ), ''
  union all
  select 4, 'the table is closed to clients: RLS on, no policy, no grant to anon or authenticated',
    (select relrowsecurity from pg_class where oid = 'public.invoice_number_reservations'::regclass)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_number_reservations')
    and not has_table_privilege('authenticated', 'public.invoice_number_reservations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.invoice_number_reservations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.invoice_number_reservations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.invoice_number_reservations', 'DELETE')
    and not has_table_privilege('anon', 'public.invoice_number_reservations', 'SELECT'), ''
  union all
  select 5, 'every existing receipt number is reserved (the backfill)',
    not exists (
      select 1 from public.invoices i
      where not exists (select 1 from public.invoice_number_reservations r where r.invoice_number = i.invoice_number)
    ), ''
  union all
  select 6, 'every existing receipt number is reserved BY that receipt',
    not exists (
      select 1 from public.invoices i
      join public.invoice_number_reservations r on r.invoice_number = i.invoice_number
      where r.invoice_id <> i.id
    ), ''
  -- ---- the reservation trigger ------------------------------------------------
  union all
  select 7, 'invoices_reserve_number: security definer, empty search_path, refuses ANY already-reserved number (even this receipt''s own)',
    (
      select prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
         and def like '%on conflict (invoice_number) do nothing%'
         and def like '%get diagnostics v_reserved = row_count%'
         and def like '%if v_reserved = 0 then%'
         and def like '%new.invoice_number is not distinct from old.invoice_number%'
         and def not like '%v_holder%'
         and def like '%23505%'
      from fn where proname = 'invoices_reserve_number'
    ), ''
  union all
  select 8, 'invoices_reserve_number_trigger: BEFORE, row-level, on INSERT and on UPDATE OF invoice_number',
    exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_reserve_number_trigger' and not t.tgisinternal
        and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16
        and pg_get_triggerdef(t.oid) like '%UPDATE OF invoice_number%'
    ), ''
  -- ---- the counter ----------------------------------------------------------------
  union all
  select 9, 'issue_invoice_core skips reserved numbers as well as held ones; the counter row, tax formula and lock order are intact',
    (
      select def like '%while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)%'
         and def like '%or exists (select 1 from public.invoices where invoice_number = v_candidate) loop%'
         and def like '%coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number)%'
         and def like '%next_invoice_number = v_candidate + 1%'
         and def like '%round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
         and def like '%v_taxable := v_mem.amount - v_tax_amount%'
         and def like '%select * into v_bank%from public.bank_accounts%where is_active%'
         and position('from public.memberships' in def) < position('from public.invoice_settings' in def)
         and def not ilike '%max(%' and def not ilike '%nextval%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 10, 'issue_invoice_core is still security definer, empty search_path, executable by no client role',
    (
      select count(*) = 1 and bool_and(
        prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
        and not has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname = 'issue_invoice_core'
    ), ''
  -- ---- the freeze ----------------------------------------------------------------------
  union all
  select 11, 'invoices_freeze_snapshot: the three always-exempt keys, and the seven synchronized keys ONLY under the sync marker',
    (
      select def like '%array[''invoice_number'', ''invoice_date'', ''updated_at'']%'
         and def like '%current_setting(''yoga.invoice_sync'', true) = old.id::text%'
         and def like '%''plan'', ''description'', ''period_start'', ''period_end''%'
         and def like '%''total_amount'', ''taxable_amount'', ''tax_amount''%'
         and def like '%(to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt)%'
         and def like '%55006%'
      from fn where proname = 'invoices_freeze_snapshot'
    )
    and exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'invoices_freeze_snapshot_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16), ''
  union all
  select 12, 'the freeze does NOT exempt anything frozen: no business, customer, bank, terms, signatory, tax setting, currency or payment-date column is named',
    (
      select not (def ~ '(business_|customer_|bank_|terms|signatory|signature|tax_enabled|tax_name|tax_rate|currency|payment_date|invoice_prefix|document_title|membership_id)')
      from fn where proname = 'invoices_freeze_snapshot'
    ), ''
  -- ---- the sync -------------------------------------------------------------------------
  union all
  select 13, 'sync_invoice_from_membership exists: security definer, empty search_path, executable by NO client role',
    (
      select count(*) = 1 and bool_and(
        prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
        and not has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname = 'sync_invoice_from_membership'
    ), ''
  union all
  select 14, 'the sync writes only the seven columns (and updated_at), by invoice id, after locking the receipt row',
    (
      select def like '%where membership_id = p_membership_id%for update%'
         and def like '%set plan           = v_mem.plan,%'
         and def like '%description    = v_description,%'
         and def like '%period_start   = v_mem.start_date,%'
         and def like '%period_end     = v_mem.end_date,%'
         and def like '%total_amount   = v_mem.amount,%'
         and def like '%taxable_amount = v_taxable,%'
         and def like '%tax_amount     = v_tax_amount,%'
         and def like '%updated_at     = now()%'
         and def like '%where id = v_inv.id%'
         and def not like '%invoice_number =%' and def not like '%invoice_date =%' and def not like '%invoice_prefix =%'
         and def not like '%insert into%'
         and regexp_replace(def, '--[^\n]*', '', 'g') not like '%issue_invoice%'
      from fn where proname = 'sync_invoice_from_membership'
    ), ''
  union all
  select 15, 'the sync uses the receipt''s OWN stored tax rate with the issue formula; tax off leaves both NULL',
    (
      select def like '%round(v_mem.amount * v_inv.tax_rate / (100 + v_inv.tax_rate), 2)%'
         and def like '%v_taxable := v_mem.amount - v_tax_amount%'
         and def like '%if v_inv.tax_enabled then%'
         and def not like '%invoice_settings%'
      from fn where proname = 'sync_invoice_from_membership'
    ), ''
  union all
  select 16, 'the sync sets and clears the transaction-local marker for exactly this invoice',
    (
      select def like '%set_config(''yoga.invoice_sync'', v_inv.id::text, true)%'
         and def like '%set_config(''yoga.invoice_sync'', '''', true)%'
      from fn where proname = 'sync_invoice_from_membership'
    ), ''
  union all
  select 17, 'memberships_sync_invoice_trigger: AFTER UPDATE OF amount, plan, start_date, end_date, row-level, WHEN one of them changed',
    exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_sync_invoice_trigger' and not t.tgisinternal
        and (t.tgtype & 2) = 0 and (t.tgtype & 1) = 1 and (t.tgtype & 16) = 16
        and pg_get_triggerdef(t.oid) like '%UPDATE OF amount, plan, start_date, end_date%'
        and pg_get_triggerdef(t.oid) like '%WHEN%'
    ), ''
  union all
  select 18, 'memberships_sync_invoice calls the sync and nothing else (security definer, empty search_path)',
    (
      select prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
         and def like '%perform public.sync_invoice_from_membership(new.id)%'
         and def not like '%issue_invoice%'
      from fn where proname = 'memberships_sync_invoice'
    ), ''
  -- ---- what did not change -----------------------------------------------------------------
  union all
  select 19, 'the membership guards and the auto-issue trigger are intact',
    (
      select count(*) = 3 from pg_trigger
      where not tgisinternal and tgrelid = 'public.memberships'::regclass
        and tgname in ('memberships_invoice_guard_trigger', 'memberships_payment_rules_trigger', 'memberships_auto_issue_invoice_trigger')
    )
    and (select def like '%The payment status cannot be changed after an invoice has been issued.%' and def like '%The payment date cannot be changed after an invoice has been issued.%'
         from fn where proname = 'memberships_invoice_guard'), ''
  union all
  select 20, 'the other invoice triggers are intact (validate dates, prevent delete) and invoices has no new column',
    (
      select count(*) = 2 from pg_trigger
      where not tgisinternal and tgname in ('invoices_validate_dates_trigger', 'invoices_prevent_delete_trigger')
    )
    and (select count(*) = 39 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'), ''
  union all
  select 21, 'invoices stays SELECT-only for clients; update_invoice_details and issue_invoice are unchanged in access',
    has_table_privilege('authenticated', 'public.invoices', 'SELECT')
    and not has_table_privilege('authenticated', 'public.invoices', 'INSERT')
    and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.invoices', 'DELETE')
    and (select count(*) = 2 and bool_and(has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))
         from fn where proname in ('issue_invoice', 'update_invoice_details')), ''
  union all
  select 22, 'unique indexes still guard one receipt per membership and one current holder per number',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_membership_id_unique')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_invoice_number_unique'), ''
  union all
  select 23, 'invoices_tax_consistent is still in force, and every existing receipt satisfies it',
    exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_tax_consistent')
    and not exists (select 1 from public.invoices where tax_enabled and taxable_amount + tax_amount <> total_amount), ''
  union all
  select 24, 'INFO: receipts / reservations / receipts currently differing from their membership (amount, plan or dates) — NOT changed by 0030',
    true,
    (select count(*) from public.invoices) || ' receipts; '
      || (select count(*) from public.invoice_number_reservations) || ' reserved numbers; '
      || (select count(*) from public.invoices i join public.memberships m on m.id = i.membership_id
          where i.total_amount <> m.amount or i.plan <> m.plan or i.period_start <> m.start_date or i.period_end <> m.end_date) || ' differ from their membership'
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
