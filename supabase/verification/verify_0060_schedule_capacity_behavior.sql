-- ===========================================================================
-- Migration 0060 verification (behaviour) - schedule capacity
-- Exercises supabase/migrations/0060_schedule_capacity.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  0060 is applied: schedule_series.capacity and its constraint, the functions and triggers. Otherwise everything is skipped.
--   B1  0059's batch capacity is gone: no batches.capacity column, no 0059 trigger or function.
--   PF  Preflight: no fixture name exists.
--   V   Capacity values on a series: NULL, 1, 1000 accepted; 0, -1, 1001 refused (23514, schedule_series_capacity_valid).
--   N   A series without a capacity is unlimited.
--   F   A full series refuses another assignment ("The schedule is full") and keeps nothing of it; a future-dated one too.
--   O   What takes a place: not an ended assignment, not one whose enrollment is inactive or ended; yes an assignment ending today,
--       a future-dated one, and one of an inactive student. An already-ended assignment can still be recorded in a full series.
--   S   An enrollment with several assignments takes one place in each of those series.
--   R   Enrollment reactivated into a full series: refused (it stays inactive); deactivating frees the place.
--   X   Enrollment end date extended (past -> null) into a full series: refused; ending one frees the place.
--   Y   Assignment end date extended (past -> null) in a full series: refused; ending one frees the place.
--   U   Writes that take no new place are never refused at capacity (another future end, no end, the same values again, a new
--       enrollment start with the 0051 cascade).
--   M   Moving an assignment to a full series: refused; to a series with room: accepted.
--   T   One statement over several rows: three assignments into two places refused as a whole; two accepted.
--   D   Lowering a series' capacity: below the places taken refused ("The capacity cannot be lowered") and nothing changes; to
--       exactly the places taken, higher, or NULL accepted.
--   CR  create_enrollment as the Admin: creates the enrollment and every assignment; a full schedule among them, a schedule of
--       another batch, no schedule, a duplicate enrollment or a start before the join date each write NOTHING; not the Admin: 42501.
--   CH  change_enrollment as the Admin: a switch into a full schedule writes nothing (the old assignment stays open); a switch from
--       today closes the old assignment yesterday and adds the new one; a future-dated switch counts toward both series; reactivating
--       while switching away from a full series succeeds (judged on the result); a back-dated change, a schedule of another batch or
--       not the Admin writes nothing; an unstarted assignment is withdrawn; a start-date move reports the moved count (0051).
--   Z   Every batch, series, enrollment and assignment that existed before this script is byte-for-byte unchanged.
--
-- PREREQUISITES: 0060 applied. CR and CH need an Admin profile (public.profiles role 'admin'); without one they are NOT TESTED.
--
-- HOW THE DEFERRED CHECKS ARE EXERCISED
--   0060's capacity checks run at COMMIT. This script never commits, so after each write it runs
--   SET CONSTRAINTS enrollment_schedules_capacity_check, batch_enrollments_capacity_check IMMEDIATE, which fires the pending checks
--   then and there (inside the same savepoint, so a refused write is rolled back with its check). create_enrollment and
--   change_enrollment set them DEFERRED themselves and force them before returning, exactly as they do in the application.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ, so the digests of existing rows come from one snapshot), ending in ROLLBACK. Disposable fixtures
--   only: students 'ZZVERIFY 0060 ...', batches 'ZZVERIFY 0060 ...' (codes ZZV60...), their series, enrollments and assignments. No
--   trigger is disabled. The series rows locked by the checks are fixture rows.
--   Every fixture student consumes a value of the student_code sequence (the YC-... Student IDs) even though it is rolled back, so
--   real Student IDs will skip those numbers. Run it on a disposable database if gaps matter.
--
-- LIMITATIONS
--   * CONCURRENCY IS NOT TESTED HERE: one transaction cannot race itself. It rests on the series row lock (READ COMMITTED only). To
--     check it by hand on a disposable database, with two psql sessions (not two SQL editor tabs, which do not overlap), a fixture
--     series <x> of capacity 1, and fixture enrollments <e1>, <e2> (active, current) of its batch; <d> is the centre's date:
--     select (now() at time zone public.centre_timezone())::date;
--       session 1: begin; insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
--                  values (<e1>, <x>, <d>);
--       session 2: begin; insert into public.enrollment_schedules (...) values (<e2>, <x>, <d>); commit;   -- waits for session 1
--       session 1: commit;
--       session 2: -- its commit must now fail with 23514 "The schedule is full (capacity 1) ...".
--     And against a capacity cut, with <x> of capacity 2 holding one place: session 1 inserts as above (no commit); session 2 runs
--     "update public.schedule_series set capacity = 1 where id = <x>;" - it must succeed (it does not see the uncommitted place),
--     and then session 1's commit must fail with "The schedule is full (capacity 1)".
--   * "Today" is the centre's date. Running across the centre's midnight may move the date boundaries.
--   * The application does not call create_enrollment / change_enrollment yet (S3); this tests the database only.
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

