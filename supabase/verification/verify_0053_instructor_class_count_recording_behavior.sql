-- ===========================================================================
-- Migration 0053 verification (behaviour) - Instructor recording of class-count attendance
-- Exercises supabase/migrations/0053_instructor_class_count_recording.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0053 is applied (the two re-created functions use class_count_student_visible). Otherwise every scenario is
--       skipped (NOT TESTED).   PF  Preflight: no fixture name exists.
--   L   The eligible list. An Instructor's list holds only THEIR students' eligible memberships (an expired membership, one that has
--       not started and an inactive student are not eligible for anyone); the other instructor's student and an unrelated student are
--       absent; an Instructor's rows carry NO phone number while the Admin's do; the Admin's list is complete.
--   R   Recording by an Instructor, through the real function:
--         R1 records a class for their own student's membership, with the right balance.
--         R2 the audit row names the Instructor (recorded_by = their login), not an Admin.
--         R3 a repeat of the same request ID records nothing again and says it was replayed.
--         R4 the same request with a different date is refused (23505).
--         R5 another instructor, an unrelated student, the other instructor's student, an UNKNOWN membership are all refused with the
--            same error (42501) and record nothing.
--         R6 the date rules still hold (not in the future, not before the membership starts): 22023.
--         R7 the eligibility rules still hold: an expired membership, one that has not started, an inactive student: 55000.
--         R8 a membership never goes below zero: its last class is recorded, the next is refused (55000).
--   A   Admin unchanged: the Admin still records for ANY student (including one no instructor teaches), and the two-argument
--       recorder is still Admin only.
--   V   Reversal stays Admin only: an Instructor cannot reverse (42501) even the class they recorded; the Admin can, and the class
--       counts again.
--   X   Refusals: anon, a signed-in user who is not an instructor, and a DEACTIVATED instructor are refused for both the list and
--       recording (42501); the deactivated instructor can record again once reactivated.
--   S   Session attendance is untouched: the attendance and class session rows are identical after all the recordings.
--   Z   Every row that existed before this script is byte-for-byte unchanged by it.
--
-- RESULTS AND NOT TESTED: PASS and FAIL are verdicts. NOT TESTED means a prerequisite could not be created (no Admin, fewer than two
-- active linked instructors), so nothing depending on it was judged. The SUMMARY row says FAILURES if anything failed, INCOMPLETE if
-- nothing failed but something was NOT TESTED, and ALL PASS only when every scenario ran and passed.
--
-- PREREQUISITES: migrations 0043-0053 applied; an Admin profile; TWO active instructors linked to a login (instructors.user_id).
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students and a batch named 'ZZVERIFY 0053 ...'.
--   The class-count tables are append-only, so the rollback is the only clean-up: never run this in a session with autocommit. ONE
--   existing row is touched, inside the transaction: scenario X sets Instructor A's status to 'inactive' and sets it back; the
--   rollback restores it anyway. Nothing disables a trigger.
--
-- LIMITATIONS
--   * Concurrency (two recordings of the last class at once) cannot be tested in one transaction; the lock on the membership row
--     that serialises it is unchanged from 0045.
--   * The application's pages and the Record class dialog are not exercised; this script tests the database rules only.
--   * Every record created here consumes a sequence number: the rollback leaves gaps.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _fx (key text primary key, student uuid, membership uuid, code text) on commit drop;
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

create function pg_temp.to_int(p_text text)
returns integer language sql immutable as $f$
  select case when p_text ~ '^-?[0-9]+$' then p_text::integer end
$f$;

-- record_class_count_attendance (three arguments) as a user: one key of its answer ('replayed', 'classes_remaining', 'attendance_id',
-- ...), or 'ERR:<sqlstate>'.
create function pg_temp.record_as(p_user uuid, p_membership uuid, p_request uuid, p_on date, p_key text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select (public.record_class_count_attendance(%L, %L, %L::date))->>%L$q$, p_membership, p_request, p_on, p_key));
end $f$;

