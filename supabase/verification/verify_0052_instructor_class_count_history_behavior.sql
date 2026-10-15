-- ===========================================================================
-- Migration 0052 verification (behaviour) - Instructor read access to class-count attendance history
-- Exercises supabase/migrations/0052_instructor_class_count_history.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0052 is applied (the three functions). Otherwise every scenario is skipped (NOT TESTED).
--   PF  Preflight: no fixture name exists.
--   A   Admin: sees every fixture record, with the reversal reason and time of a reversed one.
--   I   Instructor ownership isolation. Instructor A sees ONLY the records of the students that are theirs:
--         E     an ACTIVE enrollment with a CURRENT assignment on a series A teaches                     -> visible
--         ATT   no enrollment, but attendance recorded on a session A owns                               -> visible
--         B     enrolled on a series only Instructor B teaches                                           -> NOT visible to A
--         NONE  no link at all                                                                           -> NOT visible
--         PAST  an assignment on A's series that ENDED yesterday, no attendance                          -> NOT visible
--         INACT an INACTIVE enrollment with a current assignment on A's series                           -> NOT visible
--       Instructor B sees only B. Neither sees the other's records, and a search for the other's student finds nothing.
--   V   Reversed records: visible to the Instructor as Reversed, WITHOUT the reason or the reversal time; the Admin gets both.
--   S   Search (student name, membership code, case-insensitive, wildcard characters not interpreted) can only narrow.
--   D   Date ranges (inclusive ends, an invalid range refused) and the per-date counts for the calendar and Quick dates.
--   L   Row limit: p_limit caps the rows while total_count still counts the range; 0 and over-large values are clamped.
--   C   Column privacy: the functions return no phone, email, recorder or reverser, or amount.
--   T   Raw tables stay Admin-only: an Instructor's direct SELECT of either class-count table returns nothing.
--   X   Access refusals: anon (privilege), a signed-in user who is not an instructor (42501), and a DEACTIVATED instructor (42501).
--   E   Authorization edge cases (fixture names 'ZZVERIFY EDGE52 ...', all on Instructor A's side unless stated):
--         SCHEDEND   a current enrollment and assignment on a series whose only schedule version ENDED yesterday   -> NOT visible
--         SCHEDINACT the same on a schedule version that is INACTIVE                                               -> NOT visible
--         SCHEDNEXT  the same on a schedule version that only STARTS in ten days                                   -> NOT visible
--         SCHEDFUT   an assignment on A's active series that only STARTS in ten days (a FUTURE-dated assignment)  -> NOT visible
--         ATTB       attendance only on a session B owns                                                          -> visible to B, NOT to A
--         REASB      a session on A's schedule that was REASSIGNED to B (class_sessions.instructor_id = B)        -> visible to B, NOT to A
--         REASA      a session on B's schedule that was reassigned to A                                           -> visible to A, NOT to B
--       so access follows class_sessions.instructor_id (the session's snapshot owner), not the schedule it came from.
--   G   Grants, proven from the catalog and not from the functions' own refusals: anon cannot execute either read function or the
--       internal helper; authenticated can execute both reads but not the helper; nobody holds a PUBLIC grant on any of the three.
--   U   Recording and reversal: an Instructor cannot record for, reverse, or list the memberships of a student who is not theirs, and
--       cannot reverse at all (42501); the Admin's record and reverse still work (they build the fixtures). These hold both before
--       and after migration 0053 (which lets an Instructor record and list for their OWN students - verify_0053 covers that).
--   R   Nothing is written by the reads: the class-count, attendance and session rows are the same after every call.
--   Z   Every row that existed before this script is byte-for-byte unchanged by it.
--
-- RESULTS AND NOT TESTED: PASS and FAIL are verdicts. NOT TESTED is neither: it means a prerequisite could not be created (a missing
-- Admin or instructor pair, a fixture the database refused, a reversal that could not be made), so the scenarios that depend on it
-- were not judged. The SUMMARY row says FAILURES if anything failed, INCOMPLETE if nothing failed but something was NOT TESTED, and
-- ALL PASS only when every scenario ran and passed. An INCOMPLETE run is not a verification of 0052.
--
-- PREREQUISITES: migrations 0043-0052 applied; an Admin profile; TWO active instructors linked to a login (instructors.user_id) -
-- without them the instructor scenarios are reported NOT TESTED.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students, batches and an instructor-linked
--   schedule named 'ZZVERIFY 0052 ...' or 'ZZVERIFY EDGE52 ...'. The class-count tables are append-only, so the rollback is the only clean-up: never run this
--   in a session with autocommit. ONE existing row is touched, inside the transaction: scenario X sets Instructor A's status to
--   'inactive' to prove deactivation revokes access, and sets it back before the digest check; the rollback restores it anyway.
--   Nothing disables a trigger, so the application does not have to be idle, but run it when nobody is editing instructors.
--
-- LIMITATIONS
--   * The 500-row cap itself is not exercised (it would need 500 records); only the clamping of p_limit is.
--   * Concurrency cannot be tested in one transaction. The rule is evaluated at read time, so a change committed by another
--     session is seen by the next call.
--   * "Today" for the current-assignment rule is the centre-timezone date, the same value this script uses.
--   * The application's own pages are not exercised; this script tests the database rules only.
--   * Every membership and class record created here consumes a sequence number: the rollback leaves gaps.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _fx (key text primary key, student uuid, membership uuid, code text, rec1 uuid, rec2 uuid) on commit drop;
create temp table _hash (before_hash text, after_hash text, rows_before text, rows_after text) on commit drop;

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

-- One scalar query as anon: its text, or 'ERR:<sqlstate>'.
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

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- text -> integer, or NULL when it is not an integer (an 'ERR:...' result): a failed call becomes a FAIL, never an aborted script.
create function pg_temp.to_int(p_text text)
returns integer language sql immutable as $f$
  select case when p_text ~ '^-?[0-9]+$' then p_text::integer end
$f$;

-- A scenario that needs a prerequisite: judged when it exists, NOT TESTED (never FAIL) when it could not be created.
create function pg_temp.chk(p_prereq boolean, p_test text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $f$
begin
  if coalesce(p_prereq, false) then
    perform pg_temp.rec(p_test, p_ok, p_detail);
  else
    perform pg_temp.skip(p_test, 'A prerequisite fixture could not be created (see the NOT TESTED fixture rows above).');
  end if;
end $f$;

-- Whether a role may execute a function, from the catalog: NULL when the role does not exist.
create function pg_temp.priv(p_role text, p_function text)
returns boolean language plpgsql as $f$
begin
  return has_function_privilege(p_role, p_function, 'execute');
exception when others then
  return null;
end $f$;

-- Whether PUBLIC holds EXECUTE on a function (the default ACL counts when no explicit ACL is stored).
create function pg_temp.public_can_execute(p_function text)
returns boolean language sql as $f$
  select exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = p_function::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  )
$f$;

-- list_class_count_attendance_history as a user, summarised: 'N=<total_count>;R=<rows>;<name|date|reversed|reason|time>,...' (rows
-- ordered by date then name) or 'ERR:<sqlstate>'.
create function pg_temp.hist(p_user uuid, p_from date, p_to date, p_q text, p_limit integer)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select 'N=' || coalesce(max(h.total_count), 0) || ';R=' || count(*) || ';' ||
              coalesce(string_agg(h.student_name || '|' || h.attended_on || '|' || h.reversed || '|' || coalesce(h.reversal_reason, '~') || '|' ||
                                  case when h.reversed_at is null then '~' else 'T' end, ',' order by h.attended_on, h.student_name), '')
       from public.list_class_count_attendance_history(%L::date, %L::date, %L::text, %L::integer) h$q$,
    p_from, p_to, p_q, p_limit));
