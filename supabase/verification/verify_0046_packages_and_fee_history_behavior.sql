-- ===========================================================================
-- Migration 0046 verification (behaviour) - package catalogue and fee history (V1 Fee Structure, FS-2)
-- Exercises supabase/migrations/0046_packages_and_fee_history.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0046 is applied (the five tables, the six trigger functions, the ten triggers). If not, every other
--       check is skipped (NOT TESTED).
--   P1  Preflight: no package already has one of the fixture names this run uses. If one does, P1 FAILS, every scenario
--       is skipped, and nothing is created or changed.
--   N   Package names and descriptions: required, trimmed, 2 to 100 / at most 500 characters; unique ignoring case,
--       including against an inactive package.
--   K   Package type: class allowance by kind, kind and status values, no deletion, no change of id, and the composite
--       foreign keys - the type cannot change once an option or a fee entry references the package, and can while
--       nothing does.
--   O   Duration options: only a duration package has them; the five values; no duplicates.
--   E   Fee entries: amount by kind, currency format, package kind must match, one live entry per package and date
--       (a cancelled entry frees its date), created uncancelled, never deleted.
--   G   The fee-entry guard: a scheduled entry can be edited, one in effect (today included) cannot and can only be
--       cancelled - stamped with the transaction time, not back- or future-dated - a cancelled entry is final, identity
--       and correction link never change, an actor may go to null.
--   C   Corrections: a replacement must correct a CANCELLED entry of the SAME package, and an entry has at most one.
--   D   Discounts: the three options, the shape (fixed or percentage), only on a duration entry, and the freeze - open
--       while the entry is scheduled or being created in this transaction, closed once it is in effect or cancelled.
--   V   Events: an actor is required when an event is written (23502); an event can only name a fee entry of its OWN
--       package (23503); the shape per event type; the reason rules (a correction always; cancelling a fee in effect);
--       the in_effect flag of a fee_cancelled event is checked against the fee entry and the centre's date, so a wrong
--       flag cannot dodge the reason rule (23514); reason and payload checks; and protection (update, delete, truncate
--       refused; the actor may go to null later).
--   A   Access: an Admin can read; an Instructor sees no rows (reported NOT TESTED when no Instructor profile exists);
--       anon is refused; nobody holds INSERT, UPDATE or DELETE; the trigger functions are not callable.
--   Z   Every pre-existing row of the tables that matter (memberships, payments, invoices, settings, students,
--       class-count attendance) is byte-for-byte unchanged by this script. This shows that THIS SCRIPT wrote nothing
--       there; it does not show that applying the migration changed nothing (hash the same tables before and after the
--       apply to show that).
--
-- PREREQUISITES
--   * Migration 0046 applied. If it is NOT, P0 fails and every scenario is skipped.
--   * An Admin profile. An Instructor profile is needed for the Instructor checks (skipped without one).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable fixtures only: packages named 'ZZVERIFY 0046 ...' (plus a few short or padded names the checks need)
--     and the options, fee entries, discounts and events made for them. No existing row is written; existing tables are
--     read only to be fingerprinted. Because every table here is append-only, nothing could be removed afterwards -
--     which is why the rollback is the only cleanup, and why the file must be run as one transaction and never in a
--     session with autocommit.
--   * It exercises refusals that, if a guard were missing, would change or remove rows of the new tables (an owner's
--     update, delete and truncate). Because of the rollback nothing can persist.
--
-- LIMITATIONS
--   * TRUNCATE is checked on the tables nothing references (the events, the options, the discounts). The other two are
--     referenced by foreign keys, so PostgreSQL refuses their truncation before any trigger runs; their truncate
--     triggers are verified by the structure script instead.
--   * "Created in this transaction" is exercised with an explicit created_at: a whole script is one transaction, so an
--     entry created earlier is simulated by an entry whose created_at is in the past.
--   * The database-account-deleted path (ON DELETE SET NULL on an actor) is exercised by setting the actor to null
--     directly, which is the update that path performs. No auth user is created or deleted.
--   * Nothing here exercises the write functions of a later phase, fee resolution or conflict detection: they do not
--     exist yet. Concurrency cannot be tested in one transaction and is not tested.
--   * It cannot test that an audit event EXISTS for every change: 0046 does not guarantee that (see the migration's
--     AUDIT LIMITATION), and the FS-3 verification must test it against the functions.
--   * The triggers refuse ordinary statements from the table owner, which is who runs this script. They cannot stop an
--     owner who disables or replaces them; this script checks that they are enabled and what they refuse, nothing more.
--   * TRUNCATE takes an exclusive lock on the table for the length of the transaction: run this when no one is using the
--     package screens.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED, INFO.
-- ===========================================================================

-- REPEATABLE READ: every fingerprint of existing data below is read from ONE snapshot of the database, so a change by
-- another session between the "before" and "after" fingerprints cannot be mistaken for a change made by this script.
-- The script writes only its own disposable fixtures, so it cannot hit a serialization failure of its own making.
begin isolation level repeatable read;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