-- The fixture students in the eligible list as a user (comma separated, sorted, prefix removed), or 'ERR:<sqlstate>'.
create function pg_temp.eligible_names(p_user uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user,
    $q$select coalesce(string_agg(replace(e.full_name, 'ZZVERIFY 0053 ', ''), ',' order by e.full_name), '')
       from public.list_class_count_eligible() e where position('ZZVERIFY 0053 ' in e.full_name) = 1$q$);
end $f$;

create function pg_temp.mk_student(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0053 ' || p_name, '9000000053', '+91', p_today - 100, 'active') returning id into v_id;
  return v_id;
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

create function pg_temp.enrol(p_student uuid, p_batch uuid, p_series uuid, p_today date)
returns void language plpgsql as $f$
declare
  v_enr uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, status)
  values (p_student, p_batch, p_today - 60, 'active') returning id into v_enr;
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  values (v_enr, p_series, p_today - 60);
end $f$;

-- A class-count membership: p_total classes, starting p_start, ending p_end (null = No expiry); recorded in _fx.
create function pg_temp.mk_membership(p_key text, p_student uuid, p_total integer, p_start date, p_end date)
returns uuid language plpgsql as $f$
declare
  v_id   uuid;
  v_code text;
begin
  insert into public.memberships (student_id, plan, kind, total_classes, start_date, end_date, amount, currency)
  values (p_student, 'class_count', 'class_count', p_total, p_start, p_end, 500, (select cp.currency from public.center_profile cp where cp.singleton))
  returning id, membership_code into v_id, v_code;
  insert into _fx (key, student, membership, code) values (p_key, p_student, v_id, v_code);
  return v_id;
end $f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s), '') ||
  coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), '') ||
  coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a), '') ||
  coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r), '') ||
  coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') ||
  coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''));

do $$
declare
  v_applied boolean;
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_admin   uuid;
  v_ia      uuid; v_ia_user uuid;
  v_ib      uuid; v_ib_user uuid;
  v_b       uuid;
  v_sa      uuid; v_sb uuid;
  s_e uuid; s_bb uuid; s_none uuid; s_exp uuid; s_one uuid; s_inact uuid; s_fut uuid;
  m_e uuid; m_bb uuid; m_none uuid; m_exp uuid; m_one uuid; m_inact uuid; m_fut uuid;
  v_req     uuid := gen_random_uuid();
  v_req2    uuid := gen_random_uuid();
  v_c       text;
  v_r       text;
  v_att     uuid;
  v_before_rows text;
  v_after_rows  text;
  v_stranger uuid := gen_random_uuid();
  v_a_status text;
  v_phones_a text;
  v_phones_admin text;
