-- ===========================================================================
-- Migration 0054 structural verification
-- Verifies supabase/migrations/0054_legacy_receipt_protection.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0054. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0054_legacy_receipt_protection_behavior.sql, which edits
-- disposable memberships and receipts for real (and rolls back).
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL, INFO (a readout, never an assertion). Every PASS/FAIL row should be PASS.
-- ===========================================================================

begin transaction read only;

with checks as (
  -- ---- the sync path is gone --------------------------------------------------
  select 1 as seq, 'the trigger memberships_sync_invoice_trigger no longer exists on public.memberships' as check_name,
    not exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_sync_invoice_trigger') as ok,
    '' as detail
  union all
  select 2, 'the function public.memberships_sync_invoice() no longer exists',
    to_regprocedure('public.memberships_sync_invoice()') is null, ''
  union all
  select 3, 'no function public.sync_invoice_from_membership exists, in any signature',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'sync_invoice_from_membership'), ''
  union all
  select 4, 'no remaining trigger on public.memberships calls a receipt sync',
    not exists (
      select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'public.memberships'::regclass and not t.tgisinternal
        and pg_get_functiondef(p.oid) ilike '%sync_invoice_from_membership%'
    ), ''
  union all
  select 5, 'no function in public still refers to sync_invoice_from_membership',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%sync_invoice_from_membership%'
    ), ''
  -- ---- the snapshot protection remains ----------------------------------------
  union all
  select 6, 'invoices_freeze_snapshot() and its trigger invoices_freeze_snapshot_trigger still exist and the trigger is enabled',
    to_regprocedure('public.invoices_freeze_snapshot()') is not null
    and exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_freeze_snapshot_trigger'
                and not t.tgisinternal and t.tgenabled <> 'D'), ''
  union all
  select 7, 'invoices_prevent_delete_trigger and invoices_validate_dates_trigger still exist',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_prevent_delete_trigger' and not t.tgisinternal)
    and exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_validate_dates_trigger' and not t.tgisinternal), ''
  union all
  select 8, 'invoices_tax_consistent and the unique indexes (one receipt per membership, one holder per number) are still in force',
    exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_tax_consistent')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_membership_id_unique')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_invoice_number_unique'), ''
  -- ---- issuance and numbering remain -----------------------------------------
  union all
  select 9, 'receipt issuance remains: memberships_auto_issue_invoice() and its enabled trigger, issue_invoice and issue_invoice_core',
    to_regprocedure('public.memberships_auto_issue_invoice()') is not null
    and exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_auto_issue_invoice_trigger'
                and not t.tgisinternal and t.tgenabled <> 'D')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'issue_invoice')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'issue_invoice_core'), ''
  union all
  select 10, 'memberships_invoice_guard_trigger (Paid -> Pending and payment date protection) is still installed and enabled',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_invoice_guard_trigger'
            and not t.tgisinternal and t.tgenabled <> 'D'), ''
  union all
  select 11, 'number reservation remains: invoices_reserve_number_trigger is installed and enabled',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_reserve_number_trigger'
            and not t.tgisinternal and t.tgenabled <> 'D'), ''
  union all
  select 12, 'update_invoice_details(uuid, bigint, date) remains, callable by authenticated and not by anon',
    to_regprocedure('public.update_invoice_details(uuid, bigint, date)') is not null
    and has_function_privilege('authenticated', 'public.update_invoice_details(uuid, bigint, date)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_invoice_details(uuid, bigint, date)', 'EXECUTE'), ''
  union all
  select 13, 'the payment-document correction remains: correct_payment_document exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'correct_payment_document'), ''
  union all
  select 14, 'the 0049 class-count expiry guard on memberships is untouched',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_class_count_expiry_guard_trigger' and not t.tgisinternal), ''
  -- ---- readouts ---------------------------------------------------------------
  union all
  select 15, 'INFO: receipts / reserved numbers / receipts currently differing from their membership (amount, plan or dates) - NOT changed by 0054',
    true,
    (select count(*) from public.invoices) || ' receipts; '
      || (select count(*) from public.invoice_number_reservations) || ' reserved numbers; '
      || (select count(*) from public.invoices i join public.memberships m on m.id = i.membership_id
          where i.payment_id is null
            and (i.total_amount <> m.amount or i.plan <> m.plan or i.period_start <> m.start_date or i.period_end <> m.end_date))
      || ' membership-level receipts differ from their membership (expected to grow only as legacy memberships are edited after their receipt)'
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
