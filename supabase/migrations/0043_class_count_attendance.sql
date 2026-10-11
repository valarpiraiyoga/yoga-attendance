-- =============================================================================
-- V1 Class Count Attendance: recording and history (Phase 2)
-- Migration 0043
--
-- ADDITIVE. Builds on 0042 (class-count memberships). It adds the table that records each completed class of a
-- class-count membership, the one function that writes it, and the list of students a class can be recorded for.
-- Session attendance (the attendance table, save_session_attendance, resolve_eligible_students) is not touched:
-- a class-count membership is still never used there.
--
-- WHAT IT ADDS
--   1. class_count_attendance - one row per recorded class: the membership and student, the day (in the centre's
--      time zone), a unique request ID, who recorded it and when. Rows are history: the table has no update or
--      delete access for any client role, and triggers refuse an update, a delete or a truncate even by the owner.
--      The one exception is the database's own clearing of recorded_by when that user account is deleted (the same
--      ON DELETE SET NULL the other audit tables use): it changes nothing else about the row.
--      There is NO stored counter. A membership's remaining classes are always total_classes minus its rows here,
--      so they cannot drift and cannot be edited by hand.
--   2. record_class_count_attendance(membership, request ID) - Admin only. Locks the membership row, so two
--      concurrent recordings cannot both take the last class, then checks the membership and records ONE class.
--      A retry with the same request ID records nothing again and returns the original result. Separate classes on
--      the same day are separate requests and are all recorded.
--   3. list_class_count_eligible() - Admin only. The class-count memberships that can have a class recorded today,
--      with the student and the classes used and remaining.
--   4. A guard trigger on the table: whoever inserts a row (this function, or anything else), the membership must be
--      a class-count membership of that student with at least one class remaining. Remaining classes can never go
--      below zero, even if the function were bypassed.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not INSERT, UPDATE or DELETE any existing row, and does not alter memberships, invoices, attendance,
--     class sessions or any existing function. It edits no earlier migration.
--   * No screen, form, renewal, document wording or correction/undo of a recorded class (later phases / undecided).
--   * No instructor access: the initial implementation is Admin only.
-- Safe to run again.
-- =============================================================================


-- 1. The history table ------------------------------------------------------------------------------------------

create table if not exists public.class_count_attendance (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references public.memberships (id) on delete restrict,
  student_id     uuid not null references public.students (id) on delete restrict,
  -- The centre's calendar day the class was recorded on (centre timezone, not the server's UTC date).
  attended_on    date not null,
  -- Supplied by the caller once per click. A second call with the same ID is a retry, never a second class.
  request_id     uuid not null,
  recorded_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint class_count_attendance_request_id_key unique (request_id)
);

comment on table public.class_count_attendance is
  'One row per completed class recorded against a class-count membership. History: never updated or deleted. A membership''s remaining classes are memberships.total_classes minus its rows here - there is no stored counter. Written only by record_class_count_attendance().';

comment on column public.class_count_attendance.request_id is
  'Unique per recording request. A retry of the same request records nothing again.';

comment on column public.class_count_attendance.attended_on is
  'The centre-timezone calendar date on which the class was recorded.';

create index if not exists class_count_attendance_membership_id_idx
  on public.class_count_attendance (membership_id);

create index if not exists class_count_attendance_student_id_idx
  on public.class_count_attendance (student_id);

-- Access: Admin may read; nobody has insert, update or delete through the API. The function below runs as the
-- table's owner, which is the only writer.
alter table public.class_count_attendance enable row level security;

revoke all on public.class_count_attendance from public, anon, authenticated;
grant select on public.class_count_attendance to authenticated;

drop policy if exists "class_count_attendance_select_admin" on public.class_count_attendance;
create policy "class_count_attendance_select_admin"
  on public.class_count_attendance
  for select
  to authenticated
  using (public.is_admin());


-- 2. The history is read-only, even for the owner --------------------------------------------------------------

