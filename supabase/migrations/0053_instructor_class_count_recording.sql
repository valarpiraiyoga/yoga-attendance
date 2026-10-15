-- Instructor recording of class-count attendance
--
-- WHY
--   Class Count Attendance (record a completed class against a class-count membership) was Admin only. An Instructor now records
--   it for the students that instructor is authorized for - the same students migration 0052 lets them see in Attendance History
--   (class_count_student_visible: a current active enrollment and assignment on a series they teach, or attendance on a session
--   they own). Reversing a record, editing an expiry, renewing and every other administrative function stay Admin only.
--
-- WHAT THIS MIGRATION DOES
--   1. record_class_count_attendance(membership, request, date) - re-created from 0045 with ONE change: the opening authorization.
--      An Admin is admitted as before; an active, linked Instructor only for a membership whose student is authorized for them;
--      everyone else, and an unknown membership, is refused (42501) the same way. Every later rule - the membership must be an
--      eligible class-count membership, the date window, no classes remaining, the lock on the membership, the replay of a repeated
--      request ID, the request/membership/date mismatch refusals - is untouched and applies to both roles. recorded_by remains
--      auth.uid(), so the audit trail names the Instructor.
--   2. list_class_count_eligible() - re-created from 0045 with the authorization widened the same way, the Instructor's list
--      limited to their own students, and the student's phone number returned to an Admin only (an Instructor gets NULL).
--
-- WHAT IT DOES NOT DO
--   * It does not change reverse_class_count_attendance, edit_class_count_expiry, the two-argument record_class_count_attendance
--     (still Admin only), any table, policy, trigger, grant of a table, session attendance, eligibility or a report.
--   * It does not give an Instructor access to the class-count tables, to a reversal reason, to memberships, or to students they
--     are not authorized for.
--   * It changes no row.
--
-- ORDER OF MIGRATIONS
--   Needs 0052 (class_count_student_visible) and 0045 (the functions it re-creates, class_count_net_used). Independent of 0050
--   (reserved for FS-8) and of 0051. If 0043 or 0045 is re-run afterwards, re-apply 0053: they would put the Admin-only definitions
--   back.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE, then the privileges are set again.

do $$
begin
  if to_regprocedure('public.class_count_student_visible(uuid)') is null then
    raise exception '0053 needs class_count_student_visible (migration 0052).';
  end if;
  if to_regprocedure('public.record_class_count_attendance(uuid, uuid, date)') is null
     or to_regprocedure('public.list_class_count_eligible()') is null
     or to_regprocedure('public.class_count_net_used(uuid)') is null then
    raise exception '0053 needs the class-count functions of migrations 0043 and 0045.';
  end if;
  if to_regprocedure('public.current_instructor_id()') is null then
    raise exception '0053 needs current_instructor_id (migration 0004).';
  end if;
end
$$;


-- 1. Recording one class, for a chosen date ------------------------------------------------------------------------------------
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
  -- Admin: any membership, as before. An active, linked Instructor: only a membership of a student that instructor is authorized
  -- for (class_count_student_visible, 0052). The membership is looked up here only to find its student, so an unknown membership
  -- and an unauthorized one are refused the same way (42501) and nothing is revealed about either. Everything after this check is
  -- the same for both roles.
  if not public.is_admin() then
    if public.current_instructor_id() is null
       or not public.class_count_student_visible((select m.student_id from public.memberships m where m.id = p_membership_id)) then
      raise exception 'Not authorized.' using errcode = '42501';
    end if;
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
  'Admin, or an active Instructor for a student they are authorized for (class_count_student_visible). Records ONE completed class for a class-count membership on the attendance date chosen: locks the membership; it must be a class-count membership that is eligible now (not cancelled, started, not expired, active student) with a class remaining (total minus the records not reversed); the date must not be in the future (centre timezone), before the membership starts or after it ends. A repeat of the same request ID records nothing and returns the original result. recorded_by is the caller.';

revoke execute on function public.record_class_count_attendance(uuid, uuid, date) from public, anon;
grant execute on function public.record_class_count_attendance(uuid, uuid, date) to authenticated;


-- 2. Who a class can be recorded for -------------------------------------------------------------------------------------------
-- Returns one row per eligible membership. An Instructor's rows are limited to their own students and carry no phone number.

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
  v_admin boolean;
begin
  v_admin := public.is_admin();
  if not v_admin and public.current_instructor_id() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  return query
  select
    m.id,
    m.membership_code,
    s.id,
    s.full_name,
    case when v_admin then s.phone end,
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
    and (v_admin or public.class_count_student_visible(s.id))
  order by s.full_name, m.start_date, m.id;
end;
$$;

comment on function public.list_class_count_eligible() is
  'The class-count memberships a class can be recorded for today (centre timezone): not cancelled, started, not expired when they have an end date, active student, at least one class remaining - with the classes used (records not reversed) and remaining. One row per membership. An Admin gets every membership and the phone number; an active Instructor only those of the students they are authorized for (class_count_student_visible) and no phone number; anyone else is refused (42501).';

revoke execute on function public.list_class_count_eligible() from public, anon;
grant execute on function public.list_class_count_eligible() to authenticated;
