-- ===========================================================================
-- Migration 0050 verification (behaviour) - membership term and fee corrections (V1 Fee Structure, FS-8)
-- Exercises supabase/migrations/0050_membership_term_corrections.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0050 is applied (the three functions, the audit table, the guard exemption). Otherwise every scenario is skipped
--       (NOT TESTED).   PF  Preflight: no fixture name exists.
--   A   Access: anon and an Instructor are refused (42501); an unknown membership (P0002), a legacy membership and a cancelled
--       membership (22023, 55000) are refused.
--   R   Rules of the call: a reason of 3 to 500 characters is required; the revised final fee must be CONFIRMED and equal to the
--       calculated one (a wrong or missing amount is refused and nothing changes); a correction that changes nothing is refused;
--       a final fee of 0 or less is refused.
--   S   Standard pricing: a correction prices exactly as creation does (the same amount, standard fee, package discount and end date
--       as a membership CREATED with the same package, duration and start date); a start-date correction re-resolves the fee entry
--       in effect on the new date; the preview writes nothing.
--   C   Custom Fee Plan: standard -> Custom (the custom fee is the final fee, no standard fee or discount, a reason, the confirmer and
--       time recorded); Custom -> standard (a fee entry, no custom fields); a Custom Fee Plan takes no discount.
--   P   Payments: the payments are unchanged (P1); no document is created or changed (P2); the payment status is recalculated from the
--       payments - Paid becomes Partially Paid when the fee rises above them (P3), Partially Paid becomes Paid when the fee falls to
--       them (P4); a fee below the payments recorded is refused and nothing changes (P5).
--   F   Package rules: no fee in effect on the start date (F1); a package of another type (F2); a DEACTIVATED other package, while the
--       membership's OWN deactivated package is allowed (F3); a duration the package does not offer (F4); a package change also
--       changes the package name and fee (F5).
--   K   Class-count: the class total follows the package and the expiry is left alone (K1); a package allowing fewer classes than
--       were used is refused (K1); a start date after a recorded class is refused (K2).
--   G   Guards: a direct UPDATE of a package column is still refused (G1); even inside a correction the student, type and currency
--       cannot change (G2); the audited expiry edit (0049) still works on a package-linked class-count membership (G3).
--   H   History: one audit row per correction with the reason, the Admin, the values before and after and the payments recorded (H1);
--       it cannot be changed or deleted, and only an Admin reads it (H2); every correction of a membership is listed (H3).
--   Z   Every row that existed before this script is byte-for-byte unchanged by it.
--
-- RESULTS AND NOT TESTED: PASS and FAIL are verdicts. NOT TESTED means a prerequisite could not be created (no Admin, no centre
-- currency, migrations 0046-0049 missing), so the scenarios that depend on it were not judged. The SUMMARY row says FAILURES if
-- anything failed, INCOMPLETE if nothing failed but something was NOT TESTED, and ALL PASS only when every scenario ran and passed.
--
-- PREREQUISITES: migrations 0046-0050 applied; an Admin profile and the centre profile (currency); an Instructor linked to a login for
-- A2 (reported NOT TESTED without one).
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students and packages named
--   'ZZVERIFY 0050 ...' and what the functions create for them. The audit tables are append-only, so the rollback is the only
--   clean-up: never run this in a session with autocommit. It touches no existing row. Nothing disables a trigger.
--
-- LIMITATIONS
--   * Concurrency (a correction against a payment or a recording) cannot be tested in one transaction; the lock on the membership row
--     that orders them is the one payments, recordings and expiry edits already take.
--   * A fee entry in another currency than the membership's cannot be built here without writing a fee table directly, so the
--     currency rule is pinned by the unit test of the SQL only.
--   * The application's pages are not exercised; this script tests the database rules only.
--   * Every membership and record created here consumes a sequence number: the rollback leaves gaps.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _hash (before_hash text, after_hash text) on commit drop;

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

-- One scalar query as an authenticated user: its text, or 'ERR:<sqlstate>'.
create function pg_temp.scalar_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create function pg_temp.scalar_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- One statement as the owner: 'OK' or the SQLSTATE.
create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

create function pg_temp.lit(p text)
returns text language sql as $f$
  select case when p is null then 'null' else quote_literal(p) end
