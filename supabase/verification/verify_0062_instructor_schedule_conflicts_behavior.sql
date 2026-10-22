-- ===========================================================================
-- Migration 0062 verification (behaviour) - instructor schedule conflicts
-- Exercises supabase/migrations/0062_instructor_schedule_conflicts.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  0062 is applied: the trigger exists on public.schedules and is enabled; its function is SECURITY DEFINER, VOLATILE, has a pinned
--       search_path and is executable by no client role. Otherwise every scenario is skipped.
--   PF  Preflight: no fixture name exists.
--   T   Times and instructors: an overlapping class of the same instructor on the same day is refused (23P01) with the conflicting row's
--       fields in DETAIL and nothing stored (T1); back-to-back classes on both sides are allowed (T2); another instructor at the same
--       time in the same batch is allowed (T3); the same instructor at the same time on another day is allowed (T4); the same
--       instructor in ANOTHER batch is refused (T5).
--   D   Effective dates: sharing only the last day of a period (inclusive) is refused (D1); starting the day after it ends is allowed
--       (D2); a period overlapping an open-ended one (no effective_until) is refused (D3); a period ending the day before another
--       starts is allowed (D4).
--   I   Status does not decide: an INACTIVE schedule whose dates overlap still conflicts (I1); after its end date it does not (I2).
--   M   One multi-row INSERT (Add Schedule's shape): two overlapping rows refuse the WHOLE statement - neither row is stored - and the
--       DETAIL still describes the rolled-back sibling (M1); two back-to-back rows in one statement are both stored (M2).
--   S   Shortening, deactivation, extension and a conflict saved before 0062 (the legacy fixture, see below): the legacy pair is
--       created and the trigger is enabled again at once (S0); another write for that instructor leaves the pair untouched (S1);
--       shortening one of the pair is allowed (S2); deactivating it is allowed (S3); extending it while it still overlaps is refused
--       (S4); extending a schedule into no conflict is allowed (S5); extending one into a conflict is refused (S6); moving one of the
--       pair to a back-to-back time removes the overlap and is allowed (S7); the other one of the pair was never changed (S8).
--   E   Through the 0061 save functions, as the Admin: a versioned edit into a conflict is refused and the version close is rolled
--       back with it (E1); a versioned edit to a free time closes and adds the version (E2); an in-place edit into a conflict is refused
--       (E3); an extra day ("Also creates") that conflicts refuses the whole edit (E4); a Direct Edit moving an unused schedule onto a
--       conflict is refused (E5) and onto a back-to-back time is allowed (E6); re-versioning an old version (a stale form) into its own
--       later version is refused (E7).
--   Z   Every schedule and series that existed before this script is byte-for-byte unchanged by it.
--
-- PREREQUISITES: 0060, 0061 and 0062 applied. Group E calls the save functions as the Admin (a profile with role 'admin'); without one
-- it is reported NOT TESTED. Groups T-S write the tables directly as the owner: the trigger fires for every role.
--
-- THE LEGACY FIXTURE (group S) - DISABLES ONE TRIGGER, RUN WITH THE APP IDLE
--   A conflict saved before 0062 cannot be created while the trigger is on. S0 therefore runs
--     alter table public.schedules disable trigger schedules_instructor_conflict_check
--   inserts ONE row, and enables the trigger again immediately (also on error) and checks that it is enabled. Only this trigger is
--   disabled - no other trigger, and never session_replication_role. ALTER TABLE takes an ACCESS EXCLUSIVE lock on public.schedules
--   that is held until the final ROLLBACK, so every read or write of schedules by the running application WAITS until this script
--   ends. Run it when nobody is using the app, on a database you are allowed to lock briefly. The ROLLBACK also undoes the DISABLE.
--   ALTER TABLE needs the table's owner (the SQL editor's postgres role), as verify_0033 / verify_0051 / verify_0055 already require.
--
-- HOW A REFUSED STATEMENT IS JUDGED
--   Each statement runs inside its own sub-block (BEGIN ... EXCEPTION), so a refused one has all of its writes rolled back, exactly as
--   a failing statement or RPC is. Results read 'OK' or 'ERR:<sqlstate>:<message>|<detail>'. A conflict's DETAIL is 0062's JSON
--   object; pg_temp.det(r) parses it (NULL when it is not JSON), and each check compares its fields - reason, conflict_schedule_id,
--   batch_id / batch_code / batch_name, day_of_week, start_time / end_time (HH:MM), effective_from / effective_until (YYYY-MM-DD or
--   null).
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ, so the digest of existing rows comes from one snapshot), ending in ROLLBACK. Disposable fixtures
--   only: batches 'ZZVERIFY 0062 ...' (codes ZZV62...), instructors 'ZZVERIFY 0062 ...', and their series and schedules. Each group uses
--   its own instructors, so no scenario depends on another group's rows and no real instructor's schedules are involved. No student is
--   created. No COMMIT.
--
-- LIMITATIONS
--   * CONCURRENCY IS NOT TESTED HERE: one transaction cannot race itself, and REPEATABLE READ is not the level the guarantee is for.
--     Check it by hand on a disposable database with two psql sessions at the default READ COMMITTED (not two SQL editor tabs, which do
--     not overlap). Setup, in either session (then commit):
--         insert into public.batches (name, code) values ('ZZCONC 0062', 'ZZC62') returning id;                 -- <b>
--         insert into public.instructors (full_name) values ('ZZCONC 0062 Instructor') returning id;           -- <i>
--         insert into public.instructors (full_name) values ('ZZCONC 0062 Other') returning id;                -- <j>
--         insert into public.schedule_series (batch_id) values (<b>), (<b>), (<b>) returning id;               -- <x1> <x2> <x3>
--       (a) the same instructor - the second waits, then is refused:
--         session 1: begin; insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, series_id)
--                           values (<b>, <i>, 'monday', '06:00', '07:00', current_date, <x1>);
--         session 2: begin; insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, series_id)
--                           values (<b>, <i>, 'monday', '06:30', '07:30', current_date, <x2>);           -- WAITS for session 1
--         session 1: commit;
--         session 2: -- must now fail: ERROR 23P01 "This instructor already has a class ..." with DETAIL naming session 1's row.
--                    rollback;
--       (b) after session 1 ROLLS BACK instead of committing, session 2's insert must succeed (then roll it back).
--       (c) another instructor does not wait: with session 1 holding (a)'s insert uncommitted, session 2 inserting for <j> at the same
--           time with <x3> returns at once.
--     Clean up afterwards (the ZZCONC rows were committed): delete the ZZCONC schedules, then their series, instructors and batch.
--   * "Today" is the centre's date. Running across the centre's midnight may move the date boundaries.
--   * The application's handling of 23P01 (lib/schedules) is C2b and is tested separately, from source.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
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

