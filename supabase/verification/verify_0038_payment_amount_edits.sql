-- ===========================================================================
-- Migration 0038 verification (structure) - Editing a payment's amount before its document is issued
-- Verifies supabase/migrations/0038_payment_amount_edits.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor after 0034-0038 are applied. Read-only catalog queries only; rolled back.
-- Behaviour: verify_0038_payment_amount_edits_behavior.sql.
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
  v_edit text;
  v_core text;
begin
  -- A. The audit table ------------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 membership_payment_edits has its eight columns',
    (select count(*) = 8 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payment_edits'
       and column_name in ('id', 'payment_id', 'edited_at', 'edited_by', 'previous_amount', 'new_amount',
                           'previous_allocations', 'new_allocations')), '');
  perform pg_temp.rec('A2 amounts must be positive and allocations must be JSON arrays',
    (select count(*) >= 4 from pg_constraint where conrelid = 'public.membership_payment_edits'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%previous_amount > %' or pg_get_constraintdef(oid) like '%new_amount > %'
            or pg_get_constraintdef(oid) like '%jsonb_typeof(previous_allocations)%'
            or pg_get_constraintdef(oid) like '%jsonb_typeof(new_allocations)%')), '');
  perform pg_temp.rec('A3 payment_id references membership_payments ON DELETE RESTRICT',
    exists (select 1 from pg_constraint where conrelid = 'public.membership_payment_edits'::regclass and contype = 'f'
              and confrelid = 'public.membership_payments'::regclass and confdeltype = 'r'), '');

  -- B. Access ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('B1 RLS is enabled on membership_payment_edits',
    (select relrowsecurity from pg_class where oid = 'public.membership_payment_edits'::regclass), '');
  perform pg_temp.rec('B2 authenticated may only SELECT it; anon has nothing',
    has_table_privilege('authenticated', 'public.membership_payment_edits', 'select')
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'insert')
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'update')
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'delete')
    and not has_table_privilege('anon', 'public.membership_payment_edits', 'select'), '');
  perform pg_temp.rec('B3 its only policy is an Admin SELECT',
    (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'membership_payment_edits')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'membership_payment_edits'
                  and cmd = 'SELECT' and qual like '%is_admin()%'), '');

  -- C. edit_payment_amount ------------------------------------------------------------------------------------------
  v_edit := pg_get_functiondef('public.edit_payment_amount(uuid, jsonb)'::regprocedure);
  perform pg_temp.rec('C1 edit_payment_amount(uuid, jsonb) is security definer with an empty search_path and an Admin check',
    exists (select 1 from pg_proc p where p.oid = 'public.edit_payment_amount(uuid, jsonb)'::regprocedure and p.prosecdef
              and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
    and v_edit like '%if not public.is_admin() then%', '');
  perform pg_temp.rec('C2 authenticated may execute it; anon may not',
    has_function_privilege('authenticated', 'public.edit_payment_amount(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.edit_payment_amount(uuid, jsonb)', 'execute'), '');
  perform pg_temp.rec('C3 it locks the membership, then the payment, then checks for documents',
    v_edit ~ 'from public\.memberships\s+where id = v_payment\.membership_id\s+for update.*from public\.membership_payments\s+where id = p_payment_id\s+for update.*A document has been issued for this payment', '');
  perform pg_temp.rec('C4 ANY document blocks the edit - issued or cancelled (no status filter)',
    v_edit like '%if exists (select 1 from public.invoices where payment_id = v_payment.id) then%', '');
  perform pg_temp.rec('C5 the new total is checked against the membership amount less the OTHER payments',
    v_edit like '%where membership_id = v_mem.id and id <> v_payment.id%' and v_edit like '%if v_total > v_mem.amount - v_other then%', '');
  perform pg_temp.rec('C6 only method AMOUNTS change (no method, reference or notes column is written)',
    v_edit like '%set amount = (a.value ->> ''amount'')::numeric%'
    and v_edit not like '%set method%' and v_edit not like '%reference_id =%' and v_edit not like '%notes =%', '');
  perform pg_temp.rec('C7 every real edit writes an audit row; the status follows under the 0034 marker, which is then cleared',
    v_edit like '%insert into public.membership_payment_edits%'
    and v_edit like '%set_config(''yoga.payment_status_sync'', v_mem.id::text, true)%'
    and v_edit like '%set_config(''yoga.payment_status_sync'', '''', true)%', '');

  -- D. The issuing function reads the payment again under the locks -----------------------------------------------------
  v_core := pg_get_functiondef('public.issue_payment_document_core(uuid, date, text, uuid)'::regprocedure);
  perform pg_temp.rec('D1 issue_payment_document_core re-reads the payment FOR UPDATE after the membership and settings locks',
    v_core ~ 'from public\.memberships\s+where id = v_payment\.membership_id\s+for update.*from public\.invoice_settings\s+where singleton\s+for update.*from public\.membership_payments\s+where id = p_payment_id\s+for update', '');
  perform pg_temp.rec('D2 ... and still allows only one ISSUED document per payment (a cancelled one does not count)',
    v_core like '%where payment_id = v_payment.id and status = ''issued''%', '');

  -- E. Existing data ---------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('E1 no payment was edited after its first document was issued',
    not exists (select 1 from public.membership_payment_edits e join public.invoices i on i.payment_id = e.payment_id
                where i.created_at < e.edited_at), '');
  perform pg_temp.rec('E2 each edited payment''s latest audit row matches its current amount',
    not exists (select 1 from public.membership_payments p
                join lateral (select e.new_amount from public.membership_payment_edits e where e.payment_id = p.id
                              order by e.edited_at desc, e.id desc limit 1) last on true
                where last.new_amount <> p.amount), '');
  perform pg_temp.rec('E3 every payment''s methods add up to its amount (still true after edits)',
    not exists (select 1 from public.membership_payments p
                where p.amount <> (select coalesce(sum(m.amount), 0) from public.membership_payment_methods m where m.payment_id = p.id)), '');
  perform pg_temp.info('DATA', format('%s edit(s) recorded for %s payment(s)',
    (select count(*) from public.membership_payment_edits), (select count(distinct payment_id) from public.membership_payment_edits)));
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
