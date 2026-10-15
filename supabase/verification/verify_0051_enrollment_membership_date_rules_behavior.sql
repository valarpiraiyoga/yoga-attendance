-- ===========================================================================
-- Migration 0051 verification (behaviour) - join-date rules and the enrollment start-date cascade
-- Exercises supabase/migrations/0051_enrollment_membership_date_rules.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0051 is applied (the four functions and four triggers). Otherwise every scenario is skipped (NOT TESTED).
--   PF  Preflight: no fixture name exists.
--   E   Enrollment start vs join date: before the join date is refused (23514); on it and after it pass.
--   M   Membership start vs join date: the same; every other edit of a membership that already starts early (notes) still works.
--   U   Existing out-of-range records: an unrelated edit (status, end date) still works; a CHANGED start that is still before the
--       join date is refused; a changed start on or after it passes - for an enrollment (U4) and for a membership (M5).
--   C   The cascade: only the assignments whose start equals the OLD enrollment start move (the count is reported); an assignment
--       added later, an assignment's end date and every other row are untouched; moving the start later works as well. Isolation
--       (C5, C6): assignments of ANOTHER enrollment - of another student, and of the same student's enrollment in another batch -
--       that start on the very same old date do not move.
--   O   Refusals roll the whole update back: an overlap (23P01) or an assignment that would end before the new start (23514)
--       leaves the enrollment start AND every assignment exactly as they were.
--   B   A batch change is not a start-date move: the assignments are not moved.
--   J   Join date moved later: refused while an ACTIVE enrollment or a NON-CANCELLED membership starts earlier (23514) - together
--       (J1) and, separately, an active enrollment alone (J6) and a membership alone (J7); allowed when only an inactive
--       enrollment (J8) or only a cancelled membership (J9) does, and when both do (J5); moving it earlier, or any other edit, is
--       never refused.
--   K   A package-linked membership made through create_membership_from_package, as the Admin: a start before the join date is
--       refused (23514, with the join-date message) and leaves no membership; a start ON the join date passes (the control that the
--       refusal is the join date and not the fixture).
--   Z   Every student, enrollment, assignment and membership that existed before this script is byte-for-byte unchanged by it.
--
-- PREREQUISITES: migration 0051 applied (it refuses to run without 0013's no-overlap constraint). Scenarios A-J, M, U, C, O, B use no
-- Admin or Instructor profile: the rules are enforced by triggers whoever writes. Scenario K needs an Admin profile, migrations
-- 0046-0048 (create_package, schedule_fee_entry, create_membership_from_package) and the centre profile; without them it is
-- reported NOT TESTED.
--
-- WARNING - RUN THIS WHEN THE APPLICATION IS IDLE
--   To build records that are ALREADY out of range (as real data has), the script temporarily DISABLES the join-date triggers on
--   public.batch_enrollments and public.memberships (ALTER TABLE ... DISABLE TRIGGER) and enables them again within the same helper
--   call. ALTER TABLE takes a SHARE ROW EXCLUSIVE lock held until the final ROLLBACK, so writes to those two tables from any other
--   session wait for the whole run, and the trigger is off for this transaction only (a disabled trigger is transactional: it is
--   restored by the rollback even if a helper fails). Do not run it while the app is in use, and never in a session with autocommit.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ, so the digests of existing rows come from one snapshot), ending in ROLLBACK. Disposable
--   fixtures only: students 'ZZVERIFY 0051 ...', batches 'ZZVERIFY 0051 ...' and what hangs off them. The guards are switched off
--   (ALTER TABLE ... DISABLE TRIGGER, which is transactional) ONLY to build the "already out of range" records that exist in real
--   data, and switched on again before anything is judged.
--
-- LIMITATIONS
--   * Concurrency (a join-date change against an enrollment or membership write) cannot be tested in one transaction; it rests on
--     the row locks described in the migration.
--   * KNOWN, ACCEPTED, UNTESTED RACE - reactivation. Setting an out-of-range enrollment from inactive to active is an unrelated edit
--     and takes no student-row lock (by design: it is never refused). If it commits while a join-date move for the same student is
--     running, that move's guard may not see the not-yet-committed activation, and the student ends with an ACTIVE enrollment that
--     starts before the join date - the same state as the records that already exist, with no data lost; correcting the join date
--     fixes it. The probability is low (two Admin actions on one student in the same moment) and no scenario here can reproduce it.
--   * The application's own check for a moved join date and for a start date runs before the database's; this script tests the
--     database rules only.
--   * Class sessions, attendance records and frozen rosters are not created here: no trigger of 0051 reads or writes them, and the
--     migration test pins that. The cascade writes enrollment_schedules only.
--   * Every row created here consumes sequence numbers: the rollback leaves gaps.
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