create or replace function public.class_count_attendance_readonly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The one change allowed: clearing recorded_by (what ON DELETE SET NULL does when that user is deleted), with
  -- every other column exactly as it was. OLD and NEW exist only for row triggers, hence the nested IFs.
  if tg_op = 'UPDATE' then
    if old.recorded_by is not null and new.recorded_by is null
       and (new.id, new.membership_id, new.student_id, new.attended_on, new.request_id, new.created_at)
           is not distinct from (old.id, old.membership_id, old.student_id, old.attended_on, old.request_id, old.created_at) then
      return new;
    end if;
  end if;

  raise exception 'Class count attendance history cannot be changed or deleted.' using errcode = '55006';
end;
$$;

comment on function public.class_count_attendance_readonly() is
  'Refuses every update, delete and truncate of class_count_attendance: its rows are history. The only change allowed is clearing recorded_by when its user account is deleted.';

revoke execute on function public.class_count_attendance_readonly() from public, anon, authenticated;

drop trigger if exists class_count_attendance_readonly_trigger on public.class_count_attendance;
create trigger class_count_attendance_readonly_trigger
  before update or delete on public.class_count_attendance
  for each row
  execute function public.class_count_attendance_readonly();

drop trigger if exists class_count_attendance_readonly_truncate_trigger on public.class_count_attendance;
create trigger class_count_attendance_readonly_truncate_trigger
  before truncate on public.class_count_attendance
  for each statement
  execute function public.class_count_attendance_readonly();


-- 3. The balance guard -------------------------------------------------------------------------------------------
-- Whoever inserts a row: the membership is locked, it must be the student's class-count membership, and a class
-- must remain. This is the last line of defence; record_class_count_attendance() checks first, with clear messages.

create or replace function public.class_count_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem  public.memberships%rowtype;
  v_used integer;
begin
  select * into v_mem
  from public.memberships
  where id = new.membership_id
  for update;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  if v_mem.kind is distinct from 'class_count' then
    raise exception 'Only a class-count membership can record class attendance.' using errcode = '22023';
  end if;

  if v_mem.student_id is distinct from new.student_id then
    raise exception 'The student is not the student of this membership.' using errcode = '22023';
  end if;

  select count(*) into v_used
  from public.class_count_attendance
  where membership_id = new.membership_id;

  if v_used >= v_mem.total_classes then
    raise exception 'No classes remain on this membership.' using errcode = '55000';
  end if;

  return new;
end;
$$;

comment on function public.class_count_attendance_guard() is
  'Before every insert into class_count_attendance: locks the membership and refuses a row unless it is the student''s class-count membership with a class remaining. Remaining classes can never go below zero.';

revoke execute on function public.class_count_attendance_guard() from public, anon, authenticated;

drop trigger if exists class_count_attendance_guard_trigger on public.class_count_attendance;
create trigger class_count_attendance_guard_trigger
  before insert on public.class_count_attendance
  for each row
  execute function public.class_count_attendance_guard();


-- 4. Recording one class ---------------------------------------------------------------------------------------------
-- Returns jsonb: attendance_id, membership_id, student_id, attended_on, total_classes, classes_used,
-- classes_remaining and replayed (true when this request ID had already been recorded).

