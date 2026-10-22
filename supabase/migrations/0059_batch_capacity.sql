-- Batch capacity: an optional maximum number of students per batch
--
-- WHY
--   A batch can hold only so many students. Nothing stopped an Admin enrolling more, and a check in the application alone could be
--   bypassed by a direct write or by two Admins enrolling into the last place at the same moment.
--
-- THE RULE (approved, V1 Final Improvements - Batch Capacity)
--   A batch's capacity is a whole number from 1 to 1000, or NULL for unlimited (every existing batch, unchanged).
--   An enrollment OCCUPIES a place in its batch when its status is 'active' AND it has no end date or ends today or later, "today"
--   being the centre's date (centre_timezone(), 0024). Future-dated enrollments therefore reserve a place; an inactive enrollment, or
--   one that ended before today, does not. The student's own status, memberships, payments and attendance play no part: an inactive
--   student whose enrollment is still active keeps the place until the enrollment is ended or deactivated.
--
-- WHAT THIS MIGRATION DOES
--   1. batches.capacity integer NULL, with batches_capacity_valid: NULL, or 1 to 1000 (23514).
--   2. batch_enrollments_capacity_guard (BEFORE INSERT OR UPDATE OF status, batch_id, effective_end_date): refuses a write that makes
--      an enrollment occupy a place in a full batch - a new active enrollment, inactive -> active, a move to another batch, or an end
--      date moved from the past to today or later, or cleared. Violation: 23514, "The batch is full ...". A write after which the
--      enrollment does not occupy a place (deactivating it, ending it before today, an inactive or already-ended record), or one
--      that leaves an enrollment that already occupied a place in the same batch occupying it (a new start date, a different future
--      end date), is never refused.
--   3. batches_capacity_guard (BEFORE UPDATE OF capacity): a capacity cannot be set below the number of places occupied now.
--      Violation: 23514, "The capacity cannot be lowered to N ...". Raising it, clearing it (unlimited) or setting it to exactly the
--      occupied number always works. Nothing is ever removed or deactivated to make room.
--
-- WHAT IT DOES NOT DO
--   * It updates no existing row: every batch starts with capacity NULL (unlimited), so no existing enrollment can be refused.
--   * It changes no existing function, trigger, policy or grant. RLS on batches and batch_enrollments (0005, 0007) is unchanged:
--     Admins already write both tables, and the guards apply to every writer whatever the policy.
--   * Attendance eligibility, class sessions, schedule assignments, memberships, payments and documents are not read or touched.
--     Capacity only refuses writes; it never changes who is eligible for a class.
--
-- CONCURRENCY
--   Both guards serialise on the batch row. The enrollment guard locks it with SELECT ... FOR NO KEY UPDATE before it counts, and a
--   capacity UPDATE holds the same row lock while its guard counts. So two enrollments into the same batch, or an enrollment and a
--   capacity change, wait for each other; the second counts after the first commits and sees its result (READ COMMITTED, the
--   default and what PostgREST uses: every statement in the guard takes a fresh snapshot). FOR NO KEY UPDATE rather than FOR UPDATE:
--   it conflicts with itself and with a row update exactly as needed, but not with the FOR KEY SHARE locks foreign-key checks take
--   on the batch (a schedule or enrollment of that batch being written elsewhere), so it adds no waits or deadlocks of its own.
--   Under REPEATABLE READ or SERIALIZABLE a writer's snapshot is fixed when its transaction starts, so this guarantee is stated for
--   READ COMMITTED only - the application never uses anything else.
--   Lock order: the enrollment guard takes the batch row, then the join-date guard (0051, fired after it - triggers fire in name
--   order) takes the student row FOR SHARE. No guard takes them the other way round.
--
-- RE-RUN
--   Idempotent: ADD COLUMN IF NOT EXISTS, the constraint added only when missing, CREATE OR REPLACE for the functions, the two
--   triggers dropped and re-created. Run it as one transaction.

do $$
begin
  if to_regclass('public.batches') is null or to_regclass('public.batch_enrollments') is null then
    raise exception '0059 needs the batches (0005) and batch enrollment (0007) tables.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null then
    raise exception '0059 needs public.centre_timezone() (0024): the occupied places are counted on the centre''s date.';
  end if;