begin
  -- P0 ----------------------------------------------------------------------------------------------------------------------
  v_applied := to_regprocedure('public.record_class_count_attendance(uuid, uuid, date)') is not null
           and to_regprocedure('public.list_class_count_eligible()') is not null
           and to_regprocedure('public.class_count_student_visible(uuid)') is not null
           and pg_get_functiondef('public.record_class_count_attendance(uuid, uuid, date)'::regprocedure) like '%class_count_student_visible%'
           and pg_get_functiondef('public.list_class_count_eligible()'::regprocedure) like '%class_count_student_visible%';
  perform pg_temp.rec('P0 migration 0053 is applied (the recorder and the list authorize through class_count_student_visible)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0053 (and 0052) is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0053' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0053' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0053 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id, user_id into v_ia, v_ia_user from public.instructors where user_id is not null and status = 'active' order by created_at limit 1;
  select id, user_id into v_ib, v_ib_user from public.instructors where user_id is not null and status = 'active' and id <> v_ia order by created_at limit 1;
  if v_admin is null then
    perform pg_temp.skip('all scenarios', 'Needs an Admin profile.');
    return;
  end if;
  if v_ia is null or v_ib is null then
    perform pg_temp.skip('L / R / A / V / X / S (instructor scenarios)', 'Needs two ACTIVE instructors linked to a login (instructors.user_id).');
    return;
  end if;

  -- Fixtures ----------------------------------------------------------------------------------------------------------------------
  insert into public.batches (name, code) values ('ZZVERIFY 0053 Batch', 'ZZV53') returning id into v_b;
  v_sa := pg_temp.mk_series(v_b, v_ia, 'monday', v_today);       -- Instructor A's series
  v_sb := pg_temp.mk_series(v_b, v_ib, 'wednesday', v_today);    -- Instructor B's series

  s_e := pg_temp.mk_student('E', v_today);          perform pg_temp.enrol(s_e, v_b, v_sa, v_today);      -- A's student
  s_one := pg_temp.mk_student('ONE', v_today);      perform pg_temp.enrol(s_one, v_b, v_sa, v_today);    -- A's student, ONE class only
  s_exp := pg_temp.mk_student('EXP', v_today);      perform pg_temp.enrol(s_exp, v_b, v_sa, v_today);    -- A's student, expired membership
  s_fut := pg_temp.mk_student('FUT', v_today);      perform pg_temp.enrol(s_fut, v_b, v_sa, v_today);    -- A's student, membership starts later
  s_inact := pg_temp.mk_student('INACTS', v_today); perform pg_temp.enrol(s_inact, v_b, v_sa, v_today);  -- A's student, made inactive below
  s_bb := pg_temp.mk_student('BB', v_today);        perform pg_temp.enrol(s_bb, v_b, v_sb, v_today);     -- B's student
  s_none := pg_temp.mk_student('NONE', v_today);                                                          -- nobody's student

  m_e := pg_temp.mk_membership('E', s_e, 10, v_today - 30, null);
  m_one := pg_temp.mk_membership('ONE', s_one, 1, v_today - 30, null);
  m_exp := pg_temp.mk_membership('EXP', s_exp, 10, v_today - 30, v_today - 1);
  m_fut := pg_temp.mk_membership('FUT', s_fut, 10, v_today + 5, null);
  m_inact := pg_temp.mk_membership('INACTS', s_inact, 10, v_today - 30, null);
  m_bb := pg_temp.mk_membership('BB', s_bb, 10, v_today - 30, null);
  m_none := pg_temp.mk_membership('NONE', s_none, 10, v_today - 30, null);
  update public.students set status = 'inactive' where id = s_inact;

  select md5(coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') || '#' ||
             coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''))
    into v_before_rows;

  -- L. The eligible list ------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('L1 Instructor A''s list holds exactly their own eligible students (E, ONE) - not the expired, not-started or inactive ones, not B''s, not an unrelated one',
    pg_temp.eligible_names(v_ia_user) = 'E,ONE', pg_temp.eligible_names(v_ia_user));
  perform pg_temp.rec('L2 Instructor B''s list holds exactly BB',
    pg_temp.eligible_names(v_ib_user) = 'BB', pg_temp.eligible_names(v_ib_user));
  perform pg_temp.rec('L3 the Admin''s list is complete (BB, E, NONE, ONE) and still leaves out the ineligible ones',
    pg_temp.eligible_names(v_admin) = 'BB,E,NONE,ONE', pg_temp.eligible_names(v_admin));
  v_phones_a := pg_temp.scalar_as(v_ia_user, $q$select count(*) filter (where e.phone is not null)::text from public.list_class_count_eligible() e$q$);
  v_phones_admin := pg_temp.scalar_as(v_admin, $q$select count(*) filter (where e.phone is not null)::text from public.list_class_count_eligible() e where position('ZZVERIFY 0053 ' in e.full_name) = 1$q$);
  perform pg_temp.rec('L4 an Instructor''s rows carry no phone number; the Admin''s rows do',
    v_phones_a = '0' and pg_temp.to_int(v_phones_admin) >= 4, coalesce(v_phones_a, '') || ' / ' || coalesce(v_phones_admin, ''));

  -- R. Recording by an Instructor ----------------------------------------------------------------------------------------------------
  v_c := pg_temp.record_as(v_ia_user, m_e, v_req, v_today - 1, 'classes_remaining');
  perform pg_temp.rec('R1 Instructor A records a class for their own student; nine of ten remain', v_c = '9', v_c);
  select a.id into v_att from public.class_count_attendance a where a.request_id = v_req;
  perform pg_temp.rec('R2 the audit row names the Instructor''s login as the recorder, with the date and student',
    exists (select 1 from public.class_count_attendance a where a.id = v_att and a.recorded_by = v_ia_user and a.membership_id = m_e
            and a.student_id = s_e and a.attended_on = v_today - 1), coalesce(v_att::text, 'no record'));
  v_c := pg_temp.record_as(v_ia_user, m_e, v_req, v_today - 1, 'replayed');
  perform pg_temp.rec('R3 a repeat of the same request ID is replayed and records nothing again',
    v_c = 'true' and (select count(*) from public.class_count_attendance a where a.membership_id = m_e) = 1, v_c);
  v_c := pg_temp.record_as(v_ia_user, m_e, v_req, v_today - 2, 'replayed');
  perform pg_temp.rec('R4 the same request ID with a different date is refused (23505)', v_c = 'ERR:23505', v_c);

  v_r := pg_temp.record_as(v_ib_user, m_e, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, m_bb, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, m_none, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, gen_random_uuid(), gen_random_uuid(), v_today - 1, 'attendance_id');
  perform pg_temp.rec('R5 another instructor, B''s student, an unrelated student and an unknown membership are all refused the same way (42501) and record nothing',
    v_r = 'ERR:42501 / ERR:42501 / ERR:42501 / ERR:42501'
    and (select count(*) from public.class_count_attendance a where a.membership_id in (m_e, m_bb, m_none)) = 1, v_r);

  v_r := pg_temp.record_as(v_ia_user, m_e, gen_random_uuid(), v_today + 1, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, m_e, gen_random_uuid(), v_today - 31, 'attendance_id');
  perform pg_temp.rec('R6 the date rules hold for an Instructor: not in the future, not before the membership starts (22023)',
    v_r = 'ERR:22023 / ERR:22023', v_r);

  v_r := pg_temp.record_as(v_ia_user, m_exp, gen_random_uuid(), v_today - 2, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, m_fut, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.record_as(v_ia_user, m_inact, gen_random_uuid(), v_today - 1, 'attendance_id');
  perform pg_temp.rec('R7 the eligibility rules hold for an Instructor: an expired membership, one not started, an inactive student (55000)',
    v_r = 'ERR:55000 / ERR:55000 / ERR:55000', v_r);

  v_c := pg_temp.record_as(v_ia_user, m_one, gen_random_uuid(), v_today - 1, 'classes_remaining');
  v_r := pg_temp.record_as(v_ia_user, m_one, gen_random_uuid(), v_today - 1, 'attendance_id');
  perform pg_temp.rec('R8 a membership never goes below zero: the last class is recorded (0 left), the next is refused (55000)',
    v_c = '0' and v_r = 'ERR:55000' and (select count(*) from public.class_count_attendance a where a.membership_id = m_one) = 1, v_c || ' / ' || v_r);

  -- A. Admin unchanged ----------------------------------------------------------------------------------------------------------------
  v_c := pg_temp.record_as(v_admin, m_none, gen_random_uuid(), v_today - 1, 'classes_remaining');
  perform pg_temp.rec('A1 the Admin still records for any student, including one no instructor teaches', v_c = '9', v_c);
  v_c := pg_temp.scalar_as(v_ia_user, format($q$select public.record_class_count_attendance(%L, gen_random_uuid())::text$q$, m_e));
  perform pg_temp.rec('A2 the two-argument recorder is still Admin only (an Instructor is refused, 42501)', v_c = 'ERR:42501', v_c);

  -- V. Reversal stays Admin only ----------------------------------------------------------------------------------------------------------
  v_c := pg_temp.scalar_as(v_ia_user, format($q$select public.reverse_class_count_attendance(%L, 'ZZVERIFY not allowed', gen_random_uuid())::text$q$, v_att));
  perform pg_temp.rec('V1 an Instructor cannot reverse even the class they recorded (42501), and it stays recorded',
    v_c = 'ERR:42501' and not exists (select 1 from public.class_count_attendance_reversals r where r.attendance_id = v_att), v_c);
  v_c := pg_temp.scalar_as(v_admin, format($q$select public.reverse_class_count_attendance(%L, 'ZZVERIFY reversal reason', gen_random_uuid())::text$q$, v_att));
  perform pg_temp.rec('V2 the Admin can reverse it, and the class counts again (ten of ten remain for A''s student)',
    v_c not like 'ERR:%' and pg_temp.scalar_as(v_ia_user, format($q$select e.classes_remaining::text from public.list_class_count_eligible() e where e.membership_id = %L$q$, m_e)) = '10', v_c);

  -- X. Refusals ----------------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.record_as(v_stranger, m_e, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.scalar_as(v_stranger, 'select count(*)::text from public.list_class_count_eligible()');
  perform pg_temp.rec('X1 a signed-in user who is neither an Admin nor a linked instructor is refused for recording and for the list (42501)',
    v_r = 'ERR:42501 / ERR:42501', v_r);
  v_r := pg_temp.scalar_anon(format($q$select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)::text$q$, m_e, v_today - 1)) || ' / '
      || pg_temp.scalar_anon('select count(*)::text from public.list_class_count_eligible()');
  perform pg_temp.rec('X2 anon is refused for recording and for the list (42501)', v_r = 'ERR:42501 / ERR:42501', v_r);

  select status into v_a_status from public.instructors where id = v_ia;
  update public.instructors set status = 'inactive' where id = v_ia;
  v_r := pg_temp.record_as(v_ia_user, m_e, gen_random_uuid(), v_today - 1, 'attendance_id') || ' / '
      || pg_temp.scalar_as(v_ia_user, 'select count(*)::text from public.list_class_count_eligible()');
  update public.instructors set status = v_a_status where id = v_ia;
  perform pg_temp.rec('X3 a DEACTIVATED instructor is refused for recording and for the list (42501), and can record again once reactivated',
    v_r = 'ERR:42501 / ERR:42501'
    and pg_temp.record_as(v_ia_user, m_e, gen_random_uuid(), v_today - 1, 'classes_remaining') = '9', v_r);

  -- S. Session attendance is untouched ------------------------------------------------------------------------------------------------------
  select md5(coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') || '#' ||
             coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''))
    into v_after_rows;
  perform pg_temp.rec('S1 the attendance and class session rows are identical after all the recordings', v_before_rows = v_after_rows, '');

  -- Z. Existing data unchanged ---------------------------------------------------------------------------------------------------------------
  update _hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s where s.id not in (select student from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m where m.id not in (select membership from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a where a.membership_id not in (select membership from _fx)), '') ||
    coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r
              where r.attendance_id in (select a.id from public.class_count_attendance a where a.membership_id not in (select membership from _fx))), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') ||
    coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), '')));
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
            then ' - NOT TESTED is neither a pass nor a failure: a prerequisite could not be created, so this run does NOT verify 0053'
            else '' end
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0053' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0053' in name) = 1) as leftover_batches;
-- Both must be 0. (The one instructor row the script changes is restored inside the transaction and compared by check Z; the
-- rollback restores it as well.)
