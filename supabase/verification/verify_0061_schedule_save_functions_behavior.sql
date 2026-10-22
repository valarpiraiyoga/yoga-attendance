-- ===========================================================================
-- Migration 0061 verification (behaviour) - atomic Edit Schedule saves
-- Exercises supabase/migrations/0061_schedule_save_functions.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  0061 is applied: the four functions exist, only the two save functions are executable by signed-in users (not by anon),
--       the two helpers by nobody. Otherwise every scenario is skipped.
--   PF  Preflight: no fixture name exists.
--   A   Authorization: someone who is not the Admin is refused (42501) by both functions and nothing changes.
--   V   save_schedule_edit, schedule rows: a later effective date closes the current version the day before and adds a new active
--       version on the SAME series (V1); an effective date on or before the current start updates it in place - no new version (V2);
--       a date in the past is refused with the application's message and nothing changes (V3); an unknown schedule is P0002 (V4).
--   C   Capacity: set together with the schedule change (C1); an explicit "unlimited" (NULL with p_set_capacity true) clears it (C2);
--       p_set_capacity false leaves the stored capacity alone whatever p_capacity holds (C3); a value below the places taken is refused
--       by 0060's guard and NOTHING changes - no version, no capacity change (C4); a value out of range is refused likewise (C5).
--   E   Extra days ("Also creates"): each gets its own new series and schedule with the edit's instructor, times and dates, starting
--       with the capacity being saved (E1), or the stored one when none was supplied (E2), or unlimited when explicitly cleared (E3);
--       an unrelated batch and series are untouched (E4); a failure creating the LAST extra rolls back the primary edit, the capacity
--       and every extra already created (E5); the schedule's own day is refused (E6); a repeated day is created once (E7).
--   D   save_unused_schedule_edit: an unused schedule is corrected in place (the existing correct_unused_schedule), with the capacity
--       and the extra days (D1); a schedule that has earlier versions is refused with correct_unused_schedule's own error (22023, its
--       message) and the capacity set in the same call is rolled back with it (D2); an unknown schedule is P0002 (D3); a capacity
--       below the places taken refuses everything (D4); a failure creating an extra day rolls back the correction itself (D5);
--       a started assignment is refused with its own reason (D6).
--   Z   Every schedule and series that existed before this script is byte-for-byte unchanged by it.
--
-- PREREQUISITES: 0060 and 0061 applied. The save functions are called as the Admin (a profile with role 'admin'); without one every
-- scenario that needs it is reported NOT TESTED.
--
-- HOW A REFUSED CALL IS JUDGED
--   Each call runs inside its own sub-block (BEGIN ... EXCEPTION), so a function that raises has all of its writes rolled back to the
--   start of the call, exactly as a failing statement is. "Nothing changed" is then proved by comparing a digest of the batch's
--   schedules and series (every column, including updated_at) before and after.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ, so the digests of existing rows come from one snapshot), ending in ROLLBACK. Disposable fixtures
--   only: students 'ZZVERIFY 0061 ...', batches 'ZZVERIFY 0061 ...' (codes ZZV61...), instructors 'ZZVERIFY 0061 ...', and what hangs
--   off them. No trigger is disabled. Every fixture student consumes a value of the student_code sequence (the YC-... Student IDs) even
--   though it is rolled back, so real Student IDs will skip those numbers. Run it on a disposable database if gaps matter.
--
-- LIMITATIONS
--   * CONCURRENCY IS NOT TESTED HERE: one transaction cannot race itself. The lock order is analysed in the migration header. To check
--     it by hand on a disposable database, with two psql sessions at the default READ COMMITTED (not two SQL editor tabs, which do not
--     overlap), a fixture schedule <s> on series <x> whose capacity is 2 with 2 places taken, and an enrollment <e> that could join <x>:
--       (a) an edit against an enrollment on one series -
--         session 1: begin; select public.save_schedule_edit(<s>, <instr>, '06:00', '07:00', <d>+7, null, true, 5, '{}');
--         session 2: select public.create_enrollment(<student>, <batch>, <d>, null, array[<x>]::uuid[]);   -- waits for session 1
--         session 1: commit;
--         session 2: -- must now succeed (capacity 5, 2 taken); with the edit setting 2 instead it must fail "The schedule is full".
--       (b) two edits of one schedule serialise: session 1 begins and calls save_schedule_edit(<s>, ...) without committing; session 2
--         calls it for the same <s> and waits; after session 1 commits, session 2 runs against the row as it then stands.
--     <d> is the centre's date: select (now() at time zone public.centre_timezone())::date;
--   * "Today" is the centre's date. Running across the centre's midnight may move the date boundaries.
--   * The application's own handling of these answers (lib/schedules/actions.js) is tested separately, from source.
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

