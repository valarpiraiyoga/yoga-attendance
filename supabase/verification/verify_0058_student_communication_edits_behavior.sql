-- ===========================================================================
-- Migration 0058 verification (behaviour) - Edit Communication
-- Exercises supabase/migrations/0058_student_communication_edits.sql (and that 0057 still works)
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0058 is applied (update_student_communication and the edited_* columns exist). Otherwise skipped (NOT TESTED).
--   PF  Preflight: no fixture name exists.
--   E   Editing, as an Admin, through the real function:
--         E1 the time, type, subject and notes change; the id, student, recorder (id, name, role) and created_at do not; the edit is
--            stamped with the Admin (edited_by = auth.uid(), edited_at, edited_by_name).
--         E2 an edit that changes nothing writes nothing (no edit stamp).
--         E3 invalid input is refused (22023) and the row is unchanged: blank subject, blank notes, unknown type, future time, a
--            follow-up date before the communication date, a follow-up without a note.
--         E4 a PENDING follow-up's date and note can be changed: it stays Pending, with no completion details.
--         E5 a PENDING follow-up can be removed; E6 a follow-up can be added to a communication without one (Pending).
--         E7 a COMPLETED follow-up: the communication can still be edited and the follow-up keeps its status, completion time and
--            completion staff; changing its note (55000), its date (55000) or removing it (55000) is refused and the row is unchanged.
--   A   Authorization:
--         A1 a signed-in user who is not staff, anon and an unknown communication id are refused (42501); nothing changes.
--         A2 an Instructor edits a communication of THEIR student (stamped with them; the Admin stays the recorder); they are
--            refused (42501) for a student they do not teach. Needs two active linked instructors (NOT TESTED otherwise).
--   R   0057 still works: record, list (newest first, with the edited_* columns) and complete.
--   Z   Every student, instructor, membership, attendance row and session that existed before this script is unchanged.
--
-- RESULTS: PASS / FAIL / NOT TESTED, plus a SUMMARY row (FAILURES, INCOMPLETE or ALL PASS).
--
-- PREREQUISITES: migrations 0001-0058 applied; an Admin profile; for A2, TWO active instructors linked to a login.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ), ending in ROLLBACK. Disposable fixtures only: students and a batch named 'ZZVERIFY 0058 ...'.
--   Never run this in a session with autocommit. Nothing disables a trigger.
--
-- LIMITATIONS
--   * The application's pages and dialogs are not exercised; this script tests the database rules only.
--   * Concurrency (an edit racing a completion) cannot be tested in one transaction; the row lock in both functions serialises it.
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

-- One scalar statement as an authenticated user: its text, or 'ERR:<sqlstate>'. The role is reset afterwards.
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

create function pg_temp.record_as(p_user uuid, p_student uuid, p_at timestamp, p_type text, p_subject text, p_notes text,
                                  p_fu_date date default null, p_fu_note text default null)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select public.record_student_communication(%L::uuid, %L::timestamp, %L, %L, %L, %L::date, %L)::text$q$,
    p_student, p_at, p_type, p_subject, p_notes, p_fu_date, p_fu_note));
end $f$;

-- update_student_communication as a user: '' on success, or 'ERR:<sqlstate>'.
create function pg_temp.edit_as(p_user uuid, p_id uuid, p_at timestamp, p_type text, p_subject text, p_notes text,
                                p_fu boolean, p_fu_date date default null, p_fu_note text default null)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    $q$select (public.update_student_communication(%L::uuid, %L::timestamp, %L, %L, %L, %L::boolean, %L::date, %L))::text$q$,
    p_id, p_at, p_type, p_subject, p_notes, p_fu, p_fu_date, p_fu_note));
end $f$;

create function pg_temp.complete_as(p_user uuid, p_id uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format($q$select (public.complete_student_follow_up(%L::uuid))::text$q$, p_id));
end $f$;

create function pg_temp.ok(p_text text)
returns boolean language sql immutable as $f$
  select left(coalesce(p_text, ''), 4) <> 'ERR:'
$f$;

create function pg_temp.to_uuid(p_text text)
returns uuid language sql immutable as $f$
  select case when p_text ~ '^[0-9a-f-]{36}$' then p_text::uuid end
$f$;

