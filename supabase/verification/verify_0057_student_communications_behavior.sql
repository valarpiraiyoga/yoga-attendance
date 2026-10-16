-- ===========================================================================
-- Migration 0057 verification (behaviour) - Student communication history with an optional follow-up
-- Exercises supabase/migrations/0057_student_communications.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0057 is applied (the table and the four functions exist). Otherwise every scenario is skipped (NOT TESTED).
--   PF  Preflight: no fixture name exists.
--   C   Recording, as an Admin, through the real function:
--         C1 a communication WITHOUT a follow-up: one row, no follow-up columns set, attributed to the Admin (auth.uid(), role admin).
--         C2 a communication WITH a follow-up: the follow-up is Pending with its date and note, on the same row.
--         C3 a follow-up date before the communication date is refused (22023); the same day is accepted.
--         C4 a future date and time is refused (22023); an earlier one is accepted.
--         C5 required fields: no subject, no notes, an unknown type, a follow-up date without a note are refused (22023).
--         C6 the function takes no staff parameter: attribution can only be auth.uid().
--   F   Follow-up completion:
--         F1 a pending follow-up becomes Completed: its date and note are unchanged, completion time and the Admin are recorded,
--            and no communication is added.
--         F2 completing it again is refused (55000); F3 a communication without a follow-up is refused (22023).
--   L   The history is newest first (by communication time, not by when it was recorded).
--   I   Instructor scope (the 0052 rule):
--         I1 Instructor A records for THEIR student: attributed to A (role instructor).
--         I2 A is refused (42501) for Instructor B's student, for a student nobody teaches and for an UNKNOWN student id - the same
--            error each time.
--         I3 A lists their own student's history; A is refused (42501) for a student nobody teaches.
--         I4 B cannot complete a follow-up of A's student (42501); A can.
--   X   Refusals: anon cannot record, list or complete (42501). No signed-in user can insert, update or delete the table directly
--       (42501). An Instructor's direct SELECT on the table returns nothing (direct reads are Admin only).
--       X4 a signed-in user who is NOT staff (no Admin profile, no linked instructor) cannot record, list or complete (42501);
--       the pending follow-up they tried to complete stays Pending, and nothing is recorded for them.
--   Z   Every student, instructor, membership, attendance row and session that existed before this script is byte-for-byte unchanged.
--
-- RESULTS AND NOT TESTED: PASS and FAIL are verdicts. NOT TESTED means a prerequisite could not be created (no Admin, fewer than two
-- active linked instructors), so nothing depending on it was judged. The SUMMARY row says FAILURES if anything failed, INCOMPLETE if
-- nothing failed but something was NOT TESTED, and ALL PASS only when every scenario ran and passed.
--
-- PREREQUISITES: migrations 0001-0057 applied; an Admin profile; for the I scenarios, TWO active instructors linked to a login.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students and a batch named 'ZZVERIFY 0057 ...'.
--   Never run this in a session with autocommit. Nothing disables a trigger.
--
-- LIMITATIONS
--   * The application's pages and dialogs are not exercised; this script tests the database rules only.
--   * Concurrency (two completions at once) cannot be tested in one transaction; the row lock in complete_student_follow_up
--     serialises it.
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

-- One scalar statement as an authenticated user: its text, or 'ERR:<sqlstate>'.
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

-- One scalar statement as anon: its text, or 'ERR:<sqlstate>'.
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

-- record_student_communication as a user: the new id, or 'ERR:<sqlstate>'.
create function pg_temp.record_as(p_user uuid, p_student uuid, p_at timestamp, p_type text, p_subject text, p_notes text,
                                  p_fu_date date default null, p_fu_note text default null)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select public.record_student_communication(%L::uuid, %L::timestamp, %L, %L, %L, %L::date, %L)::text$q$,
    p_student, p_at, p_type, p_subject, p_notes, p_fu_date, p_fu_note));
end $f$;

