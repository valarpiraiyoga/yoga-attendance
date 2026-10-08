-- ===========================================================================
-- Migration 0033 verification (structure) - Membership service details
-- Verifies supabase/migrations/0033_membership_service_details.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor of the project the application actually uses, AFTER applying 0033.
-- Read-only catalog queries only: nothing is written, and the whole script is rolled back.
-- The behaviour (a snapshot taken, preserved and recomputed) is verified by
-- verify_0033_membership_service_details_behavior.sql.
--
-- OUTPUT: seq / test / status / detail. Statuses: PASS, FAIL, INFO.
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
          case when p_ok then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $f$;

create function pg_temp.info(p_test text, p_detail text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'INFO', p_detail);
end $f$;

do $$
declare
  v_helper  text;
  v_core    text;
  v_sync    text;
  v_freeze  text;
begin
  select pg_get_functiondef('public.membership_service_details(uuid)'::regprocedure) into v_helper;
  select pg_get_functiondef('public.issue_invoice_core(uuid, date)'::regprocedure) into v_core;
  select pg_get_functiondef('public.sync_invoice_from_membership(uuid)'::regprocedure) into v_sync;
  select pg_get_functiondef('public.invoices_freeze_snapshot()'::regprocedure) into v_freeze;

  -- A. The column --------------------------------------------------------------------------------
  perform pg_temp.rec('A1 invoices.service_details exists as nullable jsonb',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'invoices' and column_name = 'service_details'
              and data_type = 'jsonb' and is_nullable = 'YES'), '');

  perform pg_temp.rec('A1b invoices.service_details_tracked exists as boolean NOT NULL DEFAULT false',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'invoices' and column_name = 'service_details_tracked'
              and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'), '');

  perform pg_temp.rec('A1c no receipt that carries service details is untracked (an untracked receipt must be a pre-0033 one with NULL)',
    not exists (select 1 from public.invoices where service_details is not null and not service_details_tracked), '');

  perform pg_temp.rec('A2 the shape CHECK exists (NULL, or an object with a version and a batches array)',
    exists (select 1 from pg_constraint
            where conrelid = 'public.invoices'::regclass and conname = 'invoices_service_details_shape' and contype = 'c'
              and pg_get_constraintdef(oid) like '%jsonb_typeof%object%'
              and pg_get_constraintdef(oid) like '%version%'
              and pg_get_constraintdef(oid) like '%batches%array%'), '');

  perform pg_temp.info('RECEIPTS', format('%s receipt(s); %s with service details',
    (select count(*) from public.invoices), (select count(*) from public.invoices where service_details is not null)));

  -- B. The helper -----------------------------------------------------------------------------------
  perform pg_temp.rec('B1 membership_service_details(uuid) is security definer with an empty search_path',
    exists (select 1 from pg_proc p where p.oid = 'public.membership_service_details(uuid)'::regprocedure
              and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), '');

  perform pg_temp.rec('B2 no client role (anon, authenticated, PUBLIC) can execute the helper',
    not has_function_privilege('anon', 'public.membership_service_details(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.membership_service_details(uuid)', 'execute')
    and not exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = 'public.membership_service_details(uuid)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ), '');

  perform pg_temp.rec('B3 the helper uses the effective-date rule and does not check schedule status',
    v_helper like '%be.status = ''active''%' and v_helper like '%sc.effective_from <= v_start%'
    and v_helper like '%sc.effective_until is null or sc.effective_until >= v_start%'
    and v_helper not like '%sc.status%' and v_helper not like '%b.status%', '');

  perform pg_temp.rec('B4 the helper orders batches by name, code, id and slots by an explicit day-name CASE',
    v_helper like '%order by b.name, b.code, b.id%' and v_helper like '%when ''monday'' then 1%'
    and v_helper like '%when ''sunday'' then 7%' and v_helper not like '%extract(dow%', '');

  perform pg_temp.rec('B5 overlapping versions fall back to latest effective_from, created_at, id',
    v_helper like '%sc.effective_from desc, sc.created_at desc, sc.id desc%', '');

  -- C. issue_invoice_core -----------------------------------------------------------------------------
  perform pg_temp.rec('C1 issue_invoice_core stores service_details from the helper and marks the receipt tracked',
    v_core like '%service_details, service_details_tracked%' and v_core like '%public.membership_service_details(v_mem.id), true%', '');

  perform pg_temp.rec('C2 it still has 0031''s behaviour: reservations, prefix, bank snapshot, Half Yearly / Annual wording',
    v_core like '%invoice_number_reservations%' and v_core like '%invoice_prefix%' and v_core like '%v_bank.bank_name%'
    and v_core like '%''half_yearly'' then ''Half Yearly''%' and v_core like '%''annual'' then ''Annual''%', '');

  perform pg_temp.rec('C3 no client role can execute issue_invoice_core',
    not has_function_privilege('anon', 'public.issue_invoice_core(uuid, date)', 'execute')
    and not has_function_privilege('authenticated', 'public.issue_invoice_core(uuid, date)', 'execute'), '');

  -- D. Synchronization ----------------------------------------------------------------------------------
  perform pg_temp.rec('D1 sync recomputes service_details only when the start date moved',
    v_sync like '%v_recompute := v_inv.service_details_tracked%' and v_sync like '%v_inv.period_start is distinct from v_mem.start_date%'
    and v_sync like '%service_details = case when v_recompute then v_details else service_details end%', '');

  perform pg_temp.rec('D2 sync still writes the seven financial columns',
    v_sync like '%plan           = v_mem.plan%' and v_sync like '%period_start   = v_mem.start_date%'
    and v_sync like '%period_end     = v_mem.end_date%' and v_sync like '%total_amount   = v_mem.amount%'
    and v_sync like '%taxable_amount = v_taxable%' and v_sync like '%tax_amount     = v_tax_amount%'
    and v_sync like '%description    = v_description%', '');

  perform pg_temp.rec('D3 no client role can execute the sync function',
    not has_function_privilege('anon', 'public.sync_invoice_from_membership(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.sync_invoice_from_membership(uuid)', 'execute'), '');

  perform pg_temp.rec('D4 the membership trigger of 0030 is still in place, unchanged in what it watches',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass
              and t.tgname = 'memberships_sync_invoice_trigger' and not t.tgisinternal
              and pg_get_triggerdef(t.oid) like '%amount%' and pg_get_triggerdef(t.oid) like '%plan%'
              and pg_get_triggerdef(t.oid) like '%start_date%' and pg_get_triggerdef(t.oid) like '%end_date%'), '');

  -- E. The freeze trigger ----------------------------------------------------------------------------------
  perform pg_temp.rec('E1 the freeze trigger exempts exactly eight columns while synchronizing',
    v_freeze like '%''plan'', ''description'', ''period_start'', ''period_end''%'
    and v_freeze like '%''total_amount'', ''taxable_amount'', ''tax_amount'', ''service_details''%'
    and (select count(*) = 8 from regexp_matches(
           substring(v_freeze from 'v_exempt \|\| array\[(.*?)\]'), '''[a-z_]+''', 'g')), '');

  perform pg_temp.rec('E1b the marker is not among the columns the synchronization may change (it is set at issue, never updated)',
    v_freeze not like '%service_details_tracked%' and v_sync not like '%service_details_tracked =%', '');

  perform pg_temp.rec('E2 outside the sync only invoice_number, invoice_date and updated_at are exempt',
    v_freeze like '%array[''invoice_number'', ''invoice_date'', ''updated_at'']%'
    and v_freeze like '%yoga.invoice_sync%', '');

  perform pg_temp.rec('E3 the freeze trigger is still attached to invoices',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and not t.tgisinternal
              and pg_get_triggerdef(t.oid) like '%invoices_freeze_snapshot%'), '');
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL') || ' failed'
from _verify_results;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;
