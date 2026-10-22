-- ===========================================================================
-- Migration 0063 verification (behaviour) - deleting a schedule version
-- Exercises supabase/migrations/0063_safe_schedule_version_deletion.sql (public.delete_unused_schedule)
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  0063 is applied: delete_unused_schedule mentions 'later_version', is SECURITY DEFINER with a pinned search_path, and is executable by
--       signed-in users but not by anon. Otherwise every scenario is skipped.
--   PF  Preflight: no fixture name exists.
--   A   Authorization: someone who is not the Admin is refused (42501) and nothing is deleted (A1); an unknown schedule is P0002 (A2).
--   S   A class's ONLY version (the rules it always had): nothing recorded - the schedule and its series go (S1); an unstarted assignment is
--       withdrawn with it (S2); a started assignment refuses it - 22023, DETAIL started_assignments - and nothing changes (S3); a class
--       session of its own refuses it - 22023, DETAIL sessions - and nothing changes (S4).
--   L   The LATEST of several versions: deleted, and the series, its capacity, every assignment (started or not) and the earlier version
--       (byte for byte) are untouched (L1); sessions of an EARLIER version do not block it (L2); a session of its own does - DETAIL sessions -
--       and nothing changes (L3); an inactive latest version is deleted exactly like an active one (L4); the result says the series
--       continues (series_deleted false, versions_remaining) (L5); the instructor-conflict trigger is not involved: deleting needs no free
--       slot and the version chain's dates are not rewritten (L6).
--   E   An EARLIER or MIDDLE version while a later one exists: refused - 22023, DETAIL later_version - and nothing changes, even with
--       no session and no assignment (E1, E2); after the later versions are deleted one by one, the next latest can go, and the last takes the series (E3a-c).
--   Z   Every schedule, series, assignment and session that existed before this script is byte-for-byte unchanged by it.
--
-- PREREQUISITES: 0060-0063 applied. The function is called as the Admin (a profile with role 'admin'); without one every scenario that needs
-- it is reported NOT TESTED.
--
-- HOW A REFUSED CALL IS JUDGED
--   Each call runs inside its own sub-block (BEGIN ... EXCEPTION), so a function that raises has all of its writes rolled back, exactly as a
--   failing RPC is. "Nothing changed" is proved by comparing a digest of the batch's schedules, series, assignments and sessions before and
--   after. Results read the function's JSON, or 'ERR:<sqlstate>:<message>|<detail>'.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students, batches (codes ZZV63...) and instructors named
--   'ZZVERIFY 0063 ...', and what hangs off them. No trigger is disabled. Every fixture student consumes a value of the student_code
--   sequence even though it is rolled back, so real Student IDs will skip those numbers.
--
-- LIMITATIONS
--   * CONCURRENCY IS NOT TESTED HERE: one transaction cannot race itself. By hand, on a disposable database, with two psql sessions at the
--     default READ COMMITTED (not two SQL editor tabs, which do not overlap), for a committed fixture schedule <s> (the only version of its
--     series, no session):
--       session 1: begin; select public.delete_unused_schedule(<s>);                          -- holds the schedule row
--       session 2: insert into public.class_sessions (schedule_id, batch_id, instructor_id, session_date, start_time, end_time)
--                  values (<s>, <batch>, <instructor>, current_date, '06:00', '07:00');      -- WAITS for session 1
--       session 1: commit;
--       session 2: -- must now FAIL on the foreign key (23503): no orphaned session. If session 2 commits first instead, session 1's
--                  -- delete_unused_schedule must raise 22023 'sessions'.
--     Clean up the committed fixtures afterwards.
--   * "Today" is the centre's date. Running across the centre's midnight may move the started / unstarted boundary.
--   * The application's handling of these answers is tested separately, from source.
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

-- One statement as an authenticated user (or nobody when p_user is null): its text, or 'ERR:<sqlstate>:<message>|<detail>'.
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
  return coalesce(v_out, '');
end $f$;

create function pg_temp.j(p_text text)
returns jsonb language plpgsql as $f$
begin
  return p_text::jsonb;
exception when others then
  return null;
end $f$;

