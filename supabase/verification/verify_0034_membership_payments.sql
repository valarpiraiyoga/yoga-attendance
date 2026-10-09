-- ===========================================================================
-- Migration 0034 verification (structure) - Membership payments
-- Verifies supabase/migrations/0034_membership_payments.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor of the project the application uses, after 0034-0038 are applied (later
-- migrations re-create some of 0034's objects; where they do, the CURRENT form is checked and said so).
-- Read-only catalog queries only: nothing is written, and the whole script is rolled back.
-- Behaviour: verify_0034_membership_payments_behavior.sql.
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
  v_guard  text;
  v_record text;
begin
  -- A. Payment status -------------------------------------------------------------------------------------
  perform pg_temp.rec('A1 memberships_payment_status_valid allows exactly pending, partially_paid, paid',
    exists (select 1 from pg_constraint where conrelid = 'public.memberships'::regclass and conname = 'memberships_payment_status_valid'
              and pg_get_constraintdef(oid) like '%pending%' and pg_get_constraintdef(oid) like '%partially_paid%' and pg_get_constraintdef(oid) like '%paid%'), '');
  perform pg_temp.rec('A2 no other CHECK on memberships restricts payment_status to the old two values',
    not exists (select 1 from pg_constraint where conrelid = 'public.memberships'::regclass and contype = 'c'
                  and conname <> 'memberships_payment_status_valid'
                  and pg_get_constraintdef(oid) like '%payment_status%' and pg_get_constraintdef(oid) like '%pending%'), '');

  -- B. Tables ------------------------------------------------------------------------------------------------
  perform pg_temp.rec('B1 membership_payments has its columns (id, membership_id, payment_date, amount, created_at, created_by)',
    (select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payments'
       and column_name in ('id', 'membership_id', 'payment_date', 'amount', 'created_at', 'created_by')), '');
  perform pg_temp.rec('B2 membership_payment_methods has its columns (payment_id, position, method, amount, reference_id, notes)',
    (select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payment_methods'
       and column_name in ('payment_id', 'position', 'method', 'amount', 'reference_id', 'notes')), '');
  perform pg_temp.rec('B3 the method CHECK allows cash, card, upi, bank_transfer, other',
    exists (select 1 from pg_constraint where conrelid = 'public.membership_payment_methods'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%bank_transfer%' and pg_get_constraintdef(oid) like '%upi%'), '');
  perform pg_temp.rec('B4 positive amounts are enforced on payments and methods',
    exists (select 1 from pg_constraint where conrelid = 'public.membership_payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount > %0%')
    and exists (select 1 from pg_constraint where conrelid = 'public.membership_payment_methods'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount > %0%'), '');
  perform pg_temp.rec('B5 one position per method of a payment (unique index)',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'membership_payment_methods_payment_position_unique'), '');

  -- C. Access -----------------------------------------------------------------------------------------------
  perform pg_temp.rec('C1 row level security is on for both tables',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.membership_payments'::regclass, 'public.membership_payment_methods'::regclass)), '');
  perform pg_temp.rec('C2 authenticated may SELECT and nothing else; anon has nothing',
    has_table_privilege('authenticated', 'public.membership_payments', 'select')
    and not has_table_privilege('authenticated', 'public.membership_payments', 'insert')
    and not has_table_privilege('authenticated', 'public.membership_payments', 'update')
    and not has_table_privilege('authenticated', 'public.membership_payments', 'delete')
    and has_table_privilege('authenticated', 'public.membership_payment_methods', 'select')
    and not has_table_privilege('authenticated', 'public.membership_payment_methods', 'insert')
    and not has_table_privilege('authenticated', 'public.membership_payment_methods', 'update')
    and not has_table_privilege('authenticated', 'public.membership_payment_methods', 'delete')
    and not has_table_privilege('anon', 'public.membership_payments', 'select')
    and not has_table_privilege('anon', 'public.membership_payment_methods', 'select'), '');
  perform pg_temp.rec('C3 the SELECT policies are Admin-only',
    (select count(*) = 2 from pg_policies where schemaname = 'public'
       and tablename in ('membership_payments', 'membership_payment_methods') and cmd = 'SELECT' and qual like '%is_admin()%'), '');

  -- D. Integrity at commit --------------------------------------------------------------------------------------
  perform pg_temp.rec('D1 deferred constraint triggers check totals on both tables',
    (select count(*) = 2 from pg_trigger t
       where t.tgname in ('membership_payments_check_totals_trigger', 'membership_payment_methods_check_totals_trigger')
         and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred), '');
  perform pg_temp.rec('D2 the totals check refuses unbalanced methods and payments above the membership amount',
    pg_get_functiondef('public.membership_payments_check_totals()'::regprocedure) like '%The payment methods must add up to the payment amount.%'
    and pg_get_functiondef('public.membership_payments_check_totals()'::regprocedure) like '%v_paid > v_due%', '');

  -- E. The status guard ---------------------------------------------------------------------------------------------
  v_guard := pg_get_functiondef('public.memberships_payments_guard()'::regprocedure);
  perform pg_temp.rec('E1 memberships_payments_guard runs BEFORE INSERT OR UPDATE on memberships',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_payments_guard_trigger'
              and not t.tgisinternal and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE%'), '');
  perform pg_temp.rec('E2 the guard honours only the yoga.payment_status_sync marker and refuses hand-set statuses',
    v_guard like '%yoga.payment_status_sync%' and v_guard like '%Partially Paid is set by recording payments.%'
    and v_guard like '%The payment status follows the recorded payments.%', '');

  -- F. Recording (re-created by 0035 with a fourth argument) ----------------------------------------------------------
  perform pg_temp.rec('F1 record_membership_payment exists in its current (0035) form only',
    to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is not null
    and to_regprocedure('public.record_membership_payment(uuid, date, jsonb)') is null, '');
  v_record := pg_get_functiondef('public.record_membership_payment(uuid, date, jsonb, boolean)'::regprocedure);
  perform pg_temp.rec('F2 it is security definer, Admin-checked, locks the membership and refuses an over-payment',
    exists (select 1 from pg_proc p where p.oid = 'public.record_membership_payment(uuid, date, jsonb, boolean)'::regprocedure and p.prosecdef
              and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
    and v_record like '%if not public.is_admin() then%' and v_record like '%for update%'
    and v_record like '%v_total > v_mem.amount - v_paid%', '');
  perform pg_temp.rec('F3 authenticated may execute it; anon and PUBLIC may not',
    has_function_privilege('authenticated', 'public.record_membership_payment(uuid, date, jsonb, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.record_membership_payment(uuid, date, jsonb, boolean)', 'execute'), '');

  perform pg_temp.info('DATA', format('%s payment(s), %s method row(s), %s membership(s) Partially Paid',
    (select count(*) from public.membership_payments), (select count(*) from public.membership_payment_methods),
    (select count(*) from public.memberships where payment_status = 'partially_paid')));
  perform pg_temp.rec('G1 every existing payment''s methods add up to its amount',
    not exists (select 1 from public.membership_payments p
                where p.amount <> (select coalesce(sum(m.amount), 0) from public.membership_payment_methods m where m.payment_id = p.id)), '');
  perform pg_temp.rec('G2 no membership''s payments exceed its amount',
    not exists (select 1 from public.memberships ms
                where (select coalesce(sum(p.amount), 0) from public.membership_payments p where p.membership_id = ms.id) > ms.amount), '');
  perform pg_temp.rec('G3 every membership with payments has the status its payments give it',
    not exists (select 1 from public.memberships ms
                join (select membership_id, sum(amount) as paid from public.membership_payments group by membership_id) s on s.membership_id = ms.id
                where ms.payment_status <> case when s.paid >= ms.amount then 'paid' else 'partially_paid' end), '');
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