end $f$;

-- The distinct FIXTURE student names a call returned (comma separated, sorted, prefix removed), or the 'ERR:' text. Real students
-- the instructor may see are deliberately left out, so existing data cannot change a result.
create function pg_temp.who(p_user uuid, p_from date, p_to date, p_q text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select coalesce(string_agg(distinct replace(h.student_name, 'ZZVERIFY 0052 ', ''), ',' order by replace(h.student_name, 'ZZVERIFY 0052 ', '')), '')
       from public.list_class_count_attendance_history(%L::date, %L::date, %L::text, 500) h
       where position('ZZVERIFY 0052 ' in h.student_name) = 1$q$,
    p_from, p_to, p_q));
end $f$;

-- The distinct EDGE-fixture student names a call returned (prefix removed, sorted), or the 'ERR:' text.
create function pg_temp.who_edge(p_user uuid, p_from date, p_to date)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select coalesce(string_agg(distinct replace(h.student_name, 'ZZVERIFY EDGE52 ', ''), ',' order by replace(h.student_name, 'ZZVERIFY EDGE52 ', '')), '')
       from public.list_class_count_attendance_history(%L::date, %L::date, 'ZZVERIFY EDGE52', 500) h
       where position('ZZVERIFY EDGE52 ' in h.student_name) = 1$q$,
    p_from, p_to));
end $f$;

-- list_class_count_attendance_dates as a user: 'date:count,...' (newest first) or 'ERR:<sqlstate>'.
create function pg_temp.dates(p_user uuid, p_from date, p_to date)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select coalesce(string_agg(d.attended_on || ':' || d.record_count, ',' order by d.attended_on desc), '')
       from public.list_class_count_attendance_dates(%L::date, %L::date, 200) d$q$,
    p_from, p_to));
end $f$;

-- The record count of ONE date from the dates function as a user: an integer as text, or 'ERR:<sqlstate>'.
create function pg_temp.day_count(p_user uuid, p_from date, p_to date, p_day date)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select coalesce(sum(d.record_count), 0)::text from public.list_class_count_attendance_dates(%L::date, %L::date, 200) d where d.attended_on = %L::date$q$,
    p_from, p_to, p_day));
end $f$;

create function pg_temp.mk_student(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0052 ' || p_name, '9000000052', '+91', p_today - 100, 'active') returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_student_x(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY EDGE52 ' || p_name, '9000000052', '+91', p_today - 100, 'active') returning id into v_id;
  return v_id;
end $f$;

-- A series with ONE schedule version of the given period and status (the edge cases need ended, inactive and future versions).
create function pg_temp.mk_series_x(p_batch uuid, p_instr uuid, p_day text, p_from date, p_until date, p_status text)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instr, p_day, '09:00', '10:00', p_from, p_until, p_status, v_series);
  return v_series;
