-- ===========================================================================
-- Migration 0035 verification (structure) - Tax invoice preferences
-- Verifies supabase/migrations/0035_tax_invoice_preferences.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor after 0034-0038 are applied. Read-only catalog queries only; rolled back.
-- Behaviour: verify_0035_tax_invoice_preferences_behavior.sql.
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
  v_def text;
begin
  perform pg_temp.rec('A1 students.tax_invoice_default is boolean NOT NULL DEFAULT true',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'students'
              and column_name = 'tax_invoice_default' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'), '');
  perform pg_temp.rec('A2 membership_payments.issue_tax_invoice is boolean NOT NULL DEFAULT true',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payments'
              and column_name = 'issue_tax_invoice' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'), '');

  perform pg_temp.rec('B1 record_membership_payment has one signature: (uuid, date, jsonb, boolean)',
    to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is not null
    and to_regprocedure('public.record_membership_payment(uuid, date, jsonb)') is null, '');

  v_def := pg_get_functiondef('public.record_membership_payment(uuid, date, jsonb, boolean)'::regprocedure);
  perform pg_temp.rec('B2 the payment stores the override, else the student''s default, else true - and never writes the student',
    v_def like '%coalesce(p_issue_tax_invoice, s.tax_invoice_default, true)%'
    and v_def like '%issue_tax_invoice)%' and v_def not like '%update public.students%', '');
  perform pg_temp.rec('B3 the fourth argument is optional (default NULL)',
    v_def like '%p_issue_tax_invoice boolean DEFAULT NULL%', '');
  perform pg_temp.rec('B4 it stays security definer with an empty search_path; authenticated may execute, anon may not',
    exists (select 1 from pg_proc p where p.oid = 'public.record_membership_payment(uuid, date, jsonb, boolean)'::regprocedure and p.prosecdef
              and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
    and has_function_privilege('authenticated', 'public.record_membership_payment(uuid, date, jsonb, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.record_membership_payment(uuid, date, jsonb, boolean)', 'execute'), '');

  perform pg_temp.info('DATA', format('students: %s with tax invoice by default, %s without; payments: %s tax invoice, %s not',
    (select count(*) from public.students where tax_invoice_default), (select count(*) from public.students where not tax_invoice_default),
    (select count(*) from public.membership_payments where issue_tax_invoice), (select count(*) from public.membership_payments where not issue_tax_invoice)));
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
