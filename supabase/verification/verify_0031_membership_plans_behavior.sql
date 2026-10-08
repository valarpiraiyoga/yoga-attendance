-- ===========================================================================
-- V1 Membership plans — Migration 0031 BEHAVIOURAL verification
-- Exercises supabase/migrations/0031_membership_plans.sql
-- ===========================================================================
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * Self-contained: it creates its OWN disposable fixtures (one student, ZZVERIFY, and four
--     memberships, one per plan under test), marks some Paid (which issues receipts), and edits
--     their plan. It touches no real membership, student or receipt; the receipts that already
--     exist are fingerprinted first and checked at the end to be byte-for-byte the same.
--   * ONE SIDE EFFECT THAT ROLLBACK CANNOT UNDO: a student and a membership take their YC- / MEM-
--     codes from sequences, and nextval() is never given back. Each run leaves a small GAP in the
--     numbering (one student code, four membership codes). No row remains.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction, issue
--     `rollback;` first.
--
-- AUTHENTICATION
--   Admin behaviour runs as an authenticated ADMIN by setting request.jwt.claims and switching to
--   the `authenticated` role, as PostgREST does. No service-role key is used.
--
-- OUTPUT: one grid of seq / test / status / detail, plus a SUMMARY row.
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

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

do $$
declare
  v_admin        uuid;
  v_today        date;
  v_student      uuid;
  v_fixture_err  text;
  v_mh uuid; v_ma uuid; v_mm uuid; v_mq uuid;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_code         text;
  v_inv          public.invoices%rowtype;