create function pg_temp.today()
returns date language sql as $f$ select (now() at time zone public.centre_timezone())::date $f$;

-- One statement that RETURNS A ROW (a SELECT, or an INSERT ... RETURNING id::text) as the owner, in its own sub-block: 'OK' (or its single
-- text result), else 'ERR:<sqlstate>:<message>|<detail>'. EXECUTE ... INTO is only valid for a command that returns rows - use pg_temp.run for a
-- plain INSERT or an UPDATE.
create function pg_temp.try(p_sql text)
returns text language plpgsql as $f$
declare
  v_out    text;
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  begin
    execute p_sql into v_out;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    return 'ERR:' || v_state || ':' || v_msg || '|' || coalesce(v_detail, '');
  end;
  return coalesce(v_out, 'OK');
end $f$;

-- One command that returns NO rows (a plain INSERT or an UPDATE) as the owner, in its own sub-block: 'OK', else 'ERR:<sqlstate>:<message>|<detail>'.
-- No INTO: EXECUTE ... INTO raises 42601 for such a command after it has run, which the handler would report as a failure of a write the
-- trigger had accepted (and roll it back).
create function pg_temp.run(p_sql text)
returns text language plpgsql as $f$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    return 'ERR:' || v_state || ':' || v_msg || '|' || coalesce(v_detail, '');
  end;
  return 'OK';