-- One statement as the owner: 'OK' or the SQLSTATE. A failed statement is rolled back to its own savepoint only.
create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- One statement as an authenticated user: 'OK', or '<sqlstate>:<message>' (to tell WHICH rule refused it).
create function pg_temp.msg_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    v_out := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
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

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

create function pg_temp.mk_student(p_name text, p_join date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0051 ' || p_name, '9000000051', '+91', p_join, 'active') returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_series(p_batch uuid, p_instr uuid, p_day text)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instr, p_day, '09:00', '10:00', current_date - 400, null, 'active', v_series);
  return v_series;
end $f$;

-- An enrollment, bypassing the join-date guard when p_force (to build a record that is already out of range, as real data has).
create function pg_temp.mk_enrollment(p_student uuid, p_batch uuid, p_start date, p_force boolean default false)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  if p_force then alter table public.batch_enrollments disable trigger batch_enrollments_join_date_guard_trigger; end if;
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date)
  values (p_student, p_batch, p_start) returning id into v_id;
  if p_force then alter table public.batch_enrollments enable trigger batch_enrollments_join_date_guard_trigger; end if;
  return v_id;
end $f$;

create function pg_temp.assign(p_enrollment uuid, p_series uuid, p_from date, p_until date default null)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
  values (p_enrollment, p_series, p_from, p_until) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_membership(p_student uuid, p_start date, p_end date, p_force boolean default false)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  if p_force then alter table public.memberships disable trigger memberships_join_date_guard_trigger; end if;
  insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency)
  values (p_student, 'monthly', 'duration', p_start, p_end, 700, (select cp.currency from public.center_profile cp where cp.singleton))
  returning id into v_id;
  if p_force then alter table public.memberships enable trigger memberships_join_date_guard_trigger; end if;
  return v_id;
end $f$;

-- A digest of the assignments of one enrollment: id, start, end - in a stable order.
create function pg_temp.assignments_of(p_enrollment uuid)
returns text language sql as $f$
  select coalesce(string_agg(es.id::text || ':' || es.effective_start_date::text || ':' || coalesce(es.effective_end_date::text, 'open'),
                             '|' order by es.id), '')
  from public.enrollment_schedules es where es.batch_enrollment_id = p_enrollment
$f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _legacy_hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s), '') ||
  coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be), '') ||
  coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es), '') ||
  coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.memberships m), ''));

do $$
declare
  v_applied  boolean;
  v_today    date := current_date;
  v_instr    uuid;
  v_b1       uuid;
  v_b2       uuid;
  v_s1       uuid;
  v_s2       uuid;
  v_s3       uuid;
  v_s4       uuid;
  v_admin    uuid;
  p_pkg      uuid;
  en2        uuid;
  en3        uuid;
  v_b2a      text;
  v_b2b      text;
  st         uuid;
  en         uuid;
  m          uuid;
  a1         uuid;
  a2         uuid;
  a3         uuid;
  a4         uuid;
  v_before   text;
  v_c        text;
  v_moved    integer;