end
$$;


-- 1. The capacity -------------------------------------------------------------------------------------------------

alter table public.batches
  add column if not exists capacity integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batches_capacity_valid' and conrelid = 'public.batches'::regclass) then
    alter table public.batches
      add constraint batches_capacity_valid
      check (capacity is null or capacity between 1 and 1000);
  end if;
end
$$;

comment on column public.batches.capacity is
  'The most enrollments that may occupy a place in this batch at once (1-1000), or NULL for unlimited. An enrollment occupies a place when it is active and has no end date or ends on or after the centre''s today. Enforced by batch_enrollments_capacity_guard and batches_capacity_guard.';


-- 2. An enrollment cannot take a place in a full batch -------------------------------------------------------------

create or replace function public.batch_enrollments_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_capacity integer;
  v_occupied integer;
begin
  -- After this write the enrollment does not occupy a place: nothing to check (deactivating or ending one is never refused).
  if new.status <> 'active' or (new.effective_end_date is not null and new.effective_end_date < v_today) then
    return new;
  end if;

  -- It already occupied a place in this same batch: the write takes no new place (a new start date, another future end date).
  if tg_op = 'UPDATE' and new.batch_id = old.batch_id and old.status = 'active'
     and (old.effective_end_date is null or old.effective_end_date >= v_today) then
    return new;
  end if;

  -- The batch row lock serialises every write that takes a place in this batch, and a capacity change of it.
  select b.capacity into v_capacity from public.batches b where b.id = new.batch_id for no key update;

  if v_capacity is null then
    return new;
  end if;

  select count(*) into v_occupied
  from public.batch_enrollments be
  where be.batch_id = new.batch_id
    and be.id <> new.id
    and be.status = 'active'
    and (be.effective_end_date is null or be.effective_end_date >= v_today);

  if v_occupied >= v_capacity then
    raise exception 'The batch is full (% of % places taken). Increase the batch capacity, or end or deactivate another enrollment, first.',
      v_occupied, v_capacity using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.batch_enrollments_capacity_guard() is
  'Refuses a write that makes an enrollment occupy a place (active, no end date or ending on or after the centre''s today) in a batch whose occupied places already reach its capacity. Writes that free a place, or keep one in the same batch, are never refused.';

revoke execute on function public.batch_enrollments_capacity_guard() from public, anon, authenticated;

drop trigger if exists batch_enrollments_capacity_guard_trigger on public.batch_enrollments;
create trigger batch_enrollments_capacity_guard_trigger
  before insert or update of status, batch_id, effective_end_date on public.batch_enrollments
  for each row
  execute function public.batch_enrollments_capacity_guard();


-- 3. A capacity cannot be set below the places occupied now ----------------------------------------------------------

-- BEFORE UPDATE: the batch row is already locked by this UPDATE while the guard counts, so no enrollment can take a place meanwhile.

create or replace function public.batches_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_occupied integer;
begin
  -- NULL (unlimited) and an unchanged value need no count. A value below 1 is left to batches_capacity_valid (this BEFORE trigger
  -- runs before the CHECK), so it is refused as an invalid capacity, not as "below the places taken".
  if new.capacity is null or new.capacity < 1 or new.capacity is not distinct from old.capacity then
    return new;
  end if;

  select count(*) into v_occupied
  from public.batch_enrollments be
  where be.batch_id = new.id
    and be.status = 'active'
    and (be.effective_end_date is null or be.effective_end_date >= v_today);

  if v_occupied > new.capacity then
    raise exception 'The capacity cannot be lowered to % because % places are taken. Set it to % or more, or end or deactivate enrollments first.',
      new.capacity, v_occupied, v_occupied using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.batches_capacity_guard() is
  'A batch''s capacity cannot be set below the number of enrollments occupying a place in it now. Raising or clearing it is never refused, and no enrollment is ever changed by it.';

revoke execute on function public.batches_capacity_guard() from public, anon, authenticated;

drop trigger if exists batches_capacity_guard_trigger on public.batches;
create trigger batches_capacity_guard_trigger
  before update of capacity on public.batches
  for each row
  execute function public.batches_capacity_guard();