end $f$;

-- An active enrollment starting p_enr_start with ONE open assignment starting p_asg_start (a future-dated assignment).
create function pg_temp.enrol_x(p_student uuid, p_batch uuid, p_series uuid, p_enr_start date, p_asg_start date)
returns void language plpgsql as $f$
declare
  v_enr uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, status)
  values (p_student, p_batch, p_enr_start, 'active') returning id into v_enr;
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  values (v_enr, p_series, p_asg_start);
end $f$;

-- A session on the series' schedule, OWNED by p_owner (class_sessions.instructor_id), with one present mark for the student.
create function pg_temp.mk_session(p_series uuid, p_batch uuid, p_owner uuid, p_day date, p_student uuid)
returns void language plpgsql as $f$
declare
  v_sched uuid;
  v_ses   uuid;
begin
  select id into v_sched from public.schedules where series_id = p_series;
  insert into public.class_sessions (schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status)
  values (v_sched, p_batch, p_owner, p_day, '09:00', '10:00', 'scheduled') returning id into v_ses;
  insert into public.attendance (class_session_id, student_id, status) values (v_ses, p_student, 'present');
end $f$;

create function pg_temp.mk_series(p_batch uuid, p_instr uuid, p_day text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instr, p_day, '09:00', '10:00', p_today - 90, null, 'active', v_series);
  return v_series;
end $f$;

-- An enrollment (active or inactive) and ONE assignment on a series, starting p_from and ending p_until (null = open).
create function pg_temp.enrol(p_student uuid, p_batch uuid, p_series uuid, p_status text, p_today date, p_until date)
returns void language plpgsql as $f$
declare
  v_enr uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, status)
  values (p_student, p_batch, p_today - 60, p_status) returning id into v_enr;
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
  values (v_enr, p_series, p_today - 60, p_until);
end $f$;

-- A class-count membership for the student; the fixture row is recorded in _fx.
create function pg_temp.mk_membership(p_key text, p_student uuid, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id   uuid;
  v_code text;
begin
  insert into public.memberships (student_id, plan, kind, total_classes, start_date, end_date, amount, currency)
  values (p_student, 'class_count', 'class_count', 10, p_today - 30, null, 500, (select cp.currency from public.center_profile cp where cp.singleton))
  returning id, membership_code into v_id, v_code;
  insert into _fx (key, student, membership, code) values (p_key, p_student, v_id, v_code);
  return v_id;
end $f$;

-- Records one class as the Admin and returns the attendance id (or the 'ERR:' text).
create function pg_temp.record_as(p_admin uuid, p_membership uuid, p_on date)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    $q$select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)->>'attendance_id'$q$, p_membership, p_on));
end $f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _hash (before_hash, rows_before)
select md5(
  coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s), '') ||
  coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), '') ||
  coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a), '') ||
  coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r), '') ||
  coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') ||
  coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), '')),
  null;

do $$
declare
  v_applied boolean;
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_admin   uuid;
  v_ia      uuid; v_ia_user uuid;
  v_ib      uuid; v_ib_user uuid;
  v_b       uuid;
  v_sa      uuid; v_sb uuid;
  v_sched_a uuid;
  v_session uuid;
  s_e uuid; s_att uuid; s_b uuid; s_none uuid; s_past uuid; s_inact uuid;
  m_e uuid; m_att uuid; m_b uuid; m_none uuid; m_past uuid; m_inact uuid;
  v_id      text;
  v_c       text;
  v_r       text;
  v_key     text;
  v_att_ok  boolean := true;
  v_edge_ok boolean := true;
  v_rev_ok  boolean := true;
  v_se uuid; v_si uuid; v_sn uuid;
  s_x1 uuid; s_x2 uuid; s_x3 uuid; s_x4 uuid; s_x5 uuid; s_x6 uuid; s_x7 uuid;
  v_rows_before text;
  v_rows_after  text;
  v_stranger uuid := gen_random_uuid();
  v_has_instructors boolean;
  v_a_status text;
