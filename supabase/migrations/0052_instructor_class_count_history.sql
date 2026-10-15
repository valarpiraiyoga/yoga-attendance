-- Instructor read access to class-count attendance history
--
-- WHY
--   Attendance History shows class-count records beside session attendance (Admin, since the visibility enhancement). The two
--   class-count tables are Admin-only under RLS (0043, 0045), and students, memberships and enrollments are Admin-only for an
--   Instructor (0014, principle 3: student data never becomes table-readable). So an Instructor can see none of it, and a table
--   policy alone could not show a student's name. This migration gives an Instructor a READ-ONLY, narrowly scoped window through
--   functions that authorize in SQL - the way resolve_eligible_students does for one owned session.
--
-- WHAT THIS MIGRATION DOES
--   1. class_count_student_visible(student)           - the one authorization rule (internal; no client may call it).
--   2. list_class_count_attendance_history(from, to, q, limit) - the records of a date range, for an Admin or an authorized
--      Instructor, each with its reversal STATUS; the free-text reversal reason and time are returned to an Admin only.
--   3. list_class_count_attendance_dates(from, to, limit)      - per-date counts for the calendar and Quick dates, same rule.
--
-- WHO MAY SEE WHICH STUDENT (class_count_student_visible)
--   * An Admin: every student.
--   * An Instructor (current_instructor_id(): linked AND active - a deactivated instructor loses access here, at the database):
--     a student who, today in the centre timezone, has
--       (a) an ACTIVE enrollment covering today, with a schedule assignment covering today, on a schedule series that has an
--           ACTIVE schedule version in effect today taught by this instructor; OR
--       (b) attendance recorded on any session this instructor owns (class_sessions.instructor_id - snapshot ownership wins, as in
--           can_access_session, 0014).
--     Nobody else. A reassigned session or schedule moves access with it, exactly as session access does.
--
-- WHAT AN INSTRUCTOR GETS (and does not)
--   The date, when it was recorded, the membership code and its current expiry (for the "Attendance after current expiry" flag),
--   the student's name and student code, and whether the record is Reversed. NOT returned to an Instructor: the reversal reason
--   (Admin free text), the reversal time, who recorded or reversed it, a phone number or email,
--   an amount, or anything about a student who is not theirs. An Admin additionally gets the reversal reason and time.
--
-- WHAT IT DOES NOT DO
--   * It adds no policy, grant, table or column, and changes no existing function or trigger. class_count_attendance and
--     class_count_attendance_reversals stay Admin-only: a direct Instructor SELECT still returns nothing.
--   * It does not change recording, reversal, eligibility or the Class Count Attendance route: record_class_count_attendance,
--     reverse_class_count_attendance and list_class_count_eligible stay Admin-only, untouched.
--   * It changes no row and no session, attendance, report or eligibility function.
--
-- ORDER OF MIGRATIONS
--   Needs 0014 (current_instructor_id is 0004, is_admin 0002), 0013 (enrollment assignments), 0024 (centre_timezone), 0043 and
--   0045 (the class-count tables). Independent of 0050 (reserved for FS-8) and of 0051.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE, then the privileges are set again.

do $$
begin
  if to_regclass('public.class_count_attendance') is null or to_regclass('public.class_count_attendance_reversals') is null then
    raise exception '0052 needs the class-count attendance tables (0043 and 0045).';
  end if;
  if to_regclass('public.enrollment_schedules') is null or to_regclass('public.class_sessions') is null
     or to_regclass('public.attendance') is null or to_regclass('public.schedules') is null then
    raise exception '0052 needs the schedule assignment (0013), class session and attendance tables.';
  end if;
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.current_instructor_id()') is null
     or to_regprocedure('public.centre_timezone()') is null then
    raise exception '0052 needs is_admin (0002), current_instructor_id (0004) and centre_timezone (0024).';
  end if;
end
$$;


-- 1. The one authorization rule ----------------------------------------------------------------------------------

