-- ===========================================================================
-- Migration 0035 verification (behaviour) - Tax invoice preferences
-- Exercises supabase/migrations/0035_tax_invoice_preferences.sql
-- ===========================================================================
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only: two students (one with the default on, one with it off), one membership
--     each, and payments recorded against them. No real student, membership or payment is touched.
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
--   * Run after migrations 0034-0038 are applied.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row.
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
-- Run one statement as an authenticated user; return 'OK' or the SQLSTATE.
create function pg_temp.run_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims',
          json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

-- Run one scalar query as an authenticated user; return its text, or 'ERR:<sqlstate>'.
create function pg_temp.query_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
          json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- A returned id as uuid, or NULL when the call returned 'ERR:<sqlstate>' (so a failure is reported, never raised).
create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- Run one statement as the anonymous role; return 'OK' or the SQLSTATE.
create function pg_temp.run_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- A disposable student (ZZVERIFY) with one Pending membership of p_amount; returns the membership id.
create function pg_temp.fixture(p_label text, p_phone text, p_amount numeric, p_tax_default boolean default true)
returns uuid language plpgsql as $f$
declare
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_student uuid;
  v_mem     uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status, tax_invoice_default)
  values ('ZZVERIFY ' || p_label, p_phone, '+91', v_today - 400, 'active', p_tax_default)
  returning id into v_student;

  insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
  values (v_student, 'monthly', v_today - 20, v_today + 9, p_amount, 'pending', 'INR')
  returning id into v_mem;

  return v_mem;
end $f$;

-- Records a payment as p_admin; returns the payment id, or 'ERR:<sqlstate>'.
create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_methods text, p_tax text default 'null')
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %s::boolean)::text',
    p_membership, p_date, p_methods, p_tax));
end $f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_on  uuid;  -- membership of a student whose default is ON
  v_off uuid;  -- membership of a student whose default is OFF
  v_out        text;
  v_pref0      text;
  v_pref1      text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  select md5(coalesce(string_agg(s.id::text || ':' || s.tax_invoice_default::text, '|' order by s.id), '')) into v_pref0
  from public.students s;

  begin
    v_on := pg_temp.fixture('0035 ON', '9000350001', 1000, true);
    v_off := pg_temp.fixture('0035 OFF', '9000350002', 1000, false);
  exception when others then
    v_on := null;
    v_err := sqlstate || ' ' || sqlerrm;
  end;

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_on is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  else
    v_out := pg_temp.pay(v_admin, v_on, v_today, '[{"method":"cash","amount":"100"}]', 'null');
    perform pg_temp.rec('T1 no override, student default ON: the payment is a tax invoice payment',
      v_out not like 'ERR:%' and (select issue_tax_invoice from public.membership_payments where id = pg_temp.as_uuid(v_out)), coalesce(v_out, 'NULL'));

    v_out := pg_temp.pay(v_admin, v_off, v_today, '[{"method":"cash","amount":"100"}]', 'null');
    perform pg_temp.rec('T2 no override, student default OFF: the payment is not',
      v_out not like 'ERR:%' and not (select issue_tax_invoice from public.membership_payments where id = pg_temp.as_uuid(v_out)), coalesce(v_out, 'NULL'));

    v_out := pg_temp.pay(v_admin, v_off, v_today, '[{"method":"cash","amount":"100"}]', 'true');
    perform pg_temp.rec('T3 override TRUE beats a default of OFF',
      v_out not like 'ERR:%' and (select issue_tax_invoice from public.membership_payments where id = pg_temp.as_uuid(v_out)), coalesce(v_out, 'NULL'));

    v_out := pg_temp.pay(v_admin, v_on, v_today, '[{"method":"cash","amount":"100"}]', 'false');
    perform pg_temp.rec('T4 override FALSE beats a default of ON',
      v_out not like 'ERR:%' and not (select issue_tax_invoice from public.membership_payments where id = pg_temp.as_uuid(v_out)), coalesce(v_out, 'NULL'));

    perform pg_temp.rec('T5 the overrides changed neither student''s saved preference',
      (select s.tax_invoice_default from public.memberships m join public.students s on s.id = m.student_id where m.id = v_on)
      and not (select s.tax_invoice_default from public.memberships m join public.students s on s.id = m.student_id where m.id = v_off), '');

    if v_instructor is null then
      perform pg_temp.skip('T6 instructor', 'no instructor profile found');
    else
      v_out := pg_temp.pay(v_instructor, v_on, v_today, '[{"method":"cash","amount":"10"}]', 'true');
      perform pg_temp.rec('T6 an Instructor cannot record a payment with a preference either (42501)', v_out = 'ERR:42501', v_out);
    end if;
  end if;

  select md5(coalesce(string_agg(s.id::text || ':' || s.tax_invoice_default::text, '|' order by s.id), '')) into v_pref1
  from public.students s where s.full_name not like 'ZZVERIFY%';
  perform pg_temp.rec('Z1 no pre-existing student''s preference changed', v_pref0 = v_pref1, '');
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

-- AFTER THE ROLLBACK (run separately): select count(*) from public.students where full_name like 'ZZVERIFY%';  -- must be 0
