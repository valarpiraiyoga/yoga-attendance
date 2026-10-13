-- ===========================================================================
-- Migration 0048 verification (behaviour) - package-linked memberships (V1 Fee Structure, FS-5)
-- Exercises supabase/migrations/0048_package_linked_memberships.sql
-- ===========================================================================
--
-- WHAT IT CHECKS (FS-5 acceptance criteria of docs/04-development-plan.md)
--   P0  Migration 0048 is applied. If not, every scenario is skipped (NOT TESTED).   PF  Preflight: no fixture name exists.
--   A   Access: anon refused; an Instructor refused (NOT TESTED without one).
--   P   Pricing: standard fee, package discount, individual discount, final fee; half-up rounding.
--   E   End date: calendar months clamped to a shorter month, then minus one day, calculated in SQL.
--   D   Discount refusals: individual discount too large, final fee 0, package discount above the standard fee.
--   F   Fee resolution by START DATE (an earlier entry, no entry, another currency never converted).
--   C   Custom Fee Plan: confirmed and recorded; unconfirmed, reason-less or discounted refused.
--   G   Guards: a direct insert, an edit of a protected column, a link of a legacy membership and a membership-level
--       document for a package membership are refused; notes still change.
--   X   Fee-conflict detection: cancelling an entry a membership was priced from, or scheduling an entry that would change
--       which fee applies to a start date, is refused; correcting an entry (same date) and an unrelated future schedule
--       are allowed; no membership is repriced.
--   K   A class-count package: a membership with no expiry and with one, its price, a package-level individual discount; a
--       duration option, months or an end date on the wrong kind, and an expiry before the start, are refused.
--   U   An ordinary edit of a LEGACY membership (amount, end date, notes) still works as an Admin.
--   Q   Payments on a package membership: the status follows the payments (partially paid, then paid), an overpayment is
--       refused, each payment gets its own document (tax invoice or receipt series), no membership-level document exists,
--       and the package, fee and discount columns are untouched.
--   L   A deactivated package is refused; every pre-existing membership is byte-for-byte unchanged by this script.
--
-- PREREQUISITES: migrations 0046, 0047 and 0048 applied; an Admin profile (an Instructor profile for A2).
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ so the fingerprints come from one snapshot), ending in ROLLBACK. Disposable fixtures only:
--   packages named 'ZZVERIFY 0048 ...', students named 'ZZVERIFY 0048 ...' and what the functions create for them. The package
--   tables are append-only, so the rollback is the only clean-up: never run this in a session with autocommit.
--
-- LIMITATIONS
--   * The fee-conflict check is a DEFERRED constraint trigger that fires at COMMIT. This script never commits, so it forces
--     the check with SET CONSTRAINTS ... IMMEDIATE after each fee change (pg_temp.checked): it shows the check refuses and
--     allows the right changes; it does not show that a commit through the API surfaces the same error.
--   * Concurrency cannot be tested in one transaction.
--   * Every membership created here consumes a MEM-nnnnnn number: the rollback leaves a gap in the membership codes
--     (a sequence is never rolled back).
--   * JavaScript/SQL agreement beyond the shared cases below is not claimed.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _legacy_ids (id uuid primary key) on commit drop;
create temp table _legacy_hash (before_hash text, after_hash text) on commit drop;

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

-- One statement as the owner: 'OK' or the SQLSTATE.
create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
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

