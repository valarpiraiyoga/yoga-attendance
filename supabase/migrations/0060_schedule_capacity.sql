-- Schedule capacity: an optional maximum number of students per recurring class (schedule series), replacing 0059's batch capacity
--
-- WHY
--   Capacity belongs to each recurring class, not to the batch (01-product.md §7 "Schedule Capacity", approved S0): Hatha Yoga's
--   Monday 6:00 AM and Monday 5:00 PM classes each have their own limit. 0059 (applied) put one capacity on the batch; it is
--   superseded here and never edited.
--
-- THE RULE (01-product.md §4, §7 "Schedule Capacity", §12)
--   A schedule series' capacity is a whole number from 1 to 1000, or NULL for unlimited (every existing series, unchanged). It is
--   held by the series, so a new schedule version keeps it, and a change to it applies at once (no version, no effective date).
--   A schedule assignment (enrollment_schedules) TAKES A PLACE in its series when the assignment has no end date or ends on or
--   after the centre's today (centre_timezone(), 0024), AND its enrollment is 'active' with no end date or ending on or after
--   today. A future-dated assignment already takes its place. The student's own status, memberships, payments and attendance play
--   no part. An enrollment with several assignments takes one place in each of their series.
--
-- WHAT THIS MIGRATION DOES
--   1. Removes 0059's batch capacity - its two triggers, two functions, constraint and batches.capacity - but ONLY when every
--      batches.capacity is NULL. If any batch has a capacity, the migration stops with an error before changing anything; the
--      value is never cleared or moved by it. (Run on a database without 0059, there is nothing to remove.)
--   2. schedule_series.capacity integer NULL, with schedule_series_capacity_valid: NULL, or 1 to 1000 (23514).
--   3. schedule_series_occupied_places(series, today): the places taken, by the rule above. Internal (no client access).
--   4. Capacity checks AT COMMIT - two DEFERRABLE INITIALLY DEFERRED constraint triggers:
--        enrollment_schedules_capacity_check (AFTER INSERT OR UPDATE OF schedule_series_id, effective_end_date, batch_enrollment_id)
--          - a new assignment, an assignment moved to another series or enrollment, or one whose end date is cleared or moved to
--            today or later;
--        batch_enrollments_capacity_check (AFTER UPDATE OF status, effective_end_date)
--          - an enrollment reactivated, or its end date cleared or moved to today or later, so its assignments take places again.
--      Each re-reads the row as it stands at the check (never the event's old values), and checks every series the row then takes
--      a place in: refused when that series' places taken EXCEED its capacity. Because the check is of the final state, a write
--      that takes no new place - ending, deactivating, re-saving the same values, a new start date - can never be refused, and a
--      transaction that both closes and adds assignments is judged on the result. Violation: 23514 "The schedule is full ...".
--   5. schedule_series_capacity_guard (BEFORE UPDATE OF capacity): a capacity cannot be set below the places taken now. Violation:
--      23514 "The capacity cannot be lowered to N ...". Raising it, removing it or setting it to exactly the places taken works;
--      nothing is ended or removed to make room.
--   6. Atomic enrollment writes (SECURITY DEFINER, Admin only, 42501 otherwise), one transaction each:
--        create_enrollment(student, batch, start, end, schedule series[])  -> the new enrollment's id
--        change_enrollment(enrollment, batch, start, end, status, schedule series[], schedule change date) -> {enrollment_id, moved}
--      They do exactly what lib/enrollments/actions.js's createEnrollment / updateEnrollment do today, step for step (the selected
--      series must belong to the batch; a changed selection closes the dropped assignments the day before the change date, or
--      withdraws them if they start on or after it, and adds the new ones from it; the 0051 start-date cascade and its moved count),
--      but in one transaction: if any selected schedule is full - or any other rule refuses - nothing is written. The capacity
--      checks are deferred inside them and forced before they return, so the refusal is their own error.
--      The join date (0051) and the 'one active enrollment per batch' index are enforced by the existing triggers and index; the
--      attendance-on-the-effective-date rule stays in the application, which checks it before calling.
--
-- WHAT IT DOES NOT DO
--   * It changes no existing row (schedule_series.capacity starts NULL everywhere) and no existing function, trigger, policy or
--     grant other than removing 0059's. Attendance eligibility (resolve_eligible_students, the saved eligibility snapshots),
--     class sessions, schedule versioning (schedules), memberships, payments and documents are not read or touched.
--   * Deactivating a schedule still does not end its students' assignments (approved D4); they keep counting.
--   * The application does not call the new functions yet (S3); until then its two-step create can, if a schedule is full, leave
--     an enrollment without the refused assignment. No capacity can be set before the schedule form offers it (S5), so this
--     cannot happen in practice before S3.
--
-- CONCURRENCY (READ COMMITTED - the default, and what PostgREST uses)
--   Every check locks its series row with SELECT ... FOR NO KEY UPDATE before it counts, and a capacity UPDATE holds the same row
--   lock while its guard counts. So two transactions that take places in one series, or one that takes a place and one that lowers
--   the capacity, are serialised; the later one counts after the earlier commits and sees its rows (each statement in these
--   functions takes a fresh snapshot). The deferred checks run at commit, so the lock is held only from the check to the commit.
--   The two functions lock every series they will touch, in id order, before writing anything, so two of them never wait on each
--   other in opposite orders. Direct multi-row writes from elsewhere that touch several series in different orders could deadlock;
--   PostgreSQL then aborts one of them (40P01) and nothing is written by it. Under REPEATABLE READ or SERIALIZABLE the limit is NOT
--   guaranteed: a transaction's snapshot is fixed when it starts.
--   Lock order with 0051: the functions lock the enrollment row, then series rows; the join-date guard takes the student row FOR
--   SHARE; students_join_date_guard reads enrollments without locking series. No path takes them the other way round.
--
-- RE-RUN
--   Idempotent: the 0059 removal is IF EXISTS, ADD COLUMN IF NOT EXISTS, the constraint added only when missing, CREATE OR REPLACE
--   for the functions, the triggers dropped and re-created. Run it as one transaction.

