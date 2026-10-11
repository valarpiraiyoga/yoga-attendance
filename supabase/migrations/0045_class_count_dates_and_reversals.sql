-- =============================================================================
-- V1 Class Count Attendance: attendance dates and reversals
-- Migration 0045
--
-- ADDITIVE on 0042-0044. Two things, both Admin only:
--
--   1. ATTENDANCE DATE. A class is recorded for the day it was actually held, chosen by the Admin
--      (record_class_count_attendance, now with a date). The database enforces the approved rules:
--        * the membership must be eligible NOW - a class-count membership that is not cancelled, has started and has not
--          expired today, of an active student, with a class left; a cancelled membership never takes a new record;
--        * the date is not in the future (centre timezone), not before the membership's start date and, when the
--          membership has an end date, not after it.
--      The two-argument function stays as a thin wrapper that records for today at the centre.
--
--   2. REVERSALS. A record made by mistake is reversed, never edited or deleted. A new append-only table,
--      class_count_attendance_reversals, holds one row per reversed record: who, when and why (a trimmed reason of 3 to
--      500 characters), plus a request ID that makes a retry safe. The original record is not touched. A record can be
--      reversed once. Reversal is allowed whatever the membership's status - after expiry or cancellation too - because it
--      corrects an existing record.
--
--   Remaining classes are NET: total_classes minus the recorded classes that have not been reversed. One helper,
--   class_count_net_used(), says so, and every count that decides a balance now uses it: the record function, the insert
--   guard, list_class_count_eligible() and the class-total floor of the memberships guard (0044). That floor now compares
--   with the NET count; the freeze of a membership's kind and student still applies once ANY record exists, reversed or not.
--   A reversed class can be recorded again - as a new record, with a new request ID.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not INSERT, UPDATE or DELETE any existing row, and edits no earlier migration. Existing records are all
--     un-reversed, so every existing balance is exactly what it was.
--   * Session attendance (attendance, save_session_attendance, resolve_eligible_students) is not touched.
-- Safe to run again.
-- =============================================================================


-- 1. Reversals: append-only ---------------------------------------------------------------------------------------------

create table if not exists public.class_count_attendance_reversals (
  id             uuid primary key default gen_random_uuid(),
  attendance_id  uuid not null references public.class_count_attendance (id) on delete restrict,
  reason         text not null,
  reversed_by    uuid references auth.users (id) on delete set null,
  reversed_at    timestamptz not null default now(),
  -- Supplied by the caller once per reversal. A second call with the same ID is a retry, never a second reversal.
  request_id     uuid not null,

  constraint class_count_attendance_reversals_attendance_key unique (attendance_id),
  constraint class_count_attendance_reversals_request_id_key unique (request_id),
  -- Trimmed means no leading or trailing whitespace of any kind (spaces, tabs, newlines): a reason of only whitespace is
  -- therefore refused too, whatever its length.
  constraint class_count_attendance_reversals_reason_valid check (reason = regexp_replace(reason, '^\s+|\s+$', '', 'g') and length(reason) between 3 and 500)
);

comment on table public.class_count_attendance_reversals is
  'One row per reversed class-count attendance record: who reversed it, when and why. Append-only history: never updated or deleted. A record has at most one reversal. A membership''s remaining classes are its total minus the records that have no row here.';

comment on column public.class_count_attendance_reversals.reason is
  'Why the record was reversed: trimmed, 3 to 500 characters.';

comment on column public.class_count_attendance_reversals.request_id is
  'Unique per reversal request. A retry of the same request reverses nothing again.';

alter table public.class_count_attendance_reversals enable row level security;

revoke all on public.class_count_attendance_reversals from public, anon, authenticated;
grant select on public.class_count_attendance_reversals to authenticated;

drop policy if exists "class_count_attendance_reversals_select_admin" on public.class_count_attendance_reversals;
create policy "class_count_attendance_reversals_select_admin"
  on public.class_count_attendance_reversals
  for select
  to authenticated
  using (public.is_admin());