-- One statement as an authenticated user: 'OK' or the SQLSTATE.
create function pg_temp.as_user(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

-- A FEE change as an authenticated user, followed by the deferred conflict check forced to run now. 'OK' or the SQLSTATE; a
-- refusal rolls the whole change back (the block is a subtransaction).
create function pg_temp.checked(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    execute 'set constraints public.package_fee_entries_conflict_trigger immediate';
  exception when others then
    v_code := sqlstate;
  end;
  execute 'set constraints public.package_fee_entries_conflict_trigger deferred';
  execute 'reset role';
  return v_code;
end $f$;

create function pg_temp.as_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- A disposable student (as the owner).
create function pg_temp.student(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0048 ' || p_name, '9000000048', '+91', current_date, 'active')
  returning id into v_id;
  return v_id;
end $f$;

-- create_membership_from_package for a disposable student, as the Admin: its id text or 'ERR:<sqlstate>'. NULL arguments are
-- passed as the string 'null'.
create function pg_temp.buy(p_admin uuid, p_student uuid, p_package uuid, p_option text, p_months text, p_start date, p_end text,
                            p_ind_type text, p_ind_value text, p_code text, p_note text,
                            p_mode text, p_custom_fee text, p_custom_reason text, p_confirmed text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    'select public.create_membership_from_package(%L, %L, %s, %s, %L, %s, %s, %s, %s, %s, %s, %s, %s, %s, null)::text',
    p_student, p_package,
    case when p_option is null then 'null' else quote_literal(p_option) end,
    coalesce(p_months, 'null'), p_start, coalesce(p_end, 'null'),
    case when p_ind_type is null then 'null' else quote_literal(p_ind_type) end, coalesce(p_ind_value, 'null'),
    case when p_code is null then 'null' else quote_literal(p_code) end,
    case when p_note is null then 'null' else quote_literal(p_note) end,
    case when p_mode is null then 'null' else quote_literal(p_mode) end,
    coalesce(p_custom_fee, 'null'),
    case when p_custom_reason is null then 'null' else quote_literal(p_custom_reason) end,
    coalesce(p_confirmed, 'null')));
end $f$;

-- Records a payment as the Admin: the payment id text, or 'ERR:<sqlstate>'.
create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_methods text, p_tax text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %s::boolean)::text',
    p_membership, p_date, p_methods, p_tax));
end $f$;

-- Issues a payment's document as the Admin: 'OK' or the SQLSTATE.
create function pg_temp.issue(p_admin uuid, p_payment text)
returns text language plpgsql as $f$
begin
  return pg_temp.as_user(p_admin, format('select public.issue_payment_document(%L::uuid)', p_payment));
end $f$;