-- 0. Prerequisites ----------------------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.schedule_series') is null or to_regclass('public.enrollment_schedules') is null
     or to_regclass('public.batch_enrollments') is null or to_regclass('public.batches') is null then
    raise exception '0060 needs the batches (0005), batch enrollment (0007), schedule series and schedule assignment (0013) tables.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '0060 needs public.centre_timezone() (0024) and public.is_admin().';
  end if;
end
$$;


-- 1. Remove 0059's batch capacity - only when no batch has one ------------------------------------------------------------
-- One statement, before anything else changes: the table is locked, the values checked, and 0059's objects dropped together. If any
-- batch has a capacity the exception aborts it and the migration, and nothing at all has changed.

do $$
declare
  v_set integer;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'batches' and column_name = 'capacity') then
    lock table public.batches in access exclusive mode;

    execute 'select count(*) from public.batches where capacity is not null' into v_set;
    if v_set > 0 then
      raise exception '0060 stopped without changing anything: % batch(es) still have a capacity (0059). Batch capacity is replaced by schedule capacity; clear those values deliberately first (or keep 0059), then run 0060 again.',
        v_set using errcode = '55000';
    end if;
  end if;

  drop trigger if exists batch_enrollments_capacity_guard_trigger on public.batch_enrollments;
  drop trigger if exists batches_capacity_guard_trigger on public.batches;
  drop function if exists public.batch_enrollments_capacity_guard();
  drop function if exists public.batches_capacity_guard();
  alter table public.batches drop constraint if exists batches_capacity_valid;
  alter table public.batches drop column if exists capacity;
end
$$;


-- 2. The capacity of a schedule series --------------------------------------------------------------------------------------

alter table public.schedule_series
  add column if not exists capacity integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_series_capacity_valid'
                 and conrelid = 'public.schedule_series'::regclass) then
    alter table public.schedule_series
      add constraint schedule_series_capacity_valid
      check (capacity is null or capacity between 1 and 1000);
  end if;
end
$$;

comment on column public.schedule_series.capacity is
  'The most schedule assignments that may take a place in this recurring class at once (1-1000), or NULL for unlimited. Held by the series, so every version keeps it. An assignment takes a place when it has no end date or ends on or after the centre''s today and its enrollment is active with no end date or ending on or after today. Enforced by enrollment_schedules_capacity_check, batch_enrollments_capacity_check and schedule_series_capacity_guard (0060).';


-- 3. Places taken in a series -----------------------------------------------------------------------------------------------