-- Read-only even for the owner, like the attendance history itself. The one change allowed: clearing reversed_by (what
-- ON DELETE SET NULL does when that user account is deleted), with every other column exactly as it was.
create or replace function public.class_count_attendance_reversals_readonly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.reversed_by is not null and new.reversed_by is null
       and (new.id, new.attendance_id, new.reason, new.reversed_at, new.request_id)
           is not distinct from (old.id, old.attendance_id, old.reason, old.reversed_at, old.request_id) then
      return new;
    end if;
  end if;

  raise exception 'Class count attendance reversals cannot be changed or deleted.' using errcode = '55006';
end;
$$;

comment on function public.class_count_attendance_reversals_readonly() is
  'Refuses every update, delete and truncate of class_count_attendance_reversals: its rows are history. The only change allowed is clearing reversed_by when its user account is deleted.';

revoke execute on function public.class_count_attendance_reversals_readonly() from public, anon, authenticated;

drop trigger if exists class_count_attendance_reversals_readonly_trigger on public.class_count_attendance_reversals;
create trigger class_count_attendance_reversals_readonly_trigger
  before update or delete on public.class_count_attendance_reversals
  for each row
  execute function public.class_count_attendance_reversals_readonly();

drop trigger if exists class_count_attendance_reversals_readonly_truncate_trigger on public.class_count_attendance_reversals;
create trigger class_count_attendance_reversals_readonly_truncate_trigger
  before truncate on public.class_count_attendance_reversals
  for each statement
  execute function public.class_count_attendance_reversals_readonly();


-- 2. Net classes used ---------------------------------------------------------------------------------------------------
-- The one definition of "used": the recorded classes of a membership that have not been reversed. Volatile on purpose
-- (no STABLE), so each call reads what is committed at that moment - after the caller has locked the membership.