end $f$;

-- One statement as an authenticated user, with the same result format. The claims are cleared afterwards.
create function pg_temp.call_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out    text;
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user, 'role', 'authenticated')::text, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_out;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
    v_out := 'ERR:' || v_state || ':' || v_msg || '|' || coalesce(v_detail, '');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v_out, 'OK');
end $f$;

create function pg_temp.mk_batch(p_name text, p_code text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batches (name, code) values ('ZZVERIFY 0062 ' || p_name, p_code) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_instructor(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.instructors (full_name) values ('ZZVERIFY 0062 ' || p_name) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_series(p_batch uuid)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_id;
  return v_id;
end $f$;

-- The DETAIL of a pg_temp.try / call_as result as JSON: everything after the first '|' (0062's messages contain none). NULL when the
-- result is not an error or its DETAIL is not JSON.
create function pg_temp.det(p_result text)
returns jsonb language plpgsql as $f$
begin
  if p_result is null or p_result not like 'ERR:%|%' then
    return null;
  end if;
  return substr(p_result, position('|' in p_result) + 1)::jsonb;
exception when others then
  return null;
end $f$;

-- The INSERT of one schedule on a new series, as SQL text (so pg_temp.try can judge it). Returns the new id as text.
-- The series is created when this text is built, outside pg_temp.try's sub-block, so a refused insert leaves that series empty until
-- the final ROLLBACK. That is harmless: no check counts series, except group E's batch digests, which are always taken after their
-- fixtures are built.
create function pg_temp.ins_sql(p_batch uuid, p_instructor uuid, p_day text, p_start time, p_end time, p_from date, p_until date,
                                p_status text default 'active')
returns text language sql as $f$
  select format('insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
                 values (%L, %L, %L, %L, %L, %L, %L, %L, %L) returning id::text',
                p_batch, p_instructor, p_day, p_start, p_end, p_from, p_until, p_status, pg_temp.mk_series(p_batch))
$f$;

-- Inserts a schedule that is expected to be allowed, returning its id (NULL when it was refused).
create function pg_temp.ins(p_batch uuid, p_instructor uuid, p_day text, p_start time, p_end time, p_from date, p_until date,
                            p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_r text := pg_temp.try(pg_temp.ins_sql(p_batch, p_instructor, p_day, p_start, p_end, p_from, p_until, p_status));
begin
  return case when v_r like 'ERR:%' then null else v_r::uuid end;
end $f$;

create function pg_temp.n(p_instructor uuid)
returns integer language sql as $f$ select count(*)::integer from public.schedules where instructor_id = p_instructor $f$;

-- Every schedule and series of a batch, every column: equal before and after means nothing was written.
create function pg_temp.shape(p_batch uuid)
returns text language sql as $f$
  select coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s where s.batch_id = p_batch), '') || '#' ||
         coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss where ss.batch_id = p_batch), '')
$f$;

create function pg_temp.row_of(p_schedule uuid)
returns text language sql as $f$ select coalesce((select to_jsonb(s)::text from public.schedules s where s.id = p_schedule), '') $f$;

create function pg_temp.edit_sql(p_id uuid, p_instructor uuid, p_start time, p_end time, p_from date, p_until date, p_extra text)
returns text language sql as $f$
  select format('select public.save_schedule_edit(%L, %L, %L, %L, %L, %L, false, null, %L::text[])::text',
                p_id, p_instructor, p_start, p_end, p_from, p_until, p_extra)
$f$;

