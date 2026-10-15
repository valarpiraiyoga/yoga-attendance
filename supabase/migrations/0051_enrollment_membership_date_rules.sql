-- Join-date rules and the enrollment start-date cascade
--
-- WHY
--   An enrollment, and a membership, could start before the student joined, and editing an enrollment's start date left its
--   schedule assignments behind: attendance eligibility needs the enrollment AND an assignment to cover the session date, so an
--   earlier enrollment start changed nothing until the assignments moved too (01-product.md section 8).
--
-- WHAT THIS MIGRATION DOES
--   1. batch_enrollments_join_date_guard (BEFORE INSERT OR UPDATE OF effective_start_date): an enrollment cannot START before the
--      student's join_date. Checked on insert, and on update only when the start date actually CHANGES - so any other edit of an
--      existing record that is already out of range (a status change, an end date) still works. Violation: 23514.
--   2. memberships_join_date_guard (BEFORE INSERT OR UPDATE OF start_date): the same for a membership's start date, for every
--      way a membership is written (legacy insert and edit, renewal, create_membership_from_package, a future correction).
--   3. batch_enrollments_start_cascade (AFTER UPDATE OF effective_start_date): when an enrollment's start date changes (and its
--      batch does not), the schedule assignments of THIS enrollment whose effective_start_date equals the OLD enrollment start move
--      to the new start, in the same statement and transaction. Nothing else moves: an assignment added later by a deliberate schedule
--      change, an assignment's end date, class sessions, attendance records, saved eligibility snapshots and frozen rosters are
--      untouched. If the move would overlap another assignment of the same series (enrollment_schedules_no_overlap, 23P01) or
--      leave an assignment ending before its start (enrollment_schedules_end_after_start, 23514), the whole statement - the
--      enrollment update included - is rolled back.
--   4. students_join_date_guard (BEFORE UPDATE OF join_date): a join date cannot be moved LATER while the student has an ACTIVE
--      enrollment or a NON-CANCELLED membership that starts before the new date (23514). Moving it earlier - the supported way to
--      correct an earlier start - is always allowed. Inactive enrollments and cancelled memberships are history and never block.
--
-- WHAT IT DOES NOT DO
--   * It updates no existing row and bulk-corrects nothing: records that already start before their student's join date stay as they
--     are, until the join date is corrected through Edit Student.
--   * It changes no existing function, trigger or policy of an earlier migration, and it adds no table, column or grant.
--   * It does not touch the package guard (0048), the payment guard (0034), the class-count expiry guard (0049) or the receipt-sync
--     trigger (0030): its membership trigger fires only on INSERT and on an UPDATE of start_date, and checks one thing.
--
-- CONCURRENCY
--   The enrollment and membership guards read the student's join date with SELECT ... FOR SHARE, and a join-date UPDATE holds the
--   student row exclusively while its guard looks for earlier starts. So a write that starts a record before a join date being
--   changed at the same moment cannot interleave with it: one waits for the other, then sees its result (READ COMMITTED, the
--   default). The cascade runs inside the enrollment's own UPDATE statement.
--
-- ORDER OF MIGRATIONS
--   0051 does not depend on 0050 (reserved for FS-8). FS-8's correction function will meet the memberships guard at run time.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE for the functions, the four triggers dropped and re-created. Run it as one transaction. It
--   re-creates nothing that another migration defines.

do $$
begin
  if to_regclass('public.students') is null or to_regclass('public.batch_enrollments') is null
     or to_regclass('public.enrollment_schedules') is null or to_regclass('public.memberships') is null then
    raise exception '0051 needs the students, batch enrollment, schedule assignment (0013) and membership tables.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'enrollment_schedules_no_overlap'
                 and conrelid = 'public.enrollment_schedules'::regclass) then
    raise exception '0051 needs the enrollment_schedules_no_overlap constraint of migration 0013: the cascade relies on it to refuse an overlap.';
  end if;
end
$$;


-- 1. An enrollment cannot start before the student joined ------------------------------------------------------

create or replace function public.batch_enrollments_join_date_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_join date;
begin
  -- Only a NEW start date is judged: any other edit of an existing record is allowed, whatever its current start.
  if tg_op = 'UPDATE' and new.effective_start_date is not distinct from old.effective_start_date then
    return new;
  end if;

  -- FOR SHARE: a join-date change of this student (which holds the row exclusively) cannot interleave with this write.
  select s.join_date into v_join from public.students s where s.id = new.student_id for share;

  if v_join is not null and new.effective_start_date < v_join then
    raise exception 'The enrollment cannot start before the student joined (%). Correct the join date in Edit Student first.',
      to_char(v_join, 'YYYY-MM-DD') using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.batch_enrollments_join_date_guard() is
  'An enrollment cannot start before the student''s join date. Judged on insert and when the start date changes; other edits of an existing record are never blocked by it.';