begin
  -- P0. The migration is applied -------------------------------------------------------------------------------------------
  select (select count(*) from pg_trigger where not tgisinternal and tgname in (
            'batch_enrollments_join_date_guard_trigger', 'memberships_join_date_guard_trigger',
            'batch_enrollments_start_cascade_trigger', 'students_join_date_guard_trigger')) = 4
     and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'batch_enrollments_join_date_guard', 'memberships_join_date_guard',
            'batch_enrollments_start_cascade', 'students_join_date_guard')) = 4
  into v_applied;
  perform pg_temp.rec('P0 migration 0051 is applied (four functions, four triggers)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0051 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0051' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0051' in name) = 1)
     or exists (select 1 from public.packages where position('ZZVERIFY 0051' in name) = 1) then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0051 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  insert into public.instructors (full_name) values ('ZZVERIFY 0051 Instructor') returning id into v_instr;
  insert into public.batches (name, code) values ('ZZVERIFY 0051 One', 'ZZV51A') returning id into v_b1;
  insert into public.batches (name, code) values ('ZZVERIFY 0051 Two', 'ZZV51B') returning id into v_b2;
  v_s1 := pg_temp.mk_series(v_b1, v_instr, 'monday');
  v_s2 := pg_temp.mk_series(v_b1, v_instr, 'wednesday');
  v_s3 := pg_temp.mk_series(v_b1, v_instr, 'friday');
  v_s4 := pg_temp.mk_series(v_b2, v_instr, 'saturday');
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  -- E. An enrollment cannot start before the student joined ---------------------------------------------------------------------
  st := pg_temp.mk_student('E', v_today - 50);
  v_c := pg_temp.code(format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (%L, %L, %L)', st, v_b1, v_today - 51));
  perform pg_temp.rec('E1 an enrollment starting the day before the join date is refused (23514)', v_c = '23514'
    and not exists (select 1 from public.batch_enrollments where student_id = st), v_c);
  v_c := pg_temp.code(format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (%L, %L, %L)', st, v_b1, v_today - 50));
  perform pg_temp.rec('E2 an enrollment starting ON the join date passes', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (%L, %L, %L)', st, v_b2, v_today - 10));
  perform pg_temp.rec('E3 an enrollment starting after the join date passes', v_c = 'OK', v_c);

  -- M. A membership cannot start before the student joined ----------------------------------------------------------------------
  st := pg_temp.mk_student('M', v_today - 50);
  v_c := pg_temp.code(format('insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency) values (%L, ''monthly'', ''duration'', %L, %L, 700, (select cp.currency from public.center_profile cp where cp.singleton))',
                             st, v_today - 51, v_today - 21));
  perform pg_temp.rec('M1 a membership starting the day before the join date is refused (23514)', v_c = '23514'
    and not exists (select 1 from public.memberships where student_id = st), v_c);
  v_c := pg_temp.code(format('insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency) values (%L, ''monthly'', ''duration'', %L, %L, 700, (select cp.currency from public.center_profile cp where cp.singleton))',
                             st, v_today - 50, v_today - 20));
  perform pg_temp.rec('M2 a membership starting ON the join date passes', v_c = 'OK', v_c);

  -- U. Existing out-of-range records -----------------------------------------------------------------------------------------------
  st := pg_temp.mk_student('U', v_today - 50);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 60, true);
  m := pg_temp.mk_membership(st, v_today - 60, v_today - 30, true);
  v_c := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'' where id = %L', en));
  perform pg_temp.rec('U1 a status change of an enrollment that already starts before the join date still works', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.batch_enrollments set status = ''active'', effective_end_date = %L where id = %L', v_today + 30, en));
  perform pg_temp.rec('U2 an end-date change of such an enrollment still works', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.memberships set notes = ''edited'' where id = %L', m));
  perform pg_temp.rec('M3 the notes of a membership that already starts before the join date still change', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 55, en));
  perform pg_temp.rec('U3 a CHANGED start that is still before the join date is refused (23514) and nothing changes', v_c = '23514'
    and (select effective_start_date from public.batch_enrollments where id = en) = v_today - 60, v_c);
  v_c := pg_temp.code(format('update public.memberships set start_date = %L where id = %L', v_today - 55, m));
  perform pg_temp.rec('M4 a CHANGED membership start still before the join date is refused (23514)', v_c = '23514'
    and (select start_date from public.memberships where id = m) = v_today - 60, v_c);
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 50, en));
  perform pg_temp.rec('U4 a changed start ON the join date passes', v_c = 'OK'
    and (select effective_start_date from public.batch_enrollments where id = en) = v_today - 50, v_c);
  v_c := pg_temp.code(format('update public.memberships set start_date = %L where id = %L', v_today - 50, m));
  perform pg_temp.rec('M5 a changed membership start ON the join date passes (the end date and the notes are kept)', v_c = 'OK'
    and (select start_date from public.memberships where id = m) = v_today - 50
    and (select end_date from public.memberships where id = m) = v_today - 30
    and (select notes from public.memberships where id = m) = 'edited', v_c);
  v_c := pg_temp.code(format('update public.memberships set start_date = %L where id = %L', v_today - 45, m));
  perform pg_temp.rec('M6 a changed membership start AFTER the join date passes', v_c = 'OK'
    and (select start_date from public.memberships where id = m) = v_today - 45, v_c);

  -- C. The cascade ---------------------------------------------------------------------------------------------------------------
  st := pg_temp.mk_student('C', v_today - 100);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 40);
  a1 := pg_temp.assign(en, v_s1, v_today - 40);                  -- initial: starts on the enrollment start
  a2 := pg_temp.assign(en, v_s2, v_today - 40, v_today - 5);     -- initial, with an end date
  a3 := pg_temp.assign(en, v_s3, v_today - 15);                  -- added later by a schedule change
  -- Another enrollment of ANOTHER student, and the same student's enrollment in ANOTHER batch, each with an assignment that starts on
  -- the very date this enrollment's start is about to leave (today - 40).
  en2 := pg_temp.mk_enrollment(pg_temp.mk_student('C other student', v_today - 100), v_b1, v_today - 40);
  a4 := pg_temp.assign(en2, v_s1, v_today - 40);
  en3 := pg_temp.mk_enrollment(st, v_b2, v_today - 40);
  v_b2b := pg_temp.assign(en3, v_s4, v_today - 40)::text;
  v_b2a := pg_temp.assignments_of(en2) || '#' || pg_temp.assignments_of(en3);
  v_before := pg_temp.assignments_of(en);
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 70, en));
  perform pg_temp.rec('C0 the start-date move itself succeeds', v_c = 'OK', v_c);
  select count(*) into v_moved from public.enrollment_schedules where batch_enrollment_id = en and effective_start_date = v_today - 70;
  perform pg_temp.rec('C1 moving the start earlier moves exactly the two initial assignments (count 2)', v_moved = 2, 'moved ' || v_moved);
  perform pg_temp.rec('C5 the assignments of another student''s enrollment, which start on the same old date, did not move',
    pg_temp.assignments_of(en2) = split_part(v_b2a, '#', 1)
    and (select effective_start_date from public.enrollment_schedules where id = a4) = v_today - 40
    and (select effective_start_date from public.batch_enrollments where id = en2) = v_today - 40, '');
  perform pg_temp.rec('C6 the same student''s enrollment in another batch, with an assignment starting on the same old date, did not move',
    pg_temp.assignments_of(en3) = split_part(v_b2a, '#', 2)
    and (select effective_start_date from public.batch_enrollments where id = en3) = v_today - 40, '');
  perform pg_temp.rec('C2 the assignment added later keeps its start, and the end date of an initial one is kept',
    (select effective_start_date from public.enrollment_schedules where id = a3) = v_today - 15
    and (select effective_end_date from public.enrollment_schedules where id = a2) = v_today - 5
    and (select effective_end_date from public.enrollment_schedules where id = a1) is null, '');
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 30, en));
  perform pg_temp.rec('C3a moving the start later succeeds', v_c = 'OK', v_c);
  perform pg_temp.rec('C3 moving the start LATER moves the initial assignments (now starting on the old start) and nothing else',
    (select effective_start_date from public.enrollment_schedules where id = a1) = v_today - 30
    and (select effective_start_date from public.enrollment_schedules where id = a2) = v_today - 30
    and (select effective_start_date from public.enrollment_schedules where id = a3) = v_today - 15, '');
  v_before := pg_temp.assignments_of(en);
  v_c := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'', effective_end_date = %L where id = %L', v_today + 5, en));
  perform pg_temp.rec('C4 an edit that does not change the start date moves nothing', v_c = 'OK' and pg_temp.assignments_of(en) = v_before, v_c);

  -- O. A refused move rolls the whole update back ------------------------------------------------------------------------------
  st := pg_temp.mk_student('O', v_today - 100);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 40);
  a1 := pg_temp.assign(en, v_s1, v_today - 90, v_today - 41);    -- an earlier, closed assignment of the same series
  a2 := pg_temp.assign(en, v_s1, v_today - 40);                  -- the initial one, same series
  v_before := pg_temp.assignments_of(en);
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 60, en));
  perform pg_temp.rec('O1 a move that would overlap another assignment of the same series is refused (23P01) and nothing changes',
    v_c = '23P01' and pg_temp.assignments_of(en) = v_before
    and (select effective_start_date from public.batch_enrollments where id = en) = v_today - 40, v_c);

  en := pg_temp.mk_enrollment(pg_temp.mk_student('O2', v_today - 100), v_b1, v_today - 40);
  a1 := pg_temp.assign(en, v_s2, v_today - 40, v_today - 35);    -- an initial assignment that ends soon
  a2 := pg_temp.assign(en, v_s3, v_today - 40);
  v_before := pg_temp.assignments_of(en);
  v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 30, en));
  perform pg_temp.rec('O2 a move that would leave an assignment ending before its start is refused (23514) and nothing changes',
    v_c = '23514' and pg_temp.assignments_of(en) = v_before
    and (select effective_start_date from public.batch_enrollments where id = en) = v_today - 40, v_c);

  -- B. A batch change is not a start-date move ---------------------------------------------------------------------------------
  en := pg_temp.mk_enrollment(pg_temp.mk_student('B', v_today - 100), v_b1, v_today - 40);
  a1 := pg_temp.assign(en, v_s1, v_today - 40);
  v_before := pg_temp.assignments_of(en);
  v_c := pg_temp.code(format('update public.batch_enrollments set batch_id = %L, effective_start_date = %L where id = %L', v_b2, v_today - 50, en));
  perform pg_temp.rec('B1 changing the batch together with the start date moves no assignment', v_c = 'OK' and pg_temp.assignments_of(en) = v_before, v_c);

  -- J. A join date moved later -------------------------------------------------------------------------------------------------
  st := pg_temp.mk_student('J', v_today - 100);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 40);
  m := pg_temp.mk_membership(st, v_today - 40, v_today - 10);
  v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 30, st));
  perform pg_temp.rec('J1 a join date moved past an active enrollment AND a membership start is refused (23514)', v_c = '23514'
    and (select join_date from public.students where id = st) = v_today - 100, v_c);
  v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 40, st));
  perform pg_temp.rec('J2 a join date moved exactly to the earliest start passes', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 200, st));
  perform pg_temp.rec('J3 a join date moved earlier always passes', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.students set full_name = %L where id = %L', 'ZZVERIFY 0051 J renamed', st));
  perform pg_temp.rec('J4 any other edit of the student passes', v_c = 'OK', v_c);

  v_c := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'' where id = %L', en));
  perform pg_temp.rec('J5a the enrollment of the J student is made inactive', v_c = 'OK', v_c);
  v_c := pg_temp.code(format('update public.memberships set cancelled_at = now() where id = %L', m));
  if v_c <> 'OK' then
    perform pg_temp.skip('J5 an inactive enrollment and a cancelled membership do not block moving the join date later', 'The membership could not be cancelled here (' || v_c || ').');
  else
    v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 5, st));
    perform pg_temp.rec('J5 only an inactive enrollment and a cancelled membership start earlier: moving the join date is allowed', v_c = 'OK', v_c);
  end if;

  -- Each record type on its own, so a broken counter in one cannot hide behind the other.
  -- J6: an ACTIVE enrollment alone (no membership at all).
  st := pg_temp.mk_student('J6 enrollment only', v_today - 100);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 40);
  v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 30, st));
  perform pg_temp.rec('J6 an active enrollment ALONE starting earlier blocks moving the join date later (23514)', v_c = '23514'
    and (select join_date from public.students where id = st) = v_today - 100, v_c);

  -- J7: a NON-CANCELLED membership alone (no enrollment at all).
  st := pg_temp.mk_student('J7 membership only', v_today - 100);
  m := pg_temp.mk_membership(st, v_today - 40, v_today - 10);
  v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 30, st));
  perform pg_temp.rec('J7 a non-cancelled membership ALONE starting earlier blocks moving the join date later (23514)', v_c = '23514'
    and (select join_date from public.students where id = st) = v_today - 100, v_c);

  -- J8: an INACTIVE enrollment alone.
  st := pg_temp.mk_student('J8 inactive enrollment only', v_today - 100);
  en := pg_temp.mk_enrollment(st, v_b1, v_today - 40);
  v_c := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'' where id = %L', en));
  if v_c <> 'OK' then
    perform pg_temp.skip('J8 an inactive enrollment alone does not block moving the join date later', 'The enrollment could not be made inactive (' || v_c || ').');
  else
    v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 30, st));
    perform pg_temp.rec('J8 an INACTIVE enrollment alone starting earlier does not block moving the join date later', v_c = 'OK'
      and (select join_date from public.students where id = st) = v_today - 30, v_c);
  end if;

  -- J9: a CANCELLED membership alone.
  st := pg_temp.mk_student('J9 cancelled membership only', v_today - 100);
  m := pg_temp.mk_membership(st, v_today - 40, v_today - 10);
  v_c := pg_temp.code(format('update public.memberships set cancelled_at = now() where id = %L', m));
  if v_c <> 'OK' then
    perform pg_temp.skip('J9 a cancelled membership alone does not block moving the join date later', 'The membership could not be cancelled here (' || v_c || ').');
  else
    v_c := pg_temp.code(format('update public.students set join_date = %L where id = %L', v_today - 30, st));
    perform pg_temp.rec('J9 a CANCELLED membership alone starting earlier does not block moving the join date later', v_c = 'OK'
      and (select join_date from public.students where id = st) = v_today - 30, v_c);
  end if;

  -- K. A package-linked membership (create_membership_from_package, as the Admin) -------------------------------------------------
  if v_admin is null
     or to_regprocedure('public.create_membership_from_package(uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text)') is null
     or to_regprocedure('public.create_package(text, text, text, integer, text[])') is null
     or to_regproc('public.schedule_fee_entry') is null
     or (select cp.currency from public.center_profile cp where cp.singleton) is null then
    perform pg_temp.skip('K1-K2 package-linked membership creation before / on the join date',
      'needs an Admin profile, migrations 0046-0048 and the centre profile');
  else
    p_pkg := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, $q$select public.create_package('ZZVERIFY 0051 Duration', null, 'duration', null, '{monthly,quarterly,half_yearly,annual,custom}'::text[])::text$q$));
    v_c := pg_temp.scalar_as(v_admin, format($q$select public.schedule_fee_entry(%L, %L::date, 1000, null, null)::text$q$, p_pkg, v_today - 100));
    if p_pkg is null or v_c like 'ERR:%' then
      perform pg_temp.skip('K1-K2 package-linked membership creation before / on the join date',
        'the package fixture could not be created (' || coalesce(v_c, 'no package') || ')');
    else
      st := pg_temp.mk_student('K', v_today - 50);
      v_c := pg_temp.msg_as(v_admin, format($q$select public.create_membership_from_package(%L, %L, 'monthly', null, %L, null, null, null, null, null, null, null, null, null, null)$q$, st, p_pkg, v_today - 51));
      perform pg_temp.rec('K1 create_membership_from_package with a start the day before the join date is refused (23514, the join-date message) and leaves no membership',
        v_c like '23514:The membership cannot start before the student joined%'
        and not exists (select 1 from public.memberships where student_id = st), v_c);
      v_c := pg_temp.scalar_as(v_admin, format($q$select public.create_membership_from_package(%L, %L, 'monthly', null, %L, null, null, null, null, null, null, null, null, null, null)::text$q$, st, p_pkg, v_today - 50));
      perform pg_temp.rec('K2 the same call with a start ON the join date creates the membership (so K1 was the join date, not the fixture)',
        pg_temp.as_uuid(v_c) is not null
        and exists (select 1 from public.memberships where student_id = st and start_date = v_today - 50 and package_id = p_pkg), v_c);
    end if;
  end if;

  -- Z. Existing data unchanged ---------------------------------------------------------------------------------------------------
  -- Fixture rows are excluded by name: only what existed before this script is compared.
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.students s where position('ZZVERIFY 0051' in s.full_name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be where be.student_id in (select id from public.students where position('ZZVERIFY 0051' in full_name) <> 1)), '') ||
    coalesce((select string_agg(to_jsonb(es)::text, '|' order by es.id) from public.enrollment_schedules es where es.batch_enrollment_id in (select id from public.batch_enrollments where student_id in (select id from public.students where position('ZZVERIFY 0051' in full_name) <> 1))), '') ||
    coalesce((select string_agg(to_jsonb(mm)::text, '|' order by mm.id) from public.memberships mm where mm.student_id in (select id from public.students where position('ZZVERIFY 0051' in full_name) <> 1)), '')));
  perform pg_temp.rec('Z every student, enrollment, assignment and membership that existed before this script is byte-for-byte unchanged by it',
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
--   select (select count(*) from public.students where position('ZZVERIFY 0051' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0051' in name) = 1) as leftover_batches,
--          (select count(*) from public.instructors where position('ZZVERIFY 0051' in full_name) = 1) as leftover_instructors,
--          (select count(*) from public.packages where position('ZZVERIFY 0051' in name) = 1) as leftover_packages;
-- All four must be 0.
