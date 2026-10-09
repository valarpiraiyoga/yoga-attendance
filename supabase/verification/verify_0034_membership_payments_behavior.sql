-- ===========================================================================
-- Migration 0034 verification (behaviour) - Membership payments
-- Exercises supabase/migrations/0034_membership_payments.sql (with 0035's current recording function)
-- ===========================================================================
--
-- SAFETY - ROLLBACK ONLY
--   * Everything runs inside ONE transaction that ends in ROLLBACK. Run the whole file in one go; if the editor
--     reports an open transaction, run `rollback;` first.
--   * Self-contained: it creates its own disposable fixtures (students named ZZVERIFY, one membership each) and
--     records payments only against them. No real student, membership or payment is touched; the existing
--     payments are fingerprinted first and checked at the end.
--   * ONE SIDE EFFECT ROLLBACK CANNOT UNDO: student and membership codes come from sequences, so each run leaves
--     a small gap in the YC- / MEM- numbering. No row remains.
--   * Admin and Instructor calls run as an authenticated user (request.jwt.claims + role authenticated), as
--     PostgREST does. No service-role key is used.
--   * The deferred totals check is exercised with SET CONSTRAINTS ... IMMEDIATE inside a sub-block, so the
--     unbalanced rows it tries to write are rejected on the spot and rolled back with that block.
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

-- Try to write a payment and its one method directly (owner), in ONE statement, with the totals check made
-- immediate for this attempt. Returns 'OK', or the SQLSTATE and message of the refusal.
create function pg_temp.try_direct(p_membership uuid, p_payment_amount numeric, p_method_amount numeric)
returns text language plpgsql as $f$
declare
  v_result text := 'OK';
begin
  begin
    set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger immediate;
    with p as (
      insert into public.membership_payments (membership_id, payment_date, amount)
      values (p_membership, (now() at time zone public.centre_timezone())::date, p_payment_amount)
      returning id
    )
    insert into public.membership_payment_methods (payment_id, position, method, amount)
    select p.id, 1, 'cash', p_method_amount from p;
  exception when others then
    v_result := sqlstate || ' ' || sqlerrm;
  end;
  set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger deferred;
  return v_result;
end $f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m1 uuid; v_m2 uuid; v_m3 uuid;
  v_out        text;
  v_code       text;
  v_hash0      text;
  v_hash1      text;
  v_mem        public.memberships%rowtype;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_hash0 from public.membership_payments p;

  begin
    v_m1 := pg_temp.fixture('0034 A', '9000340001', 1000);
    v_m2 := pg_temp.fixture('0034 B', '9000340002', 500);
    v_m3 := pg_temp.fixture('0034 C', '9000340003', 800);
  exception when others then
    v_m1 := null;
    v_err := sqlstate || ' ' || sqlerrm;
  end;

  perform pg_temp.info('SETUP', format('admin=%s instructor=%s fixtures=%s', coalesce(v_admin::text, 'none'),
    coalesce(v_instructor::text, 'none'), case when v_m1 is null then 'NO' else 'yes' end));

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_m1 is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  else
    -- R. Recording ---------------------------------------------------------------------------------------------
    v_out := pg_temp.pay(v_admin, v_m1, v_today - 3, '[{"method":"cash","amount":"400"}]');
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('R1 a single cash payment below the amount: recorded, membership Partially Paid, no payment date',
      v_out not like 'ERR:%' and v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null
      and (select sum(amount) from public.membership_payments where membership_id = v_m1) = 400, coalesce(v_out, 'NULL'));

    v_out := pg_temp.pay(v_admin, v_m1, v_today - 1, '[{"method":"cash","amount":"300"},{"method":"upi","amount":"300","reference_id":"ZZ-UPI-1","notes":"verify"}]');
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('R2 a mixed cash + UPI payment completing it: Paid, payment date = that payment''s date',
      v_out not like 'ERR:%' and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 1, coalesce(v_out, 'NULL'));
    perform pg_temp.rec('R3 the mixed payment has two method rows, in order, with the UPI reference and notes, adding up to 600',
      v_out not like 'ERR:%'
      and (select count(*) = 2 and sum(amount) = 600 from public.membership_payment_methods where payment_id = pg_temp.as_uuid(v_out))
      and exists (select 1 from public.membership_payment_methods where payment_id = pg_temp.as_uuid(v_out) and position = 2
                    and method = 'upi' and reference_id = 'ZZ-UPI-1' and notes = 'verify')
      and (select amount from public.membership_payments where id = pg_temp.as_uuid(v_out)) = 600, '');
    perform pg_temp.rec('R4 becoming Paid through payments issued no membership-level document',
      not exists (select 1 from public.invoices where membership_id = v_m1), '');

    -- O. Refusals ------------------------------------------------------------------------------------------------
    v_out := pg_temp.pay(v_admin, v_m1, v_today, '[{"method":"cash","amount":"1"}]');
    perform pg_temp.rec('O1 a Paid membership takes no more payments (55000)', v_out = 'ERR:55000', v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today, '[{"method":"cash","amount":"400"},{"method":"card","amount":"100.01"}]');
    perform pg_temp.rec('O2 a payment above the outstanding balance is refused (22023), nothing written',
      v_out = 'ERR:22023' and not exists (select 1 from public.membership_payments where membership_id = v_m2), v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today + 1, '[{"method":"cash","amount":"10"}]');
    perform pg_temp.rec('O3 a future payment date is refused (22023)', v_out = 'ERR:22023', v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today, '[{"method":"cheque","amount":"10"}]');
    perform pg_temp.rec('O4 an unknown method is refused (22023)', v_out = 'ERR:22023', v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today, '[{"method":"cash","amount":"0"}]');
    perform pg_temp.rec('O5 a zero amount is refused (22023)', v_out = 'ERR:22023', v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today, '[{"method":"cash","amount":"10.005"}]');
    perform pg_temp.rec('O6 more than two decimals is refused (22023)', v_out = 'ERR:22023', v_out);
    v_out := pg_temp.pay(v_admin, v_m2, v_today, '[]');
    perform pg_temp.rec('O7 a payment with no method is refused (22023)', v_out = 'ERR:22023', v_out);

    -- I. Invariants at commit (made immediate here) --------------------------------------------------------------
    v_code := pg_temp.try_direct(v_m3, 100, 50);
    perform pg_temp.rec('I1 a payment whose methods do not add up is rejected by the totals check (23514)',
      v_code like '23514 The payment methods must add up to the payment amount.%'
      and not exists (select 1 from public.membership_payments where membership_id = v_m3), v_code);
    v_code := pg_temp.try_direct(v_m3, 900, 900);
    perform pg_temp.rec('I2 a balanced payment above the membership amount is rejected by the totals check (23514)',
      v_code like '23514 The payment cannot be more than the outstanding balance.%'
      and not exists (select 1 from public.membership_payments where membership_id = v_m3), v_code);

    -- G. The status guard -------------------------------------------------------------------------------------------
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''pending'' where id = %L', v_m1));
    perform pg_temp.rec('G1 the status of a membership with payments cannot be set by hand (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''partially_paid'' where id = %L', v_m3));
    perform pg_temp.rec('G2 Partially Paid cannot be set by hand, even without payments (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 1200 where id = %L', v_m1));
    perform pg_temp.rec('G3 an amount edit that would change a payments-based status is refused (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set notes = ''ZZVERIFY note'' where id = %L', v_m1));
    perform pg_temp.rec('G4 an ordinary edit of the same membership still works', v_code = 'OK', v_code);

    -- P. Permissions -------------------------------------------------------------------------------------------------
    v_code := pg_temp.run_as(v_admin, format('insert into public.membership_payments (membership_id, payment_date, amount) values (%L, %L, 1)', v_m3, v_today));
    perform pg_temp.rec('P1 even an Admin cannot write payments directly (42501)', v_code = '42501', v_code);
    v_code := pg_temp.run_as(v_admin, format('delete from public.membership_payments where membership_id = %L', v_m1));
    perform pg_temp.rec('P2 nor delete them (42501)', v_code = '42501', v_code);
    v_out := pg_temp.query_as(v_admin, format('select count(*)::text from public.membership_payments where membership_id = %L', v_m1));
    perform pg_temp.rec('P3 an Admin reads the payments', v_out = '2', v_out);
    if v_instructor is null then
      perform pg_temp.skip('P4-P5 instructor', 'no instructor profile found');
    else
      v_out := pg_temp.query_as(v_instructor, format('select count(*)::text from public.membership_payments where membership_id = %L', v_m1));
      perform pg_temp.rec('P4 an Instructor reads no payments (row level security)', v_out = '0', v_out);
      v_out := pg_temp.pay(v_instructor, v_m3, v_today, '[{"method":"cash","amount":"10"}]');
      perform pg_temp.rec('P5 an Instructor cannot record a payment (42501)', v_out = 'ERR:42501', v_out);
    end if;
    v_code := pg_temp.run_anon('select count(*) from public.membership_payments');
    perform pg_temp.rec('P6 an anonymous caller cannot read payments (42501)', v_code = '42501', v_code);
  end if;

  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_hash1
  from public.membership_payments p
  where p.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  perform pg_temp.rec('Z1 every pre-existing payment is byte-for-byte unchanged', v_hash0 = v_hash1, '');
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

-- AFTER THE ROLLBACK (run separately): no fixture may remain.
--   select count(*) from public.students where full_name like 'ZZVERIFY%';  -- must be 0
