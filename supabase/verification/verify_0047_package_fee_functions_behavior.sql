-- ===========================================================================
-- Migration 0047 verification (behaviour) - package and fee functions (V1 Fee Structure, FS-3)
-- Exercises supabase/migrations/0047_package_fee_functions.sql
-- ===========================================================================
--
-- It calls every function AS AN ADMIN (it never writes a package table directly) and checks the FS-3 acceptance criteria of
-- docs/04-development-plan.md: each change writes exactly one audit event for the Admin, in the same transaction; a failed
-- change leaves no event and no change; a correction cancels the old entry before it appends the linked replacement; a
-- cancellation is stamped with the transaction time and says truthfully whether the fee was in effect; the currency is the
-- centre's; the reasons are enforced; and every cancelled or corrected entry has its event.
--
-- WHAT IT CHECKS
--   P0  Migration 0047 is applied (the eight functions). If not, every other check is skipped (NOT TESTED).
--   P1  Preflight: no package already has a fixture name (ZZVERIFY 0047 ...). If one does, P1 FAILS and nothing is created.
--   F   Access: anon and the helper functions are refused; an Instructor is refused (reported NOT TESTED without one).
--   C   create_package: duration and class-count; the invalid ones are refused with no event on failure.
--   D   update_package_details: a rename writes one event; no change writes none.
--   T   update_package_terms: class allowance and options (at least one for a duration package); no change, no event.
--   S   set_package_status: deactivate and reactivate, one event each; no change, no event.
--   E   schedule_fee_entry: the entry, its discounts, the centre currency, one event; the refusals.
--   X   edit_fee_entry: a scheduled fee only, to a date after today; no change, no event.
--   K   cancel_fee_entry: stamped now(), in_effect truthful, a reason when in effect.
--   Y   correct_fee_entry: reason required, cancel-then-append, one fee_corrected event, no-change refused, a chain.
--   AU  Audit scan: every cancelled entry and every correction has its event; every event names the Admin.
--
-- PREREQUISITES
--   * Migrations 0046 and 0047 applied. If 0047 is NOT, P0 fails and every scenario is skipped.
--   * An Admin profile. An Instructor profile is needed for F3 (reported NOT TESTED without one).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable fixtures only: packages named 'ZZVERIFY 0047 ...' and what the functions create for them. The package
--     tables are append-only, so the rollback is the only clean-up: never run this in a session with autocommit.
--
-- LIMITATIONS
--   * The functions cannot be called concurrently from one transaction: locking is checked in the SQL text by the unit tests,
--     not here. Fee-conflict detection is FS-5 and is not tested.
--   * Only what the functions do is tested: an ad-hoc statement that bypasses them can still leave no event (0046's AUDIT
--     LIMITATION); the scan AU only covers the rows these functions made.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED, INFO.
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

-- Run one scalar query as an authenticated user; return its text, or 'ERR:<sqlstate>'.
create function pg_temp.as_user_scalar(p_user uuid, p_sql text)
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

-- Run one statement as an authenticated user; return 'OK' or the SQLSTATE.
create function pg_temp.as_user_do(p_user uuid, p_sql text)
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

-- Run one statement as the anonymous role; return 'OK' or the SQLSTATE.
create function pg_temp.as_anon_do(p_sql text)
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

-- A uuid from text, or NULL when the text is not one (for example 'ERR:23505').
create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- How many audit events a package has, of one type or of any.
create function pg_temp.events(p_package uuid, p_type text default null)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.package_events e
  where e.package_id = p_package and (p_type is null or e.event_type = p_type);
  return v_count;
end $f$;