create function pg_temp.mk_batch(p_name text, p_code text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batches (name, code) values ('ZZVERIFY 0063 ' || p_name, p_code) returning id into v_id;
  return v_id;
end $f$;

-- One instructor per fixture GROUP. The instructor-conflict trigger (0062) stays on and judges every fixture schedule, so fixtures of different
-- groups must not give one instructor overlapping classes (several groups use the same weekday and 06:00-07:00). A fixed instructor for the whole
-- script made later groups collide with earlier ones that stay stored (for example a schedule a refused delete leaves behind).
create function pg_temp.mk_instructor(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.instructors (full_name) values ('ZZVERIFY 0063 ' || p_name) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_student(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0063 ' || p_name, '9000000063', '+91', pg_temp.today() - 400, 'active') returning id into v_id;
  return v_id;
end $f$;

-- A new series with capacity p_capacity and its FIRST version (06:00-07:00 on p_day), returning the schedule id. Versions of one series use
-- non-overlapping dates, so the instructor-conflict trigger (0062) never refuses a fixture.
create function pg_temp.mk_series(p_batch uuid, p_instructor uuid, p_day text, p_from date, p_until date, p_status text default 'active', p_capacity integer default null)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
  v_id     uuid;
begin
  insert into public.schedule_series (batch_id, capacity) values (p_batch, p_capacity) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instructor, p_day, '06:00', '07:00', p_from, p_until, p_status, v_series) returning id into v_id;
  return v_id;
end $f$;

-- A further version of the series of p_schedule.
create function pg_temp.mk_version(p_schedule uuid, p_from date, p_until date, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  select batch_id, instructor_id, day_of_week, start_time, end_time, p_from, p_until, p_status, series_id
  from public.schedules where id = p_schedule returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.series_of(p_schedule uuid)
returns uuid language sql as $f$ select series_id from public.schedules where id = p_schedule $f$;

-- A class session of one schedule version (materialized history).
create function pg_temp.mk_session(p_schedule uuid, p_date date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.class_sessions (schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status)
  select id, batch_id, instructor_id, p_date, start_time, end_time, 'scheduled' from public.schedules where id = p_schedule
  returning id into v_id;
  return v_id;
end $f$;

-- One student assigned to a series from p_start (an enrollment of a new student in the batch plus the assignment).
create function pg_temp.assign(p_batch uuid, p_series uuid, p_name text, p_start date)
returns void language plpgsql as $f$
declare
  v_student    uuid := pg_temp.mk_student(p_name);
  v_enrollment uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date)
  values (v_student, p_batch, pg_temp.today() - 30) returning id into v_enrollment;
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  values (v_enrollment, p_series, p_start);
end $f$;

-- Everything delete_unused_schedule can touch, for one batch, every column: equal before and after means nothing was written or removed.
create function pg_temp.shape(p_batch uuid)
returns text language sql as $f$
  select coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s where s.batch_id = p_batch), '') || '#' ||
         coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss where ss.batch_id = p_batch), '') || '#' ||
         coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es
                    where es.schedule_series_id in (select id from public.schedule_series where batch_id = p_batch)), '') || '#' ||
         coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs where cs.batch_id = p_batch), '')
$f$;

create function pg_temp.row_of(p_schedule uuid)
returns text language sql as $f$ select coalesce((select to_jsonb(s)::text from public.schedules s where s.id = p_schedule), '') $f$;

create function pg_temp.del_sql(p_schedule uuid)
returns text language sql as $f$ select format('select public.delete_unused_schedule(%L)::text', p_schedule) $f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _legacy_hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s), '') ||
  coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss), '') ||
  coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es), '') ||
  coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''));

do $$
declare
  v_applied boolean;
  v_today   date := pg_temp.today();
  v_admin   uuid;
  i1        uuid;
  b         uuid;
  s1        uuid;
  s2        uuid;
  s3        uuid;
  x         uuid;
  r         text;
  snap      text;
  earlier   text;