$f$;

-- The membership's row: 'amount|plan|start|end|mode|status'.
create function pg_temp.row_of(p_membership uuid)
returns text language sql as $f$
  select m.amount || '|' || m.plan || '|' || m.start_date || '|' || coalesce(m.end_date::text, '~') || '|' || coalesce(m.pricing_mode, '~')
         || '|' || m.payment_status || '|' || coalesce(m.package_name, '~')
  from public.memberships m where m.id = p_membership
$f$;

-- create_membership_from_package as the Admin: the id text, or 'ERR:<sqlstate>'. Arguments: package, option, months, start, end, then the
-- individual discount (type, value, reason code, note) and the pricing mode, custom fee, reason and confirmation - SQL fragments.
create function pg_temp.buy(p_admin uuid, p_student uuid, p_package uuid, p_option text, p_months text, p_start date, p_end text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    'select public.create_membership_from_package(%L, %L, %s, %s, %L, %s::date, null, null, null, null, null, null, null, null, null)::text',
    p_student, p_package, pg_temp.lit(p_option), coalesce(p_months, 'null'), p_start, pg_temp.lit(p_end)));
end $f$;

-- A correction as a user. p_args keys (all optional but pkg and start): pkg, opt, months, start, it (individual type), iv, ic, in,
-- mode, cfee, creason, confirm, reason. Returns the audit id text, or 'ERR:<sqlstate>'.
create function pg_temp.corr(p_user uuid, p_membership uuid, p_args jsonb)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    'select public.correct_membership_terms(%L, %s::uuid, %s, %s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s)::text',
    p_membership, pg_temp.lit(p_args ->> 'pkg'), pg_temp.lit(p_args ->> 'opt'), coalesce(p_args ->> 'months', 'null'),
    pg_temp.lit(p_args ->> 'start'), pg_temp.lit(p_args ->> 'it'), coalesce(p_args ->> 'iv', 'null'), pg_temp.lit(p_args ->> 'ic'),
    pg_temp.lit(p_args ->> 'in'), pg_temp.lit(coalesce(p_args ->> 'mode', 'standard')), coalesce(p_args ->> 'cfee', 'null'),
    pg_temp.lit(p_args ->> 'creason'), coalesce(p_args ->> 'confirm', 'null'), pg_temp.lit(p_args ->> 'reason')));
end $f$;

-- The preview, same arguments (no confirm, no reason): the jsonb text, or 'ERR:<sqlstate>'.
create function pg_temp.prev(p_user uuid, p_membership uuid, p_args jsonb)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    'select public.preview_membership_correction(%L, %s::uuid, %s, %s, %s::date, %s, %s, %s, %s, %s, %s, %s)::text',
    p_membership, pg_temp.lit(p_args ->> 'pkg'), pg_temp.lit(p_args ->> 'opt'), coalesce(p_args ->> 'months', 'null'),
    pg_temp.lit(p_args ->> 'start'), pg_temp.lit(p_args ->> 'it'), coalesce(p_args ->> 'iv', 'null'), pg_temp.lit(p_args ->> 'ic'),
    pg_temp.lit(p_args ->> 'in'), pg_temp.lit(coalesce(p_args ->> 'mode', 'standard')), coalesce(p_args ->> 'cfee', 'null'),
    pg_temp.lit(p_args ->> 'creason')));
end $f$;

create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_amount text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    $q$select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, false)::text$q$,
    p_membership, p_date, '[{"method":"cash","amount":"' || p_amount || '"}]'));
end $f$;

create function pg_temp.student(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0050 ' || p_name, '9000000050', '+91', p_today - 300, 'active')
  returning id into v_id;
  return v_id;
end $f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s), '') ||
  coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), '') ||
  coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.membership_payments p), '') ||
  coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.invoices i), '') ||
  coalesce((select string_agg(to_jsonb(k)::text, '|' order by k.id) from public.packages k), '') ||
  coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a), ''));