create function pg_temp.complete_as(p_user uuid, p_id uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format($q$select (public.complete_student_follow_up(%L::uuid))::text$q$, p_id));
end $f$;

create function pg_temp.to_uuid(p_text text)
returns uuid language sql immutable as $f$
  select case when p_text ~ '^[0-9a-f-]{36}$' then p_text::uuid end
$f$;

create function pg_temp.mk_student(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0057 ' || p_name, '9000000057', '+91', p_today - 100, 'active') returning id into v_id;
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

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s), '') ||
  coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), '') ||
  coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') ||
  coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''));

do $$
declare
  v_applied boolean;
  v_tz      text;
  v_today   date;
  v_now     timestamp;
  v_admin   uuid;
  v_ia      uuid; v_ia_user uuid;
  v_ib      uuid; v_ib_user uuid;
  v_b       uuid;
  v_sa      uuid; v_sb uuid;
  s_main uuid; s_a uuid; s_bb uuid; s_none uuid;
  c_plain uuid; c_fu uuid; c_old uuid; c_new uuid; c_a uuid; c_pend uuid;
  -- A signed-in caller who is not staff: a login with no Admin profile and no linked instructor.
  v_stranger uuid := gen_random_uuid();
  v_r       text;
  v_row     public.student_communications%rowtype;
  v_count   integer;