begin
  -- P0. The migration is applied ----------------------------------------------------------------------------------------------
  select to_regprocedure('public.delete_unused_schedule(uuid)') is not null
     and pg_get_functiondef(to_regprocedure('public.delete_unused_schedule(uuid)')) like '%later_version%'
     and exists (select 1 from pg_proc where oid = to_regprocedure('public.delete_unused_schedule(uuid)') and prosecdef
                   and exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))
     and has_function_privilege('authenticated', 'public.delete_unused_schedule(uuid)', 'execute')
     and not has_function_privilege('anon', 'public.delete_unused_schedule(uuid)', 'execute')
  into v_applied;
  perform pg_temp.rec('P0 migration 0063 is applied (delete_unused_schedule knows later_version; SECURITY DEFINER; pinned search_path; executable by signed-in users, not anon)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0063 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0063' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0063' in name) = 1 or lower(code) like 'zzv63%')
     or exists (select 1 from public.instructors where position('ZZVERIFY 0063' in full_name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0063 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    perform pg_temp.skip('A-E all scenarios', 'needs an Admin profile (public.profiles role admin)');
    return;
  end if;


  -- A. Authorization ------------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Authorization', 'ZZV63A');
  i1 := pg_temp.mk_instructor('Authorization');
  s1 := pg_temp.mk_series(b, i1, 'monday', v_today - 30, null);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(null, pg_temp.del_sql(s1));
  perform pg_temp.rec('A1 someone who is not the Admin is refused (42501) and nothing is deleted', r like 'ERR:42501:%' and pg_temp.shape(b) = snap, r);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(gen_random_uuid()));
  perform pg_temp.rec('A2 an unknown schedule is P0002', r like 'ERR:P0002:%', r);

  -- S. A class's only version ---------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Only', 'ZZV63S');
  i1 := pg_temp.mk_instructor('Only');
  s1 := pg_temp.mk_series(b, i1, 'tuesday', v_today - 30, null, 'active', 10);
  x := pg_temp.series_of(s1);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('S1 the only version with nothing recorded is deleted and its series goes with it',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'success')::boolean and (pg_temp.j(r) ->> 'series_deleted')::boolean and (pg_temp.j(r) ->> 'versions_remaining')::int = 0
    and (pg_temp.j(r) ->> 'batch_id')::uuid = b
    and not exists (select 1 from public.schedules where id = s1) and not exists (select 1 from public.schedule_series where id = x), r);

  s1 := pg_temp.mk_series(b, i1, 'wednesday', v_today - 30, null);
  x := pg_temp.series_of(s1);
  perform pg_temp.assign(b, x, 'S2 unstarted', v_today + 3);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('S2 an unstarted assignment is withdrawn with the only version, and the series goes',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'withdrawn_assignments')::int = 1
    and not exists (select 1 from public.enrollment_schedules where schedule_series_id = x) and not exists (select 1 from public.schedule_series where id = x), r);

  s1 := pg_temp.mk_series(b, i1, 'thursday', v_today - 30, null);
  x := pg_temp.series_of(s1);
  perform pg_temp.assign(b, x, 'S3 started', v_today - 5);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('S3 a started assignment refuses the only version (22023, DETAIL started_assignments) and nothing changes',
    r like 'ERR:22023:%|started_assignments' and pg_temp.shape(b) = snap, r);

  s1 := pg_temp.mk_series(b, i1, 'friday', v_today - 30, null);
  perform pg_temp.mk_session(s1, v_today - 7);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('S4 a class session of its own refuses the only version (22023, DETAIL sessions) and nothing changes',
    r like 'ERR:22023:%|sessions' and pg_temp.shape(b) = snap, r);

  -- L. The latest of several versions ------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Latest', 'ZZV63L');
  i1 := pg_temp.mk_instructor('Latest');
  s1 := pg_temp.mk_series(b, i1, 'monday', v_today - 60, v_today - 31, 'active', 12);
  x := pg_temp.series_of(s1);
  s2 := pg_temp.mk_version(s1, v_today - 30, null);
  perform pg_temp.assign(b, x, 'L started', v_today - 20);
  perform pg_temp.assign(b, x, 'L unstarted', v_today + 5);
  earlier := pg_temp.row_of(s1);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('L1 the latest version is deleted; the series, its capacity, every assignment (started or not) and the earlier version stay exactly as they were',
    r not like 'ERR:%' and not exists (select 1 from public.schedules where id = s2)
    and pg_temp.row_of(s1) = earlier
    and exists (select 1 from public.schedule_series where id = x and capacity = 12)
    and (select count(*) from public.enrollment_schedules where schedule_series_id = x) = 2
    and (pg_temp.j(r) ->> 'withdrawn_assignments')::int = 0, r);
  perform pg_temp.rec('L5 the answer says the series continues (series_deleted false, one version remaining)',
    (pg_temp.j(r) ->> 'series_deleted')::boolean = false and (pg_temp.j(r) ->> 'versions_remaining')::int = 1, r);
  perform pg_temp.rec('L6 the earlier version''s end date was not rewritten: the class simply ends where it ended',
    (select effective_until from public.schedules where id = s1) = v_today - 31, '');

  b := pg_temp.mk_batch('EarlierSessions', 'ZZV63M');
  i1 := pg_temp.mk_instructor('EarlierSessions');
  s1 := pg_temp.mk_series(b, i1, 'tuesday', v_today - 60, v_today - 31);
  s2 := pg_temp.mk_version(s1, v_today - 30, null);
  perform pg_temp.mk_session(s1, v_today - 40);
  earlier := pg_temp.row_of(s1);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('L2 a session of an EARLIER version does not block the latest one; the session and the earlier version stay',
    r not like 'ERR:%' and not exists (select 1 from public.schedules where id = s2)
    and (select count(*) from public.class_sessions where schedule_id = s1) = 1 and pg_temp.row_of(s1) = earlier, r);

  b := pg_temp.mk_batch('OwnSession', 'ZZV63O');
  i1 := pg_temp.mk_instructor('OwnSession');
  s1 := pg_temp.mk_series(b, i1, 'wednesday', v_today - 60, v_today - 31);
  s2 := pg_temp.mk_version(s1, v_today - 30, null);
  perform pg_temp.mk_session(s2, v_today - 10);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('L3 the latest version with a session of its own is refused (22023, DETAIL sessions) and nothing changes',
    r like 'ERR:22023:%|sessions' and pg_temp.shape(b) = snap, r);

  b := pg_temp.mk_batch('Inactive', 'ZZV63I');
  i1 := pg_temp.mk_instructor('Inactive');
  s1 := pg_temp.mk_series(b, i1, 'thursday', v_today - 60, v_today - 31);
  s2 := pg_temp.mk_version(s1, v_today - 30, v_today + 10, 'inactive');
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('L4 an INACTIVE latest version is deleted exactly like an active one (status does not decide)',
    r not like 'ERR:%' and not exists (select 1 from public.schedules where id = s2) and exists (select 1 from public.schedules where id = s1), r);

  -- E. Earlier and middle versions ------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Chain', 'ZZV63C');
  i1 := pg_temp.mk_instructor('Chain');
  s1 := pg_temp.mk_series(b, i1, 'friday', v_today - 90, v_today - 61);
  s2 := pg_temp.mk_version(s1, v_today - 60, v_today - 31);
  s3 := pg_temp.mk_version(s1, v_today - 30, null);
  snap := pg_temp.shape(b);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('E1 the EARLIEST version is refused while later ones exist (22023, DETAIL later_version) - no session, no assignment - and nothing changes',
    r like 'ERR:22023:%|later_version' and pg_temp.shape(b) = snap, r);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('E2 a MIDDLE version is refused likewise - no gap in the chain - and nothing changes',
    r like 'ERR:22023:%|later_version' and pg_temp.shape(b) = snap, r);

  -- Three statements, in order (an AND chain gives no evaluation-order guarantee): the latest, then the middle, then the last remaining one.
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s3));
  perform pg_temp.rec('E3a the latest of three goes first (two versions remain)',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'versions_remaining')::int = 2 and not exists (select 1 from public.schedules where id = s3), r);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s2));
  perform pg_temp.rec('E3b the middle version is now the latest and can go (one version remains)',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'versions_remaining')::int = 1 and exists (select 1 from public.schedules where id = s1), r);
  r := pg_temp.call_as(v_admin, pg_temp.del_sql(s1));
  perform pg_temp.rec('E3c the last remaining version takes the series with it',
    r not like 'ERR:%' and (pg_temp.j(r) ->> 'series_deleted')::boolean
    and not exists (select 1 from public.schedules where batch_id = b) and not exists (select 1 from public.schedule_series where batch_id = b), r);

  -- Z. Existing data unchanged ---------------------------------------------------------------------------------------------------------------
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.schedules s
              where s.batch_id in (select id from public.batches where position('ZZVERIFY 0063' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(ss)::text, '|' order by ss.id) from public.schedule_series ss
              where ss.batch_id in (select id from public.batches where position('ZZVERIFY 0063' in name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es
              where es.schedule_series_id in (select id from public.schedule_series
                                              where batch_id in (select id from public.batches where position('ZZVERIFY 0063' in name) <> 1))), '') ||
    coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs
              where cs.batch_id in (select id from public.batches where position('ZZVERIFY 0063' in name) <> 1)), '')));
  perform pg_temp.rec('Z every schedule, series, assignment and session that existed before this script is byte-for-byte unchanged by it',
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
--   select (select count(*) from public.students where position('ZZVERIFY 0063' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0063' in name) = 1) as leftover_batches,
--          (select count(*) from public.instructors where position('ZZVERIFY 0063' in full_name) = 1) as leftover_instructors;
-- All three must be 0.