-- A row as text, to prove "unchanged".
create function pg_temp.row_of(p_id uuid)
returns text language sql stable as $f$
  select to_jsonb(c)::text from public.student_communications c where c.id = p_id
$f$;

create function pg_temp.mk_student(p_name text, p_today date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0058 ' || p_name, '9000000058', '+91', p_today - 100, 'active') returning id into v_id;
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
  v_b       uuid; v_sa uuid; v_sb uuid;
  s_main uuid; s_a uuid; s_bb uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c_a uuid; c_b uuid; c_r uuid;
  v_stranger uuid := gen_random_uuid();
  v_r      text;
  v_before text;
  v_row    public.student_communications%rowtype;
  v_orig   public.student_communications%rowtype;
begin
  -- P0 ----------------------------------------------------------------------------------------------------------------------
  v_applied := to_regprocedure('public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text)') is not null
           and exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'student_communications' and column_name = 'edited_by');
  perform pg_temp.rec('P0 migration 0058 is applied (update_student_communication and the edited_* columns exist)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0058 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0058' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0058' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0058 row already exists - clean up first.');
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

  -- E1 ----------------------------------------------------------------------------------------------------------------------
  c1 := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_main, v_now - interval '3 hours', 'phone_call', 'Original subject', 'Original notes.'));
  select * into v_orig from public.student_communications where id = c1;
  v_r := pg_temp.edit_as(v_admin, c1, v_now - interval '4 hours', 'in_person', 'Corrected subject', 'Corrected notes.', false);
  select * into v_row from public.student_communications where id = c1;
  perform pg_temp.rec('E1 an edit changes the time, type, subject and notes, keeps the id, student, recorder and created_at, and is stamped with the Admin',
    pg_temp.ok(v_r)
      and v_row.communication_type = 'in_person' and v_row.subject = 'Corrected subject' and v_row.notes = 'Corrected notes.'
      and v_row.communicated_at = ((v_now - interval '4 hours') at time zone v_tz)
      and v_row.student_id = v_orig.student_id and v_row.recorded_by = v_orig.recorded_by
      and v_row.recorded_by_name = v_orig.recorded_by_name and v_row.recorded_by_role = v_orig.recorded_by_role
      and v_row.created_at = v_orig.created_at
      and v_row.edited_by = v_admin and v_row.edited_at is not null and v_row.edited_by_name is not null,
    'result: ' || coalesce(v_r, 'null'));

  -- E2 ----------------------------------------------------------------------------------------------------------------------
  c2 := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_main, v_now - interval '2 hours', 'whatsapp', 'Same', 'Same notes.'));
  v_r := pg_temp.edit_as(v_admin, c2, v_now - interval '2 hours', 'whatsapp', ' Same ', 'Same notes.', false);
  perform pg_temp.rec('E2 an edit that changes nothing writes nothing (no edit stamp)',
    pg_temp.ok(v_r) and (select edited_at from public.student_communications where id = c2) is null, 'result: ' || coalesce(v_r, 'null'));

  -- E3 ----------------------------------------------------------------------------------------------------------------------
  v_before := pg_temp.row_of(c2);
  perform pg_temp.rec('E3 invalid input is refused (22023) and the row is unchanged',
    pg_temp.edit_as(v_admin, c2, v_now, 'whatsapp', ' ', 'N', false) = 'ERR:22023'
      and pg_temp.edit_as(v_admin, c2, v_now, 'whatsapp', 'S', '', false) = 'ERR:22023'
      and pg_temp.edit_as(v_admin, c2, v_now, 'email', 'S', 'N', false) = 'ERR:22023'
      and pg_temp.edit_as(v_admin, c2, v_now + interval '1 day', 'whatsapp', 'S', 'N', false) = 'ERR:22023'
      and pg_temp.edit_as(v_admin, c2, v_now, 'whatsapp', 'S', 'N', true, v_today - 1, 'Too early') = 'ERR:22023'
      and pg_temp.edit_as(v_admin, c2, v_now, 'whatsapp', 'S', 'N', true, v_today + 1, '  ') = 'ERR:22023'
      and pg_temp.row_of(c2) = v_before,
    '');

  -- E4 / E5 / E6 --------------------------------------------------------------------------------------------------------------
  c3 := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_main, v_now - interval '1 hour', 'other', 'Pending one', 'Notes.', v_today + 2, 'First plan'));
  v_r := pg_temp.edit_as(v_admin, c3, v_now - interval '1 hour', 'other', 'Pending one', 'Notes.', true, v_today + 5, 'Revised plan');
  select * into v_row from public.student_communications where id = c3;
  perform pg_temp.rec('E4 a pending follow-up''s date and note change; it stays Pending with no completion details',
    pg_temp.ok(v_r) and v_row.follow_up_status = 'pending' and v_row.follow_up_date = v_today + 5 and v_row.follow_up_note = 'Revised plan'
      and v_row.follow_up_completed_at is null and v_row.follow_up_completed_by is null and v_row.follow_up_completed_by_name is null,
    'result: ' || coalesce(v_r, 'null'));

  v_r := pg_temp.edit_as(v_admin, c3, v_now - interval '1 hour', 'other', 'Pending one', 'Notes.', false);
  select * into v_row from public.student_communications where id = c3;
  perform pg_temp.rec('E5 a pending follow-up can be removed',
    pg_temp.ok(v_r) and v_row.follow_up_status is null and v_row.follow_up_date is null and v_row.follow_up_note is null,
    'result: ' || coalesce(v_r, 'null'));

  v_r := pg_temp.edit_as(v_admin, c3, v_now - interval '1 hour', 'other', 'Pending one', 'Notes.', true, v_today + 1, 'Added later');
  select * into v_row from public.student_communications where id = c3;
  perform pg_temp.rec('E6 a follow-up can be added by an edit (Pending)',
    pg_temp.ok(v_r) and v_row.follow_up_status = 'pending' and v_row.follow_up_date = v_today + 1 and v_row.follow_up_note = 'Added later',
    'result: ' || coalesce(v_r, 'null'));

  -- E7 ----------------------------------------------------------------------------------------------------------------------
  c4 := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_main, v_now - interval '5 hours', 'phone_call', 'Done one', 'Notes.', v_today + 1, 'Call back'));
  perform pg_temp.complete_as(v_admin, c4);
  select * into v_orig from public.student_communications where id = c4;
  v_r := pg_temp.edit_as(v_admin, c4, v_now - interval '5 hours', 'phone_call', 'Done one (corrected)', 'Notes, corrected.', true, v_today + 1, 'Call back');
  select * into v_row from public.student_communications where id = c4;
  perform pg_temp.rec('E7a a communication with a completed follow-up can be edited; the follow-up keeps its status, completion time and staff',
    pg_temp.ok(v_r) and v_orig.follow_up_status = 'completed'
      and v_row.subject = 'Done one (corrected)' and v_row.follow_up_status = 'completed'
      and v_row.follow_up_date = v_orig.follow_up_date and v_row.follow_up_note = v_orig.follow_up_note
      and v_row.follow_up_completed_at = v_orig.follow_up_completed_at and v_row.follow_up_completed_by = v_orig.follow_up_completed_by
      and v_row.follow_up_completed_by_name = v_orig.follow_up_completed_by_name,
    'result: ' || coalesce(v_r, 'null'));

  v_before := pg_temp.row_of(c4);
  perform pg_temp.rec('E7b a completed follow-up cannot have its note or date changed, or be removed (55000); the row is unchanged',
    pg_temp.edit_as(v_admin, c4, v_now - interval '5 hours', 'phone_call', 'Done one (corrected)', 'Notes, corrected.', true, v_today + 1, 'Rewritten') = 'ERR:55000'
      and pg_temp.edit_as(v_admin, c4, v_now - interval '5 hours', 'phone_call', 'Done one (corrected)', 'Notes, corrected.', true, v_today + 9, 'Call back') = 'ERR:55000'
      and pg_temp.edit_as(v_admin, c4, v_now - interval '5 hours', 'phone_call', 'Done one (corrected)', 'Notes, corrected.', false) = 'ERR:55000'
      and pg_temp.row_of(c4) = v_before,
    '');

  -- A1 ----------------------------------------------------------------------------------------------------------------------
  v_before := pg_temp.row_of(c2);
  perform pg_temp.rec('A1 a signed-in non-staff user, anon and an unknown id are refused (42501); nothing changes',
    pg_temp.edit_as(v_stranger, c2, v_now, 'other', 'Hijack', 'N', false) = 'ERR:42501'
      and pg_temp.scalar_anon(format($q$select (public.update_student_communication(%L::uuid, %L::timestamp, 'other', 'S', 'N', false))::text$q$, c2, v_now)) = 'ERR:42501'
      and pg_temp.edit_as(v_admin, gen_random_uuid(), v_now, 'other', 'S', 'N', false) = 'ERR:42501'
      and pg_temp.row_of(c2) = v_before,
    '');

  -- R (0057 still works) ------------------------------------------------------------------------------------------------------
  c_r := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_main, v_now - interval '1 minute', 'whatsapp', 'Newest', 'Newest notes.', v_today, 'Today'));
  v_r := pg_temp.scalar_as(v_admin, format(
    $q$select string_agg(c.id::text, ',' order by c.ordinality) from public.list_student_communications(%L::uuid) with ordinality c$q$, s_main));
  perform pg_temp.rec('R1 recording and listing still work; the newest is first',
    c_r is not null and split_part(v_r, ',', 1) = c_r::text, 'order: ' || coalesce(v_r, 'null'));
  perform pg_temp.rec('R2 the list returns the edited_* columns (the edited communication carries its stamp)',
    pg_temp.scalar_as(v_admin, format($q$select (c.edited_by is not null)::text from public.list_student_communications(%L::uuid) c where c.id = %L$q$, s_main, c1)) = 'true',
    '');
  v_r := pg_temp.complete_as(v_admin, c_r);
  perform pg_temp.rec('R3 completing a follow-up still works',
    pg_temp.ok(v_r) and (select follow_up_status from public.student_communications where id = c_r) = 'completed', 'result: ' || coalesce(v_r, 'ok'));

  -- A2 (Instructor scope) -----------------------------------------------------------------------------------------------------
  select id, user_id into v_ia, v_ia_user from public.instructors where user_id is not null and status = 'active' order by created_at limit 1;
  select id, user_id into v_ib, v_ib_user from public.instructors where user_id is not null and status = 'active' and id <> v_ia order by created_at limit 1;
  if v_ia is null or v_ib is null then
    perform pg_temp.skip('A2 Instructor scope', 'Needs two ACTIVE instructors linked to a login (instructors.user_id).');
  else
    insert into public.batches (name, code) values ('ZZVERIFY 0058 Batch', 'ZZV58') returning id into v_b;
    v_sa := pg_temp.mk_series(v_b, v_ia, 'monday', v_today);
    v_sb := pg_temp.mk_series(v_b, v_ib, 'wednesday', v_today);
    s_a := pg_temp.mk_student('A', v_today);   perform pg_temp.enrol(s_a, v_b, v_sa, v_today);
    s_bb := pg_temp.mk_student('BB', v_today); perform pg_temp.enrol(s_bb, v_b, v_sb, v_today);

    c_a := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_a, v_now - interval '1 hour', 'other', 'For A', 'Notes.'));
    c_b := pg_temp.to_uuid(pg_temp.record_as(v_admin, s_bb, v_now - interval '1 hour', 'other', 'For B', 'Notes.'));
    v_r := pg_temp.edit_as(v_ia_user, c_a, v_now - interval '1 hour', 'other', 'For A (edited)', 'Notes.', false);
    select * into v_row from public.student_communications where id = c_a;
    v_before := pg_temp.row_of(c_b);
    perform pg_temp.rec('A2 an Instructor edits their own student''s communication (stamped with them; the Admin stays the recorder) and is refused (42501) for another instructor''s student',
      pg_temp.ok(v_r) and v_row.subject = 'For A (edited)' and v_row.edited_by = v_ia_user and v_row.recorded_by = v_admin
        and pg_temp.edit_as(v_ia_user, c_b, v_now - interval '1 hour', 'other', 'Hijack', 'Notes.', false) = 'ERR:42501'
        and pg_temp.row_of(c_b) = v_before,
      'result: ' || coalesce(v_r, 'null'));
  end if;

  -- Z -------------------------------------------------------------------------------------------------------------------------
  update _hash set after_hash = md5(
    coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.id) from public.instructors i), '') ||
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s where position('ZZVERIFY 0058' in s.full_name) <> 1), '') ||
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
            then ' - NOT TESTED is neither a pass nor a failure: a prerequisite could not be created, so this run does NOT fully verify 0058'
            else '' end
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;