begin
  -- P0 ----------------------------------------------------------------------------------------------------------------------
  v_applied := to_regprocedure('public.list_class_count_attendance_history(date, date, text, integer)') is not null
           and to_regprocedure('public.list_class_count_attendance_dates(date, date, integer)') is not null
           and to_regprocedure('public.class_count_student_visible(uuid)') is not null;
  perform pg_temp.rec('P0 migration 0052 is applied (the history, dates and visibility functions)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0052 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0052' in full_name) = 1 or position('ZZVERIFY EDGE52' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0052' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0052 / ZZVERIFY EDGE52 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id, user_id into v_ia, v_ia_user from public.instructors where user_id is not null and status = 'active' order by created_at limit 1;
  select id, user_id into v_ib, v_ib_user from public.instructors where user_id is not null and status = 'active' and id <> v_ia order by created_at limit 1;
  v_has_instructors := v_ia is not null and v_ib is not null;

  if v_admin is null then
    perform pg_temp.skip('all scenarios', 'Needs an Admin profile.');
    return;
  end if;
  if not v_has_instructors then
    perform pg_temp.skip('I / V / S / D / L / T / X / U (instructor scenarios)', 'Needs two ACTIVE instructors linked to a login (instructors.user_id).');
    return;
  end if;

  -- Fixtures: one batch, A's series and B's series (A and B are the two existing instructors) ------------------------------
  insert into public.batches (name, code) values ('ZZVERIFY 0052 Batch', 'ZZV52') returning id into v_b;
  v_sa := pg_temp.mk_series(v_b, v_ia, 'monday', v_today);
  v_sb := pg_temp.mk_series(v_b, v_ib, 'wednesday', v_today);
  select id into v_sched_a from public.schedules where series_id = v_sa;

  s_e := pg_temp.mk_student('E', v_today);
  perform pg_temp.enrol(s_e, v_b, v_sa, 'active', v_today, null);
  s_att := pg_temp.mk_student('ATT', v_today);
  s_b := pg_temp.mk_student('B', v_today);
  perform pg_temp.enrol(s_b, v_b, v_sb, 'active', v_today, null);
  s_none := pg_temp.mk_student('NONE', v_today);
  s_past := pg_temp.mk_student('PAST', v_today);
  perform pg_temp.enrol(s_past, v_b, v_sa, 'active', v_today, v_today - 1);
  s_inact := pg_temp.mk_student('INACT', v_today);
  perform pg_temp.enrol(s_inact, v_b, v_sa, 'inactive', v_today, null);

  -- ATT: attendance on a session A owns (one present mark), and no enrollment. Built in its own block: if the database refuses the
  -- fixture the failure is recorded (F3) instead of ending the run.
  begin
    insert into public.class_sessions (schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status)
    values (v_sched_a, v_b, v_ia, v_today - 10, '09:00', '10:00', 'scheduled') returning id into v_session;
    insert into public.attendance (class_session_id, student_id, status) values (v_session, s_att, 'present');
  exception when others then
    v_att_ok := false;
    perform pg_temp.skip('F3 the ATT fixture (a session owned by A with one attendance mark) could be built', sqlstate || ': ' || sqlerrm);
  end;
  if v_att_ok then
    perform pg_temp.rec('F3 the ATT fixture (a session owned by A with one attendance mark) could be built', true, '');
  end if;

  -- The edge-case fixtures (scenario E), built in one block: if the database refuses any part, the whole block is undone and the edge
  -- scenarios are reported NOT TESTED (F4) instead of ending the run or failing.
  begin
    v_se := pg_temp.mk_series_x(v_b, v_ia, 'tuesday', v_today - 90, v_today - 1, 'active');    -- version ENDED yesterday
    v_si := pg_temp.mk_series_x(v_b, v_ia, 'thursday', v_today - 90, null, 'inactive');         -- version INACTIVE
    v_sn := pg_temp.mk_series_x(v_b, v_ia, 'saturday', v_today + 10, null, 'active');           -- version starts in ten days

    s_x1 := pg_temp.mk_student_x('SCHEDEND', v_today);
    perform pg_temp.enrol(s_x1, v_b, v_se, 'active', v_today, null);
    s_x2 := pg_temp.mk_student_x('SCHEDINACT', v_today);
    perform pg_temp.enrol(s_x2, v_b, v_si, 'active', v_today, null);
    s_x3 := pg_temp.mk_student_x('SCHEDFUT', v_today);
    perform pg_temp.enrol_x(s_x3, v_b, v_sa, v_today - 60, v_today + 10);                         -- assignment starts in ten days
    s_x4 := pg_temp.mk_student_x('SCHEDNEXT', v_today);
    perform pg_temp.enrol(s_x4, v_b, v_sn, 'active', v_today, null);

    s_x5 := pg_temp.mk_student_x('ATTB', v_today);
    perform pg_temp.mk_session(v_sb, v_b, v_ib, v_today - 11, s_x5);                              -- B's schedule, owned by B
    s_x6 := pg_temp.mk_student_x('REASB', v_today);
    perform pg_temp.mk_session(v_sa, v_b, v_ib, v_today - 12, s_x6);                              -- A's schedule, reassigned to B
    s_x7 := pg_temp.mk_student_x('REASA', v_today);
    perform pg_temp.mk_session(v_sb, v_b, v_ia, v_today - 13, s_x7);                              -- B's schedule, reassigned to A

    perform pg_temp.mk_membership('X_SCHEDEND', s_x1, v_today);
    perform pg_temp.mk_membership('X_SCHEDINACT', s_x2, v_today);
    perform pg_temp.mk_membership('X_SCHEDFUT', s_x3, v_today);
    perform pg_temp.mk_membership('X_SCHEDNEXT', s_x4, v_today);
    perform pg_temp.mk_membership('X_ATTB', s_x5, v_today);
    perform pg_temp.mk_membership('X_REASB', s_x6, v_today);
    perform pg_temp.mk_membership('X_REASA', s_x7, v_today);
  exception when others then
    v_edge_ok := false;
    perform pg_temp.skip('F4 the edge-case fixtures (ended / inactive / future schedule versions, a future assignment, reassigned sessions) could be built', sqlstate || ': ' || sqlerrm);
  end;
  if v_edge_ok then
    perform pg_temp.rec('F4 the edge-case fixtures (ended / inactive / future schedule versions, a future assignment, reassigned sessions) could be built', true, '');
  end if;

  m_e := pg_temp.mk_membership('E', s_e, v_today);
  m_att := pg_temp.mk_membership('ATT', s_att, v_today);
  m_b := pg_temp.mk_membership('B', s_b, v_today);
  m_none := pg_temp.mk_membership('NONE', s_none, v_today);
  m_past := pg_temp.mk_membership('PAST', s_past, v_today);
  m_inact := pg_temp.mk_membership('INACT', s_inact, v_today);

  -- Two classes each, as the Admin (the real function): attended today-5 and today-3. E's second is then reversed.
  for v_key in select key from _fx order by key loop
    update _fx set rec1 = pg_temp.as_uuid(pg_temp.record_as(v_admin, membership, v_today - 5)) where key = v_key;
    update _fx set rec2 = pg_temp.as_uuid(pg_temp.record_as(v_admin, membership, v_today - 3)) where key = v_key;
  end loop;
  if exists (select 1 from _fx where rec1 is null or rec2 is null) then
    perform pg_temp.skip('F fixtures: every fixture membership has its two class-count records, recorded by the Admin function',
      (select count(*) from _fx where rec1 is null or rec2 is null) || ' fixture membership(s) are missing a record, so none of the scenarios below can be judged.');
    return;
  end if;
  perform pg_temp.rec('F fixtures: every fixture membership has its two class-count records, recorded by the Admin function', true, (select count(*) from _fx) || ' memberships');

  v_c := pg_temp.scalar_as(v_admin, format(
    $q$select public.reverse_class_count_attendance(%L, 'ZZVERIFY reversal reason', gen_random_uuid())::text$q$, (select rec2 from _fx where key = 'E')));
  v_rev_ok := v_c not like 'ERR:%';
  if v_rev_ok then
    perform pg_temp.rec('F2 the Admin reverses E''s second record (the real function)', true, v_c);
  else
    perform pg_temp.skip('F2 the Admin reverses E''s second record (the real function)', 'The reversal fixture could not be created: ' || v_c);
  end if;

  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '') || '#' ||
             coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r), '') || '#' ||
             coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') || '#' ||
             coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''))
    into v_rows_before from public.class_count_attendance a;

  -- A. Admin ------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.hist(v_admin, v_today - 30, v_today, 'ZZVERIFY 0052', 500);
  perform pg_temp.rec('A1 the Admin sees all twelve fixture records', v_r like 'N=12;R=12;%', v_r);
  perform pg_temp.chk(v_rev_ok, 'A2 the Admin sees the reversed record WITH its reason and reversal time',
    v_r like '%ZZVERIFY 0052 E|' || (v_today - 3) || '|true|ZZVERIFY reversal reason|T%', v_r);
  perform pg_temp.rec('A3 an Admin sees every fixture student, including those no instructor teaches',
    pg_temp.who(v_admin, v_today - 30, v_today, 'ZZVERIFY 0052') = 'ATT,B,E,INACT,NONE,PAST', pg_temp.who(v_admin, v_today - 30, v_today, 'ZZVERIFY 0052'));

  -- I. Isolation --------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk(v_att_ok, 'I1 Instructor A sees exactly E and ATT (an active enrollment with a current assignment on their series; attendance on their session)',
    pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052') = 'ATT,E', pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052'));
  perform pg_temp.rec('I2 Instructor B sees exactly B',
    pg_temp.who(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052') = 'B', pg_temp.who(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052'));
  perform pg_temp.rec('I3 NONE, PAST (assignment ended yesterday) and INACT (inactive enrollment) are visible to neither instructor',
    pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052') !~ '(NONE|PAST|INACT)'
    and pg_temp.who(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052') !~ '(NONE|PAST|INACT)', '');
  perform pg_temp.rec('I4 a search for the OTHER instructor''s student finds nothing, for each of them',
    pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052 B') = '' and pg_temp.who(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052 E') = '', '');
  perform pg_temp.chk(v_att_ok, 'I5 an instructor''s total_count counts only their own records (A: 4, B: 2)',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 500) like 'N=4;R=4;%'
    and pg_temp.hist(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052', 500) like 'N=2;R=2;%',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 500) || ' / ' || pg_temp.hist(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052', 500));

  -- V. Reversal ----------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052 E', 500);
  perform pg_temp.chk(v_rev_ok, 'V1 the Instructor sees the reversed record as Reversed, WITHOUT the reason and WITHOUT the reversal time',
    v_r like '%ZZVERIFY 0052 E|' || (v_today - 3) || '|true|~|~%' and v_r not like '%ZZVERIFY reversal reason%', v_r);
  perform pg_temp.chk(v_rev_ok, 'V2 the Instructor''s non-reversed record of the same student is shown as not reversed',
    v_r like '%ZZVERIFY 0052 E|' || (v_today - 5) || '|false|~|~%', v_r);

  -- S. Search ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk(v_att_ok, 'S1 search is case-insensitive on the student name',
    pg_temp.who(v_ia_user, v_today - 30, v_today, 'zzverify 0052 att') = 'ATT', pg_temp.who(v_ia_user, v_today - 30, v_today, 'zzverify 0052 att'));
  perform pg_temp.rec('S2 search matches the membership code, and only inside what the instructor may see',
    pg_temp.who(v_ia_user, v_today - 30, v_today, (select code from _fx where key = 'E')) = 'E'
    and pg_temp.who(v_ia_user, v_today - 30, v_today, (select code from _fx where key = 'B')) = '', '');
  perform pg_temp.rec('S3 wildcard characters in a search are not interpreted (% and _ match nothing here)',
    pg_temp.who(v_ia_user, v_today - 30, v_today, '%') = '' and pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY_0052') = '', '');
  perform pg_temp.chk(v_att_ok, 'S4 a blank or null search widens nothing (still only E and ATT among the fixtures)',
    pg_temp.who(v_ia_user, v_today - 30, v_today, '   ') = 'ATT,E' and pg_temp.who(v_ia_user, v_today - 30, v_today, null) = 'ATT,E',
    pg_temp.who(v_ia_user, v_today - 30, v_today, null));
  perform pg_temp.rec('S5 an over-long search (101 characters) is refused (22023)',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, repeat('x', 101), 10) = 'ERR:22023', pg_temp.hist(v_ia_user, v_today - 30, v_today, repeat('x', 101), 10));

  -- D. Date ranges -------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk(v_att_ok, 'D1 a single-day range is inclusive at both ends (today-5: A sees E and ATT)',
    pg_temp.hist(v_ia_user, v_today - 5, v_today - 5, 'ZZVERIFY 0052', 500) like 'N=2;R=2;%'
    and pg_temp.who(v_ia_user, v_today - 5, v_today - 5, 'ZZVERIFY 0052') = 'ATT,E', pg_temp.hist(v_ia_user, v_today - 5, v_today - 5, 'ZZVERIFY 0052', 500));
  perform pg_temp.rec('D2 a range with no records returns nothing', pg_temp.hist(v_ia_user, v_today - 20, v_today - 10, 'ZZVERIFY 0052', 500) = 'N=0;R=0;', '');
  perform pg_temp.rec('D3 an invalid range (from after to) is refused (22023)',
    pg_temp.hist(v_ia_user, v_today, v_today - 1, null, 10) = 'ERR:22023', pg_temp.hist(v_ia_user, v_today, v_today - 1, null, 10));
  -- Other (real) records may share these dates, so the counts are compared with the Admin's: the Admin's day count must exceed an
  -- instructor's by AT LEAST the fixture records that instructor may not see (A: B, NONE, PAST, INACT = 4; B: all but B's own = 5).
  perform pg_temp.chk(v_att_ok, 'D4 the per-date count for A includes their two fixture records and omits the four they may not see',
    pg_temp.to_int(pg_temp.day_count(v_ia_user, v_today - 6, v_today, v_today - 5)) >= 2
    and pg_temp.to_int(pg_temp.day_count(v_admin, v_today - 6, v_today, v_today - 5)) - pg_temp.to_int(pg_temp.day_count(v_ia_user, v_today - 6, v_today, v_today - 5)) >= 4,
    pg_temp.day_count(v_ia_user, v_today - 6, v_today, v_today - 5) || ' of ' || pg_temp.day_count(v_admin, v_today - 6, v_today, v_today - 5));
  perform pg_temp.rec('D5 the per-date count for B includes their one fixture record and omits the five they may not see',
    pg_temp.to_int(pg_temp.day_count(v_ib_user, v_today - 6, v_today, v_today - 5)) >= 1
    and pg_temp.to_int(pg_temp.day_count(v_admin, v_today - 6, v_today, v_today - 5)) - pg_temp.to_int(pg_temp.day_count(v_ib_user, v_today - 6, v_today, v_today - 5)) >= 5,
    pg_temp.day_count(v_ib_user, v_today - 6, v_today, v_today - 5) || ' of ' || pg_temp.day_count(v_admin, v_today - 6, v_today, v_today - 5));
  perform pg_temp.rec('D6 the dates function refuses an invalid or half-given range (22023)',
    pg_temp.dates(v_ia_user, v_today, v_today - 1) = 'ERR:22023' and pg_temp.dates(v_ia_user, v_today, null) = 'ERR:22023', '');
  v_c := pg_temp.scalar_as(v_ia_user, 'select coalesce(sum(d.record_count), 0)::text from public.list_class_count_attendance_dates(null, null, 200) d');
  perform pg_temp.chk(v_att_ok, 'D7 with no range the Quick-dates read returns at least A''s four fixture records and never more than the Admin''s',
    pg_temp.to_int(v_c) >= 4
    and pg_temp.to_int(v_c) <= pg_temp.to_int(pg_temp.scalar_as(v_admin, 'select coalesce(sum(d.record_count), 0)::text from public.list_class_count_attendance_dates(null, null, 200) d')),
    v_c);

  -- L. Limit -------------------------------------------------------------------------------------------------------------------
  perform pg_temp.chk(v_att_ok, 'L1 p_limit caps the rows while total_count still counts the whole range',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 1) like 'N=4;R=1;%', pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 1));
  perform pg_temp.chk(v_att_ok, 'L2 p_limit 0 or negative is clamped to 1, and a huge one to the cap (here all four rows)',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 0) like 'N=4;R=1;%'
    and pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', -5) like 'N=4;R=1;%'
    and pg_temp.hist(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052', 100000) like 'N=4;R=4;%', '');

  -- C. Column privacy ----------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('C1 the history function returns no phone, email, recorder, reverser or amount column',
    pg_get_function_result('public.list_class_count_attendance_history(date, date, text, integer)'::regprocedure) !~* '(phone|email|recorded_by|reversed_by|amount)'
    and pg_get_function_result('public.list_class_count_attendance_dates(date, date, integer)'::regprocedure) !~* '(phone|email|recorded_by|reversed_by|amount)',
    pg_get_function_result('public.list_class_count_attendance_history(date, date, text, integer)'::regprocedure));

  -- T. Raw tables stay Admin-only ------------------------------------------------------------------------------------------------
  perform pg_temp.rec('T1 an Instructor''s direct SELECT of class_count_attendance and of its reversals returns nothing',
    pg_temp.scalar_as(v_ia_user, 'select count(*)::text from public.class_count_attendance') = '0'
    and pg_temp.scalar_as(v_ia_user, 'select count(*)::text from public.class_count_attendance_reversals') = '0', '');
  perform pg_temp.rec('T2 the Admin''s direct SELECT still sees the fixtures (the tables are unchanged)',
    pg_temp.to_int(pg_temp.scalar_as(v_admin, 'select count(*)::text from public.class_count_attendance')) >= 12, '');
  perform pg_temp.rec('T3 the internal visibility function is not callable by a client (permission denied, 42501)',
    pg_temp.scalar_as(v_ia_user, format('select public.class_count_student_visible(%L)::text', s_b)) = 'ERR:42501', '');

  -- U. Recording and reversal are unchanged ---------------------------------------------------------------------------------------
  v_c := pg_temp.scalar_as(v_ib_user, format($q$select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)::text$q$, m_e, v_today - 1));
  perform pg_temp.rec('U1 an Instructor cannot record a class for ANOTHER instructor''s student (42501)', v_c = 'ERR:42501', v_c);
  v_c := pg_temp.scalar_as(v_ia_user, format($q$select public.reverse_class_count_attendance(%L, 'ZZVERIFY nope', gen_random_uuid())::text$q$, (select rec1 from _fx where key = 'E')));
  perform pg_temp.rec('U2 an Instructor still cannot reverse a class (42501)', v_c = 'ERR:42501', v_c);
  v_c := pg_temp.scalar_as(v_ib_user, format($q$select count(*)::text from public.list_class_count_eligible() e where e.membership_id = %L$q$, m_e));
  perform pg_temp.rec('U3 the eligible list never contains ANOTHER instructor''s student (refused 42501 before 0053, an empty match after)',
    v_c = 'ERR:42501' or v_c = '0', v_c);

  -- X. Access refusals ---------------------------------------------------------------------------------------------------------
  v_c := pg_temp.scalar_anon(format($q$select count(*)::text from public.list_class_count_attendance_history(%L::date, %L::date, null, 10)$q$, v_today - 30, v_today));
  perform pg_temp.rec('X1 anon is refused by the history function (42501; the grant itself is proven by G1)', v_c = 'ERR:42501', v_c);
  v_c := pg_temp.scalar_anon(format($q$select count(*)::text from public.list_class_count_attendance_dates(%L::date, %L::date, 10)$q$, v_today - 30, v_today));
  perform pg_temp.rec('X2 anon is refused by the dates function (42501; the grant itself is proven by G2)', v_c = 'ERR:42501', v_c);
  perform pg_temp.rec('X3 a signed-in user who is neither an Admin nor a linked instructor is refused (42501)',
    pg_temp.hist(v_stranger, v_today - 30, v_today, null, 10) = 'ERR:42501' and pg_temp.dates(v_stranger, v_today - 30, v_today) = 'ERR:42501', '');

  -- G. Grants, from the catalog (not from the functions' own refusals) ---------------------------------------------------------------
  perform pg_temp.chk(pg_temp.priv('anon', 'public.list_class_count_attendance_history(date, date, text, integer)') is not null,
    'G1 anon has no EXECUTE on the history function',
    pg_temp.priv('anon', 'public.list_class_count_attendance_history(date, date, text, integer)') is false, '');
  perform pg_temp.chk(pg_temp.priv('anon', 'public.list_class_count_attendance_dates(date, date, integer)') is not null,
    'G2 anon has no EXECUTE on the dates function',
    pg_temp.priv('anon', 'public.list_class_count_attendance_dates(date, date, integer)') is false, '');
  perform pg_temp.chk(pg_temp.priv('anon', 'public.class_count_student_visible(uuid)') is not null,
    'G3 anon has no EXECUTE on the internal visibility function',
    pg_temp.priv('anon', 'public.class_count_student_visible(uuid)') is false, '');
  perform pg_temp.chk(pg_temp.priv('authenticated', 'public.list_class_count_attendance_history(date, date, text, integer)') is not null,
    'G4 authenticated has EXECUTE on the history function',
    pg_temp.priv('authenticated', 'public.list_class_count_attendance_history(date, date, text, integer)') is true, '');
  perform pg_temp.chk(pg_temp.priv('authenticated', 'public.list_class_count_attendance_dates(date, date, integer)') is not null,
    'G5 authenticated has EXECUTE on the dates function',
    pg_temp.priv('authenticated', 'public.list_class_count_attendance_dates(date, date, integer)') is true, '');
  perform pg_temp.chk(pg_temp.priv('authenticated', 'public.class_count_student_visible(uuid)') is not null,
    'G6 authenticated has NO EXECUTE on the internal visibility function',
    pg_temp.priv('authenticated', 'public.class_count_student_visible(uuid)') is false, '');
  perform pg_temp.rec('G7 PUBLIC holds no EXECUTE on any of the three functions',
    not pg_temp.public_can_execute('public.list_class_count_attendance_history(date, date, text, integer)')
    and not pg_temp.public_can_execute('public.list_class_count_attendance_dates(date, date, integer)')
    and not pg_temp.public_can_execute('public.class_count_student_visible(uuid)'), '');

  -- E. Authorization edge cases ---------------------------------------------------------------------------------------------------
  perform pg_temp.chk(v_edge_ok, 'E1 Instructor A sees exactly REASA among the edge fixtures (a session on B''s schedule reassigned to A)',
    pg_temp.who_edge(v_ia_user, v_today - 30, v_today) = 'REASA', pg_temp.who_edge(v_ia_user, v_today - 30, v_today));
  perform pg_temp.chk(v_edge_ok, 'E2 Instructor B sees exactly ATTB and REASB among the edge fixtures',
    pg_temp.who_edge(v_ib_user, v_today - 30, v_today) = 'ATTB,REASB', pg_temp.who_edge(v_ib_user, v_today - 30, v_today));
  perform pg_temp.chk(v_edge_ok, 'E3 the Admin sees all seven edge fixtures',
    pg_temp.who_edge(v_admin, v_today - 30, v_today) = 'ATTB,REASA,REASB,SCHEDEND,SCHEDFUT,SCHEDINACT,SCHEDNEXT', pg_temp.who_edge(v_admin, v_today - 30, v_today));
  perform pg_temp.chk(v_edge_ok, 'E4 an ended, an inactive and a future schedule version, and a future-dated assignment, make a student visible to NEITHER instructor',
    pg_temp.who_edge(v_ia_user, v_today - 30, v_today) !~ 'SCHED' and pg_temp.who_edge(v_ib_user, v_today - 30, v_today) !~ 'SCHED', '');
  perform pg_temp.chk(v_edge_ok, 'E5 a student whose only attendance is on B''s session (ATTB) is not visible to A',
    pg_temp.who_edge(v_ia_user, v_today - 30, v_today) !~ 'ATTB', '');
  perform pg_temp.chk(v_edge_ok, 'E6 access follows class_sessions.instructor_id: REASB (A''s schedule, owned by B) is B''s and not A''s; REASA (B''s schedule, owned by A) is A''s and not B''s',
    pg_temp.who_edge(v_ia_user, v_today - 30, v_today) !~ 'REASB' and pg_temp.who_edge(v_ia_user, v_today - 30, v_today) ~ 'REASA'
    and pg_temp.who_edge(v_ib_user, v_today - 30, v_today) ~ 'REASB' and pg_temp.who_edge(v_ib_user, v_today - 30, v_today) !~ 'REASA', '');

  -- R. The reads wrote nothing (checked before the one deliberate change below) ---------------------------------------------------
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '') || '#' ||
             coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r), '') || '#' ||
             coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') || '#' ||
             coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''))
    into v_rows_after from public.class_count_attendance a;
  perform pg_temp.rec('R1 the class-count, reversal, attendance and session rows are identical after all the reads', v_rows_before = v_rows_after, '');

  -- X4. A deactivated instructor loses access at once (the one existing row touched; restored below) -------------------------------
  select status into v_a_status from public.instructors where id = v_ia;
  update public.instructors set status = 'inactive' where id = v_ia;
  perform pg_temp.rec('X4 a DEACTIVATED instructor is refused (42501), and so is their calendar read',
    pg_temp.hist(v_ia_user, v_today - 30, v_today, null, 10) = 'ERR:42501' and pg_temp.dates(v_ia_user, v_today - 30, v_today) = 'ERR:42501', '');
  perform pg_temp.rec('X5 deactivating A changes nothing for B', pg_temp.who(v_ib_user, v_today - 30, v_today, 'ZZVERIFY 0052') = 'B', '');
  update public.instructors set status = v_a_status where id = v_ia;
  perform pg_temp.chk(v_att_ok, 'X6 reactivated, A sees E and ATT again', pg_temp.who(v_ia_user, v_today - 30, v_today, 'ZZVERIFY 0052') = 'ATT,E', '');

  -- Z. Existing data unchanged ---------------------------------------------------------------------------------------------------
  -- Fixture rows are excluded by name: only what existed before this script is compared.
  update _hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s
              where position('ZZVERIFY 0052' in s.full_name) <> 1 and s.id not in (select student from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m where m.id not in (select membership from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a where a.membership_id not in (select membership from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r
              where r.attendance_id in (select a.id from public.class_count_attendance a where a.membership_id not in (select membership from _fx))), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x where x.student_id not in (select student from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs where cs.batch_id <> v_b), '')));
  perform pg_temp.rec('Z every instructor, student, membership, class-count record, reversal, attendance row and session that existed before this script is byte-for-byte unchanged by it',
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
            then ' - NOT TESTED is neither a pass nor a failure: a prerequisite could not be created, so this run does NOT verify 0052'
            else '' end
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0052' in full_name) = 1) as leftover_students,
--          (select count(*) from public.students where position('ZZVERIFY EDGE52' in full_name) = 1) as leftover_edge_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0052' in name) = 1) as leftover_batches;
-- All three must be 0. (The one instructor row the script changes is restored inside the transaction and compared by check Z;
-- the rollback restores it as well.)