revoke execute on function public.batch_enrollments_join_date_guard() from public, anon, authenticated;

drop trigger if exists batch_enrollments_join_date_guard_trigger on public.batch_enrollments;
create trigger batch_enrollments_join_date_guard_trigger
  before insert or update of effective_start_date on public.batch_enrollments
  for each row
  execute function public.batch_enrollments_join_date_guard();


-- 2. A membership cannot start before the student joined --------------------------------------------------------

create or replace function public.memberships_join_date_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_join date;
begin
  if tg_op = 'UPDATE' and new.start_date is not distinct from old.start_date then
    return new;
  end if;

  select s.join_date into v_join from public.students s where s.id = new.student_id for share;

  if v_join is not null and new.start_date < v_join then
    raise exception 'The membership cannot start before the student joined (%). Correct the join date in Edit Student first.',
      to_char(v_join, 'YYYY-MM-DD') using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.memberships_join_date_guard() is
  'A membership cannot start before the student''s join date. Judged on insert and when start_date changes; notes, payment status, the class-count expiry and every other edit of an existing record are never blocked by it.';

revoke execute on function public.memberships_join_date_guard() from public, anon, authenticated;

drop trigger if exists memberships_join_date_guard_trigger on public.memberships;
create trigger memberships_join_date_guard_trigger
  before insert or update of start_date on public.memberships
  for each row
  execute function public.memberships_join_date_guard();


-- 3. The initial schedule assignments follow the enrollment's start date ----------------------------------------
-- AFTER UPDATE, row level, in the enrollment's own statement: an overlap or an end-before-start raised by the assignment update
-- aborts the statement, so the enrollment keeps its old start. A batch change is not a start-date move: the assignments of the old
-- batch's series are closed or withdrawn by the schedule-change flow, never moved here.

create or replace function public.batch_enrollments_start_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.batch_id = old.batch_id
     and new.effective_start_date is distinct from old.effective_start_date then
    update public.enrollment_schedules
    set effective_start_date = new.effective_start_date,
        updated_at = now()
    where batch_enrollment_id = new.id
      and effective_start_date = old.effective_start_date;
  end if;

  return null;
end;
$$;

comment on function public.batch_enrollments_start_cascade() is
  'When an enrollment''s start date changes, moves ONLY its schedule assignments whose start equals the old enrollment start. Assignments added later, their end dates, sessions, attendance and snapshots are untouched; an overlap or an end before the new start aborts the whole update.';

revoke execute on function public.batch_enrollments_start_cascade() from public, anon, authenticated;

drop trigger if exists batch_enrollments_start_cascade_trigger on public.batch_enrollments;
create trigger batch_enrollments_start_cascade_trigger
  after update of effective_start_date on public.batch_enrollments
  for each row
  execute function public.batch_enrollments_start_cascade();


-- 4. A join date cannot move past the start of a live record ------------------------------------------------------
-- The UPDATE holds this student row exclusively while this runs (the row lock is taken before a BEFORE UPDATE trigger fires), and
-- the two guards above take it FOR SHARE: they wait for each other. Only ACTIVE enrollments and NON-CANCELLED memberships count.

create or replace function public.students_join_date_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollments integer;
  v_memberships integer;
  v_earliest    date;
begin
  if new.join_date is not distinct from old.join_date or new.join_date <= old.join_date then
    return new;
  end if;

  select count(*) into v_enrollments
  from public.batch_enrollments be
  where be.student_id = new.id and be.status = 'active' and be.effective_start_date < new.join_date;

  select count(*) into v_memberships
  from public.memberships m
  where m.student_id = new.id and m.cancelled_at is null and m.start_date < new.join_date;

  if v_enrollments + v_memberships > 0 then
    select least(
             (select min(be.effective_start_date) from public.batch_enrollments be
              where be.student_id = new.id and be.status = 'active' and be.effective_start_date < new.join_date),
             (select min(m.start_date) from public.memberships m
              where m.student_id = new.id and m.cancelled_at is null and m.start_date < new.join_date))
    into v_earliest;

    raise exception 'The join date cannot be moved to % while this student has % active enrollment(s) and % membership(s) that start earlier (earliest %).',
      to_char(new.join_date, 'YYYY-MM-DD'), v_enrollments, v_memberships, to_char(v_earliest, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.students_join_date_guard() is
  'A student''s join date cannot be moved later than the start of an active enrollment or a non-cancelled membership. Moving it earlier, or any other edit, is never blocked by it.';

revoke execute on function public.students_join_date_guard() from public, anon, authenticated;

drop trigger if exists students_join_date_guard_trigger on public.students;
create trigger students_join_date_guard_trigger
  before update of join_date on public.students
  for each row
  execute function public.students_join_date_guard();