do $$
declare
  v_admin    uuid;
  v_instr    uuid;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_currency text;
  v_other    text;
  v_ready    boolean;
  v_clash    integer := 0;
  v_s        text;
  v_c        text;
  v_n        integer;
  v_cnt      integer;
  p_dur uuid; p_round uuid; p_cur uuid; p_big uuid; p_off uuid; p_cls uuid;
  e_old uuid; e_new uuid; e_round uuid; e_cur uuid; e_big uuid; e_cls uuid; e_x uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid; s9 uuid; s10 uuid; s11 uuid; s12 uuid; s13 uuid; s14 uuid;
  s15 uuid; s16 uuid; s17 uuid; mc1 uuid; mc2 uuid; v_pay1 text; v_pay2 text; v_set public.invoice_settings%rowtype;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid; m10 uuid; m_leg uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr from public.profiles where role = 'instructor' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;
  v_other := case when v_currency = 'USD' then 'EUR' else 'USD' end;

  -- P0 -----------------------------------------------------------------------------------------------------------------
  v_ready := to_regprocedure('public.create_membership_from_package(uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text)') is not null
         and to_regprocedure('public.package_fee_conflicts(uuid)') is not null
         and to_regprocedure('public.create_package(text, text, text, integer, text[])') is not null
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name = 'pricing_mode')
         and exists (select 1 from pg_trigger where tgname = 'package_fee_entries_conflict_trigger' and not tgisinternal);
  perform pg_temp.rec('P0 migration 0048 is applied (the create function, the columns and the conflict trigger)', coalesce(v_ready, false),
    case when coalesce(v_ready, false) then '' else 'apply 0046, 0047 and 0048 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if v_ready then
    select count(*) into v_clash from public.packages where position('ZZVERIFY 0048' in name) = 1;
    perform pg_temp.rec('PF no package already has a fixture name (ZZVERIFY 0048 ...) - this run creates its own', v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing package(s) clash - nothing was created' end);
    -- Fingerprint every membership that exists before the run.
    insert into _legacy_ids select id from public.memberships;
    insert into _legacy_hash (before_hash)
    select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) from public.memberships m where m.id in (select id from _legacy_ids);
  end if;

  if not v_ready then
    perform pg_temp.skip('A / P / E / D / F / C / G / X / L', 'migration 0048 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('A / P / E / D / F / C / G / X / L', 'preflight PF failed');
  elsif v_admin is null or v_currency is null then
    perform pg_temp.skip('A / P / E / D / F / C / G / X / L', 'needs an Admin profile and the centre profile');
  else
    -- Fixtures: packages and fees through the Admin functions.
    p_dur := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 Duration', null, 'duration', null, '{monthly,quarterly,half_yearly,annual,custom}'::text[])::text$q$));
    e_old := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1000, null, null)::text$q$, p_dur, v_today - 100)));
    e_new := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1500, %L::jsonb, null)::text$q$, p_dur, v_today - 10,
      '[{"option":"quarterly","type":"fixed","value":"300"},{"option":"half_yearly","type":"percent","value":"10"},{"option":"annual","type":"fixed","value":"1200"}]')));

    p_round := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 Rounding', null, 'duration', null, '{monthly,half_yearly}'::text[])::text$q$));
    e_round := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1.01, %L::jsonb, null)::text$q$, p_round, v_today - 10,
      '[{"option":"half_yearly","type":"percent","value":"12.5"}]')));

    p_big := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 BigDiscount', null, 'duration', null, '{monthly,quarterly}'::text[])::text$q$));
    e_big := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10, %L::jsonb, null)::text$q$, p_big, v_today - 10,
      '[{"option":"quarterly","type":"fixed","value":"100"}]')));

    p_cur := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 OtherCurrency', null, 'duration', null, '{monthly}'::text[])::text$q$));
    e_cur := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 500, null, null)::text$q$, p_cur, v_today - 10)));
    -- A fee in another currency (the functions always stamp the centre's): written as the owner, as the 0046 script does.
    insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee)
    values (p_cur, 'duration', v_today - 5, v_other, 700) returning id into e_x;

    p_cls := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 Classes', null, 'class_count', 8, null)::text$q$));
    e_cls := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 2000, null, null)::text$q$, p_cls, v_today - 10)));

    p_off := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0048 Deactivated', null, 'duration', null, '{monthly}'::text[])::text$q$));
    perform pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 100, null, null)::text$q$, p_off, v_today - 10));
    v_c := pg_temp.as_user(v_admin, format($q$select public.set_package_status(%L, 'inactive', 'Not offered')$q$, p_off));

    s1 := pg_temp.student('1'); s2 := pg_temp.student('2'); s3 := pg_temp.student('3'); s4 := pg_temp.student('4'); s5 := pg_temp.student('5');
    s6 := pg_temp.student('6'); s7 := pg_temp.student('7'); s8 := pg_temp.student('8'); s9 := pg_temp.student('9'); s10 := pg_temp.student('10');
    s11 := pg_temp.student('11'); s12 := pg_temp.student('12'); s13 := pg_temp.student('13'); s14 := pg_temp.student('14');

    perform pg_temp.rec('fixtures: five packages with their fees were created through the Admin functions',
      p_dur is not null and e_old is not null and e_new is not null and p_round is not null and e_round is not null and p_big is not null
      and e_big is not null and p_cur is not null and e_x is not null and p_cls is not null and e_cls is not null and p_off is not null
      and s14 is not null and v_c = 'OK', coalesce(v_c, ''));

    -- A. Access ---------------------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_anon(format($q$select public.create_membership_from_package(%L, %L, 'monthly', null, %L, null, null, null, null, null, null, null, null, null, null)$q$, s1, p_dur, v_today));
    perform pg_temp.rec('A1 anon cannot create a package membership', v_c = '42501', v_c);
    if v_instr is null then
      perform pg_temp.skip('A2 an Instructor is refused', 'needs an Instructor profile (none exists)');
    else
      v_c := pg_temp.as_user(v_instr, format($q$select public.create_membership_from_package(%L, %L, 'monthly', null, %L, null, null, null, null, null, null, null, null, null, null)$q$, s1, p_dur, v_today));
      perform pg_temp.rec('A2 an Instructor is refused (42501) and no membership is created', v_c = '42501'
        and not exists (select 1 from public.memberships where student_id = s1), v_c);
    end if;

    -- P. Pricing --------------------------------------------------------------------------------------------------------------
    -- Quarterly from the fee entry of today-10: 1500 x 3 = 4500, package discount 300, individual 10% of 4200 = 420 -> 3780.
    m1 := pg_temp.as_uuid(pg_temp.buy(v_admin, s1, p_dur, 'quarterly', null, v_today - 5, null, 'percent', '10', 'promotional_offer', null, null, null, null, null));
    perform pg_temp.rec('P1 quarterly: standard 4500, package discount 300, individual 10% of the remainder 420, final fee 3780, snapshots kept',
      m1 is not null and exists (
        select 1 from public.memberships m where m.id = m1 and m.amount = 3780 and m.standard_fee = 4500 and m.package_discount = 300
          and m.individual_discount_type = 'percent' and m.individual_discount_value = 10 and m.individual_discount_amount = 420
          and m.individual_discount_reason_code = 'promotional_offer' and m.fee_entry_id = e_new and m.package_id = p_dur
          and m.package_name = 'ZZVERIFY 0048 Duration' and m.duration_months = 3 and m.pricing_mode = 'standard' and m.plan = 'quarterly'
          and m.kind = 'duration' and m.currency = v_currency and m.payment_status = 'pending' and m.membership_code like 'MEM-%'
          and m.start_date = v_today - 5 and m.end_date = ((v_today - 5) + interval '3 months')::date - 1), '');

    -- Half yearly: 1500 x 6 = 9000, 10% = 900, fixed individual 100 for "other" with a note -> 8000.
    m2 := pg_temp.as_uuid(pg_temp.buy(v_admin, s2, p_dur, 'half_yearly', null, v_today, null, 'fixed', '100', 'other', 'Family member', null, null, null, null));
    perform pg_temp.rec('P2 half yearly: 9000 less 900 (10%) less a fixed 100 = 8000; "other" keeps its explanation',
      exists (select 1 from public.memberships m where m.id = m2 and m.amount = 8000 and m.standard_fee = 9000 and m.package_discount = 900
        and m.individual_discount_amount = 100 and m.individual_discount_note = 'Family member'), '');

    -- Rounding: 1.01 x 6 = 6.06, 12.5% = 0.7575 -> 0.76, final 5.30. Annual: 18000 less a fixed 1200. Two months (Custom): no discount.
    m3 := pg_temp.as_uuid(pg_temp.buy(v_admin, s3, p_round, 'half_yearly', null, v_today, null, null, null, null, null, null, null, null, null));
    m4 := pg_temp.as_uuid(pg_temp.buy(v_admin, s4, p_dur, 'annual', null, v_today, null, null, null, null, null, null, null, null, null));
    m5 := pg_temp.as_uuid(pg_temp.buy(v_admin, s5, p_dur, 'custom', '2', v_today, null, null, null, null, null, null, null, null, null));
    perform pg_temp.rec('P3 rounding half up (0.7575 -> 0.76, final 5.30); annual 18000 - 1200 = 16800; a 2-month Custom duration has no package discount (3000)',
      exists (select 1 from public.memberships m where m.id = m3 and m.standard_fee = 6.06 and m.package_discount = 0.76 and m.amount = 5.30)
      and exists (select 1 from public.memberships m where m.id = m4 and m.amount = 16800 and m.package_discount = 1200 and m.duration_months = 12)
      and exists (select 1 from public.memberships m where m.id = m5 and m.amount = 3000 and m.package_discount = 0 and m.plan = 'custom' and m.duration_months = 2),
      coalesce(m3::text, '') || ' ' || coalesce(m4::text, '') || ' ' || coalesce(m5::text, ''));

    -- E. End dates -------------------------------------------------------------------------------------------------------------
    m6 := pg_temp.as_uuid(pg_temp.buy(v_admin, s6, p_dur, 'monthly', null, date '2030-01-31', null, null, null, null, null, null, null, null, null));
    m7 := pg_temp.as_uuid(pg_temp.buy(v_admin, s7, p_dur, 'quarterly', null, date '2030-11-30', null, null, null, null, null, null, null, null, null));
    m8 := pg_temp.as_uuid(pg_temp.buy(v_admin, s8, p_dur, 'annual', null, date '2032-02-29', null, null, null, null, null, null, null, null, null));
    m9 := pg_temp.as_uuid(pg_temp.buy(v_admin, s9, p_dur, 'custom', '14', date '2030-01-01', null, null, null, null, null, null, null, null, null));
    perform pg_temp.rec('E1 monthly from Jan 31: Feb 28 is the clamped month end, minus one day = Feb 27',
      exists (select 1 from public.memberships m where m.id = m6 and m.end_date = date '2030-02-27'), coalesce(m6::text, ''));
    perform pg_temp.rec('E2 quarterly from Nov 30 ends Feb 27 (Feb 28, 2031 minus one day)',
      exists (select 1 from public.memberships m where m.id = m7 and m.end_date = date '2031-02-27'), coalesce(m7::text, ''));
    perform pg_temp.rec('E3 annual from Feb 29 (a leap day) ends Feb 27 of the next year; 14 Custom months from Jan 1 end Feb 28',
      exists (select 1 from public.memberships m where m.id = m8 and m.end_date = date '2033-02-27')
      and exists (select 1 from public.memberships m where m.id = m9 and m.end_date = date '2031-02-28'), coalesce(m8::text, '') || ' ' || coalesce(m9::text, ''));

    -- D. Refusals --------------------------------------------------------------------------------------------------------------
    v_n := (select count(*) from public.memberships where student_id in (s10, s11, s12));
    v_s := pg_temp.buy(v_admin, s10, p_big, 'monthly', null, v_today, null, 'fixed', '10.01', 'special_approval', null, null, null, null, null);
    v_c := pg_temp.buy(v_admin, s10, p_big, 'monthly', null, v_today, null, 'fixed', '10', 'special_approval', null, null, null, null, null);
    perform pg_temp.rec('D1 an individual discount above the fee, or one that leaves a final fee of 0, is refused (22023)',
      v_s = 'ERR:22023' and v_c = 'ERR:22023', v_s || ' ' || v_c);
    v_s := pg_temp.buy(v_admin, s11, p_big, 'quarterly', null, v_today, null, null, null, null, null, null, null, null, null);
    perform pg_temp.rec('D2 a package discount (100) above the standard fee (30) is refused (22023)', v_s = 'ERR:22023', v_s);
    v_s := pg_temp.buy(v_admin, s12, p_big, 'monthly', null, v_today, null, 'bonus', '5', 'special_approval', null, null, null, null, null);
    v_c := pg_temp.buy(v_admin, s12, p_big, 'monthly', null, v_today, null, 'percent', '5', 'other', null, null, null, null, null);
    perform pg_temp.rec('D3 an unknown discount type, or "other" without an explanation, is refused (22023); nothing is created',
      v_s = 'ERR:22023' and v_c = 'ERR:22023'
      and (select count(*) from public.memberships where student_id in (s10, s11, s12)) = v_n, v_s || ' ' || v_c);

    -- F. Fee resolution by start date ---------------------------------------------------------------------------------------------
    m10 := pg_temp.as_uuid(pg_temp.buy(v_admin, s13, p_dur, 'monthly', null, v_today - 50, null, null, null, null, null, null, null, null, null));
    perform pg_temp.rec('F1 a start date before the newer entry takes effect is priced from the OLDER entry (1000, not 1500)',
      exists (select 1 from public.memberships m where m.id = m10 and m.fee_entry_id = e_old and m.amount = 1000), coalesce(m10::text, ''));
    v_s := pg_temp.buy(v_admin, s14, p_dur, 'monthly', null, v_today - 200, null, null, null, null, null, null, null, null, null);
    perform pg_temp.rec('F2 a start date before any fee is refused (55000), pointing to a Custom Fee Plan', v_s = 'ERR:55000', v_s);
    v_s := pg_temp.buy(v_admin, s14, p_cur, 'monthly', null, v_today, null, null, null, null, null, null, null, null, null);
    perform pg_temp.rec('F3 a fee in another currency is never converted and never falls back to an older entry (55000)', v_s = 'ERR:55000', v_s);

    -- C. Custom Fee Plan -------------------------------------------------------------------------------------------------------------
    v_s := pg_temp.buy(v_admin, s14, p_dur, 'monthly', null, v_today - 200, null, null, null, null, null, 'custom_fee_plan', '1234.50', 'Founding member price', 'true');
    m_leg := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('C1 a confirmed Custom Fee Plan creates the membership at the agreed fee, with no fee entry, the reason, the Admin and the time recorded (also where no standard fee applies)',
      exists (select 1 from public.memberships m where m.id = m_leg and m.amount = 1234.50 and m.pricing_mode = 'custom_fee_plan' and m.fee_entry_id is null
        and m.standard_fee is null and m.package_discount is null and m.individual_discount_amount is null and m.custom_fee_reason = 'Founding member price'
        and m.custom_fee_confirmed_by = v_admin and m.custom_fee_confirmed_at is not null and m.package_id = p_dur and m.currency = v_currency), v_s);
    v_n := (select count(*) from public.memberships where student_id = s12);
    v_s := pg_temp.buy(v_admin, s12, p_dur, 'monthly', null, v_today + 400, null, null, null, null, null, 'custom_fee_plan', '900', 'Special price', 'false');
    v_c := pg_temp.buy(v_admin, s12, p_dur, 'monthly', null, v_today + 400, null, null, null, null, null, 'custom_fee_plan', '900', null, 'true');
    perform pg_temp.rec('C2 a Custom Fee Plan without the explicit confirmation, or without a reason, is refused (22023)',
      v_s = 'ERR:22023' and v_c = 'ERR:22023' and (select count(*) from public.memberships where student_id = s12) = v_n, v_s || ' ' || v_c);
    v_s := pg_temp.buy(v_admin, s12, p_dur, 'monthly', null, v_today + 400, null, 'percent', '5', 'special_approval', null, 'custom_fee_plan', '900', 'Special price', 'true');
    v_c := pg_temp.buy(v_admin, s12, p_dur, 'monthly', null, v_today + 400, null, null, null, null, null, 'custom_fee_plan', '0', 'Special price', 'true');
    perform pg_temp.rec('C3 a Custom Fee Plan takes no discount (22023) and a custom fee must be greater than 0 (22023)', v_s = 'ERR:22023' and v_c = 'ERR:22023', v_s || ' ' || v_c);

    -- G. Guards ----------------------------------------------------------------------------------------------------------------------
    v_c := pg_temp.code(format($q$insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency, package_id, package_name, pricing_mode, custom_fee_reason, custom_fee_confirmed_at)
                                  values (%L, 'monthly', 'duration', %L, %L, 100, %L, %L, 'x', 'custom_fee_plan', 'abc', now())$q$, s12, v_today + 900, v_today + 929, v_currency, p_dur));
    perform pg_temp.rec('G1 a package-linked membership cannot be inserted directly, even as the owner (55006)', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.memberships set amount = amount - 1 where id = %L$q$, m1));
    v_s := pg_temp.code(format($q$update public.memberships set package_name = 'Renamed', end_date = end_date + 1 where id = %L$q$, m1));
    perform pg_temp.rec('G2 the amount, package snapshot and dates of a package membership cannot be edited (55006)', v_c in ('55006', '23514') and v_s = '55006'
      and exists (select 1 from public.memberships m where m.id = m1 and m.amount = 3780 and m.package_name = 'ZZVERIFY 0048 Duration'), v_c || ' ' || v_s);

    insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency)
    values (s12, 'monthly', 'duration', v_today + 1000, v_today + 1029, 900, v_currency) returning id into m_leg;
    v_c := pg_temp.code(format($q$update public.memberships set package_id = %L where id = %L$q$, p_dur, m_leg));
    v_s := pg_temp.code(format($q$update public.memberships set notes = 'edited' where id = %L$q$, m1));
    perform pg_temp.rec('G3 an existing membership cannot be linked to a package (55006), while notes of a package membership can still change',
      v_c = '55006' and v_s = 'OK', v_c || ' ' || v_s);
    v_c := pg_temp.code(format($q$insert into public.invoices (membership_id) values (%L)$q$, m1));
    perform pg_temp.rec('G4 a membership-level document is refused for a package membership (55006)', v_c = '55006', v_c);

    -- X. Fee conflicts -----------------------------------------------------------------------------------------------------------------
    -- m1 and others were priced from e_new; m10 from e_old. Cancelling e_new would change what applies to their start dates.
    v_c := pg_temp.checked(v_admin, format($q$select public.cancel_fee_entry(%L, 'Entered by mistake')$q$, e_new));
    perform pg_temp.rec('X1 cancelling a fee entry that existing memberships were priced from is refused (55006); the entry stays',
      v_c = '55006' and exists (select 1 from public.package_fee_entries e where e.id = e_new and e.cancelled_at is null), v_c);
    v_s := pg_temp.scalar_as(v_admin, format($q$select count(*)::text from public.package_fee_conflicts(%L)$q$, p_dur));
    v_cnt := (select count(*) from public.memberships m where m.package_id = p_dur and m.fee_entry_id = e_new and m.cancelled_at is null);
    perform pg_temp.rec('X1b the screens can list the affected memberships (package_fee_conflicts) once a change is pending; none is pending now', v_s = '0', v_s || ' (memberships priced from it: ' || v_cnt || ')');

    v_c := pg_temp.checked(v_admin, format($q$select public.correct_fee_entry(%L, 1550, %L::jsonb, 'Typing error in the price')$q$, e_new,
      '[{"option":"quarterly","type":"fixed","value":"300"},{"option":"half_yearly","type":"percent","value":"10"},{"option":"annual","type":"fixed","value":"1200"}]'));
    perform pg_temp.rec('X2 correcting that entry (same effective date) is allowed, and no existing membership is repriced',
      v_c = 'OK' and exists (select 1 from public.memberships m where m.id = m1 and m.amount = 3780 and m.fee_entry_id = e_new and m.standard_fee = 4500), v_c);

    v_c := pg_temp.checked(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1100, null, null)$q$, p_dur, v_today - 60));
    perform pg_temp.rec('X3 scheduling an entry dated before an existing membership''s start, after the entry it used, is refused (55006)',
      v_c = '55006' and not exists (select 1 from public.package_fee_entries e where e.package_id = p_dur and e.effective_from = v_today - 60), v_c);

    v_c := pg_temp.checked(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1800, null, null)$q$, p_dur, v_today + 5000));
    perform pg_temp.rec('X4 an entry that takes effect after every existing membership''s start is allowed', v_c = 'OK', v_c);

    -- K. Class-count package ---------------------------------------------------------------------------------------------------
    s15 := pg_temp.student('15'); s16 := pg_temp.student('16'); s17 := pg_temp.student('17');
    mc1 := pg_temp.as_uuid(pg_temp.buy(v_admin, s15, p_cls, null, null, v_today, null, null, null, null, null, null, null, null, null));
    perform pg_temp.rec('K1 a class-count membership with no expiry: the allowance and price of the package, no duration, no end date',
      exists (select 1 from public.memberships m where m.id = mc1 and m.kind = 'class_count' and m.plan = 'class_count' and m.total_classes = 8
        and m.end_date is null and m.amount = 2000 and m.standard_fee = 2000 and m.package_discount is null and m.duration_months is null
        and m.fee_entry_id = e_cls and m.pricing_mode = 'standard' and m.package_id = p_cls and m.currency = v_currency), coalesce(mc1::text, ''));
    mc2 := pg_temp.as_uuid(pg_temp.buy(v_admin, s15, p_cls, null, null, v_today, quote_literal((v_today + 90)::text), 'percent', '10', 'returning_member', null, null, null, null, null));
    perform pg_temp.rec('K2 a second class-count membership for the same student with an expiry date and a 10% individual discount (2000 - 200 = 1800)',
      exists (select 1 from public.memberships m where m.id = mc2 and m.end_date = v_today + 90 and m.amount = 1800 and m.individual_discount_amount = 200
        and m.package_discount is null), coalesce(mc2::text, ''));
    v_n := (select count(*) from public.memberships where student_id in (s16, s17));
    v_s := pg_temp.buy(v_admin, s16, p_cls, 'monthly', null, v_today, null, null, null, null, null, null, null, null, null);
    v_c := pg_temp.buy(v_admin, s16, p_cls, null, '3', v_today, null, null, null, null, null, null, null, null, null);
    perform pg_temp.rec('K3 a duration option or months on a class-count package, an expiry before the start, and an end date on a duration package are refused (22023); nothing is created',
      v_s = 'ERR:22023' and v_c = 'ERR:22023'
      and pg_temp.buy(v_admin, s16, p_cls, null, null, v_today, quote_literal((v_today - 1)::text), null, null, null, null, null, null, null, null) = 'ERR:22023'
      and pg_temp.buy(v_admin, s17, p_dur, 'monthly', null, v_today, quote_literal((v_today + 30)::text), null, null, null, null, null, null, null, null) = 'ERR:22023'
      and (select count(*) from public.memberships where student_id in (s16, s17)) = v_n, v_s || ' ' || v_c);

    -- U. An ordinary edit of a legacy membership (m_leg is the legacy one inserted in G3) -----------------------------------------------
    v_c := pg_temp.as_user(v_admin, format($q$update public.memberships set amount = 950, end_date = end_date + 1, notes = 'legacy edit' where id = %L$q$, m_leg));
    perform pg_temp.rec('U1 an Admin can still edit a legacy membership (amount, end date, notes): the package guard does not touch it',
      v_c = 'OK' and exists (select 1 from public.memberships m where m.id = m_leg and m.amount = 950 and m.notes = 'legacy edit'
        and m.end_date = v_today + 1030 and m.package_id is null), v_c);

    -- Q. Payments and per-payment documents on a package membership (m2: half yearly, final fee 8000) -----------------------------------
    select * into v_set from public.invoice_settings where singleton;
    if v_set.starting_invoice_number is null then
      perform pg_temp.code('update public.invoice_settings set starting_invoice_number = 990001 where singleton');
    end if;
    if v_set.payment_receipt_starting_number is null then
      perform pg_temp.code('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton');
    end if;
    v_pay1 := pg_temp.pay(v_admin, m2, v_today, '[{"method":"cash","amount":"3000"}]', 'true');
    perform pg_temp.rec('Q1 a first payment of 3000 on the package membership is recorded and the status follows it (partially paid)',
      pg_temp.as_uuid(v_pay1) is not null and exists (select 1 from public.memberships m where m.id = m2 and m.payment_status = 'partially_paid' and m.amount = 8000), v_pay1);
    v_s := pg_temp.pay(v_admin, m2, v_today, '[{"method":"cash","amount":"5000.01"}]', 'false');
    v_pay2 := pg_temp.pay(v_admin, m2, v_today, '[{"method":"upi","amount":"5000","reference_id":"ZZ-0048"}]', 'false');
    perform pg_temp.rec('Q2 a payment above the outstanding balance is refused (22023); the final 5000 makes the membership paid',
      v_s = 'ERR:22023' and pg_temp.as_uuid(v_pay2) is not null
      and exists (select 1 from public.memberships m where m.id = m2 and m.payment_status = 'paid'), v_s || ' ' || coalesce(v_pay2, ''));
    v_c := pg_temp.issue(v_admin, v_pay1);
    v_s := pg_temp.issue(v_admin, v_pay2);
    perform pg_temp.rec('Q3 each payment has its own document (tax invoice series and receipt series, each for its own amount), and no membership-level document exists',
      v_c = 'OK' and v_s = 'OK'
      and exists (select 1 from public.invoices i where i.payment_id = pg_temp.as_uuid(v_pay1) and i.membership_id = m2 and i.document_series = 'invoice' and i.total_amount = 3000)
      and exists (select 1 from public.invoices i where i.payment_id = pg_temp.as_uuid(v_pay2) and i.membership_id = m2 and i.document_series = 'payment_receipt' and i.total_amount = 5000)
      and not exists (select 1 from public.invoices i where i.membership_id = m2 and i.payment_id is null), v_c || ' ' || v_s);
    perform pg_temp.rec('Q4 the package, fee, discounts and amount are untouched by the payments and documents',
      exists (select 1 from public.memberships m where m.id = m2 and m.package_id = p_dur and m.fee_entry_id = e_new and m.standard_fee = 9000
        and m.package_discount = 900 and m.individual_discount_amount = 100 and m.amount = 8000 and m.package_name = 'ZZVERIFY 0048 Duration'), '');

    -- L. Deactivated package; legacy rows unchanged ---------------------------------------------------------------------------------------
    v_s := pg_temp.buy(v_admin, s12, p_off, 'monthly', null, v_today, null, null, null, null, null, null, null, null, null);
    perform pg_temp.rec('L1 a deactivated package cannot be chosen for a new membership (55006)', v_s = 'ERR:55006', v_s);
    update _legacy_hash set after_hash = (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) from public.memberships m where m.id in (select id from _legacy_ids));
    perform pg_temp.rec('L2 every membership that existed before this script is byte-for-byte unchanged (all package columns NULL)',
      (select before_hash = after_hash from _legacy_hash)
      and not exists (select 1 from public.memberships m where m.id in (select id from _legacy_ids) and (m.package_id is not null or m.pricing_mode is not null)), '');
  end if;
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.packages where position('ZZVERIFY 0048' in name) = 1) as leftover_packages,
--          (select count(*) from public.students where position('ZZVERIFY 0048' in full_name) = 1) as leftover_students;
-- Both must be 0.