create or replace function public.schedule_series_occupied_places(p_series_id uuid, p_today date)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.enrollment_schedules es
  join public.batch_enrollments be on be.id = es.batch_enrollment_id
  where es.schedule_series_id = p_series_id
    and (es.effective_end_date is null or es.effective_end_date >= p_today)
    and be.status = 'active'
    and (be.effective_end_date is null or be.effective_end_date >= p_today);
$$;

comment on function public.schedule_series_occupied_places(uuid, date) is
  'Places taken in a schedule series on a date: assignments with no end date or ending on or after it, whose enrollment is active with no end date or ending on or after it. The one definition every capacity check uses (0060).';

revoke execute on function public.schedule_series_occupied_places(uuid, date) from public, anon, authenticated;


-- 4. The capacity checks (at commit) ----------------------------------------------------------------------------------------

-- Locks the series, then refuses when its places taken exceed its capacity. Called only by the checks below.
create or replace function public.schedule_series_capacity_check(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_capacity integer;
  v_occupied integer;
begin
  select ss.capacity into v_capacity from public.schedule_series ss where ss.id = p_series_id for no key update;

  if not found or v_capacity is null then
    return;
  end if;

  v_occupied := public.schedule_series_occupied_places(p_series_id, v_today);

  if v_occupied > v_capacity then
    raise exception 'The schedule is full (capacity %). Increase the schedule''s capacity, or end another student''s assignment to it, first.',
      v_capacity
      using errcode = '23514',
            detail = format('schedule_series_id=%s places_needed=%s capacity=%s', p_series_id, v_occupied, v_capacity);
  end if;
end;
$$;

comment on function public.schedule_series_capacity_check(uuid) is
  'Locks a schedule series (FOR NO KEY UPDATE) and refuses (23514 "The schedule is full ...") when its places taken exceed its capacity. Used by the deferred capacity checks (0060).';

revoke execute on function public.schedule_series_capacity_check(uuid) from public, anon, authenticated;

-- An assignment, as it stands at the check: if it takes a place, its series must not be over capacity.
create or replace function public.enrollment_schedules_capacity_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today  date := (now() at time zone public.centre_timezone())::date;
  v_series uuid;
begin
  select es.schedule_series_id into v_series
  from public.enrollment_schedules es
  join public.batch_enrollments be on be.id = es.batch_enrollment_id
  where es.id = new.id
    and (es.effective_end_date is null or es.effective_end_date >= v_today)
    and be.status = 'active'
    and (be.effective_end_date is null or be.effective_end_date >= v_today);

  -- Removed since, or takes no place now: nothing to check.
  if found then
    perform public.schedule_series_capacity_check(v_series);
  end if;

  return null;
end;
$$;

comment on function public.enrollment_schedules_capacity_check() is
  'Deferred: re-reads the assignment at the check and, if it takes a place, checks its series'' capacity (0060).';

revoke execute on function public.enrollment_schedules_capacity_check() from public, anon, authenticated;

drop trigger if exists enrollment_schedules_capacity_check on public.enrollment_schedules;
create constraint trigger enrollment_schedules_capacity_check
  after insert or update of schedule_series_id, effective_end_date, batch_enrollment_id on public.enrollment_schedules
  deferrable initially deferred
  for each row
  execute function public.enrollment_schedules_capacity_check();

-- An enrollment, as it stands at the check: if it is current, every series its current assignments take a place in, in id order.
create or replace function public.batch_enrollments_capacity_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today  date := (now() at time zone public.centre_timezone())::date;
  v_series uuid;
begin
  if not exists (select 1 from public.batch_enrollments be
                 where be.id = new.id and be.status = 'active'
                   and (be.effective_end_date is null or be.effective_end_date >= v_today)) then
    return null;
  end if;

  for v_series in
    select distinct es.schedule_series_id
    from public.enrollment_schedules es
    where es.batch_enrollment_id = new.id
      and (es.effective_end_date is null or es.effective_end_date >= v_today)
    order by es.schedule_series_id
  loop
    perform public.schedule_series_capacity_check(v_series);
  end loop;

  return null;
end;
$$;

comment on function public.batch_enrollments_capacity_check() is
  'Deferred: if the enrollment is current at the check (active, no end date or ending on or after today), checks the capacity of every series its current assignments take a place in, in id order (0060).';

revoke execute on function public.batch_enrollments_capacity_check() from public, anon, authenticated;

drop trigger if exists batch_enrollments_capacity_check on public.batch_enrollments;
create constraint trigger batch_enrollments_capacity_check
  after update of status, effective_end_date on public.batch_enrollments
  deferrable initially deferred
  for each row
  execute function public.batch_enrollments_capacity_check();


-- 5. A capacity cannot be set below the places taken now --------------------------------------------------------------------
-- BEFORE UPDATE: the series row is already locked by this UPDATE while the guard counts.

create or replace function public.schedule_series_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_occupied integer;
begin
  -- NULL (unlimited) and an unchanged value need no count. A value below 1 is left to schedule_series_capacity_valid (this BEFORE
  -- trigger runs before the CHECK), so it is refused as an invalid capacity, not as "below the places taken".
  if new.capacity is null or new.capacity < 1 or new.capacity is not distinct from old.capacity then
    return new;
  end if;

  v_occupied := public.schedule_series_occupied_places(new.id, v_today);

  if v_occupied > new.capacity then
    raise exception 'The capacity cannot be lowered to % because % places are taken. Set it to % or more, or end students'' assignments first.',
      new.capacity, v_occupied, v_occupied using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.schedule_series_capacity_guard() is
  'A schedule series'' capacity cannot be set below its places taken now. Raising or removing it is never refused, and no assignment is ever changed by it (0060).';

revoke execute on function public.schedule_series_capacity_guard() from public, anon, authenticated;

drop trigger if exists schedule_series_capacity_guard_trigger on public.schedule_series;
create trigger schedule_series_capacity_guard_trigger
  before update of capacity on public.schedule_series
  for each row
  execute function public.schedule_series_capacity_guard();


-- 6. Atomic enrollment writes -----------------------------------------------------------------------------------------------

-- The distinct selected series, in id order; refuses an empty selection or one that is not entirely the batch's own.
create or replace function public.enrollment_series_selection(p_batch_id uuid, p_series_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series uuid[];
begin
  v_series := array(select distinct s from unnest(coalesce(p_series_ids, '{}')) as s where s is not null order by s);

  if cardinality(v_series) = 0 then
    raise exception 'Select at least one schedule.' using errcode = '22023';
  end if;

  if (select count(*) from public.schedule_series ss where ss.id = any(v_series) and ss.batch_id = p_batch_id)
     <> cardinality(v_series) then
    raise exception 'Select schedules that belong to the chosen batch.' using errcode = '22023';
  end if;

  return v_series;
end;
$$;

revoke execute on function public.enrollment_series_selection(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.create_enrollment(
  p_student_id uuid,
  p_batch_id   uuid,
  p_start_date date,
  p_end_date   date,
  p_series_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series     uuid[];
  v_enrollment uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Judge the whole transaction's result at the end, whatever the caller had set.
  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check deferred;

  v_series := public.enrollment_series_selection(p_batch_id, p_series_ids);

  -- Every series this write will take a place in, locked in id order before anything is written.
  perform 1 from public.schedule_series ss where ss.id = any(v_series) order by ss.id for no key update;

  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date)
  values (p_student_id, p_batch_id, p_start_date, p_end_date)
  returning id into v_enrollment;

  -- Every selected schedule starts on the enrollment's own start date (as createEnrollment does).
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  select v_enrollment, s, p_start_date from unnest(v_series) as s order by s;

  -- The capacity checks now, so a full schedule is this call's own error and nothing above remains.
  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;

  return v_enrollment;
end;
$$;

comment on function public.create_enrollment(uuid, uuid, date, date, uuid[]) is
  'Admin only. Creates an enrollment and one assignment per selected schedule series (all of the batch, at least one), all starting on the enrollment start, in one transaction: if any schedule is full (23514 "The schedule is full ...") or any other rule refuses, nothing is written (0060).';

revoke execute on function public.create_enrollment(uuid, uuid, date, date, uuid[]) from public, anon;
grant execute on function public.create_enrollment(uuid, uuid, date, date, uuid[]) to authenticated;

create or replace function public.change_enrollment(
  p_enrollment_id uuid,
  p_batch_id      uuid,
  p_start_date    date,
  p_end_date      date,
  p_status        text,
  p_series_ids    uuid[],
  p_change_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today       date := (now() at time zone public.centre_timezone())::date;
  v_stored      public.batch_enrollments%rowtype;
  v_series      uuid[];
  v_current     uuid[];
  v_close_ids   uuid[];
  v_add         uuid[];
  v_initial_ids uuid[] := '{}';
  v_moved       integer := 0;
  v_row         record;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check deferred;

  select * into v_stored from public.batch_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0002';
  end if;

  v_series := public.enrollment_series_selection(p_batch_id, p_series_ids);

  -- What is assigned now: every assignment not ended before today (updateEnrollment's own reading).
  select coalesce(array_agg(es.schedule_series_id order by es.schedule_series_id), '{}')
  into v_current
  from public.enrollment_schedules es
  where es.batch_enrollment_id = p_enrollment_id
    and (es.effective_end_date is null or es.effective_end_date >= v_today);

  select coalesce(array_agg(es.id order by es.id), '{}')
  into v_close_ids
  from public.enrollment_schedules es
  where es.batch_enrollment_id = p_enrollment_id
    and (es.effective_end_date is null or es.effective_end_date >= v_today)
    and es.schedule_series_id <> all(v_series);

  v_add := array(select s from unnest(v_series) as s where s <> all(v_current) order by s);

  -- A changed selection needs a valid, not back-dated change date (validateScheduleChangeDate).
  if cardinality(v_close_ids) > 0 or cardinality(v_add) > 0 then
    if p_change_date is null then
      raise exception 'Enter a valid date for the schedule change.' using errcode = '22023';
    end if;
    if p_change_date < v_today then
      raise exception 'The schedule change cannot be back-dated.' using errcode = '22023';
    end if;
  end if;

  -- Every series this write touches, locked in id order before anything is written.
  perform 1 from public.schedule_series ss
  where ss.id = any(v_series) or ss.id = any(v_current)
  order by ss.id
  for no key update;

  -- A start-date move with the batch unchanged: the 0051 cascade moves the assignments that start on the OLD start.
  if p_start_date is distinct from v_stored.effective_start_date and p_batch_id = v_stored.batch_id then
    select coalesce(array_agg(es.id), '{}') into v_initial_ids
    from public.enrollment_schedules es
    where es.batch_enrollment_id = p_enrollment_id and es.effective_start_date = v_stored.effective_start_date;
  end if;

  update public.batch_enrollments
  set batch_id = p_batch_id,
      effective_start_date = p_start_date,
      effective_end_date = p_end_date,
      status = p_status
  where id = p_enrollment_id;

  if cardinality(v_initial_ids) > 0 then
    select count(*) into v_moved
    from public.enrollment_schedules es
    where es.id = any(v_initial_ids) and es.effective_start_date = p_start_date;
  end if;

  -- Dropped schedules, read now (the cascade may have moved their start): closed the day before the change date, or withdrawn when
  -- they start on or after it (they have no past to keep; p_change_date >= today, so they have not started).
  for v_row in
    select es.id, es.effective_start_date from public.enrollment_schedules es where es.id = any(v_close_ids) order by es.id
  loop
    if v_row.effective_start_date < p_change_date then
      update public.enrollment_schedules set effective_end_date = p_change_date - 1 where id = v_row.id;
    else
      delete from public.enrollment_schedules where id = v_row.id;
    end if;
  end loop;

  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
  select p_enrollment_id, s, p_change_date from unnest(v_add) as s order by s;

  set constraints public.enrollment_schedules_capacity_check, public.batch_enrollments_capacity_check immediate;

  return jsonb_build_object('enrollment_id', p_enrollment_id, 'moved', v_moved);
end;
$$;

comment on function public.change_enrollment(uuid, uuid, date, date, text, uuid[], date) is
  'Admin only. Saves an enrollment edit exactly as updateEnrollment does - its fields (with the 0051 start-date cascade), then the dropped schedules closed the day before the change date or withdrawn if not started, then the added ones from it - in one transaction: if any schedule is full (23514 "The schedule is full ...") or any other rule refuses, nothing is written. Returns {enrollment_id, moved} (0060).';

revoke execute on function public.change_enrollment(uuid, uuid, date, date, text, uuid[], date) from public, anon;
grant execute on function public.change_enrollment(uuid, uuid, date, date, text, uuid[], date) to authenticated;