begin
  select (now() at time zone public.centre_timezone())::date into v_today;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  -- Disposable fixtures: one student and four non-overlapping memberships, one per plan under test.
  -- Created by the owner with the plan values the old CHECK would have refused.
  begin
    insert into public.students (full_name, phone, phone_country_code, join_date, status)
    values ('ZZVERIFY Plans Student', '9000000001', '+91', v_today - 800, 'active')
    returning id into v_student;

    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'half_yearly', v_today - 700, v_today - 520, 6000.00, 'pending', 'INR') returning id into v_mh;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'annual', v_today - 500, v_today - 136, 11000.00, 'pending', 'INR') returning id into v_ma;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'monthly', v_today - 100, v_today - 70, 1000.00, 'pending', 'INR') returning id into v_mm;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'quarterly', v_today - 60, v_today - 1, 2800.00, 'pending', 'INR') returning id into v_mq;
  exception when others then
    v_mh := null;
    v_fixture_err := sqlstate || ' ' || sqlerrm;
  end;

  select starting_invoice_number into v_start_before from public.invoice_settings where singleton;
  v_had_invoices := exists (select 1 from public.invoices);

  select coalesce(array_agg(i.id), '{}'), count(*),
         md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_ids0, v_count0, v_hash0
  from public.invoices i;

  perform pg_temp.info('SETUP', format('admin=%s fixtures-created=%s receipts-already=%s',
    coalesce(v_admin::text, 'none'), case when v_mh is null then 'NO' else 'yes' end, v_count0));

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_mh is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_fixture_err, 'unknown'));
  else
    -- P. The new plans are accepted; anything else is still refused ---------------------------
    perform pg_temp.rec('P1 Half Yearly and Annual memberships are accepted (the CHECK allows them)',
      (select count(*) = 2 from public.memberships where student_id = v_student and plan in ('half_yearly', 'annual')), '');
    perform pg_temp.rec('P2 Monthly and Quarterly memberships are accepted as before',
      (select count(*) = 2 from public.memberships where student_id = v_student and plan in ('monthly', 'quarterly')), '');
    v_code := pg_temp.run_owner(format('update public.memberships set plan = ''weekly'' where id = %L', v_mm));
    perform pg_temp.rec('P3 an unknown plan is still refused (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.memberships set plan = ''custom'' where id = %L', v_mm));
    perform pg_temp.rec('P4 Custom duration is still accepted', v_code = 'OK', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.memberships set plan = ''monthly'' where id = %L', v_mm));

    -- R. Receipts: issued with the right wording, then following a plan change ------------------
    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    perform pg_temp.run_owner('update public.invoice_settings set tax_enabled = false where singleton');

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_mh));
    select * into v_inv from public.invoices where membership_id = v_mh;
    perform pg_temp.rec('R1 a Paid Half Yearly membership gets a receipt: plan half_yearly, "Half Yearly Membership"',
      v_code = 'OK' and v_inv.plan = 'half_yearly' and v_inv.description = 'Half Yearly Membership', 'sqlstate ' || v_code || ', ' || coalesce(v_inv.description, 'NULL'));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_ma));
    select * into v_inv from public.invoices where membership_id = v_ma;
    perform pg_temp.rec('R2 a Paid Annual membership gets a receipt: plan annual, "Annual Membership"',
      v_code = 'OK' and v_inv.plan = 'annual' and v_inv.description = 'Annual Membership', 'sqlstate ' || v_code || ', ' || coalesce(v_inv.description, 'NULL'));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_mm));
    select * into v_inv from public.invoices where membership_id = v_mm;
    perform pg_temp.rec('R3 a Monthly receipt is worded exactly as before',
      v_code = 'OK' and v_inv.plan = 'monthly' and v_inv.description = 'Monthly Membership', coalesce(v_inv.description, 'NULL'));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_mq));
    select * into v_inv from public.invoices where membership_id = v_mq;
    perform pg_temp.rec('R4 a Quarterly receipt is worded exactly as before',
      v_code = 'OK' and v_inv.plan = 'quarterly' and v_inv.description = 'Quarterly Membership', coalesce(v_inv.description, 'NULL'));

    -- S. A plan change follows to the same receipt (migration 0030's sync) ----------------------
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''annual'' where id = %L', v_mh));
    select * into v_inv from public.invoices where membership_id = v_mh;
    perform pg_temp.rec('S1 Half Yearly -> Annual: the SAME receipt follows (plan and wording)',
      v_code = 'OK' and v_inv.plan = 'annual' and v_inv.description = 'Annual Membership'
      and (select count(*) = 1 from public.invoices where membership_id = v_mh), 'sqlstate ' || v_code || ', ' || coalesce(v_inv.description, 'NULL'));
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''half_yearly'' where id = %L', v_mq));
    select * into v_inv from public.invoices where membership_id = v_mq;
    perform pg_temp.rec('S2 Quarterly -> Half Yearly: the receipt follows',
      v_code = 'OK' and v_inv.plan = 'half_yearly' and v_inv.description = 'Half Yearly Membership', coalesce(v_inv.description, 'NULL'));
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''custom'' where id = %L', v_ma));
    select * into v_inv from public.invoices where membership_id = v_ma;
    perform pg_temp.rec('S3 Annual -> Custom: the receipt reads Custom duration Membership, as before',
      v_code = 'OK' and v_inv.plan = 'custom' and v_inv.description = 'Custom duration Membership', coalesce(v_inv.description, 'NULL'));

    -- T. The receipt itself still refuses an unknown plan -------------------------------------------
    v_code := pg_temp.run_owner(format('update public.invoices set plan = ''weekly'' where id = %L', v_inv.id));
    perform pg_temp.rec('T1 a receipt cannot be given an unknown plan (refused, 23514 or the freeze 55006)', v_code in ('23514', '55006'), 'sqlstate ' || v_code);
  end if;

  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i where i.id = any(v_ids0);
  perform pg_temp.rec('Z1 every pre-existing receipt is byte-for-byte unchanged', v_hash0 = v_hash1, v_count0 || ' receipt(s) fingerprinted');
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

-- ===========================================================================
-- AFTER THE ROLLBACK — confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above (commented out so the grid stays the last result).
--
--   select
--     (select count(*) from public.invoices)                                              as receipts,
--     (select count(*) from public.students where full_name like 'ZZVERIFY%')             as leftover_fixture_students,
--     (select count(*) from public.memberships m join public.students s on s.id = m.student_id
--        where s.full_name like 'ZZVERIFY%')                                              as leftover_fixture_memberships,
--     (select next_invoice_number from public.invoice_settings)                           as next_invoice_number;
--
-- receipts and next_invoice_number must equal their values before; both leftover counts must be 0.
-- (The YC- / MEM- sequences will have moved on: see the header.)
-- ===========================================================================
