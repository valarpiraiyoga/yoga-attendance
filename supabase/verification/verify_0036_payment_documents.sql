-- ===========================================================================
-- Migration 0036 verification (structure) - Payment documents and separate numbering
-- Verifies supabase/migrations/0036_payment_documents.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor after 0034-0038 are applied. Read-only catalog queries only; rolled back.
-- 0037 narrows invoices_payment_id_unique and re-creates issue_payment_document (via a core function); those are
-- checked here in their CURRENT form and said so. Behaviour: verify_0036_payment_documents_behavior.sql.
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

do $$
declare
  v_idx text;
begin
  -- A. invoices: payment and series ------------------------------------------------------------------------
  perform pg_temp.rec('A1 invoices.payment_id references membership_payments',
    exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f'
              and confrelid = 'public.membership_payments'::regclass), '');
  perform pg_temp.rec('A2 invoices.document_series is text NOT NULL DEFAULT ''invoice''',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
              and column_name = 'document_series' and is_nullable = 'NO' and column_default like '''invoice''%'), '');
  perform pg_temp.rec('A3 the series CHECK allows invoice and payment_receipt only',
    exists (select 1 from pg_constraint where conname = 'invoices_document_series_valid'
              and pg_get_constraintdef(oid) like '%invoice%' and pg_get_constraintdef(oid) like '%payment_receipt%'), '');
  perform pg_temp.rec('A4 the title CHECK allows invoice, receipt and payment_receipt (one title CHECK only)',
    exists (select 1 from pg_constraint where conname = 'invoices_document_title_valid' and pg_get_constraintdef(oid) like '%payment_receipt%')
    and (select count(*) = 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%document_title%' and conname <> 'invoices_payment_receipt_shape'), '');
  perform pg_temp.rec('A5 a payment receipt must document a payment and carry no tax (invoices_payment_receipt_shape)',
    exists (select 1 from pg_constraint where conname = 'invoices_payment_receipt_shape'
              and pg_get_constraintdef(oid) like '%payment_id IS NOT NULL%' and pg_get_constraintdef(oid) like '%tax_enabled = false%'), '');

  -- B. Uniqueness per kind ----------------------------------------------------------------------------------
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_membership_id_unique';
  perform pg_temp.rec('B1 one membership-level document per membership (unique where payment_id IS NULL)',
    v_idx like '%UNIQUE%' and v_idx like '%(membership_id)%' and v_idx like '%payment_id IS NULL%', coalesce(v_idx, 'missing'));
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_invoice_number_unique';
  perform pg_temp.rec('B2 invoice-series numbers are unique (unique where document_series = invoice)',
    v_idx like '%UNIQUE%' and v_idx like '%(invoice_number)%' and v_idx like '%''invoice''%', coalesce(v_idx, 'missing'));
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_payment_receipt_number_unique';
  perform pg_temp.rec('B3 payment-receipt numbers are unique within their own series',
    v_idx like '%UNIQUE%' and v_idx like '%(invoice_number)%' and v_idx like '%''payment_receipt''%', coalesce(v_idx, 'missing'));
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_payment_id_unique';
  perform pg_temp.rec('B4 one issued document per payment (current form, narrowed by 0037 to status = issued)',
    v_idx like '%UNIQUE%' and v_idx like '%(payment_id)%' and v_idx like '%payment_id IS NOT NULL%', coalesce(v_idx, 'missing'));

  -- C. Payment receipt reservations ----------------------------------------------------------------------------
  perform pg_temp.rec('C1 payment_receipt_number_reservations exists, keyed by receipt_number',
    exists (select 1 from pg_constraint where conrelid = 'public.payment_receipt_number_reservations'::regclass and contype = 'p'
              and pg_get_constraintdef(oid) like '%receipt_number%'), '');
  perform pg_temp.rec('C2 no client can read or write it (RLS on, no grant)',
    (select relrowsecurity from pg_class where oid = 'public.payment_receipt_number_reservations'::regclass)
    and not has_table_privilege('authenticated', 'public.payment_receipt_number_reservations', 'select')
    and not has_table_privilege('authenticated', 'public.payment_receipt_number_reservations', 'insert'), '');
  perform pg_temp.rec('C3 invoices_reserve_number writes each series to its own reservations',
    pg_get_functiondef('public.invoices_reserve_number()'::regprocedure) like '%payment_receipt_number_reservations%'
    and pg_get_functiondef('public.invoices_reserve_number()'::regprocedure) like '%invoice_number_reservations%', '');
  perform pg_temp.rec('C4 every existing payment receipt number is reserved for its own document',
    not exists (select 1 from public.invoices i where i.document_series = 'payment_receipt'
                  and not exists (select 1 from public.payment_receipt_number_reservations r where r.receipt_number = i.invoice_number)), '');

  -- D. Settings ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('D1 invoice_settings has payment_receipt_starting_number, _next_number and _prefix',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_settings'
       and column_name in ('payment_receipt_starting_number', 'payment_receipt_next_number', 'payment_receipt_prefix')), '');
  perform pg_temp.rec('D2 Admin may update the starting number and prefix, never the counter',
    has_column_privilege('authenticated', 'public.invoice_settings', 'payment_receipt_starting_number', 'update')
    and has_column_privilege('authenticated', 'public.invoice_settings', 'payment_receipt_prefix', 'update')
    and not has_column_privilege('authenticated', 'public.invoice_settings', 'payment_receipt_next_number', 'update')
    and not has_column_privilege('authenticated', 'public.invoice_settings', 'next_invoice_number', 'update'), '');
  perform pg_temp.rec('D3 the settings guard locks each starting number by its own series',
    pg_get_functiondef('public.invoice_settings_guard()'::regprocedure) like '%document_series = ''invoice''%'
    and pg_get_functiondef('public.invoice_settings_guard()'::regprocedure) like '%document_series = ''payment_receipt''%', '');
  perform pg_temp.rec('D4 the prefix CHECK is in place for payment receipts',
    exists (select 1 from pg_constraint where conname = 'invoice_settings_payment_receipt_prefix_valid'), '');

  -- E. Functions ------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('E1 issue_payment_document(uuid, date): authenticated may execute, anon may not',
    has_function_privilege('authenticated', 'public.issue_payment_document(uuid, date)', 'execute')
    and not has_function_privilege('anon', 'public.issue_payment_document(uuid, date)', 'execute'), '');
  perform pg_temp.rec('E2 issue_invoice_core refuses a membership with payments and numbers only the invoice series',
    pg_get_functiondef('public.issue_invoice_core(uuid, date)'::regprocedure) like '%This membership has recorded payments%'
    and pg_get_functiondef('public.issue_invoice_core(uuid, date)'::regprocedure) like '%document_series = ''invoice''%', '');
  perform pg_temp.rec('E3 sync_invoice_from_membership follows only the membership-level document',
    pg_get_functiondef('public.sync_invoice_from_membership(uuid)'::regprocedure) like '%payment_id is null%', '');
  perform pg_temp.rec('E4 the auto-issue trigger issues nothing for a membership with payments',
    pg_get_functiondef('public.memberships_auto_issue_invoice()'::regprocedure) like '%membership_payments%', '');
  perform pg_temp.rec('E5 only a membership-level document locks a membership''s status and payment date',
    pg_get_functiondef('public.memberships_invoice_guard()'::regprocedure) like '%payment_id is null%', '');
  perform pg_temp.rec('E6 update_invoice_details checks uniqueness and the floor within the document''s own series',
    pg_get_functiondef('public.update_invoice_details(uuid, bigint, date)'::regprocedure) like '%document_series = v_invoice.document_series%', '');

  -- F. Existing data ------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('F1 every membership-level document is in the invoice series',
    not exists (select 1 from public.invoices where payment_id is null and document_series <> 'invoice'), '');
  perform pg_temp.info('DATA', format('%s membership-level document(s); %s tax invoice(s) and %s payment receipt(s) for payments',
    (select count(*) from public.invoices where payment_id is null),
    (select count(*) from public.invoices where payment_id is not null and document_series = 'invoice'),
    (select count(*) from public.invoices where document_series = 'payment_receipt')));
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
