-- ===========================================================================
-- Migration 0065 verification (behaviour) - Payment idempotency: one request ID per payment submission
-- Exercises supabase/migrations/0065_payment_request_ids.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0065 is applied: record_membership_payment has exactly the five-argument signature (the four- and
--       three-argument ones are gone), p_request_id is optional (DEFAULT NULL), the function is SECURITY DEFINER with an
--       empty search_path, authenticated may execute it and anon may not; membership_payments.request_id is a nullable
--       uuid with a unique partial index. If 0065 is not applied, every other check is skipped (NOT TESTED).
--   PF  Preflight: no 'ZZVERIFY 0065' fixture exists before the script starts.
--   R   A request ID: the first submission records one payment and stores the ID; the same request again returns the SAME
--       payment id and records nothing (count, total and status unchanged); a payload that differs only in how it is
--       written (an amount of 300 vs "300.00", a reference with surrounding spaces) is the same request; repeating the
--       stored tax invoice choice explicitly is the same request.
--   M   Mismatched reuse is refused with 23505 and records nothing: a different date, amount, method, reference, an
--       explicitly different tax invoice choice, a different number of methods, the same methods in another order, and a
--       malformed payload (refused as a mismatch, not as a cast error).
--   X   The same request ID for ANOTHER membership is refused with 23505; that membership gets no payment.
--   F   A request that made the membership Paid is still answered with its payment (not "already paid", 55000), and a NEW
--       request on that Paid membership is still refused with 55000.
--   D   Distinct request IDs record distinct payments, even with identical details.
--   C   Compatibility: calls with three or four positional arguments, and with p_request_id explicitly NULL, record as
--       before and store request_id NULL; two identical calls without a request ID record two payments (the documented
--       behaviour without retry protection).
--   V   Every existing refusal is unchanged for a NEW request ID (overpayment, invalid method, future date, zero amount,
--       three decimals, no methods, no date, unknown membership) and records nothing - and a refused request does not
--       spend its ID: a valid call with the same ID afterwards records normally.
--   A   An Instructor (when one exists) is refused with 42501, both for a new request and for a replay of an existing one;
--       an anonymous caller cannot execute the function at all.
--   G   No client role can write membership_payments directly: an Admin session and anon cannot insert, and an Admin
--       session cannot set request_id with an update. Even the owner cannot insert a second payment with a used request
--       ID (the unique index).
--   Z   Every payment, payment method and membership that existed before this script is unchanged.
--
-- PREREQUISITES
--   * Migrations up to and including 0065 applied (0034, 0035 and 0065 in particular).
--   * An Admin profile. An Instructor profile is needed for the Instructor check (skipped without one).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable fixtures only: students named 'ZZVERIFY 0065 ...', one membership each, and the payments recorded
--     against them. No existing row is written; existing rows are only read, to be fingerprinted (Z1).
--   * Run it against a disposable or development database, not production. The student and membership code sequences
--     keep a small gap after the rollback; no row remains.
--
-- LIMITATIONS
--   * Concurrency (two simultaneous calls with the same request ID) cannot happen inside one transaction and is NOT
--     tested here. What is checked instead: the function locks the membership row before it looks the request ID up, and
--     the unique index refuses a duplicate even for the owner (G4). The two-session test is described at the end.
--   * The application (sending the request ID, keeping it across a retry) is not covered; that is a later step.
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

-- A returned id as uuid, or NULL when the call returned 'ERR:<sqlstate>'.
create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- A disposable student ('ZZVERIFY 0065 ...') with one Pending monthly membership of p_amount; returns the membership id.
-- One student per membership, so the per-student overlap rule never interferes.
create function pg_temp.fixture(p_label text, p_phone text, p_amount numeric)
returns uuid language plpgsql as $f$
declare
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_student uuid;
  v_mem     uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0065 ' || p_label, p_phone, '+91', v_today - 400, 'active')
  returning id into v_student;

  insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
  values (v_student, 'monthly', v_today - 20, v_today + 10, p_amount, 'pending', 'INR')
  returning id into v_mem;

  return v_mem;
end $f$;

