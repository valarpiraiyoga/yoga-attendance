-- ===========================================================================
-- Migration 0037 verification (structure) - Invoice corrections (cancel and reissue)
-- Verifies supabase/migrations/0037_invoice_corrections.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor after 0034-0038 are applied. Read-only catalog queries only; rolled back.
-- 0038 re-creates issue_payment_document_core (adding a re-read of the payment); its CURRENT form is checked here.
-- Behaviour: verify_0037_invoice_corrections_behavior.sql.
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
  v_idx     text;
  v_correct text;
  v_freeze  text;
begin
  -- A. Columns and rules -------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 invoices has status (default issued), cancelled_at, cancelled_by, cancellation_reason, replaces_id',
    (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
       and column_name in ('status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'replaces_id'))
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
                  and column_name = 'status' and is_nullable = 'NO' and column_default like '''issued''%'), '');
  perform pg_temp.rec('A2 status is issued or cancelled; a cancelled document always has its time and a reason',
    exists (select 1 from pg_constraint where conname = 'invoices_status_valid')
    and exists (select 1 from pg_constraint where conname = 'invoices_cancellation_consistent'), '');
  perform pg_temp.rec('A3 only a payment document can be cancelled or be a replacement',
    exists (select 1 from pg_constraint where conname = 'invoices_correction_payment_only'), '');
  perform pg_temp.rec('A4 replaces_id references invoices',
    exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f'
              and confrelid = 'public.invoices'::regclass), '');

  -- B. Indexes ---------------------------------------------------------------------------------------------------
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_payment_id_unique';
  perform pg_temp.rec('B1 one ISSUED document per payment (unique where status = issued)',
    v_idx like '%UNIQUE%' and v_idx like '%(payment_id)%' and v_idx like '%''issued''%', coalesce(v_idx, 'missing'));
  select indexdef into v_idx from pg_indexes where schemaname = 'public' and indexname = 'invoices_replaces_id_unique';
  perform pg_temp.rec('B2 a document is replaced at most once (unique replaces_id)',
    v_idx like '%UNIQUE%' and v_idx like '%(replaces_id)%', coalesce(v_idx, 'missing'));

  -- C. Functions --------------------------------------------------------------------------------------------------
  perform pg_temp.rec('C1 issue_payment_document_core(uuid, date, text, uuid) exists and no client may execute it',
    to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is not null
    and not has_function_privilege('authenticated', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'execute'), '');
  perform pg_temp.rec('C2 issue_payment_document is the Admin-checked wrapper of the core (no replacement, the payment''s own series)',
    pg_get_functiondef('public.issue_payment_document(uuid, date)'::regprocedure) like '%issue_payment_document_core(p_payment_id, p_document_date, null, null)%', '');

  v_correct := pg_get_functiondef('public.correct_payment_document(uuid, text)'::regprocedure);
  perform pg_temp.rec('C3 correct_payment_document is security definer, Admin-checked, needs a reason, and only for payment documents',
    exists (select 1 from pg_proc p where p.oid = 'public.correct_payment_document(uuid, text)'::regprocedure and p.prosecdef
              and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
    and v_correct like '%if not public.is_admin() then%' and v_correct like '%Enter the reason for the correction.%'
    and v_correct like '%Only a payment document can be corrected.%', '');
  perform pg_temp.rec('C4 it locks membership, settings, then the document, and refuses a document that is not issued',
    position('from public.memberships where id = v_doc.membership_id for update' in v_correct) > 0
    and position('from public.memberships where id = v_doc.membership_id for update' in v_correct)
        < position('from public.invoice_settings where singleton for update' in v_correct)
    and v_correct like '%This document has already been cancelled.%', '');
  perform pg_temp.rec('C5 it reissues in the SAME series, dated as the original, linked to it, and swallows no error',
    v_correct like '%issue_payment_document_core(v_doc.payment_id, v_doc.invoice_date, v_doc.document_series, v_doc.id)%'
    and v_correct not ilike '%exception when%', '');
  perform pg_temp.rec('C6 authenticated may execute the correction; anon may not',
    has_function_privilege('authenticated', 'public.correct_payment_document(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.correct_payment_document(uuid, text)', 'execute'), '');

  -- D. The freeze trigger -------------------------------------------------------------------------------------------
  v_freeze := pg_get_functiondef('public.invoices_freeze_snapshot()'::regprocedure);
  perform pg_temp.rec('D1 a cancelled document never changes; cancelling is allowed only inside the correction (yoga.invoice_cancel)',
    v_freeze like '%A cancelled document cannot be changed.%' and v_freeze like '%yoga.invoice_cancel%'
    and v_freeze like '%''status'', ''cancelled_at'', ''cancelled_by'', ''cancellation_reason''%', '');

  -- E. Existing data ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('E1 no membership-level document is cancelled or a replacement',
    not exists (select 1 from public.invoices where payment_id is null and (status <> 'issued' or replaces_id is not null)), '');
  perform pg_temp.rec('E2 no payment has two issued documents',
    not exists (select payment_id from public.invoices where payment_id is not null and status = 'issued' group by payment_id having count(*) > 1), '');
  perform pg_temp.rec('E3 every cancelled document has exactly one replacement in the same series and for the same payment',
    not exists (select 1 from public.invoices c where c.status = 'cancelled'
                  and (select count(*) from public.invoices r where r.replaces_id = c.id
                         and r.document_series = c.document_series and r.payment_id = c.payment_id) <> 1), '');
  perform pg_temp.info('DATA', format('%s cancelled document(s); %s replacement(s)',
    (select count(*) from public.invoices where status = 'cancelled'), (select count(*) from public.invoices where replaces_id is not null)));
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