-- One statement as the owner, with 0060's deferred checks fired right after it: 'OK', or '<sqlstate>:<message>'. A refused
-- statement is rolled back to its own savepoint, check included.
create function pg_temp.msg(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

-- One scalar query as an authenticated user (or as nobody when p_user is null): its text, or 'ERR:<sqlstate>:<message>'. The claims
-- are cleared afterwards so later owner statements are not taken for that user.
create function pg_temp.val_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user, 'role', 'authenticated')::text, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_out;
    set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;
  exception when others then
    v_out := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v_out, '');
end $f$;

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

create function pg_temp.today()
returns date language sql as $f$ select (now() at time zone public.centre_timezone())::date $f$;

create function pg_temp.mk_student(p_name text, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0060 ' || p_name, '9000000060', '+91', pg_temp.today() - 400, p_status) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_batch(p_name text, p_code text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batches (name, code) values ('ZZVERIFY 0060 ' || p_name, p_code) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_series(p_batch uuid, p_capacity integer)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.schedule_series (batch_id, capacity) values (p_batch, p_capacity) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_en(p_student uuid, p_batch uuid, p_start date, p_end date default null, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date, status)
  values (p_student, p_batch, p_start, p_end, p_status) returning id into v_id;
  return v_id;
end $f$;

-- A fixture assignment; its capacity check fires at once (a fixture that would overfill raises here).
create function pg_temp.mk_as(p_enrollment uuid, p_series uuid, p_start date, p_end date default null)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
  values (p_enrollment, p_series, p_start, p_end) returning id into v_id;
  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;
  return v_id;
end $f$;

create function pg_temp.as_sql(p_enrollment uuid, p_series uuid, p_start date, p_end date default null)
returns text language sql as $f$
  select format('insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date) values (%L, %L, %L, %L)',
                p_enrollment, p_series, p_start, p_end)
$f$;

create function pg_temp.occupied(p_series uuid)
returns integer language sql as $f$ select public.schedule_series_occupied_places(p_series, pg_temp.today()) $f$;

-- One enrollment and its assignments, as text: to prove a refused write changed nothing.
create function pg_temp.digest(p_enrollment uuid)
returns text language sql as $f$
  select coalesce((select to_jsonb(be)::text from public.batch_enrollments be where be.id = p_enrollment), 'none') || '|' ||
         coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es
                   where es.batch_enrollment_id = p_enrollment), '')
$f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _legacy_hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(b)::text, '|' order by b.id) from public.batches b), '') ||
  coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss), '') ||
  coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be), '') ||
  coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es), ''));

do $$
declare
  v_applied boolean;
  v_today   date := pg_temp.today();
  v_admin   uuid;
  v_c       text;
  v_before  text;
  b         uuid;
  b2        uuid;
  x         uuid;
  y         uuid;
  z         uuid;
  w         uuid;
  s1        uuid;
  s2        uuid;
  s3        uuid;
  s4        uuid;
  s5        uuid;
  s6        uuid;
  e1        uuid;
  e2        uuid;
  e3        uuid;
  a1        uuid;
  a2        uuid;