create or replace function public.class_count_net_used(p_membership_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.class_count_attendance a
  where a.membership_id = p_membership_id
    and not exists (
      select 1
      from public.class_count_attendance_reversals r
      where r.attendance_id = a.id
    );
$$;

comment on function public.class_count_net_used(uuid) is
  'The classes used by a class-count membership: its recorded attendance records that have not been reversed. Remaining classes = total_classes minus this.';

revoke execute on function public.class_count_net_used(uuid) from public, anon, authenticated;


-- 3. The insert guard counts net classes -----------------------------------------------------------------------------------
-- 0043's guard, with the count replaced by the net count.

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

  v_used := public.class_count_net_used(new.membership_id);

  if v_used >= v_mem.total_classes then
    raise exception 'No classes remain on this membership.' using errcode = '55000';
  end if;

  return new;
end;
$$;

comment on function public.class_count_attendance_guard() is
  'Before every insert into class_count_attendance: locks the membership and refuses a row unless it is the student''s class-count membership with a class remaining (total minus the records not reversed). Remaining classes can never go below zero.';


-- 4. Recording one class, for a chosen date ---------------------------------------------------------------------------------
-- Returns jsonb: attendance_id, membership_id, student_id, attended_on, total_classes, classes_used, classes_remaining and
-- replayed (true when this request ID had already been recorded).

create or replace function public.record_class_count_attendance(
  p_membership_id uuid,
  p_request_id    uuid,
  p_attended_on   date
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

  if p_membership_id is null or p_request_id is null or p_attended_on is null then
    raise exception 'A membership, a request ID and an attendance date are required.' using errcode = '22023';
  end if;

  -- The membership row first: every recording and reversal for it waits here, so the balance below cannot change under us.
  select * into v_mem
  from public.memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  -- A retry: this request was already recorded. Nothing is recorded again, and it is answered with the original result -
  -- even if the membership has used its last class or expired since, or the record has been reversed since (its request ID
  -- is spent: recording the class again takes a new one). The same request with a different date is refused, not answered
  -- with the date it was first used for.
  select * into v_existing
  from public.class_count_attendance
  where request_id = p_request_id;

  if found then
    if v_existing.membership_id <> p_membership_id then
      raise exception 'This request ID has already been used for another membership.' using errcode = '23505';
    end if;

    if v_existing.attended_on <> p_attended_on then
      raise exception 'This request ID has already been used with a different attendance date.' using errcode = '23505';
    end if;

    v_used := public.class_count_net_used(p_membership_id);

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

  -- The membership must be eligible now.
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

  -- The attendance date: not in the future at the centre, not before the membership starts, not after it ends.
  if p_attended_on > v_today then
    raise exception 'The attendance date cannot be in the future.' using errcode = '22023';
  end if;

  if p_attended_on < v_mem.start_date then
    raise exception 'The attendance date cannot be before the membership starts.' using errcode = '22023';
  end if;

  if v_mem.end_date is not null and p_attended_on > v_mem.end_date then
    raise exception 'The attendance date cannot be after the membership ends.' using errcode = '22023';
  end if;

  v_used := public.class_count_net_used(p_membership_id);

  if v_used >= v_mem.total_classes then
    raise exception 'No classes remain on this membership.' using errcode = '55000';
  end if;

  insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id, recorded_by)
  values (p_membership_id, v_mem.student_id, p_attended_on, p_request_id, auth.uid())
  returning id into v_id;

  return jsonb_build_object(
    'attendance_id', v_id,
    'membership_id', p_membership_id,
    'student_id', v_mem.student_id,
    'attended_on', p_attended_on,
    'total_classes', v_mem.total_classes,
    'classes_used', v_used + 1,
    'classes_remaining', v_mem.total_classes - v_used - 1,
    'replayed', false
  );
end;
$$;

comment on function public.record_class_count_attendance(uuid, uuid, date) is
  'Admin only. Records ONE completed class for a class-count membership on the attendance date the Admin chose: locks the membership; it must be a class-count membership that is eligible now (not cancelled, started, not expired, active student) with a class remaining (total minus the records not reversed); the date must not be in the future (centre timezone), before the membership starts or after it ends. A repeat of the same request ID records nothing and returns the original result.';

revoke execute on function public.record_class_count_attendance(uuid, uuid, date) from public, anon;
grant execute on function public.record_class_count_attendance(uuid, uuid, date) to authenticated;

-- The two-argument form of 0043: records for today at the centre. Kept so existing callers and scripts work.
create or replace function public.record_class_count_attendance(
  p_membership_id uuid,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The checks the two-argument function always made, in its order and with its messages, so a caller of this form sees
  -- exactly what it saw before the date existed; a valid call is then handed to the date-aware function.
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_membership_id is null or p_request_id is null then
    raise exception 'A membership and a request ID are required.' using errcode = '22023';
  end if;

  return public.record_class_count_attendance(
    p_membership_id,
    p_request_id,
    (now() at time zone public.centre_timezone())::date
  );
end;
$$;

comment on function public.record_class_count_attendance(uuid, uuid) is
  'Admin only. Records one class for today at the centre: record_class_count_attendance(membership, request, today). The screen passes the date the Admin chose to the three-argument form.';

revoke execute on function public.record_class_count_attendance(uuid, uuid) from public, anon;
grant execute on function public.record_class_count_attendance(uuid, uuid) to authenticated;


-- 5. Reversing a record -------------------------------------------------------------------------------------------------------
-- Returns jsonb: reversal_id, attendance_id, membership_id, student_id, attended_on, total_classes, classes_used,
-- classes_remaining and replayed (true when this request ID had already reversed this record).

create or replace function public.reverse_class_count_attendance(
  p_attendance_id uuid,
  p_reason        text,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att      public.class_count_attendance%rowtype;
  v_mem      public.memberships%rowtype;
  v_existing public.class_count_attendance_reversals%rowtype;
  v_reason   text;
  v_used     integer;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_attendance_id is null or p_request_id is null then
    raise exception 'An attendance record and a request ID are required.' using errcode = '22023';
  end if;

  -- Trimmed of all leading and trailing whitespace (spaces, tabs, newlines), the same rule as the table's check, so a reason
  -- of only whitespace is refused here with the clear message instead of reaching the table.
  v_reason := regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g');
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';
  end if;

  select * into v_att
  from public.class_count_attendance
  where id = p_attendance_id;

  if not found then
    raise exception 'Attendance record not found.' using errcode = 'P0002';
  end if;

  -- The membership row first, the order recording takes too, so a reversal and a recording of the same membership
  -- never read a balance the other is changing. No check of the membership's status: a reversal corrects a record
  -- that exists, so it is allowed after the membership has expired or been cancelled.
  select * into v_mem
  from public.memberships
  where id = v_att.membership_id
  for update;

  -- A retry: this request already reversed a record. Nothing is reversed again.
  select * into v_existing
  from public.class_count_attendance_reversals
  where request_id = p_request_id;

  if found then
    if v_existing.attendance_id <> p_attendance_id then
      raise exception 'This request ID has already been used for another attendance record.' using errcode = '23505';
    end if;

    v_used := public.class_count_net_used(v_att.membership_id);

    return jsonb_build_object(
      'reversal_id', v_existing.id,
      'attendance_id', v_att.id,
      'membership_id', v_att.membership_id,
      'student_id', v_att.student_id,
      'attended_on', v_att.attended_on,
      'total_classes', v_mem.total_classes,
      'classes_used', v_used,
      'classes_remaining', v_mem.total_classes - v_used,
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from public.class_count_attendance_reversals r
    where r.attendance_id = p_attendance_id
  ) then
    raise exception 'This class has already been reversed.' using errcode = '55000';
  end if;

  insert into public.class_count_attendance_reversals (attendance_id, reason, reversed_by, request_id)
  values (p_attendance_id, v_reason, auth.uid(), p_request_id)
  returning id into v_id;

  v_used := public.class_count_net_used(v_att.membership_id);

  return jsonb_build_object(
    'reversal_id', v_id,
    'attendance_id', v_att.id,
    'membership_id', v_att.membership_id,
    'student_id', v_att.student_id,
    'attended_on', v_att.attended_on,
    'total_classes', v_mem.total_classes,
    'classes_used', v_used,
    'classes_remaining', v_mem.total_classes - v_used,
    'replayed', false
  );
end;
$$;

comment on function public.reverse_class_count_attendance(uuid, text, uuid) is
  'Admin only. Reverses ONE class-count attendance record, with a required reason (trimmed, 3 to 500 characters): the original record is untouched and a reversal row keeps who, when and why. One class is restored to the membership. A record is reversed once; a repeat of the same request returns the original reversal. Allowed whatever the membership''s status.';

revoke execute on function public.reverse_class_count_attendance(uuid, text, uuid) from public, anon;
grant execute on function public.reverse_class_count_attendance(uuid, text, uuid) to authenticated;


-- 6. Who a class can be recorded for: net classes ---------------------------------------------------------------------------
-- 0043's list, with the used count replaced by the net count.

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
      and not exists (
        select 1
        from public.class_count_attendance_reversals r
        where r.attendance_id = a.id
      )
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
  'Admin only. The class-count memberships a class can be recorded for today (centre timezone): not cancelled, started, not expired when they have an end date, active student, at least one class remaining - with the classes used (records not reversed) and remaining. One row per membership.';


-- 7. The memberships guard: net floor, history freeze --------------------------------------------------------------------------
-- 0044's guard. Once ANY record exists - reversed or not - the membership's kind and student cannot change. The class
-- total cannot go below the NET classes used (records not reversed), so a reversed class does not hold the total up.

create or replace function public.memberships_class_count_history_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_history integer;
  v_used    integer;
begin
  select count(*) into v_history
  from public.class_count_attendance
  where membership_id = old.id;

  if v_history = 0 then
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception 'The type of a membership with recorded classes cannot be changed.' using errcode = '55006';
  end if;

  if new.student_id is distinct from old.student_id then
    raise exception 'The student of a membership with recorded classes cannot be changed.' using errcode = '55006';
  end if;

  v_used := public.class_count_net_used(old.id);

  if new.total_classes is distinct from old.total_classes
     and (new.total_classes is null or new.total_classes < v_used) then
    raise exception 'The class total cannot be less than the classes already recorded.' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.memberships_class_count_history_guard() is
  'Before an update of a membership''s kind, student or class total: once any class has been recorded against it (reversed or not), its kind and student cannot change; its class total cannot go below the classes used, counting only records that have not been reversed.';