do $$
declare
  v_applied boolean;
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_admin   uuid;
  v_instr   uuid;
  v_currency text;
  v_c       text;
  v_r       text;
  v_before  text;
  v_pay_before text;
  v_doc_before text;
  p_p uuid; p_q uuid; p_r uuid; p_off uuid; p_c uuid; p_c2 uuid; p_c3 uuid; p_c4 uuid;
  e_old uuid; e_new uuid;
  s1 uuid; s1b uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid; s9 uuid;
  m1 uuid; m1b uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid;
  v_exp1 date;
  v_aud uuid;
begin
  -- P0 ----------------------------------------------------------------------------------------------------------------------
  v_applied := to_regprocedure('public.correct_membership_terms(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text, numeric, text)') is not null
           and to_regprocedure('public.preview_membership_correction(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text)') is not null
           and to_regclass('public.membership_term_corrections') is not null
           and pg_get_functiondef('public.memberships_package_guard()'::regprocedure) like '%yoga.membership_term_correction%';
  perform pg_temp.rec('P0 migration 0050 is applied (the correction, the preview, the audit table and the guard exemption)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0050 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0050' in full_name) = 1)
     or exists (select 1 from public.packages where position('ZZVERIFY 0050' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0050 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select user_id into v_instr from public.instructors where user_id is not null and status = 'active' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;
  if v_admin is null or v_currency is null then
    perform pg_temp.skip('all scenarios', 'Needs an Admin profile and the centre profile (currency).');
    return;
  end if;

  -- Fixtures: packages and fees through the Admin functions ----------------------------------------------------------------------
  p_p := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 P', null, 'duration', null, '{monthly,quarterly,half_yearly,annual,custom}'::text[])::text$q$));
  e_old := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1000, null, null)::text$q$, p_p, v_today - 100)));
  e_new := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1500, %L::jsonb, null)::text$q$, p_p, v_today - 10,
    '[{"option":"quarterly","type":"fixed","value":"300"},{"option":"half_yearly","type":"percent","value":"10"},{"option":"annual","type":"fixed","value":"1200"}]')));

  p_q := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 Q', null, 'duration', null, '{monthly,quarterly}'::text[])::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 2000, null, null)::text$q$, p_q, v_today - 100));
  p_r := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 R', null, 'duration', null, '{monthly}'::text[])::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 800, null, null)::text$q$, p_r, v_today - 100));
  p_off := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 Off', null, 'duration', null, '{monthly}'::text[])::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 100, null, null)::text$q$, p_off, v_today - 100));
  perform pg_temp.scalar_as(v_admin, format($q$select public.set_package_status(%L, 'inactive', 'Not offered')::text$q$, p_off));

  p_c := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 C8', null, 'class_count', 8, null)::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 2000, null, null)::text$q$, p_c, v_today - 100));
  p_c2 := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 C12', null, 'class_count', 12, null)::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 3000, null, null)::text$q$, p_c2, v_today - 100));
  p_c3 := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 C3', null, 'class_count', 3, null)::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 900, null, null)::text$q$, p_c3, v_today - 100));
  p_c4 := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0050 C1', null, 'class_count', 1, null)::text$q$));
  perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 500, null, null)::text$q$, p_c4, v_today - 100));

  s1 := pg_temp.student('1', v_today); s1b := pg_temp.student('1b', v_today); s2 := pg_temp.student('2', v_today); s3 := pg_temp.student('3', v_today);
  s4 := pg_temp.student('4', v_today); s5 := pg_temp.student('5', v_today); s6 := pg_temp.student('6', v_today); s7 := pg_temp.student('7', v_today);
  s8 := pg_temp.student('8', v_today); s9 := pg_temp.student('9', v_today);

  m1 := pg_temp.as_uuid(pg_temp.buy(v_admin, s1, p_p, 'quarterly', null, v_today - 20, null));
  m2 := pg_temp.as_uuid(pg_temp.buy(v_admin, s2, p_p, 'quarterly', null, v_today - 5, null));
  m3 := pg_temp.as_uuid(pg_temp.buy(v_admin, s3, p_p, 'monthly', null, v_today - 5, null));
  m4 := pg_temp.as_uuid(pg_temp.buy(v_admin, s4, p_p, 'monthly', null, v_today - 5, null));
  m5 := pg_temp.as_uuid(pg_temp.buy(v_admin, s5, p_p, 'monthly', null, v_today - 5, null));
  m6 := pg_temp.as_uuid(pg_temp.buy(v_admin, s6, p_c, null, null, v_today - 10, (v_today + 60)::text));
  m7 := pg_temp.as_uuid(pg_temp.buy(v_admin, s7, p_r, 'monthly', null, v_today - 20, null));
  m9 := pg_temp.as_uuid(pg_temp.buy(v_admin, s9, p_p, 'monthly', null, v_today - 5, null));
  perform pg_temp.rec('F fixtures: the packages, fees, students and eight package memberships were created through the Admin functions',
    p_p is not null and e_old is not null and e_new is not null and p_q is not null and p_r is not null and p_off is not null
    and p_c is not null and p_c2 is not null and p_c3 is not null and p_c4 is not null
    and m1 is not null and m2 is not null and m3 is not null and m4 is not null and m5 is not null and m6 is not null and m7 is not null and m9 is not null,
    coalesce(m1::text, 'm1 failed'));
  if m1 is null or m6 is null then
    perform pg_temp.skip('every scenario', 'the fixtures could not be created');
    return;
  end if;
  -- A legacy membership (inserted as the owner, as the earlier scripts do).
  insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency)
  values (s8, 'monthly', 'duration', v_today - 5, v_today + 25, 700, v_currency) returning id into m8;

  -- A. Access ---------------------------------------------------------------------------------------------------------------------
  v_c := pg_temp.scalar_anon(format($q$select public.correct_membership_terms(%L, %L, 'monthly', null, %L::date, null, null, null, null, 'standard', null, null, 1500, 'ZZVERIFY nope')::text$q$, m3, p_p, v_today - 5))
      || ' / ' || pg_temp.scalar_anon(format($q$select public.preview_membership_correction(%L, %L, 'monthly', null, %L::date, null, null, null, null, 'standard', null, null)::text$q$, m3, p_p, v_today - 5));
  perform pg_temp.rec('A1 anon cannot correct or preview (42501)', v_c = 'ERR:42501 / ERR:42501', v_c);
  if v_instr is null then
    perform pg_temp.skip('A2 an Instructor is refused', 'needs an Instructor linked to a login (none exists)');
  else
    v_c := pg_temp.corr(v_instr, m3, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '1500', 'reason', 'ZZVERIFY nope'))
        || ' / ' || pg_temp.prev(v_instr, m3, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text));
    perform pg_temp.rec('A2 an Instructor cannot correct or preview (42501)', v_c = 'ERR:42501 / ERR:42501', v_c);
  end if;
  v_r := pg_temp.corr(v_admin, gen_random_uuid(), jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '1500', 'reason', 'ZZVERIFY none'));
  v_c := pg_temp.corr(v_admin, m8, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '1500', 'reason', 'ZZVERIFY legacy'));
  update public.memberships set cancelled_at = now() where id = m9;
  perform pg_temp.rec('A3 an unknown membership (P0002), a legacy membership (22023) and a cancelled one (55000) are refused',
    v_r = 'ERR:P0002' and v_c = 'ERR:22023'
    and pg_temp.corr(v_admin, m9, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 4)::text, 'confirm', '1500', 'reason', 'ZZVERIFY cancelled')) = 'ERR:55000',
    v_r || ' / ' || v_c);

  -- R. Rules of the call ----------------------------------------------------------------------------------------------------------
  v_before := pg_temp.row_of(m1);
  v_r := pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4200', 'reason', 'ab'))
      || ' / ' || pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4200', 'reason', '   '))
      || ' / ' || pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4200', 'reason', repeat('x', 501)));
  perform pg_temp.rec('R1 a missing, too short or too long reason is refused (22023) and nothing changes',
    v_r = 'ERR:22023 / ERR:22023 / ERR:22023' and pg_temp.row_of(m1) = v_before, v_r);
  v_r := pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'reason', 'ZZVERIFY no confirmation'))
      || ' / ' || pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4000', 'reason', 'ZZVERIFY wrong amount'));
  perform pg_temp.rec('R2 the revised final fee must be confirmed and equal the calculated one: none, or a wrong amount, is refused (22023) and nothing changes',
    v_r = 'ERR:22023 / ERR:22023' and pg_temp.row_of(m1) = v_before
    and (select count(*) from public.membership_term_corrections where membership_id = m1) = 0, v_r);
  v_c := pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 20)::text, 'confirm', '3000', 'reason', 'ZZVERIFY same terms'));
  perform pg_temp.rec('R3 a correction that changes nothing is refused (22023)', v_c = 'ERR:22023' and pg_temp.row_of(m1) = v_before, v_c);
  v_c := pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'mode', 'custom_fee_plan', 'cfee', '0', 'creason', 'ZZVERIFY zero', 'confirm', '0', 'reason', 'ZZVERIFY zero fee'))
     || ' / ' || pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'mode', 'custom_fee_plan', 'cfee', '-10', 'creason', 'ZZVERIFY negative', 'confirm', '-10', 'reason', 'ZZVERIFY negative fee'));
  perform pg_temp.rec('R4 a final fee of 0 or less is refused (22023) and nothing changes', v_c = 'ERR:22023 / ERR:22023' and pg_temp.row_of(m1) = v_before, v_c);

  -- S. Standard pricing: the same as creation ------------------------------------------------------------------------------------
  v_c := pg_temp.prev(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text));
  perform pg_temp.rec('S3 the preview calculates the revised price and writes nothing',
    v_c like '%"final_fee": 4200%' and pg_temp.row_of(m1) = v_before and (select count(*) from public.membership_term_corrections where membership_id = m1) = 0, v_c);
  perform pg_temp.pay(v_admin, m1, v_today, '1000');
  v_c := pg_temp.corr(v_admin, m1, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4200', 'reason', 'ZZVERIFY start date moved'));
  m1b := pg_temp.as_uuid(pg_temp.buy(v_admin, s1b, p_p, 'quarterly', null, v_today - 5, null));
  perform pg_temp.rec('S1 a corrected membership has exactly the price, breakdown and end date of one CREATED with the same package, duration and start date',
    (select (a.amount, a.standard_fee, a.package_discount, a.end_date, a.duration_months, a.plan, a.pricing_mode)
            is not distinct from (b.amount, b.standard_fee, b.package_discount, b.end_date, b.duration_months, b.plan, b.pricing_mode)
     from public.memberships a, public.memberships b where a.id = m1 and b.id = m1b)
    and (select a.amount from public.memberships a where a.id = m1) = 4200,
    coalesce(v_c, '') || ' / ' || pg_temp.row_of(m1) || ' vs ' || coalesce(pg_temp.row_of(m1b), ''));
  perform pg_temp.rec('S2 a start-date correction re-resolves the fee entry in effect on the NEW date (the older entry before, the newer after)',
    (select a.fee_entry_id from public.memberships a where a.id = m1) = e_new
    and (select c.old_values ->> 'fee_entry_id' from public.membership_term_corrections c where c.membership_id = m1 limit 1) = e_old::text,
    coalesce(v_c, ''));

  -- C. Custom Fee Plan ------------------------------------------------------------------------------------------------------------
  perform pg_temp.pay(v_admin, m3, v_today, '1500');
  perform pg_temp.corr(v_admin, m3, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'confirm', '4200', 'reason', 'ZZVERIFY quarterly instead'));
  -- P3: the fee rose above the payments: Paid -> Partially Paid, no payment date.
  perform pg_temp.rec('P3 a fee that rises above the payments turns Paid into Partially Paid and clears the payment date',
    (select (m.payment_status, m.payment_date, m.amount) is not distinct from ('partially_paid', null::date, 4200::numeric) from public.memberships m where m.id = m3),
    pg_temp.row_of(m3));
  v_pay_before := (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.membership_payments p where p.membership_id = m3);
  v_doc_before := (select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) from public.invoices i where i.membership_id = m3);
  v_c := pg_temp.corr(v_admin, m3, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'mode', 'custom_fee_plan', 'cfee', '1500', 'creason', 'ZZVERIFY special price', 'confirm', '1500', 'reason', 'ZZVERIFY switch to custom'));
  perform pg_temp.rec('C1 standard -> Custom Fee Plan: the custom fee is the final fee, with no standard fee, discount or fee entry, a reason, and the confirmer and time',
    (select (m.pricing_mode, m.amount, m.standard_fee, m.package_discount, m.individual_discount_amount, m.fee_entry_id, m.custom_fee_reason, m.custom_fee_confirmed_by, m.custom_fee_confirmed_at is not null)
            is not distinct from ('custom_fee_plan', 1500::numeric, null::numeric, null::numeric, null::numeric, null::uuid, 'ZZVERIFY special price', v_admin, true)
     from public.memberships m where m.id = m3), coalesce(v_c, '') || ' / ' || pg_temp.row_of(m3));
  perform pg_temp.rec('P4 a fee that falls to the payments turns Partially Paid into Paid, with the latest payment date',
    (select (m.payment_status, m.payment_date) is not distinct from ('paid', v_today) from public.memberships m where m.id = m3), pg_temp.row_of(m3));
  perform pg_temp.rec('P1 the payments of the membership are byte-for-byte unchanged by the correction',
    v_pay_before = (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.membership_payments p where p.membership_id = m3), '');
  perform pg_temp.rec('P2 no document is created or changed by the correction',
    v_doc_before = (select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) from public.invoices i where i.membership_id = m3), '');
  v_c := pg_temp.corr(v_admin, m3, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '1500', 'reason', 'ZZVERIFY back to standard'));
  perform pg_temp.rec('C2 Custom Fee Plan -> standard: a fee entry in effect on the start date is used and every custom field is cleared',
    (select (m.pricing_mode, m.amount, m.fee_entry_id, m.custom_fee_reason, m.custom_fee_confirmed_by, m.custom_fee_confirmed_at)
            is not distinct from ('standard', 1500::numeric, e_new, null::text, null::uuid, null::timestamptz)
     from public.memberships m where m.id = m3), coalesce(v_c, '') || ' / ' || pg_temp.row_of(m3));
  v_c := pg_temp.corr(v_admin, m5, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 5)::text, 'mode', 'custom_fee_plan', 'cfee', '900', 'creason', 'ZZVERIFY custom', 'it', 'fixed', 'iv', '50', 'ic', 'other', 'in', 'ZZVERIFY note here', 'confirm', '900', 'reason', 'ZZVERIFY discount on custom'));
  perform pg_temp.rec('C3 a Custom Fee Plan takes no discount (22023) and the membership is unchanged', v_c = 'ERR:22023'
    and (select m.pricing_mode from public.memberships m where m.id = m5) = 'standard', v_c);

  -- P5. Fee below the payments ---------------------------------------------------------------------------------------------------
  perform pg_temp.pay(v_admin, m2, v_today, '3000');
  v_before := pg_temp.row_of(m2);
  v_c := pg_temp.corr(v_admin, m2, jsonb_build_object('pkg', p_p, 'opt', 'quarterly', 'start', (v_today - 5)::text, 'mode', 'custom_fee_plan', 'cfee', '2000', 'creason', 'ZZVERIFY too low', 'confirm', '2000', 'reason', 'ZZVERIFY below payments'));
  perform pg_temp.rec('P5 a final fee below the payments already recorded is refused (22023) and nothing changes',
    v_c = 'ERR:22023' and pg_temp.row_of(m2) = v_before
    and (select sum(p.amount) from public.membership_payments p where p.membership_id = m2) = 3000, v_c);

  -- F. Package rules --------------------------------------------------------------------------------------------------------------
  v_c := pg_temp.corr(v_admin, m4, jsonb_build_object('pkg', p_p, 'opt', 'monthly', 'start', (v_today - 200)::text, 'confirm', '1000', 'reason', 'ZZVERIFY too early'));
  perform pg_temp.rec('F1 a start date with no fee in effect is refused (55000)', v_c = 'ERR:55000', v_c);
  v_c := pg_temp.corr(v_admin, m4, jsonb_build_object('pkg', p_c, 'start', (v_today - 5)::text, 'confirm', '2000', 'reason', 'ZZVERIFY wrong type'));
  perform pg_temp.rec('F2 a package of another type (class-count for a duration membership) is refused (22023)', v_c = 'ERR:22023', v_c);
  v_c := pg_temp.corr(v_admin, m4, jsonb_build_object('pkg', p_off, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '100', 'reason', 'ZZVERIFY deactivated package'));
  perform pg_temp.scalar_as(v_admin, format($q$select public.set_package_status(%L, 'inactive', 'Retired')::text$q$, p_r));
  v_r := pg_temp.corr(v_admin, m7, jsonb_build_object('pkg', p_r, 'opt', 'monthly', 'start', (v_today - 19)::text, 'confirm', '800', 'reason', 'ZZVERIFY own deactivated package'));
  perform pg_temp.rec('F3 a DIFFERENT deactivated package is refused (55006); the membership''s OWN deactivated package is allowed',
    v_c = 'ERR:55006' and v_r not like 'ERR:%' and (select m.start_date from public.memberships m where m.id = m7) = v_today - 19, v_c || ' / ' || v_r);
  v_c := pg_temp.corr(v_admin, m5, jsonb_build_object('pkg', p_q, 'opt', 'annual', 'start', (v_today - 5)::text, 'confirm', '24000', 'reason', 'ZZVERIFY not offered'));
  perform pg_temp.rec('F4 a duration the package does not offer is refused (22023)', v_c = 'ERR:22023', v_c);
  v_c := pg_temp.corr(v_admin, m5, jsonb_build_object('pkg', p_q, 'opt', 'monthly', 'start', (v_today - 5)::text, 'confirm', '2000', 'reason', 'ZZVERIFY other package'));
  perform pg_temp.rec('F5 a package change changes the package, its name and the fee (1500 -> 2000)',
    (select (m.package_id, m.package_name, m.amount) is not distinct from (p_q, 'ZZVERIFY 0050 Q', 2000::numeric) from public.memberships m where m.id = m5),
    coalesce(v_c, '') || ' / ' || pg_temp.row_of(m5));

  -- K. Class-count ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.scalar_as(v_admin, format($q$select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)::text$q$, m6, v_today - 3));
  perform pg_temp.scalar_as(v_admin, format($q$select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)::text$q$, m6, v_today - 2));
  select m.end_date into v_exp1 from public.memberships m where m.id = m6;
  v_c := pg_temp.corr(v_admin, m6, jsonb_build_object('pkg', p_c2, 'start', (v_today - 10)::text, 'confirm', '3000', 'reason', 'ZZVERIFY bigger package'));
  v_r := pg_temp.corr(v_admin, m6, jsonb_build_object('pkg', p_c4, 'start', (v_today - 10)::text, 'confirm', '500', 'reason', 'ZZVERIFY too few classes'));
  perform pg_temp.rec('K1 a class-count correction follows the package''s class total and price, leaves the expiry alone, and refuses a package allowing fewer classes than were used',
    (select (m.total_classes, m.amount, m.end_date, m.plan) is not distinct from (12, 3000::numeric, v_exp1, 'class_count') from public.memberships m where m.id = m6)
    and v_r = 'ERR:22023' and (select count(*) from public.class_count_attendance a where a.membership_id = m6) = 2,
    coalesce(v_c, '') || ' / ' || v_r);
  v_c := pg_temp.corr(v_admin, m6, jsonb_build_object('pkg', p_c2, 'start', v_today::text, 'confirm', '3000', 'reason', 'ZZVERIFY start after a class'));
  perform pg_temp.rec('K2 a start date after a recorded class is refused (22023)', v_c = 'ERR:22023'
    and (select m.start_date from public.memberships m where m.id = m6) = v_today - 10, v_c);

  -- G. Guards -----------------------------------------------------------------------------------------------------------------------
  v_c := pg_temp.scalar_as(v_admin, format($q$update public.memberships set amount = amount + 1 where id = %L$q$, m5));
  perform pg_temp.rec('G1 a direct UPDATE of a package membership''s price is still refused (55006)', v_c = 'ERR:55006', v_c);
  perform set_config('yoga.membership_term_correction', m5::text, true);
  v_c := pg_temp.code(format('update public.memberships set student_id = %L where id = %L', s9, m5));
  v_r := pg_temp.code(format('update public.memberships set currency = %L where id = %L', case when v_currency = 'USD' then 'EUR' else 'USD' end, m5));
  perform set_config('yoga.membership_term_correction', '', true);
  perform pg_temp.rec('G2 even inside a correction the student and the currency cannot change (55006)',
    v_c = '55006' and v_r = '55006' and (select m.student_id from public.memberships m where m.id = m5) = s5, v_c || ' / ' || v_r);
  v_c := pg_temp.scalar_as(v_admin, format($q$select public.edit_class_count_expiry(%L, %L::date, 'ZZVERIFY extend expiry')::text$q$, m6, v_today + 90));
  perform pg_temp.rec('G3 the audited expiry edit (0049) still works on a package-linked class-count membership', v_c not like 'ERR:%'
    and (select m.end_date from public.memberships m where m.id = m6) = v_today + 90, v_c);

  -- H. History ----------------------------------------------------------------------------------------------------------------------
  select c.id into v_aud from public.membership_term_corrections c where c.membership_id = m1 limit 1;
  perform pg_temp.rec('H1 the audit row has the reason, the Admin, the values before (3000) and after (4200), the payments recorded (1000) and the status',
    exists (select 1 from public.membership_term_corrections c
            where c.id = v_aud and c.reason = 'ZZVERIFY start date moved' and c.corrected_by = v_admin and c.old_amount = 3000 and c.new_amount = 4200
              and c.payments_total = 1000 and c.old_payment_status = 'partially_paid' and c.new_payment_status = 'partially_paid'
              and (c.old_values ->> 'start_date')::date = v_today - 20 and (c.new_values ->> 'start_date')::date = v_today - 5
              and (c.new_values ->> 'amount')::numeric = 4200), coalesce(v_aud::text, 'no audit row'));
  v_c := pg_temp.code(format('update public.membership_term_corrections set reason = %L where id = %L', 'ZZVERIFY tampered', v_aud))
      || ' / ' || pg_temp.code(format('delete from public.membership_term_corrections where id = %L', v_aud));
  v_r := pg_temp.scalar_anon('select count(*)::text from public.membership_term_corrections');
  perform pg_temp.rec('H2 the audit history cannot be changed or deleted (55006) and anon cannot read it; an Admin can',
    v_c = '55006 / 55006' and v_r = 'ERR:42501'
    and pg_temp.scalar_as(v_admin, format('select count(*)::text from public.membership_term_corrections where membership_id = %L', m1)) = '1', v_c || ' / ' || v_r);
  perform pg_temp.rec('H3 every correction of a membership is listed (the third membership had three: quarterly, Custom Fee Plan, back to standard)',
    (select count(*) from public.membership_term_corrections c where c.membership_id = m3) = 3, (select count(*) from public.membership_term_corrections c where c.membership_id = m3)::text);

  -- Z. Existing data unchanged ----------------------------------------------------------------------------------------------------
  -- Fixture rows are excluded by student and package name: only what existed before this script is compared.
  create temp table _fxm on commit drop as
    select m.id from public.memberships m
    join public.students st on st.id = m.student_id and position('ZZVERIFY 0050' in st.full_name) = 1;
  update _hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s where position('ZZVERIFY 0050' in s.full_name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m where not exists (select 1 from _fxm x where x.id = m.id)), '') ||
    coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.membership_payments p where not exists (select 1 from _fxm x where x.id = p.membership_id)), '') ||
    coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.invoices i where not exists (select 1 from _fxm x where x.id = i.membership_id)), '') ||
    coalesce((select string_agg(to_jsonb(k)::text, '|' order by k.id) from public.packages k where position('ZZVERIFY 0050' in k.name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a where not exists (select 1 from _fxm x where x.id = a.membership_id)), '')));
  perform pg_temp.rec('Z every student, membership, payment, invoice, package and class-count record that existed before this script is byte-for-byte unchanged by it',
    (select before_hash = after_hash from _hash), '');
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') > 0 then 'FAILURES'
       when count(*) filter (where status = 'NOT TESTED') > 0 then 'INCOMPLETE'
       else 'ALL PASS' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
    || case when count(*) filter (where status = 'NOT TESTED') > 0
            then ' - NOT TESTED is neither a pass nor a failure: a prerequisite could not be created, so this run does NOT verify 0050'
            else '' end
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0050' in full_name) = 1) as leftover_students,
--          (select count(*) from public.packages where position('ZZVERIFY 0050' in name) = 1) as leftover_packages;
-- Both must be 0.