create or replace function public.class_count_student_visible(p_student_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_instructor uuid;
  v_today      date;
begin
  if public.is_admin() then
    return true;
  end if;

  v_instructor := public.current_instructor_id();
  if v_instructor is null or p_student_id is null then
    return false;
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  return exists (
           -- (a) an active enrollment and a current assignment, on a series an active schedule version of this instructor covers today
           select 1
           from public.batch_enrollments be
           join public.enrollment_schedules es on es.batch_enrollment_id = be.id
           join public.schedules sc on sc.series_id = es.schedule_series_id
           where be.student_id = p_student_id
             and be.status = 'active'
             and be.effective_start_date <= v_today
             and (be.effective_end_date is null or be.effective_end_date >= v_today)
             and es.effective_start_date <= v_today
             and (es.effective_end_date is null or es.effective_end_date >= v_today)
             and sc.instructor_id = v_instructor
             and sc.status = 'active'
             and sc.effective_from <= v_today
             and (sc.effective_until is null or sc.effective_until >= v_today)
         )
      or exists (
           -- (b) attendance on a session this instructor owns
           select 1
           from public.attendance a
           join public.class_sessions cs on cs.id = a.class_session_id
           where a.student_id = p_student_id
             and cs.instructor_id = v_instructor
         );
end;
$$;

comment on function public.class_count_student_visible(uuid) is
  'Whether the caller may see a student''s class-count attendance: an Admin always; an active Instructor only for a student with a current active enrollment and assignment on a series they teach, or with attendance on a session they own; nobody else. Internal: not callable by clients.';

revoke execute on function public.class_count_student_visible(uuid) from public, anon, authenticated;


-- 2. The records of a date range ---------------------------------------------------------------------------------
-- Newest attendance date first, at most p_limit (capped at 500) with total_count the number in the range. p_q matches the student's
-- name or the membership code (a plain, case-insensitive substring: no wildcard characters are interpreted) and can only NARROW
-- what the caller may already see.

create or replace function public.list_class_count_attendance_history(
  p_from  date,
  p_to    date,
  p_q     text default null,
  p_limit integer default 500
)
returns table (
  attendance_id   uuid,
  attended_on     date,
  recorded_at     timestamptz,
  membership_code text,
  membership_end_date date,
  student_id      uuid,
  student_name    text,
  student_code    text,
  reversed        boolean,
  reversed_at     timestamptz,
  reversal_reason text,
  total_count     bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_admin boolean;
  v_term  text;
  v_limit integer;
begin
  v_admin := public.is_admin();
  if not v_admin and public.current_instructor_id() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Enter a valid date range.' using errcode = '22023';
  end if;

  v_term := lower(btrim(coalesce(p_q, '')));
  if length(v_term) > 100 then
    raise exception 'The search is too long.' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 500), 1), 500);

  return query
  select a.id,
         a.attended_on,
         a.created_at,
         m.membership_code,
         m.end_date,
         a.student_id,
         s.full_name,
         s.student_code,
         (r.id is not null),
         case when v_admin then r.reversed_at end,
         case when v_admin then r.reason end,
         count(*) over ()
  from public.class_count_attendance a
  join public.memberships m on m.id = a.membership_id
  join public.students s on s.id = a.student_id
  left join public.class_count_attendance_reversals r on r.attendance_id = a.id
  where a.attended_on between p_from and p_to
    and (v_admin or public.class_count_student_visible(a.student_id))
    and (v_term = ''
         or position(v_term in lower(s.full_name)) > 0
         or position(v_term in lower(m.membership_code)) > 0)
  order by a.attended_on desc, a.created_at desc
  limit v_limit;
end;
$$;

comment on function public.list_class_count_attendance_history(date, date, text, integer) is
  'Class-count attendance of a date range for Attendance History. An Admin sees every record with its reversal reason and time; an active Instructor sees only the records of students class_count_student_visible allows, each with its Reversed status but never the reason or time. The search narrows, never widens. Read-only.';

revoke execute on function public.list_class_count_attendance_history(date, date, text, integer) from public, anon;
grant execute on function public.list_class_count_attendance_history(date, date, text, integer) to authenticated;


-- 3. Per-date counts for the calendar and Quick dates ---------------------------------------------------------------
-- With a range: the count per date in it. Without one: the per-date counts of the most recent p_limit visible records (capped at 500).

create or replace function public.list_class_count_attendance_dates(
  p_from  date default null,
  p_to    date default null,
  p_limit integer default 200
)
returns table (
  attended_on  date,
  record_count bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_admin boolean;
  v_limit integer;
begin
  v_admin := public.is_admin();
  if not v_admin and public.current_instructor_id() is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if (p_from is null) <> (p_to is null) or (p_from is not null and p_from > p_to) then
    raise exception 'Enter a valid date range.' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);

  if p_from is not null then
    return query
    select a.attended_on, count(*)
    from public.class_count_attendance a
    where a.attended_on between p_from and p_to
      and (v_admin or public.class_count_student_visible(a.student_id))
    group by a.attended_on
    order by a.attended_on desc;
  else
    return query
    select recent.attended_on, count(*)
    from (
      select a.attended_on
      from public.class_count_attendance a
      where (v_admin or public.class_count_student_visible(a.student_id))
      order by a.attended_on desc, a.created_at desc
      limit v_limit
    ) recent
    group by recent.attended_on
    order by recent.attended_on desc;
  end if;
end;
$$;

comment on function public.list_class_count_attendance_dates(date, date, integer) is
  'Per-date counts of the class-count records the caller may see (Admin: all; active Instructor: class_count_student_visible only), for the Attendance History calendar and Quick dates. Dates and counts only. Read-only.';

revoke execute on function public.list_class_count_attendance_dates(date, date, integer) from public, anon;
grant execute on function public.list_class_count_attendance_dates(date, date, integer) to authenticated;