-- Fingerprints of the existing tables, taken before and after the run.
create temp table _fingerprints (
  tbl    text primary key,
  before_hash text,
  after_hash  text
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

-- Run one statement as the owning role; return 'OK' or the SQLSTATE. (A failing statement is rolled back by the
-- exception block, so a refusal leaves nothing behind.)
create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- Run one statement as an authenticated user; return 'OK' or the SQLSTATE.
create function pg_temp.code_as(p_user uuid, p_sql text)
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
create function pg_temp.scalar_as(p_user uuid, p_sql text)
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

-- Run one statement as the anonymous role; return 'OK' or the SQLSTATE.
create function pg_temp.code_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  -- The authenticated helpers set the legacy sub setting for the rest of the transaction, and auth.uid() reads it
  -- first: clear it so an anonymous call cannot inherit the previous Admin identity.
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

-- A fingerprint of every row of one table.
create function pg_temp.table_hash(p_table regclass)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' order by to_jsonb(t)::text), '''')) from %s t', p_table)
    into v_out;
  return v_out;
end $f$;

-- A disposable package (as the owner); returns its id. A class-count package gets a class allowance of 5.
create function pg_temp.pkg(p_name text, p_kind text default 'duration', p_actor uuid default null)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.packages (name, kind, total_classes, created_by)
  values (p_name, p_kind, case when p_kind = 'class_count' then 5 end, p_actor)
  returning id into v_id;
  return v_id;
end $f$;

-- A disposable fee entry (as the owner); returns its id. created_at can be set in the past to stand for an entry
-- created in an earlier transaction.
create function pg_temp.entry(p_package uuid, p_from date, p_amount numeric default 1500,
                              p_created timestamptz default null, p_actor uuid default null)
returns uuid language plpgsql as $f$
declare
  v_kind text;
  v_id   uuid;
begin
  select kind into v_kind from public.packages where id = p_package;
  insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, price, created_at, created_by)
  values (p_package, v_kind, p_from, 'INR',
          case when v_kind = 'duration' then p_amount end,
          case when v_kind = 'class_count' then p_amount end,
          coalesce(p_created, now()), p_actor)
  returning id into v_id;
  return v_id;
end $f$;

-- Cancels an entry (as the owner).
create function pg_temp.cancel(p_entry uuid, p_by uuid default null)
returns void language plpgsql as $f$
begin
  update public.package_fee_entries set cancelled_at = now(), cancelled_by = p_by where id = p_entry;
end $f$;

-- A disposable package_created event (as the owner); returns its id. An event needs an actor when it is written.
create function pg_temp.event(p_package uuid, p_actor uuid)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.package_events (package_id, event_type, actor, after_state)
  values (p_package, 'package_created', p_actor, '{"name": "ZZVERIFY 0046"}'::jsonb)
  returning id into v_id;
  return v_id;
end $f$;

-- Tries to insert one event as the owner; returns 'OK' or the SQLSTATE. (A refused insert is rolled back by the exception
-- block, so a refusal leaves nothing behind. The values go in as typed parameters, so no quoting is involved.)
create function pg_temp.event_code(p_package uuid, p_entry uuid, p_type text, p_actor uuid, p_reason text,
                                   p_before jsonb, p_after jsonb)
returns text language plpgsql as $f$
begin
  insert into public.package_events (package_id, fee_entry_id, event_type, actor, reason, before_state, after_state)
  values (p_package, p_entry, p_type, p_actor, p_reason, p_before, p_after);
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

do $$
declare
  v_admin      uuid;
  v_instr_user uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_ready      boolean;
  v_clash      integer := 0;
  v_c          text;
  v_self       uuid;
  v_t          text;
  v_tables     text[] := array['packages', 'package_duration_options', 'package_fee_entries',
                               'package_fee_entry_discounts', 'package_events'];
  -- packages
  p1 uuid; p2 uuid; p_free uuid; p_dur uuid; p_cls uuid; p_ent uuid; p_cor uuid; p_oth uuid; p_dsc uuid; p_evt uuid;
  p_evt2 uuid;
  -- entries
  e_sched uuid; e_eff uuid; e_today uuid; e_act uuid; e_old uuid; e_cls uuid;
  e_c1 uuid; e_c2 uuid; e_dsch uuid; e_dfrz uuid; e_dnew uuid; e_dcan uuid; e_oth uuid; e_ev uuid;
  e_effv uuid; e_todayv uuid; e_foreign uuid;
  -- events
  ev1 uuid;
  v_long100 text;
  v_long101 text;
  v_desc500 text;
  v_desc501 text;
  v_reason501 text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr_user from public.profiles where role = 'instructor' order by created_at limit 1;

  -- P0. Is 0046 applied? ---------------------------------------------------------------------------------------------
  v_ready := (select bool_and(to_regclass('public.' || x) is not null) from unnest(v_tables) x)
         and (select bool_and(to_regprocedure(x) is not null) from unnest(array[
                'public.package_tables_no_truncate()', 'public.packages_guard()', 'public.packages_touch_updated_at()',
                'public.package_fee_entries_guard()', 'public.package_fee_entry_discounts_guard()',
                'public.package_events_guard()']) x)
         and (select count(*) = 10 from pg_trigger
              where not tgisinternal
                and tgname in ('packages_guard_trigger', 'packages_touch_updated_at_trigger',
                               'package_fee_entries_guard_trigger', 'package_fee_entry_discounts_guard_trigger',
                               'package_events_guard_trigger', 'packages_no_truncate_trigger',
                               'package_duration_options_no_truncate_trigger', 'package_fee_entries_no_truncate_trigger',
                               'package_fee_entry_discounts_no_truncate_trigger', 'package_events_no_truncate_trigger'));
  perform pg_temp.rec('P0 migration 0046 is applied (the five package tables, the six trigger functions and the ten triggers)',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0046 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  v_long100 := 'ZZVERIFY 0046 ' || repeat('x', 86);
  v_long101 := 'ZZVERIFY 0046 ' || repeat('x', 87);
  v_desc500 := repeat('d', 500);
  v_desc501 := repeat('d', 501);
  v_reason501 := repeat('r', 501);

  -- P1. Preflight: none of the fixture names may exist. Read-only, and before anything is created. -----------------------
  if v_ready then
    select count(*) into v_clash from public.packages
    where position('ZZVERIFY 0046' in name) = 1 or lower(name) = 'z0';
    perform pg_temp.rec('P1 no package already has a fixture name (ZZVERIFY 0046 ..., Z0) - this run creates its own',
      v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing package(s) clash - nothing was created or changed; rename them and run again' end);
  end if;

  -- Fingerprints of everything that already exists - every row, none excluded - taken before the run creates anything.
  if v_ready then
    insert into _fingerprints (tbl, before_hash)
    select x, pg_temp.table_hash(to_regclass('public.' || x))
    from unnest(array['memberships', 'membership_payments', 'invoices', 'invoice_settings', 'center_profile', 'students',
                      'class_count_attendance', 'class_count_attendance_reversals']) x
    where to_regclass('public.' || x) is not null;
  end if;

  if not v_ready then
    perform pg_temp.skip('N / K / O / E / G / C / D / V / A', 'migration 0046 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('N / K / O / E / G / C / D / V / A', 'preflight P1 failed: a fixture name already belongs to a package, so no fixture was created');
  elsif v_admin is null then
    perform pg_temp.skip('N / K / O / E / G / C / D / V / A', 'needs an Admin profile');
  else
    -- N. Names and descriptions -------------------------------------------------------------------------------------------
    p1 := pg_temp.pkg('ZZVERIFY 0046 Alpha');
    p2 := pg_temp.pkg('ZZVERIFY 0046 Beta', 'class_count');
    perform pg_temp.rec('N0 a valid duration package and a valid class-count package can be created (status defaults to active)',
      (select count(*) = 2 and bool_and(status = 'active') from public.packages where id in (p1, p2)), '');

    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, 'zzverify 0046 ALPHA'));
    perform pg_temp.rec('N1 a name that differs only by case is refused (unique, case-insensitive)', v_c = '23505', v_c);

    update public.packages set status = 'inactive' where id = p1;
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, 'ZZVERIFY 0046 ALPHA'));
    perform pg_temp.rec('N2 the name of an INACTIVE package cannot be reused either', v_c = '23505', v_c);
    update public.packages set status = 'active' where id = p1;

    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, 'Z'));
    perform pg_temp.rec('N3 a one-character name is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, 'Z0'));
    perform pg_temp.rec('N4 a two-character name is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, v_long100));
    perform pg_temp.rec('N5 a 100-character name is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, v_long101));
    perform pg_temp.rec('N6 a 101-character name is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, ' ZZVERIFY 0046 Lead'));
    perform pg_temp.rec('N7 a name with a leading space is refused (names are stored trimmed)', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind) values (%L, 'duration')$q$, E'ZZVERIFY 0046 Tab\t'));
    perform pg_temp.rec('N8 a name with a trailing tab is refused', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind) values (null, 'duration')$q$);
    perform pg_temp.rec('N9 a name is required', v_c = '23502', v_c);

    v_c := pg_temp.code(format($q$insert into public.packages (name, kind, description) values ('ZZVERIFY 0046 D500', 'duration', %L)$q$, v_desc500));
    perform pg_temp.rec('N10 a 500-character description is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$insert into public.packages (name, kind, description) values ('ZZVERIFY 0046 D501', 'duration', %L)$q$, v_desc501));
    perform pg_temp.rec('N11 a 501-character description is refused', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind, description) values ('ZZVERIFY 0046 DEmpty', 'duration', '')$q$);
    perform pg_temp.rec('N12 an empty description is refused (an absent one is null)', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind, description) values ('ZZVERIFY 0046 DPad', 'duration', ' padded')$q$);
    perform pg_temp.rec('N13 an untrimmed description is refused', v_c = '23514', v_c);

    -- K. Package type, status, deletion, identity ---------------------------------------------------------------------------
    v_c := pg_temp.code($q$insert into public.packages (name, kind, total_classes) values ('ZZVERIFY 0046 K1', 'class_count', null)$q$);
    perform pg_temp.rec('K1 a class-count package needs a class allowance', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind, total_classes) values ('ZZVERIFY 0046 K2', 'class_count', 0)$q$);
    perform pg_temp.rec('K2 a class allowance of 0 is refused', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind, total_classes) values ('ZZVERIFY 0046 K3', 'duration', 5)$q$);
    perform pg_temp.rec('K3 a duration package has no class allowance', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind) values ('ZZVERIFY 0046 K4', 'weekly')$q$);
    perform pg_temp.rec('K4 an unknown package type is refused', v_c = '23514', v_c);
    v_c := pg_temp.code($q$insert into public.packages (name, kind, status) values ('ZZVERIFY 0046 K5', 'duration', 'paused')$q$);
    perform pg_temp.rec('K5 an unknown status is refused', v_c = '23514', v_c);

    p_free := pg_temp.pkg('ZZVERIFY 0046 Free', 'class_count');
    v_c := pg_temp.code(format($q$delete from public.packages where id = %L$q$, p_free));
    perform pg_temp.rec('K6 a package cannot be deleted - not even one nothing references', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.packages set id = gen_random_uuid() where id = %L$q$, p_free));
    perform pg_temp.rec('K7 a package''s id cannot change', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.packages set created_at = created_at - interval '1 day' where id = %L$q$, p_free));
    perform pg_temp.rec('K8 a package''s creation time cannot change', v_c = '55006', v_c);

    -- A package nothing references can still change type (the approved rule protects it once it is referenced).
    v_c := pg_temp.code(format($q$update public.packages set kind = 'duration', total_classes = null where id = %L$q$, p_free));
    perform pg_temp.rec('K9 an unreferenced package''s type can still be changed',
      v_c = 'OK' and (select kind from public.packages where id = p_free) = 'duration', v_c);

    p_dur := pg_temp.pkg('ZZVERIFY 0046 WithOptions');
    insert into public.package_duration_options (package_id, duration_option) values (p_dur, 'monthly');
    v_c := pg_temp.code(format($q$update public.packages set kind = 'class_count', total_classes = 5 where id = %L$q$, p_dur));
    perform pg_temp.rec('K10 the type of a package that has duration options cannot change (composite foreign key, 23503)', v_c = '23503', v_c);

    p_cls := pg_temp.pkg('ZZVERIFY 0046 WithEntry', 'class_count');
    e_cls := pg_temp.entry(p_cls, v_today + 10, 3000);
    v_c := pg_temp.code(format($q$update public.packages set kind = 'duration', total_classes = null where id = %L$q$, p_cls));
    perform pg_temp.rec('K11 the type of a package that has a fee entry cannot change (composite foreign key, 23503)', v_c = '23503', v_c);

    update public.packages set description = 'touched' where id = p_free;
    perform pg_temp.rec('K12 name, description and status can still change on a referenced package (kind is the protected column)',
      pg_temp.code(format($q$update public.packages set description = 'edited', status = 'inactive' where id = %L$q$, p_dur)) = 'OK', '');

    -- O. Duration options ---------------------------------------------------------------------------------------------------
    v_c := pg_temp.code(format($q$insert into public.package_duration_options (package_id, duration_option) values (%L, 'monthly')$q$, p_dur));
    perform pg_temp.rec('O1 an option cannot be added twice for a package', v_c = '23505', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_duration_options (package_id, duration_option) values (%L, 'weekly')$q$, p_dur));
    perform pg_temp.rec('O2 an unknown option is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_duration_options (package_id, duration_option) values (%L, 'custom')$q$, p_cls));
    perform pg_temp.rec('O3 a class-count package cannot have duration options (composite foreign key, 23503)', v_c = '23503', v_c);
    -- The insert is its own statement: a query cannot see rows written by a function it calls in the same statement, so the
    -- count below must be read in a later one. p_dur already offers 'monthly' (inserted in K), so four more make five.
    v_c := pg_temp.code(format($q$insert into public.package_duration_options (package_id, duration_option) select %L, x from unnest(array['quarterly','half_yearly','annual','custom']) x$q$, p_dur));
    perform pg_temp.rec('O4 all five options can be offered by a duration package',
      v_c = 'OK' and (select count(*) = 5 from public.package_duration_options where package_id = p_dur),
      'insert: ' || v_c || '; options now offered: ' || (select count(*) from public.package_duration_options where package_id = p_dur));

    -- E. Fee entries ----------------------------------------------------------------------------------------------------------
    p_ent := pg_temp.pkg('ZZVERIFY 0046 Entries');
    e_sched := pg_temp.entry(p_ent, v_today + 10, 1500);
    perform pg_temp.rec('E1 a scheduled duration entry (monthly fee) and a class-count entry (price) can be created',
      e_sched is not null and e_cls is not null, '');

    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, price) values (%L, 'duration', %L, 'INR', 100)$q$, p_ent, v_today + 20));
    perform pg_temp.rec('E2 a duration entry with a price (and no monthly fee) is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'INR', 0)$q$, p_ent, v_today + 21));
    perform pg_temp.rec('E3 a monthly fee of 0 is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'INR', -5)$q$, p_ent, v_today + 22));
    perform pg_temp.rec('E4 a negative monthly fee is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'class_count', %L, 'INR', 100)$q$, p_cls, v_today + 23));
    perform pg_temp.rec('E5 a class-count entry with a monthly fee (and no price) is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, price) values (%L, 'class_count', %L, 'INR', 100)$q$, p_ent, v_today + 24));
    perform pg_temp.rec('E6 an entry whose package_kind does not match its package is refused (composite foreign key, 23503)', v_c = '23503', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'inr', 100)$q$, p_ent, v_today + 25));
    perform pg_temp.rec('E7 a lower-case currency code is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'IN', 100)$q$, p_ent, v_today + 26));
    perform pg_temp.rec('E8 a two-letter currency code is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'USD', 100)$q$, p_ent, v_today + 27));
    perform pg_temp.rec('E9 an entry in another currency is accepted: currency is stored, never converted', v_c = 'OK', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee) values (%L, 'duration', %L, 'USD', 100)$q$, p_ent, v_today + 10));
    perform pg_temp.rec('E10 a second live entry on the same date is refused, even in another currency', v_c = '23505', v_c);

    v_c := 'ERR';
    begin
      perform pg_temp.cancel(e_sched, v_admin);
      insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee)
      values (p_ent, 'duration', v_today + 10, 'INR', 1600);
      v_c := 'OK';
    exception when others then
      v_c := sqlstate;
    end;
    perform pg_temp.rec('E11 a cancelled entry frees its date for a new one', v_c = 'OK', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, cancelled_at) values (%L, 'duration', %L, 'INR', 100, now())$q$, p_ent, v_today + 30));
    perform pg_temp.rec('E12 an entry cannot be created already cancelled', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$delete from public.package_fee_entries where id = %L$q$, e_sched));
    perform pg_temp.rec('E13 a fee entry is never deleted', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, monthly_fee, currency) values (%L, 'duration', %L, 100, null)$q$, p_ent, v_today + 31));
    perform pg_temp.rec('E14 a currency is required', v_c = '23502', v_c);

    -- G. The fee-entry guard --------------------------------------------------------------------------------------------------
    p_oth := pg_temp.pkg('ZZVERIFY 0046 Other');
    e_oth := pg_temp.entry(p_oth, v_today + 40, 900);

    e_sched := pg_temp.entry(p_oth, v_today + 10, 1500);
    perform pg_temp.rec('G1 a scheduled entry''s amount can be edited',
      pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1550 where id = %L$q$, e_sched)) = 'OK', '');
    perform pg_temp.rec('G2 a scheduled entry''s date and currency can be edited',
      pg_temp.code(format($q$update public.package_fee_entries set effective_from = %L, currency = 'USD' where id = %L$q$, v_today + 12, e_sched)) = 'OK', '');
    v_c := pg_temp.code(format($q$update public.package_fee_entries set package_id = %L where id = %L$q$, p1, e_sched));
    perform pg_temp.rec('G3 an entry cannot be moved to another package', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set created_at = created_at - interval '1 day' where id = %L$q$, e_sched));
    perform pg_temp.rec('G4 an entry''s creation time cannot change', v_c = '55006', v_c);

    e_eff := pg_temp.entry(p_oth, v_today - 10, 1000, null, v_admin);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1100 where id = %L$q$, e_eff));
    perform pg_temp.rec('G5 an entry in effect cannot be edited (amount)', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set effective_from = %L where id = %L$q$, v_today - 20, e_eff));
    perform pg_temp.rec('G6 an entry in effect cannot be edited (date)', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set currency = 'USD' where id = %L$q$, e_eff));
    perform pg_temp.rec('G7 an entry in effect cannot be edited (currency)', v_c = '55006', v_c);

    e_today := pg_temp.entry(p_oth, v_today, 1200);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1300 where id = %L$q$, e_today));
    perform pg_temp.rec('G8 an entry that takes effect today is already in effect (it cannot be edited)', v_c = '55006', v_c);

    -- Actor nullification (what ON DELETE SET NULL does) and nothing else.
    v_c := pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1100, created_by = null where id = %L$q$, e_eff));
    perform pg_temp.rec('G9 an actor going to null does not unlock editing an entry in effect', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set created_by = null where id = %L$q$, e_eff));
    perform pg_temp.rec('G10 an entry in effect accepts its creator going to null', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set created_by = gen_random_uuid() where id = %L$q$, e_sched));
    perform pg_temp.rec('G11 who created an entry cannot be changed to someone else', v_c = '55006', v_c);

    -- Cancelling. A cancellation is stamped with the transaction time (now()): not back-dated, not future-dated.
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_at = now() - interval '1 day', cancelled_by = %L where id = %L$q$, v_admin, e_sched));
    perform pg_temp.rec('G11b a cancellation cannot be back-dated (cancelled_at must be the transaction time)', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_at = now() + interval '1 day', cancelled_by = %L where id = %L$q$, v_admin, e_sched));
    perform pg_temp.rec('G11c ... nor future-dated', v_c = '55006', v_c);
    perform pg_temp.rec('G11d ... and neither refusal cancelled the entry',
      (select cancelled_at is null from public.package_fee_entries where id = e_sched), '');
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_at = now(), cancelled_by = %L where id = %L$q$, v_admin, e_eff));
    perform pg_temp.rec('G12 an entry in effect can be cancelled', v_c = 'OK' and (select cancelled_at is not null from public.package_fee_entries where id = e_eff), v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1 , cancelled_at = now() where id = %L$q$, e_sched));
    perform pg_temp.rec('G13 an entry cannot be edited and cancelled in one step', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set monthly_fee = 1100 where id = %L$q$, e_eff));
    perform pg_temp.rec('G14 a cancelled entry cannot be edited', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_at = null, cancelled_by = null where id = %L$q$, e_eff));
    perform pg_temp.rec('G15 a cancelled entry cannot be un-cancelled', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_at = now() + interval '1 day' where id = %L$q$, e_eff));
    perform pg_temp.rec('G16 the time a cancellation was made cannot change', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_by = null where id = %L$q$, e_eff));
    perform pg_temp.rec('G17 a cancelled entry accepts its canceller going to null', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entries set cancelled_by = %L where id = %L$q$, v_admin, e_eff));
    perform pg_temp.rec('G18 ... but not a canceller being set again', v_c = '55006', v_c);

    -- C. Corrections --------------------------------------------------------------------------------------------------------------
    e_old := pg_temp.entry(p_oth, v_today - 5, 800);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id) values (%L, 'duration', %L, 'INR', 850, %L)$q$, p_oth, v_today - 4, e_old));
    perform pg_temp.rec('C1 a replacement of an entry that is NOT cancelled is refused', v_c = '55006', v_c);

    perform pg_temp.cancel(e_old, v_admin);
    v_c := 'ERR';
    begin
      insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id)
      values (p_oth, 'duration', v_today - 5, 'INR', 850, e_old)
      returning id into e_c1;
      v_c := 'OK';
    exception when others then
      v_c := sqlstate;
    end;
    perform pg_temp.rec('C2 a cancelled entry can be replaced by a linked entry - even one on the very same date', v_c = 'OK', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id) values (%L, 'duration', %L, 'INR', 860, %L)$q$, p_oth, v_today - 3, e_old));
    perform pg_temp.rec('C3 an entry has at most one replacement (the chain never forks)', v_c = '23505', v_c);

    p_cor := pg_temp.pkg('ZZVERIFY 0046 Corrects');
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id) values (%L, 'duration', %L, 'INR', 870, %L)$q$, p_cor, v_today - 5, e_old));
    perform pg_temp.rec('C4 a replacement cannot correct an entry of ANOTHER package', v_c = '55006', v_c);

    v_self := gen_random_uuid();
    v_c := pg_temp.code(format($q$insert into public.package_fee_entries (id, package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id) values (%L, %L, 'duration', %L, 'INR', 880, %L)$q$, v_self, p_cor, v_today - 5, v_self));
    perform pg_temp.rec('C5 an entry cannot correct itself (nor an entry that does not exist)', v_c in ('55006', '23514'), v_c);

    v_c := pg_temp.code(format($q$update public.package_fee_entries set corrects_entry_id = %L where id = %L$q$, e_old, e_sched));
    perform pg_temp.rec('C6 the correction link of an existing entry cannot be changed', v_c = '55006', v_c);

    -- The replacement itself can be cancelled and replaced: the chain continues.
    perform pg_temp.cancel(e_c1, v_admin);
    v_c := 'ERR';
    begin
      insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id)
      values (p_oth, 'duration', v_today - 5, 'INR', 900, e_c1)
      returning id into e_c2;
      v_c := 'OK';
    exception when others then
      v_c := sqlstate;
    end;
    perform pg_temp.rec('C7 a replacement can itself be corrected: the history is a chain', v_c = 'OK', v_c);

    -- D. Discounts ----------------------------------------------------------------------------------------------------------------
    p_dsc := pg_temp.pkg('ZZVERIFY 0046 Discounts');
    -- Entries "created in an earlier transaction" are simulated with a created_at in the past.
    e_dsch := pg_temp.entry(p_dsc, v_today + 10, 1500, now() - interval '2 days');   -- scheduled, created earlier
    e_dfrz := pg_temp.entry(p_dsc, v_today - 10, 1500, now() - interval '2 days');   -- in effect, created earlier
    e_dnew := pg_temp.entry(p_dsc, v_today - 20, 1500);                              -- in effect, created in this transaction
    e_dcan := pg_temp.entry(p_dsc, v_today - 30, 1500);                              -- will be cancelled

    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 300)$q$, e_dsch));
    perform pg_temp.rec('D1 a fixed quarterly discount can be added to a scheduled entry', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, percent_value) values (%L, 'half_yearly', 'percent', 10)$q$, e_dsch));
    perform pg_temp.rec('D2 a percentage half-yearly discount can be added', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, percent_value) values (%L, 'annual', 'percent', 100)$q$, e_dsch));
    perform pg_temp.rec('D3 a 100 percent discount is accepted by the table (whether it fits the standard fee is checked when a membership is priced)', v_c = 'OK', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'monthly', 'fixed', 100)$q$, e_dsch));
    perform pg_temp.rec('D4 Monthly never has a package discount', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'custom', 'fixed', 100)$q$, e_dsch));
    perform pg_temp.rec('D5 Custom has no discount of its own', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 100)$q$, e_dsch));
    perform pg_temp.rec('D6 a duration option has at most one discount per entry', v_c = '23505', v_c);

    -- D7: rows that DO NOT EXIST yet (e_dnew has no discount row at this point), so the primary key cannot answer for the
    -- shape check: the only error possible is the check violation, 23514.
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount, percent_value) values (%L, 'half_yearly', 'fixed', 100, 5)$q$, e_dnew));
    perform pg_temp.rec('D7 a fixed discount cannot also carry a percentage (a half_yearly row that does not exist yet)', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount, percent_value) values (%L, 'half_yearly', 'percent', 100, 5)$q$, e_dnew));
    perform pg_temp.rec('D7b a percentage discount cannot also carry a fixed amount', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type) values (%L, 'half_yearly', 'fixed')$q$, e_dnew));
    perform pg_temp.rec('D7c a fixed discount needs its amount', v_c = '23514', v_c);
    perform pg_temp.rec('D7d ... and none of those refusals left a half_yearly row behind',
      not exists (select 1 from public.package_fee_entry_discounts where entry_id = e_dnew and duration_option = 'half_yearly'), '');

    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 0)$q$, e_dnew));
    perform pg_temp.rec('D8 a fixed discount of 0 is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, percent_value) values (%L, 'quarterly', 'percent', 0)$q$, e_dnew));
    perform pg_temp.rec('D9 a percentage of 0 is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, percent_value) values (%L, 'quarterly', 'percent', 100.01)$q$, e_dnew));
    perform pg_temp.rec('D10 a percentage above 100 is refused', v_c = '23514', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type) values (%L, 'quarterly', 'bonus')$q$, e_dnew));
    perform pg_temp.rec('D11 an unknown discount type is refused', v_c = '23514', v_c);

    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 100)$q$, e_cls));
    perform pg_temp.rec('D12 a class-count entry cannot have package discounts (composite foreign key, 23503)', v_c = '23503', v_c);

    -- The freeze.
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 100)$q$, e_dfrz));
    perform pg_temp.rec('D13 the discounts of an entry in effect, created earlier, cannot be added to', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'quarterly', 'fixed', 100)$q$, e_dnew));
    perform pg_temp.rec('D14 an entry in effect that is created in THIS transaction can still receive its discounts (how a correction writes its replacement)', v_c = 'OK', v_c);

    v_c := pg_temp.code(format($q$update public.package_fee_entry_discounts set fixed_amount = 350 where entry_id = %L and duration_option = 'quarterly'$q$, e_dsch));
    perform pg_temp.rec('D15 a scheduled entry''s discount can be edited', v_c = 'OK', v_c);
    v_c := pg_temp.code(format($q$delete from public.package_fee_entry_discounts where entry_id = %L and duration_option = 'annual'$q$, e_dsch));
    perform pg_temp.rec('D16 a scheduled entry''s discount can be removed', v_c = 'OK', v_c);

    -- Freeze an existing discount: give an in-effect, earlier-created entry a discount as the owner would have done before
    -- it took effect, by using an entry created earlier that is scheduled, then moving the clock is not possible - so the
    -- cancelled entry (created now, discount added, then cancelled) stands for "frozen".
    insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount)
    values (e_dcan, 'quarterly', 'fixed', 100);
    perform pg_temp.cancel(e_dcan, v_admin);
    v_c := pg_temp.code(format($q$update public.package_fee_entry_discounts set fixed_amount = 120 where entry_id = %L$q$, e_dcan));
    perform pg_temp.rec('D17 the discounts of a cancelled entry cannot be edited', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$delete from public.package_fee_entry_discounts where entry_id = %L$q$, e_dcan));
    perform pg_temp.rec('D18 ... or removed', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount) values (%L, 'annual', 'fixed', 100)$q$, e_dcan));
    perform pg_temp.rec('D19 ... or added to', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_fee_entry_discounts set entry_id = %L where entry_id = %L$q$, e_dsch, e_dnew));
    perform pg_temp.rec('D20 a discount cannot be moved to another entry', v_c = '55006', v_c);

    -- A correction in one transaction: cancel the entry in effect, append its replacement, give the replacement its discounts.
    v_c := 'ERR';
    begin
      perform pg_temp.cancel(e_dnew, v_admin);
      insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, corrects_entry_id)
      values (p_dsc, 'duration', v_today - 20, 'INR', 1450, e_dnew)
      returning id into e_ev;
      insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, percent_value)
      values (e_ev, 'quarterly', 'percent', 5);
      v_c := 'OK';
    exception when others then
      v_c := sqlstate;
    end;
    perform pg_temp.rec('D21 a correction can cancel an entry in effect, append the replacement and write its discounts in one transaction', v_c = 'OK', v_c);

    -- V. Events -------------------------------------------------------------------------------------------------------------------------
    p_evt := pg_temp.pkg('ZZVERIFY 0046 Events');
    p_evt2 := pg_temp.pkg('ZZVERIFY 0046 EventsOther');
    e_act := pg_temp.entry(p_evt, v_today + 15, 1500);          -- a scheduled fee
    e_effv := pg_temp.entry(p_evt, v_today - 3, 1500);          -- a fee in effect
    e_todayv := pg_temp.entry(p_evt, v_today, 1500);            -- a fee that takes effect today (in effect)
    e_foreign := pg_temp.entry(p_evt2, v_today + 15, 1500);     -- a fee of ANOTHER package

    -- The actor.
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, null, null, '{"name": "x"}'::jsonb);
    perform pg_temp.rec('V1 a package_created event with an actor and an after-state is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_created', null, null, null, '{"name": "x"}'::jsonb);
    perform pg_temp.rec('V1b an event without an actor is refused when it is written (not-null violation, 23502)', v_c = '23502', v_c);

    -- Shape per event type.
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, null, '{}'::jsonb, '{}'::jsonb);
    perform pg_temp.rec('V2 a package_created event cannot have a before-state', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'package_created', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V3 a package-level event cannot name a fee entry', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'details_updated', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V4 an update event needs both a before-state and an after-state', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'fee_scheduled', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V5 a fee event must name its fee entry', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_scheduled', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V6 a fee_scheduled event with its entry is accepted (no reason needed)', v_c = 'OK', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_edited', v_admin, null, '{}'::jsonb, '{}'::jsonb);
    perform pg_temp.rec('V7 editing a scheduled fee needs no reason', v_c = 'OK', v_c);

    -- The fee entry of an event belongs to the event's own package.
    v_c := pg_temp.event_code(p_evt, e_foreign, 'fee_scheduled', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V8a an event cannot name a fee entry of ANOTHER package (composite foreign key, 23503)', v_c = '23503', v_c);
    v_c := pg_temp.event_code(p_evt2, e_foreign, 'fee_scheduled', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V8b ... while the same entry is accepted for its own package (the positive control)', v_c = 'OK', v_c);

    -- Cancelling a fee: the reason rule, and the in_effect flag that the database checks against the entry itself.
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_cancelled', v_admin, null, '{"in_effect": false}'::jsonb, null);
    perform pg_temp.rec('V9 cancelling a SCHEDULED fee needs no reason', v_c = 'OK', v_c);
    v_c := pg_temp.event_code(p_evt, e_effv, 'fee_cancelled', v_admin, null, '{"in_effect": true}'::jsonb, null);
    perform pg_temp.rec('V10 cancelling a fee IN EFFECT without a reason is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_effv, 'fee_cancelled', v_admin, 'Entered by mistake', '{"in_effect": true}'::jsonb, null);
    perform pg_temp.rec('V11 cancelling a fee in effect with a reason is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_cancelled', v_admin, null, '{}'::jsonb, null);
    perform pg_temp.rec('V12 a fee_cancelled event must say whether the fee was in effect (a missing flag is refused by the check)', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_cancelled', v_admin, null, '{"in_effect": "maybe"}'::jsonb, null);
    perform pg_temp.rec('V12b ... and so is a flag that is neither true nor false', v_c = '23514', v_c);

    v_c := pg_temp.event_code(p_evt, e_effv, 'fee_cancelled', v_admin, null, '{"in_effect": false}'::jsonb, null);
    perform pg_temp.rec('V13 reporting in_effect = false for a fee that IS in effect, to skip the reason, is refused by the trigger (23514)', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_cancelled', v_admin, 'Typing error in the date', '{"in_effect": true}'::jsonb, null);
    perform pg_temp.rec('V14 reporting in_effect = true for a SCHEDULED fee is refused too, even with a reason (23514)', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_todayv, 'fee_cancelled', v_admin, null, '{"in_effect": false}'::jsonb, null);
    perform pg_temp.rec('V15 a fee that takes effect today is in effect: reporting false is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_todayv, 'fee_cancelled', v_admin, 'Wrong amount', '{"in_effect": true}'::jsonb, null);
    perform pg_temp.rec('V16 ... and reporting true, with a reason, is accepted', v_c = 'OK', v_c);

    -- Corrections.
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_corrected', v_admin, null, '{}'::jsonb, '{}'::jsonb);
    perform pg_temp.rec('V17 a correction without a reason is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, e_act, 'fee_corrected', v_admin, 'Typing error in the fee', '{}'::jsonb, '{}'::jsonb);
    perform pg_temp.rec('V18 a correction with a reason is accepted', v_c = 'OK', v_c);

    -- Reasons and payloads.
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, 'ab', null, '{}'::jsonb);
    perform pg_temp.rec('V19 a two-character reason is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, 'abc', null, '{}'::jsonb);
    perform pg_temp.rec('V20 a three-character reason is accepted', v_c = 'OK', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, v_reason501, null, '{}'::jsonb);
    perform pg_temp.rec('V21 a 501-character reason is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, ' padded', null, '{}'::jsonb);
    perform pg_temp.rec('V22 an untrimmed reason is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_deleted', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V23 an unknown event type is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(p_evt, null, 'package_created', v_admin, null, null, '[]'::jsonb);
    perform pg_temp.rec('V24 a state that is not a JSON object is refused', v_c = '23514', v_c);
    v_c := pg_temp.event_code(gen_random_uuid(), null, 'package_created', v_admin, null, null, '{}'::jsonb);
    perform pg_temp.rec('V25 an event must belong to an existing package', v_c = '23503', v_c);

    -- Events never change.
    ev1 := pg_temp.event(p_evt, v_admin);
    v_c := pg_temp.code(format($q$update public.package_events set reason = 'abc' where id = %L$q$, ev1));
    perform pg_temp.rec('V26 an event cannot be updated', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$delete from public.package_events where id = %L$q$, ev1));
    perform pg_temp.rec('V27 an event cannot be deleted', v_c = '55006', v_c);
    v_c := pg_temp.code($q$truncate public.package_events$q$);
    perform pg_temp.rec('V28 package_events cannot be truncated', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_events set actor = null, reason = 'abc' where id = %L$q$, ev1));
    perform pg_temp.rec('V29 the actor going to null does not unlock any other change', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_events set actor = %L where id = %L$q$, v_admin, ev1));
    perform pg_temp.rec('V30 ... and no other update is accepted, not even one that changes nothing', v_c = '55006', v_c);
    v_c := pg_temp.code(format($q$update public.package_events set actor = null where id = %L$q$, ev1));
    perform pg_temp.rec('V31 the actor of an event can go to null later, with every other column unchanged (a deleted user account)',
      v_c = 'OK' and (select actor is null from public.package_events where id = ev1), v_c);

    -- Truncate triggers on the tables nothing references.
    v_c := pg_temp.code($q$truncate public.package_duration_options$q$);
    perform pg_temp.rec('V32 package_duration_options cannot be truncated', v_c = '55006', v_c);
    v_c := pg_temp.code($q$truncate public.package_fee_entry_discounts$q$);
    perform pg_temp.rec('V33 package_fee_entry_discounts cannot be truncated', v_c = '55006', v_c);

    -- A. Access ---------------------------------------------------------------------------------------------------------------------------
    -- A count comes back as text, or as 'ERR:<sqlstate>' when the query was refused. The comparison is a CASE, so a refusal
    -- is reported as a FAIL and the text is never cast to an integer unless it is all digits.
    v_t := pg_temp.scalar_as(v_admin, $q$select count(*)::text from public.packages where position('ZZVERIFY 0046' in name) = 1$q$);
    perform pg_temp.rec('A1 an Admin can read the packages', case when v_t ~ '^[0-9]+$' then v_t::int > 0 else false end, v_t);
    foreach v_t in array v_tables loop
      v_c := pg_temp.scalar_as(v_admin, format('select count(*)::text from public.%I', v_t));
      perform pg_temp.rec('A2 an Admin can read ' || v_t, case when v_c ~ '^[0-9]+$' then v_c::int > 0 else false end, v_c);
    end loop;

    if v_instr_user is null then
      perform pg_temp.skip('A3 an Instructor sees no rows of any package table', 'needs an Instructor profile (none exists)');
    else
      foreach v_t in array v_tables loop
        v_c := pg_temp.scalar_as(v_instr_user, format('select count(*)::text from public.%I', v_t));
        perform pg_temp.rec('A3 an Instructor sees no row of ' || v_t, v_c = '0', v_c);
      end loop;
    end if;

    foreach v_t in array v_tables loop
      v_c := pg_temp.code_anon(format('select count(*) from public.%I', v_t));
      perform pg_temp.rec('A4 anon cannot read ' || v_t, v_c = '42501', v_c);
    end loop;

    -- Nobody can write: the statements below are valid except for the missing privilege.
    perform pg_temp.rec('A5 an Admin cannot INSERT a package (no write grant: writes go through functions)',
      pg_temp.code_as(v_admin, $q$insert into public.packages (name, kind) values ('ZZVERIFY 0046 NoWrite', 'duration')$q$) = '42501', '');
    foreach v_t in array v_tables loop
      v_c := pg_temp.code_as(v_admin, format('update public.%I set %s = %s', v_t,
               case v_t when 'packages' then 'name' when 'package_duration_options' then 'duration_option'
                        when 'package_fee_entries' then 'currency' when 'package_fee_entry_discounts' then 'discount_type'
                        else 'event_type' end,
               case v_t when 'packages' then 'name' when 'package_duration_options' then 'duration_option'
                        when 'package_fee_entries' then 'currency' when 'package_fee_entry_discounts' then 'discount_type'
                        else 'event_type' end));
      perform pg_temp.rec('A6 an Admin cannot UPDATE ' || v_t, v_c = '42501', v_c);
      v_c := pg_temp.code_as(v_admin, format('delete from public.%I', v_t));
      perform pg_temp.rec('A7 an Admin cannot DELETE from ' || v_t, v_c = '42501', v_c);
    end loop;
    perform pg_temp.rec('A8 an Admin cannot call a trigger function (not callable by any client role)',
      pg_temp.code_as(v_admin, 'select public.packages_guard()') = '42501'
      and pg_temp.code_as(v_admin, 'select public.package_events_guard()') = '42501', '');
    if v_instr_user is null then
      perform pg_temp.skip('A9 an Instructor cannot write any package table', 'needs an Instructor profile (none exists)');
    else
      perform pg_temp.rec('A9 an Instructor cannot write any package table',
        pg_temp.code_as(v_instr_user, $q$insert into public.packages (name, kind) values ('ZZVERIFY 0046 NoWrite2', 'duration')$q$) = '42501'
        and pg_temp.code_as(v_instr_user, 'delete from public.package_events') = '42501', '');
    end if;
  end if;

  -- Z. Existing data unchanged -----------------------------------------------------------------------------------------------------------
  if v_ready then
    update _fingerprints f set after_hash = pg_temp.table_hash(to_regclass('public.' || f.tbl));
    for v_t in select tbl from _fingerprints order by tbl loop
      perform pg_temp.rec('Z ' || v_t || ' is byte-for-byte unchanged by this script',
        (select before_hash = after_hash from _fingerprints where tbl = v_t), '');
    end loop;
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

-- AFTER THE ROLLBACK (run separately, as its own statement - never inside the verification transaction).
-- Nothing of the run may remain. The fixtures are found by name:
--
--   select
--     (select count(*) from public.packages where position('ZZVERIFY 0046' in name) = 1 or lower(name) = 'z0')          as leftover_packages,
--     (select count(*) from public.package_events e join public.packages p on p.id = e.package_id
--       where position('ZZVERIFY 0046' in p.name) = 1)                                                                   as leftover_events;
--
-- Both must be 0. (If a package already has one of those names before any run, the run's preflight P1 refuses to start.)