-- Records a payment as p_user with all five arguments; returns the payment id, or 'ERR:<sqlstate>'.
-- p_tax and p_request may be NULL (sent as NULL, as a client that omits nothing would).
create function pg_temp.pay(p_user uuid, p_membership uuid, p_date date, p_methods text, p_tax boolean, p_request uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %L::boolean, %L::uuid)::text',
    p_membership, p_date, p_methods, p_tax, p_request));
end $f$;

-- How many payments a membership has, and their total.
create function pg_temp.n(p_membership uuid)
returns int language sql as $f$
  select count(*)::int from public.membership_payments where membership_id = p_membership
$f$;

create function pg_temp.total(p_membership uuid)
returns numeric language sql as $f$
  select coalesce(sum(amount), 0) from public.membership_payments where membership_id = p_membership
$f$;

create function pg_temp.status(p_membership uuid)
returns text language sql as $f$
  select payment_status from public.memberships where id = p_membership
$f$;

-- A fingerprint of every payment, payment method and membership NOT belonging to a 'ZZVERIFY 0065' fixture.
create function pg_temp.fingerprint()
returns text language sql as $f$
  select md5(
    coalesce((select string_agg(p.id::text || ':' || p.membership_id || ':' || p.payment_date || ':' || p.amount || ':'
                                || p.issue_tax_invoice || ':' || coalesce(p.request_id::text, '-'), '|' order by p.id)
              from public.membership_payments p
              join public.memberships m on m.id = p.membership_id
              join public.students s on s.id = m.student_id
              where s.full_name not like 'ZZVERIFY 0065%'), '')
    || '#' ||
    coalesce((select string_agg(pm.id::text || ':' || pm.payment_id || ':' || pm.position || ':' || pm.method || ':' || pm.amount
                                || ':' || coalesce(pm.reference_id, '-') || ':' || coalesce(pm.notes, '-'), '|' order by pm.id)
              from public.membership_payment_methods pm
              join public.membership_payments p on p.id = pm.payment_id
              join public.memberships m on m.id = p.membership_id
              join public.students s on s.id = m.student_id
              where s.full_name not like 'ZZVERIFY 0065%'), '')
    || '#' ||
    coalesce((select string_agg(m.id::text || ':' || m.payment_status || ':' || coalesce(m.payment_date::text, '-') || ':' || m.amount,
                                '|' order by m.id)
              from public.memberships m
              join public.students s on s.id = m.student_id
              where s.full_name not like 'ZZVERIFY 0065%'), '')
  )