create function pg_temp.unused_sql(p_id uuid, p_day text, p_instructor uuid, p_start time, p_end time, p_from date, p_until date)
returns text language sql as $f$
  select format('select public.save_unused_schedule_edit(%L, %L, %L, %L, %L, %L, %L, false, null, %L::text[])::text',
                p_id, p_day, p_instructor, p_start, p_end, p_from, p_until, '{}')
$f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _legacy_hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s), '') ||
  coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss), ''));

do $$
declare
  v_applied boolean;
  v_today   date := pg_temp.today();
  v_admin   uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid;
  b  uuid; b2 uuid;
  s1 uuid; s2 uuid; s3 uuid; o uuid; l1 uuid; l2 uuid; f uuid; g uuid; w uuid; u uuid; t uuid; nv uuid;
  x1 uuid; x2 uuid;
  r  text;
  snap text;
  l1_row text;
  n0 integer;
begin
  -- P0. The migration is applied ----------------------------------------------------------------------------------------------
  select exists (select 1 from pg_trigger
                 where tgrelid = 'public.schedules'::regclass and tgname = 'schedules_instructor_conflict_check'
                   and not tgisinternal and tgenabled = 'O')
     and exists (select 1 from pg_proc
                 where oid = to_regprocedure('public.schedules_instructor_conflict_guard()')
                   and prosecdef and provolatile = 'v'
                   and exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))
     and not has_function_privilege('authenticated', 'public.schedules_instructor_conflict_guard()', 'execute')
     and not has_function_privilege('anon', 'public.schedules_instructor_conflict_guard()', 'execute')
  into v_applied;
  perform pg_temp.rec('P0 migration 0062 is applied (trigger enabled on schedules; guard SECURITY DEFINER, VOLATILE, pinned search_path, not executable by clients)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0062 is not applied.');
    return;
  end if;

  if exists (select 1 from public.batches where position('ZZVERIFY 0062' in name) = 1 or lower(code) like 'zzv62%')
     or exists (select 1 from public.instructors where position('ZZVERIFY 0062' in full_name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0062 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  -- T. Times and instructors --------------------------------------------------------------------------------------------------------
  i1 := pg_temp.mk_instructor('Instructor T1');
  i2 := pg_temp.mk_instructor('Instructor T2');
  b  := pg_temp.mk_batch('Times', 'ZZV62T');
  b2 := pg_temp.mk_batch('Times Other Batch', 'ZZV62U');
  s1 := pg_temp.ins(b, i1, 'monday', '06:00', '07:00', v_today - 30, null);
  perform pg_temp.rec('T0 fixture: a first Monday 06:00-07:00 class is stored', s1 is not null, '');

  n0 := pg_temp.n(i1);
  r := pg_temp.try(pg_temp.ins_sql(b, i1, 'monday', '06:30', '07:30', v_today, null));
  perform pg_temp.rec('T1 the same instructor, same day, overlapping time (06:30-07:30 vs 06:00-07:00) is refused (23P01) with the conflicting row''s fields in DETAIL, and nothing is stored',
    r like 'ERR:23P01:This instructor already has a class at an overlapping time on that day.|%'
    and pg_temp.det(r) ->> 'reason' = 'instructor_conflict'
    and pg_temp.det(r) ->> 'conflict_schedule_id' = s1::text
    and pg_temp.det(r) ->> 'batch_id' = b::text
    and pg_temp.det(r) ->> 'batch_code' = 'ZZV62T'
    and pg_temp.det(r) ->> 'batch_name' = 'ZZVERIFY 0062 Times'
    and pg_temp.det(r) ->> 'day_of_week' = 'monday'
    and pg_temp.det(r) ->> 'start_time' = '06:00'
    and pg_temp.det(r) ->> 'end_time' = '07:00'
    and pg_temp.det(r) ->> 'effective_from' = to_char(v_today - 30, 'YYYY-MM-DD')
    and jsonb_typeof(pg_temp.det(r) -> 'effective_until') = 'null'
    and pg_temp.n(i1) = n0, r);

  s2 := pg_temp.ins(b, i1, 'monday', '07:00', '08:00', v_today - 30, null);
  s3 := pg_temp.ins(b, i1, 'monday', '05:00', '06:00', v_today - 30, null);
  perform pg_temp.rec('T2 back-to-back classes on both sides (07:00-08:00 and 05:00-06:00 next to 06:00-07:00) are allowed', s2 is not null and s3 is not null, '');

  perform pg_temp.rec('T3 another instructor at the same day and time, in the same batch, is allowed',
    pg_temp.ins(b, i2, 'monday', '06:00', '07:00', v_today - 30, null) is not null, '');

  perform pg_temp.rec('T4 the same instructor at the same time on another day is allowed',
    pg_temp.ins(b, i1, 'tuesday', '06:00', '07:00', v_today - 30, null) is not null, '');

  n0 := pg_temp.n(i1);
  r := pg_temp.try(pg_temp.ins_sql(b2, i1, 'monday', '06:15', '06:45', v_today + 5, v_today + 50));
  perform pg_temp.rec('T5 the same instructor in ANOTHER batch at an overlapping time is refused (23P01) and nothing is stored',
    r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = s1::text
    and pg_temp.det(r) ->> 'batch_code' = 'ZZV62T' and pg_temp.n(i1) = n0, r);

  -- D. Effective dates ----------------------------------------------------------------------------------------------------------------
  i3 := pg_temp.mk_instructor('Instructor D');
  b  := pg_temp.mk_batch('Dates', 'ZZV62D');
  s1 := pg_temp.ins(b, i3, 'wednesday', '06:00', '07:00', v_today + 10, v_today + 20);

  n0 := pg_temp.n(i3);
  r := pg_temp.try(pg_temp.ins_sql(b, i3, 'wednesday', '06:00', '07:00', v_today + 20, null));
  perform pg_temp.rec('D1 a period sharing only the other''s LAST day (inclusive endpoints) is refused and nothing is stored',
    s1 is not null and r like 'ERR:23P01:%'
    and pg_temp.det(r) ->> 'conflict_schedule_id' = s1::text
    and pg_temp.det(r) ->> 'effective_from' = to_char(v_today + 10, 'YYYY-MM-DD')
    and pg_temp.det(r) ->> 'effective_until' = to_char(v_today + 20, 'YYYY-MM-DD')
    and pg_temp.n(i3) = n0, r);

  s2 := pg_temp.ins(b, i3, 'wednesday', '06:00', '07:00', v_today + 21, null);
  perform pg_temp.rec('D2 a period starting the day after the other ends is allowed (here open-ended)', s2 is not null, '');

  n0 := pg_temp.n(i3);
  r := pg_temp.try(pg_temp.ins_sql(b, i3, 'wednesday', '06:30', '07:30', v_today + 100, v_today + 120));
  perform pg_temp.rec('D3 a period overlapping an open-ended schedule (no effective_until) is refused, and DETAIL gives effective_until as JSON null',
    r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = s2::text
    and jsonb_typeof(pg_temp.det(r) -> 'effective_until') = 'null'          -- present and JSON null (a missing key gives SQL NULL)
    and pg_temp.n(i3) = n0, r);

  perform pg_temp.rec('D4 a period ending the day before the other starts is allowed',
    pg_temp.ins(b, i3, 'wednesday', '06:00', '07:00', v_today - 50, v_today + 9) is not null, '');

  -- I. Status does not decide ------------------------------------------------------------------------------------------------------------
  i4 := pg_temp.mk_instructor('Instructor I');
  b  := pg_temp.mk_batch('Inactive', 'ZZV62I');
  s1 := pg_temp.ins(b, i4, 'thursday', '06:00', '07:00', v_today - 10, v_today + 30, 'inactive');

  n0 := pg_temp.n(i4);
  r := pg_temp.try(pg_temp.ins_sql(b, i4, 'thursday', '06:00', '07:00', v_today, null));
  perform pg_temp.rec('I1 an INACTIVE schedule whose dates overlap still conflicts (status does not decide)',
    s1 is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = s1::text
    and pg_temp.det(r) ->> 'day_of_week' = 'thursday' and pg_temp.n(i4) = n0, r);

  perform pg_temp.rec('I2 after the inactive schedule''s end date the same class is allowed',
    pg_temp.ins(b, i4, 'thursday', '06:00', '07:00', v_today + 31, null) is not null, '');

  -- M. One multi-row INSERT ----------------------------------------------------------------------------------------------------------------
  i5 := pg_temp.mk_instructor('Instructor M');
  b  := pg_temp.mk_batch('Multi', 'ZZV62M');
  x1 := pg_temp.mk_series(b);
  x2 := pg_temp.mk_series(b);
  r := pg_temp.run(format(
    'insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, series_id)
     values (%L, %L, ''friday'', ''06:00'', ''07:00'', %L, %L), (%L, %L, ''friday'', ''06:30'', ''07:30'', %L, %L)',
    b, i5, v_today, x1, b, i5, v_today, x2));
  perform pg_temp.rec('M1 two overlapping rows in ONE insert refuse the whole statement - neither row is stored - and DETAIL still describes the rolled-back sibling (day and times)',
    r like 'ERR:23P01:%'
    and pg_temp.det(r) ->> 'reason' = 'instructor_conflict'
    and pg_temp.det(r) ->> 'day_of_week' = 'friday'
    and pg_temp.det(r) ->> 'start_time' in ('06:00', '06:30')
    and pg_temp.det(r) ->> 'batch_code' = 'ZZV62M'
    and not exists (select 1 from public.schedules where id = (pg_temp.det(r) ->> 'conflict_schedule_id')::uuid)
    and pg_temp.n(i5) = 0, r);

  r := pg_temp.run(format(
    'insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, series_id)
     values (%L, %L, ''friday'', ''06:00'', ''07:00'', %L, %L), (%L, %L, ''friday'', ''07:00'', ''08:00'', %L, %L)',
    b, i5, v_today, x1, b, i5, v_today, x2));
  perform pg_temp.rec('M2 two back-to-back rows in one insert are both stored', r not like 'ERR:%' and pg_temp.n(i5) = 2, r);

  -- S. Shortening, deactivation, extension and a conflict saved before 0062 ---------------------------------------------------------------
  i6 := pg_temp.mk_instructor('Instructor S');
  b  := pg_temp.mk_batch('Legacy', 'ZZV62S');
  l1 := pg_temp.ins(b, i6, 'saturday', '06:00', '07:00', v_today - 60, null);

  -- The legacy fixture: the ONLY place the trigger is off, for ONE insert, and it is enabled again whatever happens.
  r := pg_temp.ins_sql(b, i6, 'saturday', '06:30', '07:30', v_today - 30, null);
  alter table public.schedules disable trigger schedules_instructor_conflict_check;
  begin
    execute r into r;
    l2 := r::uuid;
  exception when others then
    l2 := null;
  end;
  alter table public.schedules enable trigger schedules_instructor_conflict_check;
  perform pg_temp.rec('S0 legacy fixture: an overlapping pair exists, and the trigger is enabled again immediately',
    l1 is not null and l2 is not null
    and exists (select 1 from pg_trigger where tgrelid = 'public.schedules'::regclass
                  and tgname = 'schedules_instructor_conflict_check' and tgenabled = 'O'), '');
  l1_row := pg_temp.row_of(l1);

  snap := pg_temp.row_of(l1) || pg_temp.row_of(l2);
  w := pg_temp.ins(b, i6, 'sunday', '06:00', '07:00', v_today + 10, v_today + 20);
  perform pg_temp.rec('S1 another write for the same instructor (a Sunday class) is allowed and leaves the legacy pair untouched',
    w is not null and pg_temp.row_of(l1) || pg_temp.row_of(l2) = snap, '');

  r := pg_temp.run(format('update public.schedules set effective_until = %L where id = %L', v_today + 60, l2));
  perform pg_temp.rec('S2 shortening one of the conflicting pair (open-ended -> an end date) is allowed',
    r = 'OK' and (select effective_until from public.schedules where id = l2) = v_today + 60, r);

  r := pg_temp.run(format('update public.schedules set effective_until = %L, status = ''inactive'' where id = %L', v_today + 30, l2));
  perform pg_temp.rec('S3 deactivating it (an earlier end date and inactive, as deactivateSchedule writes) is allowed',
    r = 'OK' and (select status from public.schedules where id = l2) = 'inactive', r);

  r := pg_temp.run(format('update public.schedules set effective_until = %L where id = %L', v_today + 90, l2));
  perform pg_temp.rec('S4 extending it while it still overlaps the other is refused (23P01) and the end date stays',
    r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = l1::text
    and (select effective_until from public.schedules where id = l2) = v_today + 30, r);

  r := pg_temp.run(format('update public.schedules set effective_until = %L where id = %L', v_today + 40, w));
  perform pg_temp.rec('S5 extending a schedule into no conflict is allowed', r = 'OK' and (select effective_until from public.schedules where id = w) = v_today + 40, r);

  s1 := pg_temp.ins(b, i6, 'sunday', '06:00', '07:00', v_today + 41, v_today + 50);
  r := pg_temp.run(format('update public.schedules set effective_until = %L where id = %L', v_today + 45, w));
  perform pg_temp.rec('S6 extending a schedule into a conflict is refused (23P01) and the end date stays',
    s1 is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = s1::text
    and (select effective_until from public.schedules where id = w) = v_today + 40, r);

  r := pg_temp.run(format('update public.schedules set start_time = ''07:00'', end_time = ''08:00'' where id = %L', l2));
  perform pg_temp.rec('S7 moving one of the legacy pair to a back-to-back time (07:00-08:00) removes the overlap and is allowed',
    r = 'OK' and (select start_time from public.schedules where id = l2) = '07:00', r);

  perform pg_temp.rec('S8 the other schedule of the legacy pair was never changed by any of this', pg_temp.row_of(l1) = l1_row, '');

  -- E. Through the 0061 save functions, as the Admin ----------------------------------------------------------------------------------------
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    perform pg_temp.skip('E all scenarios', 'needs an Admin profile (public.profiles role admin)');
  else
    i7 := pg_temp.mk_instructor('Instructor E');

    b  := pg_temp.mk_batch('Versioned', 'ZZV62V');
    s1 := pg_temp.ins(b, i7, 'monday', '06:00', '07:00', v_today - 30, null);
    o  := pg_temp.ins(b, i7, 'monday', '09:00', '10:00', v_today - 30, null);
    snap := pg_temp.shape(b);
    r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s1, i7, '09:30', '10:30', v_today + 7, null, '{}'));
    perform pg_temp.rec('E1 a versioned edit into a conflict (09:30-10:30 vs 09:00-10:00) is refused (23P01), and the version close is rolled back with it - nothing changes',
      s1 is not null and o is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = o::text
      and pg_temp.det(r) ->> 'start_time' = '09:00' and pg_temp.det(r) ->> 'end_time' = '10:00' and pg_temp.shape(b) = snap, r);

    r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s1, i7, '07:00', '08:00', v_today + 7, null, '{}'));
    nv := (select id from public.schedules where series_id = (select series_id from public.schedules where id = s1) and id <> s1);
    perform pg_temp.rec('E2 a versioned edit to a free time (07:00-08:00) closes the current version and adds the new one',
      r not like 'ERR:%' and (select effective_until from public.schedules where id = s1) = v_today + 6 and nv is not null, r);

    r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s1, i7, '07:00', '08:00', v_today + 14, null, '{}'));
    perform pg_temp.rec('E7 re-versioning the OLD version (a stale form) into a period its own later version covers is refused (23P01) - the conflict is the later version',
      r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = nv::text
      and (select effective_until from public.schedules where id = s1) = v_today + 6, r);

    b  := pg_temp.mk_batch('InPlace', 'ZZV62P');
    f  := pg_temp.ins(b, i7, 'tuesday', '06:00', '07:00', v_today + 20, null);
    g  := pg_temp.ins(b, i7, 'tuesday', '08:00', '09:00', v_today + 20, null);
    snap := pg_temp.shape(b);
    r := pg_temp.call_as(v_admin, pg_temp.edit_sql(f, i7, '08:30', '09:30', v_today + 20, null, '{}'));
    perform pg_temp.rec('E3 an in-place edit (effective date on its own start) into a conflict is refused (23P01) and nothing changes',
      f is not null and g is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = g::text
      and pg_temp.shape(b) = snap, r);

    w := pg_temp.ins(b, i7, 'wednesday', '08:00', '09:00', v_today, null);
    snap := pg_temp.shape(b);
    r := pg_temp.call_as(v_admin, pg_temp.edit_sql(g, i7, '08:00', '09:00', v_today + 20, null, '{wednesday}'));
    perform pg_temp.rec('E4 an extra day ("Also creates" Wednesday) that conflicts refuses the whole edit - no extra series or schedule, nothing changes',
      w is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = w::text
      and pg_temp.det(r) ->> 'day_of_week' = 'wednesday' and pg_temp.shape(b) = snap, r);

    b  := pg_temp.mk_batch('Direct', 'ZZV62X');
    u  := pg_temp.ins(b, i7, 'thursday', '06:00', '07:00', v_today + 5, null);
    t  := pg_temp.ins(b, i7, 'friday', '06:00', '07:00', v_today + 5, null);
    snap := pg_temp.shape(b);
    r := pg_temp.call_as(v_admin, pg_temp.unused_sql(u, 'friday', i7, '06:00', '07:00', v_today + 5, null));
    perform pg_temp.rec('E5 a Direct Edit moving an unused schedule onto a conflict (Friday 06:00-07:00) is refused (23P01) and nothing changes',
      u is not null and t is not null and r like 'ERR:23P01:%' and pg_temp.det(r) ->> 'conflict_schedule_id' = t::text
      and pg_temp.det(r) ->> 'batch_code' = 'ZZV62X' and pg_temp.shape(b) = snap, r);

    r := pg_temp.call_as(v_admin, pg_temp.unused_sql(u, 'friday', i7, '07:00', '08:00', v_today + 5, null));
    perform pg_temp.rec('E6 the same Direct Edit to a back-to-back time (Friday 07:00-08:00) is allowed',
      r not like 'ERR:%' and exists (select 1 from public.schedules where id = u and day_of_week = 'friday' and start_time = '07:00'), r);
  end if;

  -- Z. Existing data unchanged ----------------------------------------------------------------------------------------------------------------
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s
              where s.batch_id in (select id from public.batches where position('ZZVERIFY 0062' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss
              where ss.batch_id in (select id from public.batches where position('ZZVERIFY 0062' in name) <> 1)), '')));
  perform pg_temp.rec('Z every schedule and series that existed before this script is byte-for-byte unchanged by it',
    (select before_hash = after_hash from _legacy_hash), '');
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain, and the trigger must be enabled.
--   select (select count(*) from public.batches where position('ZZVERIFY 0062' in name) = 1) as leftover_batches,
--          (select count(*) from public.instructors where position('ZZVERIFY 0062' in full_name) = 1) as leftover_instructors,
--          (select tgenabled from pg_trigger where tgrelid = 'public.schedules'::regclass
--             and tgname = 'schedules_instructor_conflict_check') as trigger_enabled;
-- leftover_batches and leftover_instructors must be 0, and trigger_enabled must be 'O'.