begin
  -- P0 / B1. Applied, and 0059's batch capacity removed --------------------------------------------------------------------
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schedule_series' and column_name = 'capacity')
     and exists (select 1 from pg_constraint where conname = 'schedule_series_capacity_valid' and conrelid = 'public.schedule_series'::regclass)
     and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'schedule_series_occupied_places', 'schedule_series_capacity_check', 'enrollment_schedules_capacity_check',
            'batch_enrollments_capacity_check', 'schedule_series_capacity_guard', 'enrollment_series_selection',
            'create_enrollment', 'change_enrollment')) = 8
     and (select count(*) from pg_trigger where not tgisinternal and tgname in (
            'enrollment_schedules_capacity_check', 'batch_enrollments_capacity_check', 'schedule_series_capacity_guard_trigger')) = 3
  into v_applied;
  perform pg_temp.rec('P0 migration 0060 is applied (column, constraint, eight functions, three triggers)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0060 is not applied.');
    return;
  end if;

  perform pg_temp.rec('B1 0059''s batch capacity is gone (no batches.capacity column, no 0059 trigger or function)',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'batches' and column_name = 'capacity')
    and not exists (select 1 from pg_trigger where tgname in ('batch_enrollments_capacity_guard_trigger', 'batches_capacity_guard_trigger'))
    and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('batch_enrollments_capacity_guard', 'batches_capacity_guard')), '');

  if exists (select 1 from public.students where position('ZZVERIFY 0060' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0060' in name) = 1 or lower(code) like 'zzv60%') then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0060 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  s1 := pg_temp.mk_student('One');
  s2 := pg_temp.mk_student('Two');
  s3 := pg_temp.mk_student('Three');
  s4 := pg_temp.mk_student('Four');
  s5 := pg_temp.mk_student('Five');
  s6 := pg_temp.mk_student('Six');

  -- V. Capacity values ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Values', 'ZZV60V');
  x := pg_temp.mk_series(b, null);
  perform pg_temp.rec('V1 a new series without a capacity is unlimited (NULL)', (select capacity from public.schedule_series where id = x) is null, '');
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 1 where id = %L', x));
  perform pg_temp.rec('V2 capacity 1 is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 1000 where id = %L', x));
  perform pg_temp.rec('V3 capacity 1000 is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 0 where id = %L', x));
  perform pg_temp.rec('V4 capacity 0 is refused (23514, schedule_series_capacity_valid)', v_c like '23514:%schedule_series_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = -1 where id = %L', x));
  perform pg_temp.rec('V5 capacity -1 is refused (23514, schedule_series_capacity_valid)', v_c like '23514:%schedule_series_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 1001 where id = %L', x));
  perform pg_temp.rec('V6 capacity 1001 is refused (23514, schedule_series_capacity_valid)', v_c like '23514:%schedule_series_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('insert into public.schedule_series (batch_id, capacity) values (%L, 0)', b));
  perform pg_temp.rec('V7 a new series with capacity 0 is refused', v_c like '23514:%schedule_series_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = null where id = %L', x));
  perform pg_temp.rec('V8 the capacity can be removed (NULL)', v_c = 'OK' and (select capacity from public.schedule_series where id = x) is null, v_c);

  -- N. Unlimited -------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Unlimited', 'ZZV60N');
  x := pg_temp.mk_series(b, null);
  perform pg_temp.mk_as(pg_temp.mk_en(s1, b, v_today), x, v_today);
  perform pg_temp.mk_as(pg_temp.mk_en(s2, b, v_today), x, v_today);
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s3, b, v_today), x, v_today));
  perform pg_temp.rec('N1 a series without a capacity takes a third assignment', v_c = 'OK' and pg_temp.occupied(x) = 3, v_c);

  -- F. A full series ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Full', 'ZZV60F');
  x := pg_temp.mk_series(b, 2);
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s1, b, v_today), x, v_today));
  perform pg_temp.rec('F1 below capacity (0 of 2) an assignment is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s2, b, v_today), x, v_today));
  perform pg_temp.rec('F2 the last place (1 of 2) is accepted', v_c = 'OK' and pg_temp.occupied(x) = 2, v_c);
  e3 := pg_temp.mk_en(s3, b, v_today);
  v_c := pg_temp.msg(pg_temp.as_sql(e3, x, v_today));
  perform pg_temp.rec('F3 a full series (2 of 2) refuses another assignment (23514, "The schedule is full (capacity 2)") and keeps nothing of it',
    v_c like '23514:The schedule is full (capacity 2)%' and not exists (select 1 from public.enrollment_schedules where batch_enrollment_id = e3), v_c);
  v_c := pg_temp.msg(pg_temp.as_sql(e3, x, v_today + 30));
  perform pg_temp.rec('F4 a future-dated assignment into a full series is refused too (it takes its place already)', v_c like '23514:The schedule is full%', v_c);

  -- O. What takes a place ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Occupancy', 'ZZV60O');
  x := pg_temp.mk_series(b, 2);
  perform pg_temp.mk_as(pg_temp.mk_en(s1, b, v_today - 60), x, v_today - 60, v_today - 1);           -- assignment ended yesterday
  perform pg_temp.mk_as(pg_temp.mk_en(s2, b, v_today - 60, null, 'inactive'), x, v_today - 60);       -- enrollment inactive
  perform pg_temp.mk_as(pg_temp.mk_en(s3, b, v_today - 60, v_today - 1), x, v_today - 60);            -- enrollment ended yesterday
  perform pg_temp.rec('O1 an ended assignment, and assignments of an inactive or ended enrollment, take no place', pg_temp.occupied(x) = 0, pg_temp.occupied(x)::text);
  perform pg_temp.mk_as(pg_temp.mk_en(s4, b, v_today - 60), x, v_today - 60, v_today);                -- ends today
  perform pg_temp.mk_as(pg_temp.mk_en(s5, b, v_today + 10), x, v_today + 10);                          -- future-dated
  perform pg_temp.rec('O2 an assignment ending today and a future-dated one each take a place (2 of 2)', pg_temp.occupied(x) = 2, pg_temp.occupied(x)::text);
  e1 := pg_temp.mk_en(s6, b, v_today - 90);
  v_c := pg_temp.msg(pg_temp.as_sql(e1, x, v_today));
  perform pg_temp.rec('O3 so the series is full: another assignment is refused', v_c like '23514:The schedule is full (capacity 2)%', v_c);
  v_c := pg_temp.msg(pg_temp.as_sql(e1, x, v_today - 90, v_today - 10));
  perform pg_temp.rec('O4 an assignment that ended before today can still be recorded in the full series (it takes no place)', v_c = 'OK', v_c);

  b2 := pg_temp.mk_batch('Inactive student', 'ZZV60I');
  y := pg_temp.mk_series(b2, 1);
  perform pg_temp.mk_as(pg_temp.mk_en(pg_temp.mk_student('Inactive', 'inactive'), b2, v_today - 30), y, v_today - 30);
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s1, b2, v_today), y, v_today));
  perform pg_temp.rec('O5 an INACTIVE student''s current assignment still takes its place (1 of 1: another is refused)', v_c like '23514:The schedule is full (capacity 1)%', v_c);

  -- S. Several schedules on one enrollment ---------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Several', 'ZZV60S');
  x := pg_temp.mk_series(b, 1);
  y := pg_temp.mk_series(b, 1);
  e1 := pg_temp.mk_en(s1, b, v_today);
  perform pg_temp.mk_as(e1, x, v_today);
  perform pg_temp.mk_as(e1, y, v_today);
  perform pg_temp.rec('S1 one enrollment with two schedules takes one place in each', pg_temp.occupied(x) = 1 and pg_temp.occupied(y) = 1, '');
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s2, b, v_today), y, v_today));
  perform pg_temp.rec('S2 so another student''s assignment to either is refused', v_c like '23514:The schedule is full (capacity 1)%', v_c);

  -- R. Reactivation ---------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Reactivate', 'ZZV60R');
  x := pg_temp.mk_series(b, 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 30, null, 'inactive');
  perform pg_temp.mk_as(e1, x, v_today - 30);
  e2 := pg_temp.mk_en(s2, b, v_today - 30);
  perform pg_temp.mk_as(e2, x, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'' where id = %L', e1));
  perform pg_temp.rec('R1 reactivating an enrollment whose schedule is full is refused, and it stays inactive',
    v_c like '23514:The schedule is full (capacity 1)%' and (select status from public.batch_enrollments where id = e1) = 'inactive', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''inactive'' where id = %L', e2));
  perform pg_temp.rec('R2 deactivating an enrollment in a full schedule is accepted and frees the place', v_c = 'OK' and pg_temp.occupied(x) = 0, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'' where id = %L', e1));
  perform pg_temp.rec('R3 the freed place can then be taken (the reactivation is accepted)', v_c = 'OK' and pg_temp.occupied(x) = 1, v_c);

  -- X. Enrollment end date ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Enrollment end', 'ZZV60X');
  x := pg_temp.mk_series(b, 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 90, v_today - 5);
  perform pg_temp.mk_as(e1, x, v_today - 90);
  e2 := pg_temp.mk_en(s2, b, v_today - 30);
  perform pg_temp.mk_as(e2, x, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = null where id = %L', e1));
  perform pg_temp.rec('X1 clearing an ended enrollment''s end date while its schedule is full is refused, and the end date stays',
    v_c like '23514:The schedule is full%' and (select effective_end_date from public.batch_enrollments where id = e1) = v_today - 5, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today - 2, e1));
  perform pg_temp.rec('X2 moving its end date to another past date is accepted (it takes no place)', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today - 1, e2));
  perform pg_temp.rec('X3 ending the other enrollment yesterday is accepted and frees the place', v_c = 'OK' and pg_temp.occupied(x) = 0, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = null where id = %L', e1));
  perform pg_temp.rec('X4 the freed place can then be taken (clearing the end date is accepted)', v_c = 'OK' and pg_temp.occupied(x) = 1, v_c);

  -- Y. Assignment end date -----------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Assignment end', 'ZZV60Y');
  x := pg_temp.mk_series(b, 1);
  a1 := pg_temp.mk_as(pg_temp.mk_en(s1, b, v_today - 90), x, v_today - 90, v_today - 5);
  a2 := pg_temp.mk_as(pg_temp.mk_en(s2, b, v_today - 30), x, v_today - 30);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = null where id = %L', a1));
  perform pg_temp.rec('Y1 clearing an ended assignment''s end date in a full series is refused, and the end date stays',
    v_c like '23514:The schedule is full%' and (select effective_end_date from public.enrollment_schedules where id = a1) = v_today - 5, v_c);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = %L where id = %L', v_today - 2, a1));
  perform pg_temp.rec('Y2 moving it to another past date is accepted (it takes no place)', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = %L where id = %L', v_today - 1, a2));
  perform pg_temp.rec('Y3 ending the other assignment yesterday is accepted and frees the place', v_c = 'OK' and pg_temp.occupied(x) = 0, v_c);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = null where id = %L', a1));
  perform pg_temp.rec('Y4 the freed place can then be taken (clearing the end date is accepted)', v_c = 'OK' and pg_temp.occupied(x) = 1, v_c);

  -- U. Writes that take no new place --------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Keep', 'ZZV60U');
  x := pg_temp.mk_series(b, 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 30);
  a1 := pg_temp.mk_as(e1, x, v_today - 30, v_today + 30);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = %L where id = %L', v_today + 60, a1));
  perform pg_temp.rec('U1 at capacity, another future end date of the assignment holding the place is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set effective_end_date = null where id = %L', a1));
  perform pg_temp.rec('U2 at capacity, clearing its future end date is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = status, effective_end_date = effective_end_date where id = %L', e1));
  perform pg_temp.rec('U3 at capacity, writing the enrollment''s same status and end date again is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 35, e1));
  perform pg_temp.rec('U4 at capacity, a new enrollment start is accepted and the 0051 cascade still moves the assignment',
    v_c = 'OK' and (select effective_start_date from public.enrollment_schedules where id = a1) = v_today - 35, v_c);

  -- M. Moving an assignment to another series ----------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Move', 'ZZV60M');
  x := pg_temp.mk_series(b, 1);
  y := pg_temp.mk_series(b, 5);
  perform pg_temp.mk_as(pg_temp.mk_en(s1, b, v_today - 30), x, v_today - 30);
  a2 := pg_temp.mk_as(pg_temp.mk_en(s2, b, v_today - 30), y, v_today - 30);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set schedule_series_id = %L where id = %L', x, a2));
  perform pg_temp.rec('M1 moving an assignment to a full series is refused and it stays where it was',
    v_c like '23514:The schedule is full (capacity 1)%' and (select schedule_series_id from public.enrollment_schedules where id = a2) = y, v_c);
  z := pg_temp.mk_series(b, 2);
  v_c := pg_temp.msg(format('update public.enrollment_schedules set schedule_series_id = %L where id = %L', z, a2));
  perform pg_temp.rec('M2 moving it to a series with room is accepted', v_c = 'OK' and pg_temp.occupied(z) = 1 and pg_temp.occupied(y) = 0, v_c);

  -- T. One statement, several rows --------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Multi', 'ZZV60T');
  x := pg_temp.mk_series(b, 2);
  e1 := pg_temp.mk_en(s1, b, v_today);
  e2 := pg_temp.mk_en(s2, b, v_today);
  e3 := pg_temp.mk_en(s3, b, v_today);
  v_c := pg_temp.msg(format('insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
    e1, x, v_today, e2, x, v_today, e3, x, v_today));
  perform pg_temp.rec('T1 one INSERT of three assignments into a series with two places is refused as a whole and writes none',
    v_c like '23514:The schedule is full (capacity 2)%' and not exists (select 1 from public.enrollment_schedules where schedule_series_id = x), v_c);
  v_c := pg_temp.msg(format('insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date) values (%L, %L, %L), (%L, %L, %L)',
    e1, x, v_today, e2, x, v_today));
  perform pg_temp.rec('T2 one INSERT of two assignments into two places is accepted', v_c = 'OK' and pg_temp.occupied(x) = 2, v_c);

  -- D. Lowering the capacity ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Decrease', 'ZZV60D');
  x := pg_temp.mk_series(b, 5);
  perform pg_temp.mk_as(pg_temp.mk_en(s1, b, v_today - 30), x, v_today - 30);
  perform pg_temp.mk_as(pg_temp.mk_en(s2, b, v_today - 30), x, v_today - 30);
  perform pg_temp.mk_as(pg_temp.mk_en(s3, b, v_today + 3), x, v_today + 3);
  perform pg_temp.mk_as(pg_temp.mk_en(s4, b, v_today - 60), x, v_today - 60, v_today - 1);
  v_before := (select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es where es.schedule_series_id = x);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 2 where id = %L', x));
  perform pg_temp.rec('D1 lowering to 2 with 3 places taken is refused (23514, "The capacity cannot be lowered to 2 because 3 places are taken"), it stays 5 and no assignment changes',
    v_c like '23514:The capacity cannot be lowered to 2 because 3 places are taken%' and (select capacity from public.schedule_series where id = x) = 5
    and v_before = (select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es where es.schedule_series_id = x), v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 3 where id = %L', x));
  perform pg_temp.rec('D2 lowering to exactly the places taken (3; the ended one does not count) is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.as_sql(pg_temp.mk_en(s5, b, v_today), x, v_today));
  perform pg_temp.rec('D3 the series is now full: another assignment is refused', v_c like '23514:The schedule is full (capacity 3)%', v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = 4 where id = %L', x));
  perform pg_temp.rec('D4 raising the capacity of a full series is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.as_sql((select id from public.batch_enrollments where student_id = s5 and batch_id = b), x, v_today));
  perform pg_temp.rec('D5 after the increase the assignment is accepted', v_c = 'OK' and pg_temp.occupied(x) = 4, v_c);
  v_c := pg_temp.msg(format('update public.schedule_series set capacity = null where id = %L', x));
  perform pg_temp.rec('D6 removing the capacity of a full series is accepted', v_c = 'OK', v_c);

  -- CR. create_enrollment ----------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Create', 'ZZV60CR');
  b2 := pg_temp.mk_batch('Create other', 'ZZV60CO');
  x := pg_temp.mk_series(b, 5);
  y := pg_temp.mk_series(b, 1);
  z := pg_temp.mk_series(b2, null);
  perform pg_temp.mk_as(pg_temp.mk_en(s6, b, v_today), y, v_today);   -- y is now full

  v_c := pg_temp.val_as(null, format('select public.create_enrollment(%L, %L, %L, null, array[%L]::uuid[])::text', s1, b, v_today, x));
  perform pg_temp.rec('CR0 create_enrollment by someone who is not the Admin is refused (42501) and writes nothing',
    v_c like 'ERR:42501:%' and not exists (select 1 from public.batch_enrollments where student_id = s1 and batch_id = b), v_c);

  if v_admin is null then
    perform pg_temp.skip('CR1-CR6 create_enrollment as the Admin', 'needs an Admin profile');
  else
    w := pg_temp.mk_series(b, 3);
    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[%L, %L]::uuid[])::text', s1, b, v_today, x, w));
    e1 := pg_temp.as_uuid(v_c);
    perform pg_temp.rec('CR1 creates the enrollment and one assignment per selected schedule, each from the enrollment start',
      e1 is not null and (select count(*) from public.enrollment_schedules where batch_enrollment_id = e1 and effective_start_date = v_today
                          and schedule_series_id in (x, w)) = 2, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[%L, %L]::uuid[])::text', s2, b, v_today, x, y));
    perform pg_temp.rec('CR2 with one of its two schedules full, it is refused ("The schedule is full") and writes NOTHING - no enrollment, no assignment',
      v_c like 'ERR:23514:The schedule is full (capacity 1)%'
      and not exists (select 1 from public.batch_enrollments where student_id = s2 and batch_id = b)
      and pg_temp.occupied(x) = 1, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[%L, %L]::uuid[])::text', s3, b, v_today, x, z));
    perform pg_temp.rec('CR3 a schedule of another batch is refused (22023) and nothing is written',
      v_c like 'ERR:22023:Select schedules that belong to the chosen batch.%' and not exists (select 1 from public.batch_enrollments where student_id = s3 and batch_id = b), v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[]::uuid[])::text', s3, b, v_today));
    perform pg_temp.rec('CR4 no schedule is refused (22023) and nothing is written',
      v_c like 'ERR:22023:Select at least one schedule.%' and not exists (select 1 from public.batch_enrollments where student_id = s3 and batch_id = b), v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[%L]::uuid[])::text', s1, b, v_today, x));
    perform pg_temp.rec('CR5 a second active enrollment in the same batch is refused (23505) and nothing new is written',
      v_c like 'ERR:23505:%' and (select count(*) from public.batch_enrollments where student_id = s1 and batch_id = b) = 1, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.create_enrollment(%L, %L, %L, null, array[%L]::uuid[])::text', s4, b, v_today - 401, x));
    perform pg_temp.rec('CR6 a start before the student''s join date is refused (23514, the 0051 rule) and nothing is written',
      v_c like 'ERR:23514:The enrollment cannot start before the student joined%' and not exists (select 1 from public.batch_enrollments where student_id = s4 and batch_id = b), v_c);
  end if;

  -- CH. change_enrollment ---------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Change', 'ZZV60CH');
  b2 := pg_temp.mk_batch('Change other', 'ZZV60CX');
  x := pg_temp.mk_series(b, 1);       -- full (held by another student)
  y := pg_temp.mk_series(b, 5);       -- room
  z := pg_temp.mk_series(b, 1);       -- held by e1 until switched
  w := pg_temp.mk_series(b2, null);   -- another batch
  perform pg_temp.mk_as(pg_temp.mk_en(s6, b, v_today - 30), x, v_today - 30);
  e1 := pg_temp.mk_en(s1, b, v_today - 30);
  a1 := pg_temp.mk_as(e1, z, v_today - 30);

  v_before := pg_temp.digest(e1);
  v_c := pg_temp.val_as(null, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e1, b, v_today - 30, y, v_today));
  perform pg_temp.rec('CH0 change_enrollment by someone who is not the Admin is refused (42501) and changes nothing',
    v_c like 'ERR:42501:%' and pg_temp.digest(e1) = v_before, v_c);

  if v_admin is null then
    perform pg_temp.skip('CH1-CH9 change_enrollment as the Admin', 'needs an Admin profile');
  else
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e1, b, v_today - 30, x, v_today));
    perform pg_temp.rec('CH1 switching into a full schedule is refused ("The schedule is full") and changes NOTHING - the old assignment stays open',
      v_c like 'ERR:23514:The schedule is full (capacity 1)%' and pg_temp.digest(e1) = v_before, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e1, b, v_today - 30, y, v_today));
    perform pg_temp.rec('CH2 switching from today closes the old assignment yesterday and adds the new one from today',
      v_c like '{%"moved": 0%}' and (select effective_end_date from public.enrollment_schedules where id = a1) = v_today - 1
      and exists (select 1 from public.enrollment_schedules where batch_enrollment_id = e1 and schedule_series_id = y and effective_start_date = v_today)
      and pg_temp.occupied(z) = 0 and pg_temp.occupied(y) = 1, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e1, b, v_today - 30, z, v_today + 7));
    perform pg_temp.rec('CH3 a switch effective in a week counts toward both schedules until then',
      v_c like '{%' and pg_temp.occupied(y) = 1 and pg_temp.occupied(z) = 1, v_c);

    e2 := pg_temp.mk_en(s2, b, v_today - 30);
    perform pg_temp.mk_as(e2, y, v_today - 30);
    v_before := pg_temp.digest(e2);
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e2, b, v_today - 30, z, v_today + 7));
    perform pg_temp.rec('CH4 a future-dated switch into a schedule that is full meanwhile is refused and changes nothing',
      v_c like 'ERR:23514:The schedule is full (capacity 1)%' and pg_temp.digest(e2) = v_before, v_c);

    e3 := pg_temp.mk_en(s3, b, v_today - 30, null, 'inactive');
    a2 := pg_temp.mk_as(e3, x, v_today - 30);
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e3, b, v_today - 30, y, v_today));
    perform pg_temp.rec('CH5 reactivating while switching away from a FULL schedule from today succeeds - it is judged on the result',
      v_c like '{%' and (select status from public.batch_enrollments where id = e3) = 'active'
      and (select effective_end_date from public.enrollment_schedules where id = a2) = v_today - 1 and pg_temp.occupied(x) = 1, v_c);

    v_before := pg_temp.digest(e2);
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e2, b, v_today - 30, z, v_today - 1));
    perform pg_temp.rec('CH6 a back-dated schedule change is refused (22023) and changes nothing',
      v_c like 'ERR:22023:The schedule change cannot be back-dated.%' and pg_temp.digest(e2) = v_before, v_c);

    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e2, b, v_today - 30, w, v_today));
    perform pg_temp.rec('CH7 a schedule of another batch is refused (22023) and changes nothing',
      v_c like 'ERR:22023:Select schedules that belong to the chosen batch.%' and pg_temp.digest(e2) = v_before, v_c);

    w := pg_temp.mk_series(b, null);    -- this batch, unlimited
    e3 := pg_temp.mk_en(s4, b, v_today - 30);
    a2 := pg_temp.mk_as(e3, y, v_today + 5);
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], %L)::text', e3, b, v_today - 30, w, v_today + 5));
    perform pg_temp.rec('CH8 an assignment that has not started yet is withdrawn (deleted) when the change takes effect on or before its start',
      v_c like '{%' and not exists (select 1 from public.enrollment_schedules where id = a2)
      and exists (select 1 from public.enrollment_schedules where batch_enrollment_id = e3 and schedule_series_id = w and effective_start_date = v_today + 5), v_c);

    e3 := pg_temp.mk_en(s5, b, v_today - 30);
    a2 := pg_temp.mk_as(e3, y, v_today - 30);
    v_c := pg_temp.val_as(v_admin, format('select public.change_enrollment(%L, %L, %L, null, ''active'', array[%L]::uuid[], null)::text', e3, b, v_today - 40, y));
    perform pg_temp.rec('CH9 a start-date move with the schedules unchanged needs no change date, moves the assignment (0051) and reports moved = 1',
      v_c like '{%"moved": 1%}' and (select effective_start_date from public.enrollment_schedules where id = a2) = v_today - 40, v_c);
  end if;

  -- Z. Existing data unchanged -------------------------------------------------------------------------------------------------------
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(bb)::text, '|' order by bb.id) from public.batches bb where position('ZZVERIFY 0060' in bb.name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss
              where ss.batch_id in (select id from public.batches where position('ZZVERIFY 0060' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be
              where be.batch_id in (select id from public.batches where position('ZZVERIFY 0060' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es
              where es.batch_enrollment_id in (select be.id from public.batch_enrollments be
                where be.batch_id in (select id from public.batches where position('ZZVERIFY 0060' in name) <> 1))), '')));
  perform pg_temp.rec('Z every batch, series, enrollment and assignment that existed before this script is byte-for-byte unchanged by it',
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

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0060' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0060' in name) = 1) as leftover_batches;
-- Both must be 0.