-- One statement as an authenticated user (or as nobody when p_user is null): its text, or 'ERR:<sqlstate>:<message>'. A failing call is
-- rolled back to the start of its own sub-block. The claims are cleared afterwards so later owner statements are not taken for that user.
create function pg_temp.call_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user, 'role', 'authenticated')::text, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v_out, '');
end $f$;

create function pg_temp.j(p_text text)
returns jsonb language plpgsql as $f$
begin
  return p_text::jsonb;
exception when others then
  return null;
end $f$;

create function pg_temp.today()
returns date language sql as $f$ select (now() at time zone public.centre_timezone())::date $f$;

create function pg_temp.mk_student(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0061 ' || p_name, '9000000061', '+91', pg_temp.today() - 400, 'active') returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_batch(p_name text, p_code text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batches (name, code) values ('ZZVERIFY 0061 ' || p_name, p_code) returning id into v_id;
  return v_id;
end $f$;

-- A schedule on a brand-new series (06:00-07:00), returning the schedule's id.
create function pg_temp.mk_sched(p_batch uuid, p_instructor uuid, p_day text, p_from date, p_until date, p_capacity integer)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
  v_id     uuid;
begin
  insert into public.schedule_series (batch_id, capacity) values (p_batch, p_capacity) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instructor, p_day, '06:00', '07:00', p_from, p_until, 'active', v_series) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.series_of(p_schedule uuid)
returns uuid language sql as $f$ select series_id from public.schedules where id = p_schedule $f$;

-- One place taken in a series: an enrollment of a new student in the batch and an assignment (started on p_start) to the series.
create function pg_temp.take_place(p_batch uuid, p_series uuid, p_name text, p_start date)
returns void language plpgsql as $f$
declare
  v_student    uuid := pg_temp.mk_student(p_name);
  v_enrollment uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date)
  values (v_student, p_batch, pg_temp.today() - 30) returning id into v_enrollment;
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  values (v_enrollment, p_series, p_start);
  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;
end $f$;

-- Every schedule and series of a batch, every column: equal before and after means nothing was written (not even updated_at).
create function pg_temp.shape(p_batch uuid)
returns text language sql as $f$
  select coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s where s.batch_id = p_batch), '') || '#' ||
         coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss where ss.batch_id = p_batch), '')
$f$;

create function pg_temp.cap(p_series uuid)
returns text language sql as $f$ select coalesce(capacity::text, 'unlimited') from public.schedule_series where id = p_series $f$;

create function pg_temp.edit_sql(p_id uuid, p_instructor uuid, p_start time, p_end time, p_from date, p_until date, p_set boolean, p_cap integer, p_extra text)
returns text language sql as $f$
  select format('select public.save_schedule_edit(%L, %L, %L, %L, %L, %L, %L, %L, %L::text[])::text',
                p_id, p_instructor, p_start, p_end, p_from, p_until, p_set, p_cap, p_extra)
$f$;