begin
  -- P0 ----------------------------------------------------------------------------------------------------------------------
  v_applied := to_regclass('public.student_communications') is not null
           and to_regprocedure('public.record_student_communication(uuid, timestamp, text, text, text, date, text)') is not null
           and to_regprocedure('public.complete_student_follow_up(uuid)') is not null
           and to_regprocedure('public.list_student_communications(uuid)') is not null
           and to_regprocedure('public.student_communication_actor()') is not null;
  perform pg_temp.rec('P0 migration 0057 is applied (the table and its four functions exist)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0057 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0057' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0057' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0057 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  v_tz := public.centre_timezone();
  v_today := (now() at time zone v_tz)::date;
  v_now := date_trunc('minute', (now() at time zone v_tz));

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    perform pg_temp.skip('all scenarios', 'Needs an Admin profile.');
    return;
  end if;

  s_main := pg_temp.mk_student('MAIN', v_today);

  -- C1 ----------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '2 hours', 'phone_call', 'Membership renewal', 'Discussed renewal.');
  c_plain := pg_temp.to_uuid(v_r);
  select * into v_row from public.student_communications where id = c_plain;
  perform pg_temp.rec('C1 a communication without a follow-up is recorded, with no follow-up, attributed to the Admin',
    c_plain is not null and v_row.follow_up_status is null and v_row.follow_up_date is null and v_row.follow_up_note is null
      and v_row.recorded_by = v_admin and v_row.recorded_by_role = 'admin' and v_row.subject = 'Membership renewal',
    'result: ' || coalesce(v_r, 'null'));

  -- C2 ----------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '1 hour', 'whatsapp', 'Class timing enquiry', 'Asked about evenings.',
                           v_today + 3, 'Send the evening timetable');
  c_fu := pg_temp.to_uuid(v_r);
  select * into v_row from public.student_communications where id = c_fu;
  perform pg_temp.rec('C2 a communication with a follow-up is recorded with a Pending follow-up (date and note) on the same row',
    c_fu is not null and v_row.follow_up_status = 'pending' and v_row.follow_up_date = v_today + 3
      and v_row.follow_up_note = 'Send the evening timetable' and v_row.follow_up_completed_at is null,
    'result: ' || coalesce(v_r, 'null'));

  -- C3 ----------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '1 day', 'in_person', 'X', 'Y', v_today - 2, 'Too early');
  perform pg_temp.rec('C3a a follow-up date before the communication date is refused (22023)', v_r = 'ERR:22023', 'result: ' || v_r);
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '1 day', 'in_person', 'X', 'Y', (v_now - interval '1 day')::date, 'Same day');
  perform pg_temp.rec('C3b a follow-up on the communication date itself is accepted', pg_temp.to_uuid(v_r) is not null, 'result: ' || v_r);

  -- C4 ----------------------------------------------------------------------------------------------------------------------
  v_r := pg_temp.record_as(v_admin, s_main, v_now + interval '1 day', 'other', 'Future', 'Not yet');
  perform pg_temp.rec('C4a a future date and time is refused (22023)', v_r = 'ERR:22023', 'result: ' || v_r);
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '40 days', 'other', 'Earlier call', 'Recorded later.');
  c_old := pg_temp.to_uuid(v_r);
  perform pg_temp.rec('C4b an earlier date and time is accepted', c_old is not null, 'result: ' || v_r);

  -- C5 ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('C5 required fields: no subject, no notes, an unknown type, a follow-up date without a note are refused (22023)',
    pg_temp.record_as(v_admin, s_main, v_now, 'phone_call', '  ', 'Notes') = 'ERR:22023'
      and pg_temp.record_as(v_admin, s_main, v_now, 'phone_call', 'Subject', '') = 'ERR:22023'
      and pg_temp.record_as(v_admin, s_main, v_now, 'email', 'Subject', 'Notes') = 'ERR:22023'
      and pg_temp.record_as(v_admin, s_main, v_now, 'phone_call', 'Subject', 'Notes', v_today + 1, null) = 'ERR:22023',
    '');

  -- C6 ----------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('C6 the recording function takes no staff parameter (attribution is auth.uid() only)',
    pg_get_function_arguments('public.record_student_communication(uuid, timestamp, text, text, text, date, text)'::regprocedure)
      !~* '(recorded|staff|user)', '');

  -- F -------------------------------------------------------------------------------------------------------------------------
  select count(*) into v_count from public.student_communications where student_id = s_main;
  v_r := pg_temp.complete_as(v_admin, c_fu);
  select * into v_row from public.student_communications where id = c_fu;
  perform pg_temp.rec('F1 completing keeps the follow-up date and note, records when and by whom, and adds no communication',
    left(coalesce(v_r, ''), 4) <> 'ERR:'
      and v_row.follow_up_status = 'completed' and v_row.follow_up_date = v_today + 3
      and v_row.follow_up_note = 'Send the evening timetable' and v_row.follow_up_completed_at is not null
      and v_row.follow_up_completed_by = v_admin and v_row.follow_up_completed_by_name is not null
      and (select count(*) from public.student_communications where student_id = s_main) = v_count,
    'result: ' || coalesce(v_r, 'ok'));
  v_r := pg_temp.complete_as(v_admin, c_fu);
  perform pg_temp.rec('F2 completing an already completed follow-up is refused (55000)', v_r = 'ERR:55000', 'result: ' || coalesce(v_r, 'ok'));
  v_r := pg_temp.complete_as(v_admin, c_plain);
  perform pg_temp.rec('F3 completing a communication without a follow-up is refused (22023)', v_r = 'ERR:22023', 'result: ' || coalesce(v_r, 'ok'));

  -- L -------------------------------------------------------------------------------------------------------------------------
  -- c_old happened 40 days ago but was recorded after c_plain and c_fu: it must come last.
  v_r := pg_temp.scalar_as(v_admin, format(
    $q$select string_agg(c.id::text, ',' order by c.ordinality)
       from public.list_student_communications(%L::uuid) with ordinality c$q$, s_main));
  perform pg_temp.rec('L the history is newest first by communication time (an earlier conversation recorded later comes last)',
    split_part(v_r, ',', 1) = (select id::text from public.student_communications where student_id = s_main order by communicated_at desc, created_at desc, id desc limit 1)
      and split_part(v_r, ',', array_length(string_to_array(v_r, ','), 1)) = c_old::text,
    'order: ' || coalesce(v_r, 'null'));

  -- X (as anon, and direct table writes) --------------------------------------------------------------------------------------------
  perform pg_temp.rec('X1 anon cannot record, list or complete (42501)',
    pg_temp.scalar_anon(format($q$select public.record_student_communication(%L::uuid, %L::timestamp, 'other', 'S', 'N')::text$q$, s_main, v_now)) = 'ERR:42501'
      and pg_temp.scalar_anon(format($q$select count(*)::text from public.list_student_communications(%L::uuid)$q$, s_main)) = 'ERR:42501'
      and pg_temp.scalar_anon(format($q$select (public.complete_student_follow_up(%L::uuid))::text$q$, c_plain)) = 'ERR:42501',
    '');
  perform pg_temp.rec('X2 a signed-in user cannot insert, update or delete the table directly (42501)',
    pg_temp.scalar_as(v_admin, format($q$insert into public.student_communications (student_id, communicated_at, communication_type, subject, notes, recorded_by_name, recorded_by_role)
                                         values (%L, now(), 'other', 'S', 'N', 'X', 'admin') returning id::text$q$, s_main)) = 'ERR:42501'
      and pg_temp.scalar_as(v_admin, format($q$update public.student_communications set subject = 'Changed' where id = %L returning id::text$q$, c_plain)) = 'ERR:42501'
      and pg_temp.scalar_as(v_admin, format($q$delete from public.student_communications where id = %L returning id::text$q$, c_plain)) = 'ERR:42501',
    '');

  -- X4: a signed-in user who is not staff. scalar_as sets the JWT claims and the role for one statement and resets the role
  -- afterwards; the claims are transaction-local, so the next call (or the ROLLBACK) replaces them.
  v_r := pg_temp.record_as(v_admin, s_main, v_now - interval '10 minutes', 'other', 'Pending for X4', 'A follow-up to try to complete.',
                           v_today + 2, 'Try to complete as a non-staff user');
  c_pend := pg_temp.to_uuid(v_r);
  if c_pend is null then
    perform pg_temp.skip('X4 a signed-in non-staff user is refused', 'Could not create its pending follow-up: ' || coalesce(v_r, 'null'));
  else
    v_r := pg_temp.record_as(v_stranger, s_main, v_now - interval '5 minutes', 'other', 'S', 'N');
    perform pg_temp.rec('X4a a signed-in user who is not staff cannot record a communication (42501)', v_r = 'ERR:42501', 'result: ' || coalesce(v_r, 'null'));
    v_r := pg_temp.scalar_as(v_stranger, format($q$select count(*)::text from public.list_student_communications(%L::uuid)$q$, s_main));
    perform pg_temp.rec('X4b a signed-in user who is not staff cannot list communications (42501)', v_r = 'ERR:42501', 'result: ' || coalesce(v_r, 'null'));
    v_r := pg_temp.complete_as(v_stranger, c_pend);
    perform pg_temp.rec('X4c a signed-in user who is not staff cannot complete a pending follow-up (42501), and it stays Pending',
      v_r = 'ERR:42501'
        and (select follow_up_status from public.student_communications where id = c_pend) = 'pending'
        and (select follow_up_completed_by from public.student_communications where id = c_pend) is null,
      'result: ' || coalesce(v_r, 'null'));
    perform pg_temp.rec('X4d nothing was recorded for the non-staff user',
      not exists (select 1 from public.student_communications where recorded_by = v_stranger), '');
  end if;

  -- I (Instructor scope) ------------------------------------------------------------------------------------------------------------
  select id, user_id into v_ia, v_ia_user from public.instructors where user_id is not null and status = 'active' order by created_at limit 1;
  select id, user_id into v_ib, v_ib_user from public.instructors where user_id is not null and status = 'active' and id <> v_ia order by created_at limit 1;
  if v_ia is null or v_ib is null then
    perform pg_temp.skip('I1-I4 and X3 (instructor scenarios)', 'Needs two ACTIVE instructors linked to a login (instructors.user_id).');
  else
    insert into public.batches (name, code) values ('ZZVERIFY 0057 Batch', 'ZZV57') returning id into v_b;
    v_sa := pg_temp.mk_series(v_b, v_ia, 'monday', v_today);
    v_sb := pg_temp.mk_series(v_b, v_ib, 'wednesday', v_today);
    s_a := pg_temp.mk_student('A', v_today);       perform pg_temp.enrol(s_a, v_b, v_sa, v_today);   -- A's student
    s_bb := pg_temp.mk_student('BB', v_today);     perform pg_temp.enrol(s_bb, v_b, v_sb, v_today);  -- B's student
    s_none := pg_temp.mk_student('NONE', v_today);                                                   -- nobody's student

    v_r := pg_temp.record_as(v_ia_user, s_a, v_now - interval '30 minutes', 'in_person', 'Posture question', 'Explained the alignment.',
                             v_today + 1, 'Check progress');
    c_a := pg_temp.to_uuid(v_r);
    select * into v_row from public.student_communications where id = c_a;
    perform pg_temp.rec('I1 an Instructor records for their own student, attributed to them (role instructor)',
      c_a is not null and v_row.recorded_by = v_ia_user and v_row.recorded_by_role = 'instructor', 'result: ' || coalesce(v_r, 'null'));

    perform pg_temp.rec('I2 an Instructor is refused the same way (42501) for another instructor''s student, nobody''s student and an unknown id',
      pg_temp.record_as(v_ia_user, s_bb, v_now, 'other', 'S', 'N') = 'ERR:42501'
        and pg_temp.record_as(v_ia_user, s_none, v_now, 'other', 'S', 'N') = 'ERR:42501'
        and pg_temp.record_as(v_ia_user, gen_random_uuid(), v_now, 'other', 'S', 'N') = 'ERR:42501',
      '');

    perform pg_temp.rec('I3 an Instructor lists their own student''s history and is refused (42501) for a student they do not teach',
      pg_temp.scalar_as(v_ia_user, format($q$select count(*)::text from public.list_student_communications(%L::uuid)$q$, s_a)) = '1'
        and pg_temp.scalar_as(v_ia_user, format($q$select count(*)::text from public.list_student_communications(%L::uuid)$q$, s_none)) = 'ERR:42501',
      '');

    v_r := pg_temp.complete_as(v_ib_user, c_a);
    perform pg_temp.rec('I4a another instructor cannot complete the follow-up (42501)', v_r = 'ERR:42501', 'result: ' || coalesce(v_r, 'ok'));
    v_r := pg_temp.complete_as(v_ia_user, c_a);
    perform pg_temp.rec('I4b the student''s own instructor can complete it',
      left(coalesce(v_r, ''), 4) <> 'ERR:' and (select follow_up_status from public.student_communications where id = c_a) = 'completed'
        and (select follow_up_completed_by from public.student_communications where id = c_a) = v_ia_user,
      'result: ' || coalesce(v_r, 'ok'));

    perform pg_temp.rec('X3 an Instructor''s direct SELECT on the table returns nothing (direct reads are Admin only)',
      pg_temp.scalar_as(v_ia_user, $q$select count(*)::text from public.student_communications$q$) = '0', '');
  end if;

  -- Z -------------------------------------------------------------------------------------------------------------------------
  update _hash set after_hash = md5(
    coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s where position('ZZVERIFY 0057' in s.full_name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.attendance x), '') ||
    coalesce((select string_agg(to_jsonb(cs)::text, '|' order by cs.id) from public.class_sessions cs), ''));
  perform pg_temp.rec('Z every instructor, student, membership, attendance row and session that existed before this script is unchanged',
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
            then ' - NOT TESTED is neither a pass nor a failure: a prerequisite could not be created, so this run does NOT fully verify 0057'
            else '' end
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;