-- How many fee entries a package has.
create function pg_temp.entries(p_package uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.package_fee_entries e where e.package_id = p_package;
  return v_count;
end $f$;

do $$
declare
  v_admin    uuid;
  v_instr    uuid;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_ready    boolean;
  v_clash    integer := 0;
  v_s        text;
  v_c        text;
  v_n        integer;
  v_n2       integer;
  v_currency text;
  p_dur uuid; p_cls uuid;
  e_f1 uuid; e_f2 uuid; e_cls uuid; e_i1 uuid; e_i2 uuid; e_i3 uuid; e_new uuid; e_new2 uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr from public.profiles where role = 'instructor' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;

  -- P0. Is 0047 applied? ---------------------------------------------------------------------------------------------
  v_ready := (select bool_and(to_regprocedure(x) is not null) from unnest(array[
      'public.create_package(text, text, text, integer, text[])',
      'public.update_package_details(uuid, text, text)',
      'public.update_package_terms(uuid, integer, text[], text)',
      'public.set_package_status(uuid, text, text)',
      'public.schedule_fee_entry(uuid, date, numeric, jsonb, text)',
      'public.edit_fee_entry(uuid, date, numeric, jsonb, text)',
      'public.cancel_fee_entry(uuid, text)',
      'public.correct_fee_entry(uuid, numeric, jsonb, text)']) x);
  perform pg_temp.rec('P0 migration 0047 is applied (the eight package and fee functions)',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0046 and 0047 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if v_ready then
    select count(*) into v_clash from public.packages where position('ZZVERIFY 0047' in name) = 1;
    perform pg_temp.rec('P1 no package already has a fixture name (ZZVERIFY 0047 ...) - this run creates its own',
      v_clash = 0, case when v_clash = 0 then '' else v_clash || ' existing package(s) clash - nothing was created; rename them and run again' end);
  end if;

  if not v_ready then
    perform pg_temp.skip('F / C / D / T / S / E / X / K / Y / AU', 'migration 0047 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('F / C / D / T / S / E / X / K / Y / AU', 'preflight P1 failed: a fixture name already belongs to a package');
  elsif v_admin is null or v_currency is null then
    perform pg_temp.skip('F / C / D / T / S / E / X / K / Y / AU', 'needs an Admin profile and the centre profile');
  else
    -- F. Access -------------------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_anon_do($q$select public.create_package('ZZVERIFY 0047 Anon', null, 'class_count', 5, null)$q$);
    perform pg_temp.rec('F1 anon cannot call a package function', v_c = '42501', v_c);
    v_c := pg_temp.as_user_do(v_admin, $q$select public.package_log_event(gen_random_uuid(), null, 'package_created', null, null, '{}'::jsonb)$q$);
    perform pg_temp.rec('F2 the helper functions are callable by no client role, not even an Admin', v_c = '42501', v_c);
    if v_instr is null then
      perform pg_temp.skip('F3 an Instructor is refused', 'needs an Instructor profile (none exists)');
    else
      v_c := pg_temp.as_user_do(v_instr, $q$select public.create_package('ZZVERIFY 0047 Instructor', null, 'class_count', 5, null)$q$);
      perform pg_temp.rec('F3 an Instructor is refused (Not authorized, 42501) and nothing is created', v_c = '42501'
        and not exists (select 1 from public.packages where name = 'ZZVERIFY 0047 Instructor'), v_c);
    end if;

    -- C. create_package -----------------------------------------------------------------------------------------------------
    v_s := pg_temp.as_user_scalar(v_admin, $q$select public.create_package('ZZVERIFY 0047 Duration', 'A duration package', 'duration', null, '{monthly,quarterly,annual}'::text[])::text$q$);
    p_dur := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('C1 a duration package is created with its three options and exactly one package_created event for the Admin',
      p_dur is not null
      and pg_temp.events(p_dur) = 1 and pg_temp.events(p_dur, 'package_created') = 1
      and (select count(*) = 3 from public.package_duration_options where package_id = p_dur)
      and exists (select 1 from public.package_events e where e.package_id = p_dur and e.actor = v_admin and e.before_state is null
                    and e.after_state ->> 'name' = 'ZZVERIFY 0047 Duration'), coalesce(v_s, ''));

    v_s := pg_temp.as_user_scalar(v_admin, $q$select public.create_package('ZZVERIFY 0047 Classes', null, 'class_count', 8, null)::text$q$);
    p_cls := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('C2 a class-count package is created with its class allowance, no options and one event',
      p_cls is not null and pg_temp.events(p_cls, 'package_created') = 1
      and exists (select 1 from public.packages p where p.id = p_cls and p.total_classes = 8 and p.status = 'active')
      and not exists (select 1 from public.package_duration_options where package_id = p_cls), coalesce(v_s, ''));

    v_n := (select count(*) from public.package_events where position('ZZVERIFY 0047' in coalesce(after_state ->> 'name', '')) = 1);
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('zzverify 0047 DURATION', null, 'class_count', 3, null)$q$);
    v_s := v_c;
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('ZZVERIFY 0047 Bad1', null, 'duration', null, null)$q$);
    v_s := v_s || ' ' || v_c;
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('ZZVERIFY 0047 Bad2', null, 'duration', 5, '{monthly}'::text[])$q$);
    v_s := v_s || ' ' || v_c;
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('ZZVERIFY 0047 Bad3', null, 'class_count', null, null)$q$);
    v_s := v_s || ' ' || v_c;
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('ZZVERIFY 0047 Bad4', null, 'class_count', 5, '{monthly}'::text[])$q$);
    v_s := v_s || ' ' || v_c;
    v_c := pg_temp.as_user_do(v_admin, $q$select public.create_package('ZZVERIFY 0047 Bad5', null, 'duration', null, '{weekly}'::text[])$q$);
    v_s := v_s || ' ' || v_c;
    perform pg_temp.rec('C3 an invalid package is refused with the right error code (a name differing only by case 23505; the rest 22023) and there is no event on failure',
      v_s = '23505 22023 22023 22023 22023 22023'
      and (select count(*) from public.package_events where position('ZZVERIFY 0047' in coalesce(after_state ->> 'name', '')) = 1) = v_n
      and not exists (select 1 from public.packages where position('ZZVERIFY 0047 Bad' in name) = 1), v_s);

    -- D. update_package_details ---------------------------------------------------------------------------------------------
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.update_package_details(%L, 'ZZVERIFY 0047 Duration Plus', 'Edited')$q$, p_dur));
    perform pg_temp.rec('D1 a rename writes exactly one details_updated event holding the name before and after',
      v_c = 'OK' and pg_temp.events(p_dur, 'details_updated') = 1
      and exists (select 1 from public.packages p where p.id = p_dur and p.name = 'ZZVERIFY 0047 Duration Plus')
      and exists (select 1 from public.package_events e where e.package_id = p_dur and e.event_type = 'details_updated'
                    and e.before_state ->> 'name' = 'ZZVERIFY 0047 Duration' and e.after_state ->> 'name' = 'ZZVERIFY 0047 Duration Plus'), v_c);
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.update_package_details(%L, 'ZZVERIFY 0047 Duration Plus', 'Edited')$q$, p_dur));
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.update_package_details(%L, '  ', null)$q$, p_dur));
    perform pg_temp.rec('D2 saving the same details writes no event; a blank name is refused (22023) with no event on failure',
      v_c = 'OK' and v_s = '22023' and pg_temp.events(p_dur) = v_n, v_c || ' ' || v_s);

    -- T. update_package_terms -----------------------------------------------------------------------------------------------
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, 12, null, 'More classes')$q$, p_cls));
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, null, '{monthly,annual}'::text[], null)$q$, p_dur));
    perform pg_temp.rec('T1 the class allowance and the offered options change, one terms_updated event each, with the optional reason and the before and after',
      v_c = 'OK' and v_s = 'OK'
      and exists (select 1 from public.packages p where p.id = p_cls and p.total_classes = 12)
      and pg_temp.events(p_cls, 'terms_updated') = 1 and pg_temp.events(p_dur, 'terms_updated') = 1
      and exists (select 1 from public.package_events e where e.package_id = p_cls and e.event_type = 'terms_updated' and e.reason = 'More classes'
                    and (e.before_state ->> 'total_classes')::int = 8 and (e.after_state ->> 'total_classes')::int = 12)
      and (select array_agg(o.duration_option order by o.duration_option) from public.package_duration_options o where o.package_id = p_dur) = array['annual', 'monthly']::text[]
      and jsonb_array_length((select e.before_state -> 'options' from public.package_events e where e.package_id = p_dur and e.event_type = 'terms_updated')) = 3,
      v_c || ' ' || v_s);
    v_n := pg_temp.events(p_dur) + pg_temp.events(p_cls);
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, null, '{}'::text[], null)$q$, p_dur));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, 0, null, null)$q$, p_cls));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, 5, null, null)$q$, p_dur));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, null, '{monthly}'::text[], null)$q$, p_cls));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, 12, null, null)$q$, p_cls));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.update_package_terms(%L, null, '{annual,monthly}'::text[], null)$q$, p_dur));
    perform pg_temp.rec('T2 a duration package keeps at least one option and the other invalid terms are refused (22023); unchanged terms write no event; no event on failure',
      v_s = '22023 22023 22023 22023 OK OK' and pg_temp.events(p_dur) + pg_temp.events(p_cls) = v_n
      and (select count(*) = 2 from public.package_duration_options where package_id = p_dur), v_s);

    -- S. set_package_status ---------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.set_package_status(%L, 'inactive', 'No longer offered')$q$, p_dur));
    perform pg_temp.rec('S1 deactivating a package writes one package_deactivated event with the reason, and keeps the package',
      v_c = 'OK' and pg_temp.events(p_dur, 'package_deactivated') = 1
      and exists (select 1 from public.packages p where p.id = p_dur and p.status = 'inactive')
      and exists (select 1 from public.package_events e where e.package_id = p_dur and e.event_type = 'package_deactivated' and e.reason = 'No longer offered'), v_c);
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.set_package_status(%L, 'inactive', null)$q$, p_dur));
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.set_package_status(%L, 'paused', null)$q$, p_dur));
    v_n2 := pg_temp.events(p_dur);
    v_c := v_c || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.set_package_status(%L, 'active', null)$q$, p_dur));
    perform pg_temp.rec('S2 the same status writes no event, an unknown status is refused (22023), and reactivating writes one package_activated event',
      v_c = 'OK OK' and v_s = '22023' and v_n2 = v_n and pg_temp.events(p_dur, 'package_activated') = 1
      and exists (select 1 from public.packages p where p.id = p_dur and p.status = 'active'), v_c || ' ' || v_s);

    -- E. schedule_fee_entry ---------------------------------------------------------------------------------------------------
    v_s := pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1500, %L::jsonb, null)::text$q$, p_dur, v_today + 30,
      '[{"option":"quarterly","type":"fixed","value":"300"},{"option":"half_yearly","type":"percent","value":"10"}]'));
    e_f1 := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('E1 a duration fee is scheduled with its discounts in the centre currency, created by the Admin, with exactly one fee_scheduled event',
      e_f1 is not null
      and exists (select 1 from public.package_fee_entries e where e.id = e_f1 and e.monthly_fee = 1500 and e.price is null
                    and e.currency = v_currency and e.created_by = v_admin and e.cancelled_at is null and e.effective_from = v_today + 30)
      and (select count(*) = 2 from public.package_fee_entry_discounts where entry_id = e_f1)
      and exists (select 1 from public.package_fee_entry_discounts d where d.entry_id = e_f1 and d.duration_option = 'quarterly' and d.discount_type = 'fixed' and d.fixed_amount = 300)
      and exists (select 1 from public.package_fee_entry_discounts d where d.entry_id = e_f1 and d.duration_option = 'half_yearly' and d.discount_type = 'percent' and d.percent_value = 10)
      and pg_temp.events(p_dur, 'fee_scheduled') = 1
      and exists (select 1 from public.package_events ev where ev.package_id = p_dur and ev.event_type = 'fee_scheduled' and ev.fee_entry_id = e_f1
                    and ev.before_state is null and ev.actor = v_admin and ev.after_state ->> 'currency' = v_currency
                    and jsonb_array_length(ev.after_state -> 'discounts') = 2), coalesce(v_s, ''));

    v_s := pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 2500, null, null)::text$q$, p_cls, v_today + 30));
    e_cls := pg_temp.as_uuid(v_s);
    v_n := pg_temp.events(p_cls);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 2500, %L::jsonb, null)$q$, p_cls, v_today + 31,
      '[{"option":"annual","type":"fixed","value":"100"}]'));
    perform pg_temp.rec('E2 a class-count fee is a price (no monthly fee); a package discount on it is refused (22023) with no event on failure',
      e_cls is not null
      and exists (select 1 from public.package_fee_entries e where e.id = e_cls and e.price = 2500 and e.monthly_fee is null and e.currency = v_currency)
      and v_c = '22023' and pg_temp.events(p_cls) = v_n and pg_temp.entries(p_cls) = 1, coalesce(v_s, '') || ' ' || v_c);

    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1400, null, null)$q$, p_dur, v_today + 30));
    perform pg_temp.rec('E3 a second fee on the same date is refused (23505) with no event on failure',
      v_c = '23505' and pg_temp.events(p_dur) = v_n and pg_temp.entries(p_dur) = 1, v_c);

    v_s := pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 0, null, null)$q$, p_dur, v_today + 50));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10.005, null, null)$q$, p_dur, v_today + 50));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, null, 10, null, null)$q$, p_dur));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10, %L::jsonb, null)$q$, p_dur, v_today + 50,
      '[{"option":"monthly","type":"fixed","value":"5"}]'));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10, %L::jsonb, null)$q$, p_dur, v_today + 50,
      '[{"option":"annual","type":"fixed","value":"5"},{"option":"annual","type":"percent","value":"5"}]'));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10, %L::jsonb, null)$q$, p_dur, v_today + 50,
      '[{"option":"annual","type":"percent","value":"100.01"}]'));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 10, %L::jsonb, null)$q$, p_dur, v_today + 50,
      '[{"option":"annual","type":"fixed","value":"0"}]'));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.schedule_fee_entry(gen_random_uuid(), %L::date, 10, null, null)$q$, v_today + 50));
    perform pg_temp.rec('E4 an amount of 0 or with three decimals, no date, a Monthly or duplicate or out-of-range discount are refused (22023), an unknown package P0002, and none leaves an entry or an event',
      v_s = '22023 22023 22023 22023 22023 22023 22023 P0002' and pg_temp.entries(p_dur) = 1 and pg_temp.events(p_dur) = v_n, v_s);

    -- Fees in effect for the cancel and correct scenarios (scheduling a past date takes effect at once).
    e_f2 := pg_temp.as_uuid(pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1450, null, null)::text$q$, p_dur, v_today + 40)));
    e_i1 := pg_temp.as_uuid(pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1000, null, null)::text$q$, p_dur, v_today - 10)));
    e_i2 := pg_temp.as_uuid(pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1100, null, 'Opening price')::text$q$, p_dur, v_today - 20)));
    e_i3 := pg_temp.as_uuid(pg_temp.as_user_scalar(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1200, null, null)::text$q$, p_dur, v_today - 30)));
    perform pg_temp.rec('E5 a fee dated today or earlier is accepted and is in effect at once (its event says so)',
      e_f2 is not null and e_i1 is not null and e_i2 is not null and e_i3 is not null
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_i1 and ev.event_type = 'fee_scheduled' and (ev.after_state ->> 'in_effect')::boolean)
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_f2 and ev.event_type = 'fee_scheduled' and not (ev.after_state ->> 'in_effect')::boolean)
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_i2 and ev.reason = 'Opening price'), '');

    -- X. edit_fee_entry -------------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1550, %L::jsonb, 'Revised price list')$q$, e_f1, v_today + 31,
      '[{"option":"annual","type":"percent","value":"15"}]'));
    perform pg_temp.rec('X1 a scheduled fee is edited (date, amount, discounts replaced) with exactly one fee_edited event holding before and after',
      v_c = 'OK'
      and exists (select 1 from public.package_fee_entries e where e.id = e_f1 and e.monthly_fee = 1550 and e.effective_from = v_today + 31 and e.currency = v_currency)
      and (select count(*) = 1 from public.package_fee_entry_discounts where entry_id = e_f1)
      and exists (select 1 from public.package_fee_entry_discounts d where d.entry_id = e_f1 and d.duration_option = 'annual' and d.percent_value = 15)
      and pg_temp.events(p_dur, 'fee_edited') = 1
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_f1 and ev.event_type = 'fee_edited' and ev.reason = 'Revised price list'
                    and (ev.before_state ->> 'monthly_fee')::numeric = 1500 and (ev.after_state ->> 'monthly_fee')::numeric = 1550), v_c);
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1550, %L::jsonb, null)$q$, e_f1, v_today + 31,
      '[{"option":"annual","type":"percent","value":"15"}]'));
    perform pg_temp.rec('X2 saving an unchanged scheduled fee writes no event', v_c = 'OK' and pg_temp.events(p_dur) = v_n and pg_temp.events(p_dur, 'fee_edited') = 1, v_c);
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1600, null, null)$q$, e_f1, v_today));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1600, null, null)$q$, e_f1, v_today - 3));
    v_s := v_s || ' ' || pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 0, null, null)$q$, e_f1, v_today + 31));
    perform pg_temp.rec('X3 an edit to today or a past date, or to an invalid amount, is refused (22023), the fee is unchanged and there is no event on failure',
      v_s = '22023 22023 22023' and pg_temp.events(p_dur) = v_n
      and exists (select 1 from public.package_fee_entries e where e.id = e_f1 and e.monthly_fee = 1550 and e.effective_from = v_today + 31), v_s);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1111, null, null)$q$, e_i1, v_today + 60));
    perform pg_temp.rec('X4 a fee in effect cannot be edited (55006; it is corrected instead) and nothing changes',
      v_c = '55006' and pg_temp.events(p_dur) = v_n
      and exists (select 1 from public.package_fee_entries e where e.id = e_i1 and e.monthly_fee = 1000), v_c);

    -- K. cancel_fee_entry -------------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.cancel_fee_entry(%L, null)$q$, e_f2));
    perform pg_temp.rec('K1 a scheduled fee is cancelled without a reason: stamped with the transaction time, one fee_cancelled event saying it was not in effect',
      v_c = 'OK'
      and exists (select 1 from public.package_fee_entries e where e.id = e_f2 and e.cancelled_at = now() and e.cancelled_by = v_admin)
      and pg_temp.events(p_dur, 'fee_cancelled') = 1
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_f2 and ev.event_type = 'fee_cancelled' and ev.reason is null
                    and ev.after_state is null and ev.before_state ->> 'in_effect' = 'false' and ev.actor = v_admin), v_c);
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.cancel_fee_entry(%L, null)$q$, e_i1));
    perform pg_temp.rec('K2 cancelling a fee IN EFFECT without a reason is refused (22023): the fee stays and there is no event on failure',
      v_c = '22023' and pg_temp.events(p_dur) = v_n
      and exists (select 1 from public.package_fee_entries e where e.id = e_i1 and e.cancelled_at is null), v_c);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.cancel_fee_entry(%L, 'Entered by mistake')$q$, e_i1));
    perform pg_temp.rec('K3 cancelling a fee in effect with a reason works; its event says it was in effect and keeps the reason',
      v_c = 'OK'
      and exists (select 1 from public.package_fee_entries e where e.id = e_i1 and e.cancelled_at = now())
      and exists (select 1 from public.package_events ev where ev.fee_entry_id = e_i1 and ev.event_type = 'fee_cancelled' and ev.reason = 'Entered by mistake'
                    and ev.before_state ->> 'in_effect' = 'true'), v_c);
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.cancel_fee_entry(%L, 'Again')$q$, e_i1));
    perform pg_temp.rec('K4 a fee that is already cancelled cannot be cancelled again (55006); there is no event on failure', v_c = '55006' and pg_temp.events(p_dur) = v_n, v_c);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.edit_fee_entry(%L, %L::date, 1700, null, null)$q$, e_f2, v_today + 70));
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.correct_fee_entry(%L, 1700, null, 'Typing error')$q$, e_i1));
    perform pg_temp.rec('K5 a cancelled fee can be neither edited nor corrected (55006)', v_c = '55006' and v_s = '55006' and pg_temp.events(p_dur) = v_n, v_c || ' ' || v_s);

    -- Y. correct_fee_entry --------------------------------------------------------------------------------------------------------
    v_n := pg_temp.events(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.correct_fee_entry(%L, 1250, null, null)$q$, e_i2));
    v_s := pg_temp.as_user_do(v_admin, format($q$select public.correct_fee_entry(%L, 1250, null, 'ab')$q$, e_i2));
    perform pg_temp.rec('Y1 a correction without a reason (or with one that is too short) is refused (22023): the fee is untouched and there is no event on failure',
      v_c = '22023' and v_s = '22023' and pg_temp.events(p_dur) = v_n
      and exists (select 1 from public.package_fee_entries e where e.id = e_i2 and e.cancelled_at is null and e.monthly_fee = 1100), v_c || ' ' || v_s);

    v_s := pg_temp.as_user_scalar(v_admin, format($q$select public.correct_fee_entry(%L, 1250, %L::jsonb, 'Typing error in the opening price')::text$q$, e_i2,
      '[{"option":"quarterly","type":"fixed","value":"200"}]'));
    e_new := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('Y2 a correction cancels the fee in effect and appends the linked replacement (same package, date and currency; the new amount and discounts) with exactly ONE fee_corrected event and no fee_cancelled event',
      e_new is not null
      and exists (select 1 from public.package_fee_entries o where o.id = e_i2 and o.cancelled_at = now() and o.cancelled_by = v_admin and o.monthly_fee = 1100)
      and exists (select 1 from public.package_fee_entries n join public.package_fee_entries o on o.id = n.corrects_entry_id
                  where n.id = e_new and o.id = e_i2 and n.package_id = o.package_id and n.effective_from = o.effective_from and n.currency = o.currency
                    and n.monthly_fee = 1250 and n.cancelled_at is null and n.created_by = v_admin)
      and (select count(*) = 1 from public.package_fee_entry_discounts where entry_id = e_new)
      and exists (select 1 from public.package_fee_entry_discounts d where d.entry_id = e_new and d.duration_option = 'quarterly' and d.fixed_amount = 200)
      and pg_temp.events(p_dur) = v_n + 1
      and (select count(*) from public.package_events ev where ev.package_id = p_dur and ev.event_type = 'fee_corrected') = 1
      and exists (select 1 from public.package_events ev where ev.event_type = 'fee_corrected' and ev.fee_entry_id = e_new and ev.actor = v_admin
                    and ev.reason = 'Typing error in the opening price' and (ev.before_state ->> 'id')::uuid = e_i2 and (ev.after_state ->> 'id')::uuid = e_new
                    and (ev.after_state ->> 'corrects_entry_id')::uuid = e_i2)
      and not exists (select 1 from public.package_events ev where ev.fee_entry_id = e_i2 and ev.event_type = 'fee_cancelled'), coalesce(v_s, ''));

    v_n := pg_temp.events(p_dur);
    v_n2 := pg_temp.entries(p_dur);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.correct_fee_entry(%L, 1250, %L::jsonb, 'Same again')$q$, e_new,
      '[{"option":"quarterly","type":"fixed","value":"200"}]'));
    perform pg_temp.rec('Y3 a correction that changes neither the amount nor the discounts is refused (22023) and everything it did is rolled back',
      v_c = '22023' and pg_temp.events(p_dur) = v_n and pg_temp.entries(p_dur) = v_n2
      and exists (select 1 from public.package_fee_entries e where e.id = e_new and e.cancelled_at is null), v_c);
    v_c := pg_temp.as_user_do(v_admin, format($q$select public.correct_fee_entry(%L, 1300, null, 'Not in effect yet')$q$, e_f1));
    perform pg_temp.rec('Y4 a fee that has not taken effect is edited, not corrected (55006)', v_c = '55006' and pg_temp.events(p_dur) = v_n, v_c);

    v_s := pg_temp.as_user_scalar(v_admin, format($q$select public.correct_fee_entry(%L, 1300, null, 'Revised again')::text$q$, e_new));
    e_new2 := pg_temp.as_uuid(v_s);
    perform pg_temp.rec('Y5 a replacement can itself be corrected: the history is a chain of linked, cancelled entries ending in one live fee',
      e_new2 is not null
      and exists (select 1 from public.package_fee_entries e where e.id = e_new and e.cancelled_at is not null)
      and exists (select 1 from public.package_fee_entries e where e.id = e_new2 and e.corrects_entry_id = e_new and e.cancelled_at is null and e.monthly_fee = 1300)
      and exists (select 1 from public.package_fee_entries e where e.id = e_i2 and e.cancelled_at is not null)
      and (select count(*) from public.package_events ev where ev.package_id = p_dur and ev.event_type = 'fee_corrected') = 2
      and (select count(*) = 0 from public.package_fee_entry_discounts where entry_id = e_new2), coalesce(v_s, ''));

    -- AU. The audit scan -------------------------------------------------------------------------------------------------------------
    perform pg_temp.rec('AU1 every cancelled fee has its event: a fee_cancelled event, or the fee_corrected event of its replacement',
      not exists (
        select 1 from public.package_fee_entries e
        where e.package_id in (p_dur, p_cls) and e.cancelled_at is not null
          and not exists (select 1 from public.package_events ev where ev.event_type = 'fee_cancelled' and ev.fee_entry_id = e.id)
          and not exists (select 1 from public.package_fee_entries r
                          join public.package_events ev on ev.fee_entry_id = r.id and ev.event_type = 'fee_corrected'
                          where r.corrects_entry_id = e.id)), '');
    perform pg_temp.rec('AU2 every fee made by a correction has its fee_corrected event, and every other fee has its fee_scheduled event',
      not exists (
        select 1 from public.package_fee_entries e
        where e.package_id in (p_dur, p_cls)
          and not exists (select 1 from public.package_events ev
                          where ev.fee_entry_id = e.id
                            and ev.event_type = case when e.corrects_entry_id is null then 'fee_scheduled' else 'fee_corrected' end)), '');
    perform pg_temp.rec('AU3 every event of these packages names the Admin as its actor',
      not exists (select 1 from public.package_events ev where ev.package_id in (p_dur, p_cls) and ev.actor is distinct from v_admin), '');
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

-- AFTER THE ROLLBACK (run separately, as its own statement - never inside the verification transaction). Nothing may remain:
--
--   select count(*) as leftover_packages from public.packages where position('ZZVERIFY 0047' in name) = 1;
--
-- It must be 0. (If a package has such a name before any run, the preflight P1 refuses to start.)