$f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_applied    boolean;
  v_err        text;
  v_fp0        text;
  v_fp1        text;
  v_def        text;
  v_out        text;
  v_out2       text;
  -- memberships
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid;
  -- request IDs
  rq_a uuid := gen_random_uuid();
  rq_b uuid := gen_random_uuid();
  rq_c uuid := gen_random_uuid();
  rq_f uuid := gen_random_uuid();
  rq_g uuid := gen_random_uuid();
  rq_v uuid := gen_random_uuid();
  -- payment ids
  p_a uuid; p_b uuid; p_c uuid; p_f uuid;
  v_n  int;
  v_code text;
  v_methods_a  text := '[{"method":"upi","amount":"300","reference_id":"UPI-1"}]';
  v_methods_b  text := '[{"method":"cash","amount":"100"},{"method":"upi","amount":"50","reference_id":"R-2"}]';
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- P0 ---------------------------------------------------------------------------------------------------------------
  v_applied := to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean, uuid)') is not null
    and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'membership_payments' and column_name = 'request_id');

  perform pg_temp.rec('P0 migration 0065 is applied (five-argument function and the request_id column exist)', v_applied,
    case when v_applied then '' else 'apply supabase/migrations/0065_payment_request_ids.sql first; every other check is skipped' end);

  if not v_applied then
    perform pg_temp.skip('every scenario', '0065 is not applied');
  else
    perform pg_temp.rec('P1 exactly one signature: the four- and three-argument versions are gone',
      to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is null
      and to_regprocedure('public.record_membership_payment(uuid, date, jsonb)') is null
      and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_membership_payment') = 1, '');

    v_def := pg_get_functiondef('public.record_membership_payment(uuid, date, jsonb, boolean, uuid)'::regprocedure);
    perform pg_temp.rec('P2 p_request_id and p_issue_tax_invoice are optional (DEFAULT NULL); it still returns uuid',
      v_def like '%p_request_id uuid DEFAULT NULL%' and v_def like '%p_issue_tax_invoice boolean DEFAULT NULL%'
      and v_def like '%RETURNS uuid%', '');

    perform pg_temp.rec('P3 security definer with an empty search_path; authenticated may execute, anon may not',
      exists (select 1 from pg_proc p
              where p.oid = 'public.record_membership_payment(uuid, date, jsonb, boolean, uuid)'::regprocedure and p.prosecdef
                and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
      and has_function_privilege('authenticated', 'public.record_membership_payment(uuid, date, jsonb, boolean, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.record_membership_payment(uuid, date, jsonb, boolean, uuid)', 'execute'), '');

    perform pg_temp.rec('P4 membership_payments.request_id is a nullable uuid',
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'membership_payments' and column_name = 'request_id'
                and data_type = 'uuid' and is_nullable = 'YES'), '');

    perform pg_temp.rec('P5 a unique partial index covers non-null request IDs only',
      exists (select 1 from pg_indexes
              where schemaname = 'public' and tablename = 'membership_payments' and indexname = 'membership_payments_request_id_key'
                and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%(request_id)%' and indexdef like '%WHERE (request_id IS NOT NULL)%'), '');

    -- PF and fixtures --------------------------------------------------------------------------------------------------
    perform pg_temp.rec('PF no ZZVERIFY 0065 fixture exists before the script',
      not exists (select 1 from public.students where full_name like 'ZZVERIFY 0065%'), '');

    v_fp0 := pg_temp.fingerprint();

    begin
      m1 := pg_temp.fixture('M1 replay', '9006500001', 1000);
      m2 := pg_temp.fixture('M2 other membership', '9006500002', 1000);
      m3 := pg_temp.fixture('M3 full payment', '9006500003', 500);
      m4 := pg_temp.fixture('M4 compatibility', '9006500004', 1000);
      m5 := pg_temp.fixture('M5 validations', '9006500005', 1000);
    exception when others then
      m1 := null;
      v_err := sqlstate || ' ' || sqlerrm;
    end;

    if v_admin is null then
      perform pg_temp.skip('every scenario', 'no admin profile found');
    elsif m1 is null then
      perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
    else

      -- R: a request ID -----------------------------------------------------------------------------------------------
      v_out := pg_temp.pay(v_admin, m1, v_today, v_methods_a, null, rq_a);
      p_a := pg_temp.as_uuid(v_out);
      perform pg_temp.rec('R1 the first submission records one payment and stores its request ID',
        p_a is not null and pg_temp.n(m1) = 1
        and (select request_id from public.membership_payments where id = p_a) = rq_a
        and pg_temp.total(m1) = 300 and pg_temp.status(m1) = 'partially_paid', coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m1, v_today, v_methods_a, null, rq_a);
      perform pg_temp.rec('R2 the same request again returns the SAME payment id and records nothing',
        pg_temp.as_uuid(v_out) = p_a and pg_temp.n(m1) = 1 and pg_temp.total(m1) = 300 and pg_temp.status(m1) = 'partially_paid',
        coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m1, v_today, '[{"method":"upi","amount":"300.00","reference_id":"  UPI-1  "}]', null, rq_a);
      perform pg_temp.rec('R3 written differently but the same request (300 vs "300.00", a padded reference): the same payment',
        pg_temp.as_uuid(v_out) = p_a and pg_temp.n(m1) = 1, coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m1, v_today, v_methods_a,
                           (select issue_tax_invoice from public.membership_payments where id = p_a), rq_a);
      perform pg_temp.rec('R4 repeating the stored tax invoice choice explicitly is the same request',
        pg_temp.as_uuid(v_out) = p_a and pg_temp.n(m1) = 1, coalesce(v_out, 'NULL'));

      -- M: mismatched reuse -------------------------------------------------------------------------------------------
      v_out := pg_temp.pay(v_admin, m1, v_today - 1, v_methods_a, null, rq_a);
      perform pg_temp.rec('M1 same ID, different date: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today, '[{"method":"upi","amount":"299","reference_id":"UPI-1"}]', null, rq_a);
      perform pg_temp.rec('M2 same ID, different amount: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today, '[{"method":"card","amount":"300","reference_id":"UPI-1"}]', null, rq_a);
      perform pg_temp.rec('M3 same ID, different method: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today, '[{"method":"upi","amount":"300","reference_id":"UPI-2"}]', null, rq_a);
      perform pg_temp.rec('M4 same ID, different reference: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today, v_methods_a,
                           not (select issue_tax_invoice from public.membership_payments where id = p_a), rq_a);
      perform pg_temp.rec('M5 same ID, an explicitly different tax invoice choice: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today,
                           '[{"method":"upi","amount":"200","reference_id":"UPI-1"},{"method":"cash","amount":"100"}]', null, rq_a);
      perform pg_temp.rec('M6 same ID, the same total split over two methods: refused 23505', v_out = 'ERR:23505', v_out);

      v_out := pg_temp.pay(v_admin, m1, v_today, '[{"method":"upi","amount":"abc","reference_id":"UPI-1"}]', null, rq_a);
      v_out2 := pg_temp.pay(v_admin, m1, v_today, '"not an array"', null, rq_a);
      perform pg_temp.rec('M7 same ID, a malformed payload: refused as a mismatch (23505), not as a cast error',
        v_out = 'ERR:23505' and v_out2 = 'ERR:23505', v_out || ' / ' || v_out2);

      perform pg_temp.rec('M8 none of the refused reuses recorded anything',
        pg_temp.n(m1) = 1 and pg_temp.total(m1) = 300 and pg_temp.status(m1) = 'partially_paid', pg_temp.n(m1)::text);

      -- Order is part of the request: two methods, then the same two swapped.
      v_out := pg_temp.pay(v_admin, m2, v_today, v_methods_b, null, rq_b);
      p_b := pg_temp.as_uuid(v_out);
      v_out := pg_temp.pay(v_admin, m2, v_today,
                           '[{"method":"upi","amount":"50","reference_id":"R-2"},{"method":"cash","amount":"100"}]', null, rq_b);
      v_out2 := pg_temp.pay(v_admin, m2, v_today, v_methods_b, null, rq_b);
      perform pg_temp.rec('M9 the same methods in another order are a different request (23505); in the same order, the same payment',
        p_b is not null and v_out = 'ERR:23505' and pg_temp.as_uuid(v_out2) = p_b and pg_temp.n(m2) = 1, v_out || ' / ' || v_out2);

      -- X: another membership -----------------------------------------------------------------------------------------
      v_n := pg_temp.n(m3);
      v_out := pg_temp.pay(v_admin, m3, v_today, v_methods_a, null, rq_a);
      perform pg_temp.rec('X1 the same request ID for ANOTHER membership is refused (23505) and that membership gets no payment',
        v_out = 'ERR:23505' and pg_temp.n(m3) = v_n and pg_temp.status(m3) = 'pending', v_out);

      -- D: distinct request IDs ---------------------------------------------------------------------------------------
      v_out := pg_temp.pay(v_admin, m2, v_today, v_methods_b, null, rq_c);
      p_c := pg_temp.as_uuid(v_out);
      perform pg_temp.rec('D1 a different request ID with identical details records a second, distinct payment',
        p_c is not null and p_c <> p_b and pg_temp.n(m2) = 2 and pg_temp.total(m2) = 300
        and (select request_id from public.membership_payments where id = p_c) = rq_c, coalesce(v_out, 'NULL'));

      -- F: a request that made the membership Paid -------------------------------------------------------------------
      v_out := pg_temp.pay(v_admin, m3, v_today, '[{"method":"cash","amount":"500"}]', null, rq_f);
      p_f := pg_temp.as_uuid(v_out);
      perform pg_temp.rec('F1 a payment of the whole amount makes the membership Paid',
        p_f is not null and pg_temp.status(m3) = 'paid', coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m3, v_today, '[{"method":"cash","amount":"500"}]', null, rq_f);
      perform pg_temp.rec('F2 its retry is answered with the same payment, not refused as already paid (55000)',
        pg_temp.as_uuid(v_out) = p_f and pg_temp.n(m3) = 1 and pg_temp.status(m3) = 'paid', coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m3, v_today, '[{"method":"cash","amount":"1"}]', null, rq_g);
      v_out2 := pg_temp.query_as(v_admin, format(
        'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, false)::text',
        m3, v_today, '[{"method":"cash","amount":"1"}]'));
      perform pg_temp.rec('F3 a NEW request on the Paid membership is still refused 55000 (with and without a request ID)',
        v_out = 'ERR:55000' and v_out2 = 'ERR:55000' and pg_temp.n(m3) = 1, v_out || ' / ' || v_out2);

      -- C: compatibility ----------------------------------------------------------------------------------------------
      v_out := pg_temp.query_as(v_admin, format(
        'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %L::boolean)::text',
        m4, v_today, '[{"method":"cash","amount":"100"}]', false));
      perform pg_temp.rec('C1 four positional arguments (no request ID) still record a payment, stored with request_id NULL',
        pg_temp.as_uuid(v_out) is not null
        and (select request_id from public.membership_payments where id = pg_temp.as_uuid(v_out)) is null, coalesce(v_out, 'NULL'));

      v_out := pg_temp.query_as(v_admin, format(
        'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb)::text',
        m4, v_today, '[{"method":"cash","amount":"100"}]'));
      perform pg_temp.rec('C2 three positional arguments still record a payment, stored with request_id NULL',
        pg_temp.as_uuid(v_out) is not null
        and (select request_id from public.membership_payments where id = pg_temp.as_uuid(v_out)) is null, coalesce(v_out, 'NULL'));

      v_out := pg_temp.pay(v_admin, m4, v_today, '[{"method":"cash","amount":"100"}]', null, null);
      perform pg_temp.rec('C3 p_request_id given explicitly as NULL records a payment, stored with request_id NULL',
        pg_temp.as_uuid(v_out) is not null
        and (select request_id from public.membership_payments where id = pg_temp.as_uuid(v_out)) is null, coalesce(v_out, 'NULL'));

      perform pg_temp.rec('C4 without a request ID, identical calls record separate payments (no retry protection, as documented)',
        pg_temp.n(m4) = 3 and pg_temp.total(m4) = 300, pg_temp.n(m4)::text);

      -- V: the existing refusals, for a NEW request ID ----------------------------------------------------------------
      v_n := pg_temp.n(m5);
      v_out := pg_temp.pay(v_admin, m5, v_today, '[{"method":"cash","amount":"2000"}]', null, rq_v);
      perform pg_temp.rec('V1 overpayment is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, v_today, '[{"method":"cheque","amount":"10"}]', null, gen_random_uuid());
      perform pg_temp.rec('V2 an invalid method is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, v_today + 1, '[{"method":"cash","amount":"10"}]', null, gen_random_uuid());
      perform pg_temp.rec('V3 a future date is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, v_today, '[{"method":"cash","amount":"0"}]', null, gen_random_uuid());
      perform pg_temp.rec('V4 a zero amount is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, v_today, '[{"method":"cash","amount":"10.005"}]', null, gen_random_uuid());
      perform pg_temp.rec('V5 an amount with three decimals is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, v_today, '[]', null, gen_random_uuid());
      perform pg_temp.rec('V6 no payment method is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, m5, null, '[{"method":"cash","amount":"10"}]', null, gen_random_uuid());
      perform pg_temp.rec('V7 no payment date is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.pay(v_admin, gen_random_uuid(), v_today, '[{"method":"cash","amount":"10"}]', null, gen_random_uuid());
      perform pg_temp.rec('V8 an unknown membership is refused (P0002)', v_out = 'ERR:P0002', v_out);
      perform pg_temp.rec('V9 none of those refusals recorded anything', pg_temp.n(m5) = v_n, pg_temp.n(m5)::text);

      v_out := pg_temp.pay(v_admin, m5, v_today, '[{"method":"cash","amount":"100"}]', null, rq_v);
      perform pg_temp.rec('V10 a refused request does not spend its ID: a valid call with the same ID records normally',
        pg_temp.as_uuid(v_out) is not null and pg_temp.n(m5) = v_n + 1
        and (select request_id from public.membership_payments where id = pg_temp.as_uuid(v_out)) = rq_v, coalesce(v_out, 'NULL'));

      -- A: authorization ----------------------------------------------------------------------------------------------
      if v_instructor is null then
        perform pg_temp.skip('A1 instructor', 'no instructor profile found');
      else
        v_out := pg_temp.pay(v_instructor, m1, v_today, '[{"method":"cash","amount":"10"}]', null, gen_random_uuid());
        v_out2 := pg_temp.pay(v_instructor, m1, v_today, v_methods_a, null, rq_a);
        perform pg_temp.rec('A1 an Instructor is refused (42501) for a new request AND for a replay - no payment id is disclosed',
          v_out = 'ERR:42501' and v_out2 = 'ERR:42501' and pg_temp.n(m1) = 1, v_out || ' / ' || v_out2);
      end if;

      v_code := pg_temp.run_anon(format(
        'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, null::boolean, %L::uuid)',
        m1, v_today, v_methods_a, rq_a));
      perform pg_temp.rec('A2 an anonymous caller cannot execute the function (42501)', v_code = '42501', v_code);

      -- G: no direct writes -------------------------------------------------------------------------------------------
      v_code := pg_temp.run_as(v_admin, format(
        'insert into public.membership_payments (membership_id, payment_date, amount, request_id) values (%L, %L, 10, %L)',
        m5, v_today, gen_random_uuid()));
      perform pg_temp.rec('G1 even an Admin session cannot insert into membership_payments directly (42501)', v_code = '42501', v_code);

      v_code := pg_temp.run_anon(format(
        'insert into public.membership_payments (membership_id, payment_date, amount) values (%L, %L, 10)', m5, v_today));
      perform pg_temp.rec('G2 anon cannot insert into membership_payments (42501)', v_code = '42501', v_code);

      v_code := pg_temp.run_as(v_admin, format(
        'update public.membership_payments set request_id = %L where id = %L', gen_random_uuid(), p_a));
      perform pg_temp.rec('G3 an Admin session cannot set request_id with an update (42501), and it is unchanged',
        v_code = '42501' and (select request_id from public.membership_payments where id = p_a) = rq_a, v_code);

      v_code := pg_temp.run_owner(format(
        'insert into public.membership_payments (membership_id, payment_date, amount, request_id) values (%L, %L, 10, %L)',
        m5, v_today, rq_a));
      perform pg_temp.rec('G4 the unique index refuses a second payment with a used request ID, even for the owner (23505)',
        v_code = '23505', v_code);

      perform pg_temp.info('DATA', format('fixture payments recorded: %s', (
        select count(*) from public.membership_payments p join public.memberships m on m.id = p.membership_id
        join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY 0065%')));
    end if;

    -- Z ------------------------------------------------------------------------------------------------------------------
    v_fp1 := pg_temp.fingerprint();
    perform pg_temp.rec('Z1 every pre-existing payment, payment method and membership is unchanged', v_fp0 = v_fp1, '');
  end if;
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

-- AFTER THE ROLLBACK (run separately): select count(*) from public.students where full_name like 'ZZVERIFY 0065%';  -- must be 0
--
-- CONCURRENCY (manual, two sessions, disposable database only - not part of this script)
--   Session A:  begin;  select public.record_membership_payment('<membership>', current_date, '[{"method":"cash","amount":"10"}]',
--               null, '<request id X>');   -- do not commit yet
--   Session B:  the same call with the same request ID X  -> it waits on the membership row lock
--   Session A:  commit;
--   Session B:  returns the SAME payment id as A, and the membership has one new payment, not two.
--   Repeat with two different memberships and the same request ID: one call succeeds, the other is refused with 23505.
--   (Both sessions must be authenticated as an Admin - for example request.jwt.claims set as in pg_temp.query_as above.)