create or replace function public.record_class_count_attendance(
  p_membership_id uuid,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem      public.memberships%rowtype;
  v_existing public.class_count_attendance%rowtype;
  v_status   text;
  v_today    date;
  v_used     integer;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_membership_id is null or p_request_id is null then
    raise exception 'A membership and a request ID are required.' using errcode = '22023';
  end if;

  -- The membership row first: every recording for it waits here, so the balance below cannot change under us.
  select * into v_mem
  from public.memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  -- A retry: this request was already recorded. Nothing is recorded again, and it is answered with the original
  -- result - even if the membership has used its last class or expired since.
  select * into v_existing
  from public.class_count_attendance
  where request_id = p_request_id;

  if found then
    if v_existing.membership_id <> p_membership_id then
      raise exception 'This request ID has already been used for another membership.' using errcode = '23505';
    end if;

    select count(*) into v_used
    from public.class_count_attendance
    where membership_id = p_membership_id;

    return jsonb_build_object(
      'attendance_id', v_existing.id,
      'membership_id', v_existing.membership_id,
      'student_id', v_existing.student_id,
      'attended_on', v_existing.attended_on,
      'total_classes', v_mem.total_classes,
      'classes_used', v_used,
      'classes_remaining', v_mem.total_classes - v_used,
      'replayed', true
    );
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  if v_mem.kind is distinct from 'class_count' then
    raise exception 'Only a class-count membership can record class attendance.' using errcode = '22023';
  end if;

  if v_mem.cancelled_at is not null then
    raise exception 'This membership is cancelled.' using errcode = '55000';
  end if;

  if v_mem.start_date > v_today then
    raise exception 'This membership has not started yet.' using errcode = '55000';
  end if;

  if v_mem.end_date is not null and v_mem.end_date < v_today then
    raise exception 'This membership has expired.' using errcode = '55000';
  end if;

  select s.status into v_status
  from public.students s
  where s.id = v_mem.student_id;

  if v_status is distinct from 'active' then
    raise exception 'The student is not active.' using errcode = '55000';
  end if;

  select count(*) into v_used
  from public.class_count_attendance
  where membership_id = p_membership_id;

  if v_used >= v_mem.total_classes then
    raise exception 'No classes remain on this membership.' using errcode = '55000';
  end if;

  insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id, recorded_by)
  values (p_membership_id, v_mem.student_id, v_today, p_request_id, auth.uid())
  returning id into v_id;

  return jsonb_build_object(
    'attendance_id', v_id,
    'membership_id', p_membership_id,
    'student_id', v_mem.student_id,
    'attended_on', v_today,
    'total_classes', v_mem.total_classes,
    'classes_used', v_used + 1,
    'classes_remaining', v_mem.total_classes - v_used - 1,
    'replayed', false
  );
end;
$$;

comment on function public.record_class_count_attendance(uuid, uuid) is
  'Admin only. Records ONE completed class for a class-count membership: locks the membership, checks it is a class-count membership, not cancelled, started, not expired (when it has an end date), the student is active and a class remains, then inserts one history row. A repeat of the same request ID records nothing and returns the original result. Remaining classes = total_classes minus recorded rows; never below zero.';

revoke execute on function public.record_class_count_attendance(uuid, uuid) from public, anon;
grant execute on function public.record_class_count_attendance(uuid, uuid) to authenticated;


-- 5. Who a class can be recorded for -----------------------------------------------------------------------------------

create or replace function public.list_class_count_eligible()
returns table (
  membership_id     uuid,
  membership_code   text,
  student_id        uuid,
  full_name         text,
  phone             text,
  student_code      text,
  start_date        date,
  end_date          date,
  total_classes     integer,
  classes_used      integer,
  classes_remaining integer
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_today date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  return query
  select
    m.id,
    m.membership_code,
    s.id,
    s.full_name,
    s.phone,
    s.student_code,
    m.start_date,
    m.end_date,
    m.total_classes,
    u.used,
    m.total_classes - u.used
  from public.memberships m
  join public.students s on s.id = m.student_id
  cross join lateral (
    select count(*)::integer as used
    from public.class_count_attendance a
    where a.membership_id = m.id
  ) u
  where m.kind = 'class_count'
    and m.cancelled_at is null
    and s.status = 'active'
    and m.start_date <= v_today
    and (m.end_date is null or m.end_date >= v_today)
    and m.total_classes - u.used > 0
  order by s.full_name, m.start_date, m.id;
end;
$$;

comment on function public.list_class_count_eligible() is
  'Admin only. The class-count memberships a class can be recorded for today (centre timezone): not cancelled, started, not expired when they have an end date, active student, at least one class remaining - with the classes used and remaining. One row per membership.';

revoke execute on function public.list_class_count_eligible() from public, anon;
grant execute on function public.list_class_count_eligible() to authenticated;