create function pg_temp.unused_sql(p_id uuid, p_day text, p_instructor uuid, p_start time, p_end time, p_from date, p_until date, p_set boolean, p_cap integer, p_extra text)
returns text language sql as $f$
  select format('select public.save_unused_schedule_edit(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L::text[])::text',
                p_id, p_day, p_instructor, p_start, p_end, p_from, p_until, p_set, p_cap, p_extra)
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
  ia        uuid;
  ib        uuid;
  b         uuid;
  b2        uuid;
  s         uuid;
  s2        uuid;
  x         uuid;
  x2        uuid;
  r         text;
  snap      text;
  snap_other text;
  res       text;
begin
  -- P0. The migration is applied ----------------------------------------------------------------------------------------------
  select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'save_schedule_edit', 'save_unused_schedule_edit', 'schedule_series_apply_capacity', 'schedule_add_extra_days')) = 4
     and has_function_privilege('authenticated', 'public.save_schedule_edit(uuid, uuid, time, time, date, date, boolean, integer, text[])', 'execute')
     and has_function_privilege('authenticated', 'public.save_unused_schedule_edit(uuid, text, uuid, time, time, date, date, boolean, integer, text[])', 'execute')
     and not has_function_privilege('anon', 'public.save_schedule_edit(uuid, uuid, time, time, date, date, boolean, integer, text[])', 'execute')
     and not has_function_privilege('anon', 'public.save_unused_schedule_edit(uuid, text, uuid, time, time, date, date, boolean, integer, text[])', 'execute')
     and not has_function_privilege('authenticated', 'public.schedule_series_apply_capacity(uuid, boolean, integer)', 'execute')
     and not has_function_privilege('authenticated', 'public.schedule_add_extra_days(uuid, uuid, time, time, date, date, integer, text, text[])', 'execute')
  into v_applied;
  perform pg_temp.rec('P0 migration 0061 is applied (four functions; the two save functions executable by signed-in users only, the helpers by nobody)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0061 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0061' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0061' in name) = 1 or lower(code) like 'zzv61%')
     or exists (select 1 from public.instructors where position('ZZVERIFY 0061' in full_name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0061 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    perform pg_temp.skip('A-D all scenarios', 'needs an Admin profile (public.profiles role admin)');
    return;
  end if;

  insert into public.instructors (full_name) values ('ZZVERIFY 0061 Instructor A') returning id into ia;
  insert into public.instructors (full_name) values ('ZZVERIFY 0061 Instructor B') returning id into ib;

  -- A. Authorization -----------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Authorization', 'ZZV61A');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(null, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, 25, '{tuesday}'));
  perform pg_temp.rec('A1 save_schedule_edit by someone who is not the Admin is refused (42501) and nothing changes',
    r like 'ERR:42501:%' and pg_temp.shape(b) = snap, r);
  r := pg_temp.call_as(null, pg_temp.unused_sql(s, 'tuesday', ib, '07:00', '08:00', v_today + 7, null, true, 25, '{friday}'));
  perform pg_temp.rec('A2 save_unused_schedule_edit by someone who is not the Admin is refused (42501) and nothing changes',
    r like 'ERR:42501:%' and pg_temp.shape(b) = snap, r);

  -- V. The schedule rows ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Versioned', 'ZZV61V');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, null);
  x := pg_temp.series_of(s);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, false, null, '{}'));
  perform pg_temp.rec('V1 a later effective date closes the current version the day before and adds a new active version on the SAME series',
    r not like 'ERR:%'
    and (select effective_until from public.schedules where id = s) = v_today + 6
    and (select count(*) from public.schedules where series_id = x) = 2
    and exists (select 1 from public.schedules where series_id = x and id <> s and effective_from = v_today + 7 and effective_until is null
                  and instructor_id = ib and start_time = '07:00' and end_time = '08:00' and day_of_week = 'monday' and status = 'active' and batch_id = b)
    and (select count(*) from public.schedule_series where batch_id = b) = 1
    and jsonb_array_length(pg_temp.j(r) -> 'ids') = 2 and (pg_temp.j(r) ->> 'added')::int = 0
    and (pg_temp.j(r) ->> 'id')::uuid <> s, r);

  s2 := pg_temp.mk_sched(b, ia, 'tuesday', v_today + 20, null, null);
  x2 := pg_temp.series_of(s2);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s2, ib, '09:00', '10:00', v_today + 10, null, false, null, '{}'));
  perform pg_temp.rec('V2 an effective date on or before the current start updates it in place - no new version, same row',
    r not like 'ERR:%'
    and (select count(*) from public.schedules where series_id = x2) = 1
    and exists (select 1 from public.schedules where id = s2 and effective_from = v_today + 10 and instructor_id = ib and start_time = '09:00' and end_time = '10:00')
    and (pg_temp.j(r) ->> 'id')::uuid = s2 and jsonb_array_length(pg_temp.j(r) -> 'ids') = 1, r);

  b := pg_temp.mk_batch('Past', 'ZZV61P');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today - 1, null, true, 25, '{tuesday}'));
  perform pg_temp.rec('V3 an effective date in the past is refused (22023, "Effective from cannot be in the past.") and nothing changes - not even the capacity or the extra day',
    r like 'ERR:22023:Effective from cannot be in the past.%' and pg_temp.shape(b) = snap, r);

  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(gen_random_uuid(), ib, '07:00', '08:00', v_today + 7, null, false, null, '{}'));
  perform pg_temp.rec('V4 an unknown schedule is P0002', r like 'ERR:P0002:%', r);

  -- C. Capacity --------------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Capacity', 'ZZV61C');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  x := pg_temp.series_of(s);
  perform pg_temp.take_place(b, x, 'C One', v_today + 1);
  perform pg_temp.take_place(b, x, 'C Two', v_today + 1);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, 25, '{}'));
  perform pg_temp.rec('C1 a capacity set together with the schedule change is saved with it (10 -> 25) and the new version exists',
    r not like 'ERR:%' and pg_temp.cap(x) = '25' and (select count(*) from public.schedules where series_id = x) = 2, r);

  r := pg_temp.call_as(v_admin, pg_temp.edit_sql((pg_temp.j(r) ->> 'id')::uuid, ib, '07:00', '08:00', v_today + 14, null, true, null, '{}'));
  perform pg_temp.rec('C2 an explicit unlimited (p_set_capacity true, NULL capacity) clears the capacity', r not like 'ERR:%' and pg_temp.cap(x) = 'unlimited', r);

  update public.schedule_series set capacity = 8 where id = x;
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql((select id from public.schedules where series_id = x order by effective_from desc limit 1), ib, '07:00', '08:00', v_today + 30, null, false, 5, '{}'));
  perform pg_temp.rec('C3 p_set_capacity false leaves the stored capacity alone, whatever p_capacity holds (8 stays 8)', r not like 'ERR:%' and pg_temp.cap(x) = '8', r);

  b := pg_temp.mk_batch('Lowering', 'ZZV61L');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  x := pg_temp.series_of(s);
  perform pg_temp.take_place(b, x, 'L One', v_today + 1);
  perform pg_temp.take_place(b, x, 'L Two', v_today + 1);
  perform pg_temp.take_place(b, x, 'L Three', v_today + 1);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, 2, '{tuesday}'));
  perform pg_temp.rec('C4 a capacity below the places taken (2 with 3 taken) is refused by the guard (23514, "The capacity cannot be lowered") and NOTHING changes - no new version, no extra day, capacity still 10',
    r like 'ERR:23514:The capacity cannot be lowered to 2 because 3 places are taken%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '10', r);

  for r in select unnest(array['0', '1001']) loop
    snap := pg_temp.shape(b);
    res := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, r::integer, '{}'));
    perform pg_temp.rec('C5 a capacity out of range (' || r || ') is refused (23514, the range constraint) and nothing changes',
      res like 'ERR:23514:%schedule_series_capacity_valid%' and pg_temp.shape(b) = snap, res);
  end loop;

  -- E. Extra days ("Also creates") ---------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Extras', 'ZZV61E');
  b2 := pg_temp.mk_batch('Unrelated', 'ZZV61U');
  s2 := pg_temp.mk_sched(b2, ia, 'saturday', v_today - 30, null, 99);
  snap_other := pg_temp.shape(b2);

  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 8);
  x := pg_temp.series_of(s);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, v_today + 200, true, 12, '{tuesday,friday}'));
  perform pg_temp.rec('E1 each extra day gets its own new series and schedule - same batch, the edit''s instructor, times and dates - starting with the capacity being saved (12)',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'added')::int = 2
    and (select count(*) from public.schedule_series where batch_id = b) = 3
    and pg_temp.cap(x) = '12'
    and (select count(*) from public.schedules t join public.schedule_series ss on ss.id = t.series_id
          where t.batch_id = b and t.day_of_week in ('tuesday', 'friday') and ss.id <> x and ss.capacity = 12
            and t.instructor_id = ib and t.start_time = '07:00' and t.end_time = '08:00' and t.effective_from = v_today + 7 and t.effective_until = v_today + 200) = 2
    and (select count(distinct series_id) from public.schedules where batch_id = b) = 3, r);
  perform pg_temp.rec('E4 an unrelated batch and its series (capacity 99) are untouched', pg_temp.shape(b2) = snap_other and pg_temp.cap(pg_temp.series_of(s2)) = '99', '');

  b := pg_temp.mk_batch('Inherit', 'ZZV61I');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 8);
  x := pg_temp.series_of(s);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, false, null, '{wednesday}'));
  perform pg_temp.rec('E2 with no capacity supplied the extra day inherits the STORED one (8) and the own series is unchanged',
    r not like 'ERR:%' and pg_temp.cap(x) = '8'
    and (select ss.capacity from public.schedules t join public.schedule_series ss on ss.id = t.series_id where t.batch_id = b and t.day_of_week = 'wednesday') = 8, r);

  b := pg_temp.mk_batch('Unlimited', 'ZZV61N');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 8);
  x := pg_temp.series_of(s);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, null, '{thursday}'));
  perform pg_temp.rec('E3 an explicit unlimited clears the own series and starts the extra day unlimited',
    r not like 'ERR:%' and pg_temp.cap(x) = 'unlimited'
    and (select count(*) from public.schedules where batch_id = b and day_of_week = 'thursday') = 1
    and (select ss.capacity from public.schedules t join public.schedule_series ss on ss.id = t.series_id where t.batch_id = b and t.day_of_week = 'thursday') is null, r);

  b := pg_temp.mk_batch('Rollback', 'ZZV61R');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 8);
  x := pg_temp.series_of(s);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, true, 30, '{tuesday,funday}'));
  perform pg_temp.rec('E5 a failure creating the LAST extra day (an invalid weekday) rolls back the primary edit, the capacity and the extra day created before it - nothing is saved',
    r like 'ERR:23514:%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '8'
    and (select count(*) from public.schedule_series where batch_id = b) = 1
    and (select count(*) from public.schedules where batch_id = b) = 1, r);

  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, false, null, '{monday}'));
  perform pg_temp.rec('E6 the schedule''s own day among the extras is refused (22023) and nothing changes', r like 'ERR:22023:%' and pg_temp.shape(b) = snap, r);

  r := pg_temp.call_as(v_admin, pg_temp.edit_sql(s, ib, '07:00', '08:00', v_today + 7, null, false, null, '{tuesday,tuesday}'));
  perform pg_temp.rec('E7 a repeated extra day is created once', r not like 'ERR:%' and (pg_temp.j(r) ->> 'added')::int = 1
    and (select count(*) from public.schedules where batch_id = b and day_of_week = 'tuesday') = 1, r);

  -- D. Direct Edit of an unused schedule ------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Direct', 'ZZV61D');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today + 5, null, 10);
  x := pg_temp.series_of(s);
  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(s, 'wednesday', ib, '09:00', '10:00', v_today + 3, null, true, 15, '{thursday}'));
  perform pg_temp.rec('D1 an unused schedule is corrected in place (the existing correct_unused_schedule) with the capacity and an extra day that starts with it',
    r not like 'ERR:%'
    and exists (select 1 from public.schedules where id = s and day_of_week = 'wednesday' and instructor_id = ib and start_time = '09:00' and end_time = '10:00' and effective_from = v_today + 3)
    and (select count(*) from public.schedules where series_id = x) = 1
    and pg_temp.cap(x) = '15' and (pg_temp.j(r) ->> 'added')::int = 1 and (pg_temp.j(r) ->> 'id')::uuid = s and (pg_temp.j(r) ->> 'batch_id')::uuid = b
    and (select ss.capacity from public.schedules t join public.schedule_series ss on ss.id = t.series_id where t.batch_id = b and t.day_of_week = 'thursday') = 15, r);

  b := pg_temp.mk_batch('Used', 'ZZV61X');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  x := pg_temp.series_of(s);
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (b, ia, 'monday', '06:00', '07:00', v_today + 10, null, 'active', x);          -- a second version: no longer "unused"
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(s, 'monday', ib, '07:00', '08:00', v_today - 30, null, true, 40, '{friday}'));
  perform pg_temp.rec('D2 a schedule with earlier versions is refused with correct_unused_schedule''s own error (22023, "earlier versions") - and the capacity set in the same call is rolled back with it, with no extra day',
    r like 'ERR:22023:This schedule has earlier versions and cannot be edited directly.%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '10', r);

  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(gen_random_uuid(), 'monday', ib, '07:00', '08:00', v_today + 1, null, false, null, '{}'));
  perform pg_temp.rec('D3 an unknown schedule is P0002', r like 'ERR:P0002:%', r);

  b := pg_temp.mk_batch('DirectLowering', 'ZZV61G');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today + 5, null, 10);
  x := pg_temp.series_of(s);
  perform pg_temp.take_place(b, x, 'G One', v_today + 1);
  perform pg_temp.take_place(b, x, 'G Two', v_today + 1);
  perform pg_temp.take_place(b, x, 'G Three', v_today + 1);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(s, 'tuesday', ib, '07:00', '08:00', v_today + 6, null, true, 2, '{friday}'));
  perform pg_temp.rec('D4 a capacity below the places taken refuses the whole Direct Edit (23514) - the day, times and extra day included - and nothing changes',
    r like 'ERR:23514:The capacity cannot be lowered to 2 because 3 places are taken%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '10', r);

  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(s, 'tuesday', ib, '07:00', '08:00', v_today + 6, null, true, 12, '{funday}'));
  perform pg_temp.rec('D5 a failure creating an extra day rolls back the correction itself (the day, times and capacity stay as they were)',
    r like 'ERR:23514:%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '10', r);

  b := pg_temp.mk_batch('Started', 'ZZV61S');
  s := pg_temp.mk_sched(b, ia, 'monday', v_today - 30, null, 10);
  x := pg_temp.series_of(s);
  perform pg_temp.take_place(b, x, 'S One', v_today - 5);                              -- an assignment that has already started
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.unused_sql(s, 'monday', ib, '07:00', '08:00', v_today - 30, null, true, 20, '{}'));
  perform pg_temp.rec('D6 a schedule with a started assignment is refused with its own reason (22023) and the capacity set in the call is rolled back',
    r like 'ERR:22023:Students have already been assigned to this schedule%' and pg_temp.shape(b) = snap and pg_temp.cap(x) = '10', r);

  -- Z. Existing data unchanged --------------------------------------------------------------------------------------------------------------
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.schedules t
              where t.batch_id in (select id from public.batches where position('ZZVERIFY 0061' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss
              where ss.batch_id in (select id from public.batches where position('ZZVERIFY 0061' in name) <> 1)), '')));
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

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0061' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0061' in name) = 1) as leftover_batches,
--          (select count(*) from public.instructors where position('ZZVERIFY 0061' in full_name) = 1) as leftover_instructors;
-- All three must be 0.
