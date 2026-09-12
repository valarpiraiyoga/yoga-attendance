-- Phase 17 — Reports: the shared session-fact function.
--
-- One set-based function serving all three approved reports (01-product.md
-- §10; wireframes p.35–37): Student Attendance, Batch Attendance and
-- Attendance Summary. Deliberately ONE function, not three — all three need
-- the same primitive ("completed sessions in a range, each with its
-- eligible/present/absent/unmarked counts"), and the Student report differs
-- only by also wanting one student's per-session status. Three functions
-- would be three places to change the counting rule.
--
-- Replaces an application-side read pattern that fetched every eligibility
-- row and every attendance mark in the range and aggregated them in
-- JavaScript. That cost one round trip per 150 sessions plus a payload that
-- grew with sessions x students, to produce a handful of integers — and in
-- the Student report's case it transferred the whole centre's rows to
-- report on one student. Database efficiency is a product requirement for
-- this application (it is intended to run affordably on Supabase Free), so
-- the aggregation belongs here, where the rows already are.
--
-- Additive only. This migration creates no table, no column, no index, no
-- policy and no grant beyond EXECUTE on the function itself. 0010–0015 are
-- applied and are not edited.

-- ============================================================================
-- A. report_session_facts
-- ============================================================================
-- SECURITY INVOKER, deliberately — unlike resolve_eligible_students and
-- save_session_attendance, which are SECURITY DEFINER because an instructor
-- has no SELECT policy on `students` and needs that indirection. This
-- function reads only tables the caller can already read, so running as the
-- caller keeps RLS as the ownership boundary with no privilege escalation:
-- an admin sees every session, and an instructor calling it would see only
-- their own (class_sessions_select_instructor / attendance_select_instructor
-- / class_session_eligible_students_select_instructor, 0014 + 0015). Reports
-- are Admin-only at the route (requireRole(ROLES.ADMIN)); this function does
-- not re-implement that gate, and does not need to.
--
-- STABLE: reads only, same result within a statement. SET search_path = '':
-- every object below is schema-qualified, matching every other function in
-- this schema.
--
-- HISTORICAL INTEGRITY (01-product.md §9, §12; Phase 16A). Eligibility comes
-- from the frozen snapshot in class_session_eligible_students and from
-- nowhere else for a snapshotted session. Nothing here reads
-- batch_enrollments, enrollment_schedules, memberships, or any current
-- student/batch status — recomputing a completed session's eligible set
-- from live state is exactly the defect 0015 corrected, and a report
-- aggregating over months of history is where that error would do the most
-- damage. The session's own batch_id/instructor_id/session_date/times are
-- themselves materialization snapshots (§7A), so filtering and display are
-- historical by construction too.
--
-- INTERNAL ALIASES: every CTE column below is given a name that cannot
-- collide with one of this function's RETURNS TABLE output columns
-- (class_session_id, session_date, batch_id, ...). In a SQL-language
-- function those output names are OUT parameters and are in scope inside
-- the body, so an unqualified reference to a same-named column is at best
-- confusing and at worst ambiguous. Hence sid/sdate/stime rather than
-- id/session_date/start_time.

create or replace function public.report_session_facts(
  p_date_from  date,
  p_date_to    date,
  p_batch_id   uuid default null,
  p_student_id uuid default null
)
returns table (
  class_session_id   uuid,
  session_date       date,
  start_time         time,
  end_time           time,
  batch_id           uuid,
  batch_name         text,
  batch_code         text,
  instructor_id      uuid,
  instructor_name    text,
  eligible_count     integer,
  present_count      integer,
  absent_count       integer,
  unmarked_count     integer,
  student_status     text,
  eligibility_source text
)
language sql
security invoker
stable
set search_path = ''
as $$
  with sessions as (
    -- Completed sessions only: cancelled/holiday never take attendance
    -- (01-product.md §8) and a still-projected occurrence has no row at all
    -- (§7A). Date bounds are INCLUSIVE at both ends, matching Attendance
    -- History's own .gte()/.lte() convention; a single-date Attendance
    -- Summary is simply p_date_from = p_date_to. session_date is a plain
    -- calendar date, so no timezone conversion applies.
    select cs.id                      as sid,
           cs.session_date            as sdate,
           cs.start_time              as stime,
           cs.end_time                as etime,
           cs.batch_id                as bid,
           cs.schedule_id             as schid,
           cs.instructor_id           as iid,
           cs.eligibility_snapshot_at as snap_at
    from public.class_sessions cs
    where cs.status = 'completed'
      and cs.session_date >= p_date_from
      and cs.session_date <= p_date_to
      and (p_batch_id is null or cs.batch_id = p_batch_id)
  ),
  eligible as (
    -- Snapshotted sessions: the frozen set, and ONLY the frozen set.
    select s.sid as e_sid, e.student_id as e_student
    from sessions s
    join public.class_session_eligible_students e on e.class_session_id = s.sid
    where s.snap_at is not null

    union all

    -- Unsnapshotted sessions: the approved live-resolution fallback, kept
    -- INSIDE this function so the application never issues a second request
    -- for it. This set is empty today and structurally cannot grow —
    -- save_session_attendance snapshots every session on the save that
    -- first completes it, and the reviewed Phase 16A backfill deliberately
    -- left only no-evidence sessions unsnapshotted. eligibility_source
    -- below reports per row which branch produced the count, so if it ever
    -- does grow that is visible rather than silent.
    --
    -- resolve_eligible_students is SECURITY DEFINER and authorizes the
    -- caller itself (is_admin() or can_access_session()); auth.uid() is a
    -- request GUC, not a role, so it still sees the original caller through
    -- this SECURITY INVOKER wrapper.
    select s.sid, r.student_id
    from sessions s
    cross join lateral public.resolve_eligible_students(s.bid, s.schid, s.sdate) r
    where s.snap_at is null
  ),
  eligible_agg as (
    select el.e_sid as ea_sid, count(*)::integer as ea_eligible
    from eligible el
    group by el.e_sid
  ),
  marks_agg as (
    -- Joined to `sessions` so only in-range sessions are scanned, using
    -- attendance_session_student_unique's leading column.
    select a.class_session_id                                       as ma_sid,
           count(*)::integer                                        as ma_marks,
           (count(*) filter (where a.status = 'present'))::integer   as ma_present,
           (count(*) filter (where a.status = 'absent'))::integer    as ma_absent
    from public.attendance a
    join sessions s on s.sid = a.class_session_id
    group by a.class_session_id
  )
  select
    s.sid,
    s.sdate,
    s.stime,
    s.etime,
    s.bid,
    b.name,
    b.code,
    s.iid,
    i.full_name,
    coalesce(ea.ea_eligible, 0),
    coalesce(ma.ma_present, 0),
    coalesce(ma.ma_absent, 0),
    -- Mirrors computeAttendanceSummary (lib/attendance/validation.js)
    -- exactly, so a report and Attendance Details never disagree about the
    -- same session: unmarked is eligible minus ALL marks, floored at zero.
    -- Floored rather than allowed negative for that function's own reason —
    -- a mark for a student outside the eligible set is evidence that must
    -- not be discarded, and must not push unmarked below zero either.
    greatest(0, coalesce(ea.ea_eligible, 0) - coalesce(ma.ma_marks, 0)),
    -- NULL unless a student was asked for. `sm` cannot match when
    -- p_student_id is null, because `sm.student_id = null` is never true.
    case when p_student_id is null then null
         else coalesce(sm.status, 'unmarked') end,
    case when s.snap_at is not null then 'snapshot' else 'live_fallback' end
  from sessions s
  left join eligible_agg ea on ea.ea_sid = s.sid
  left join marks_agg    ma on ma.ma_sid = s.sid
  left join public.batches     b on b.id = s.bid
  left join public.instructors i on i.id = s.iid
  -- At most one row per (session, student) — attendance_session_student_unique
  -- (0011) — so this join can never multiply a session's row.
  left join public.attendance sm
         on sm.class_session_id = s.sid
        and sm.student_id = p_student_id
  where
    p_student_id is null
    -- The student was in the session's historical eligible set...
    or exists (
      select 1 from eligible el
      where el.e_sid = s.sid and el.e_student = p_student_id
    )
    -- ...or holds a mark for it. An attendance row is proof the student
    -- passed eligibility at save time (Phase 16A: "attendance rows are the
    -- only proof"), so a session is never dropped from a student's report
    -- merely because the snapshot disagrees. Post-backfill this cannot
    -- differ; keeping it means a future inconsistency surfaces as a visible
    -- row rather than a silently missing one.
    or sm.id is not null
  order by s.sdate, s.stime;
$$;

comment on function public.report_session_facts(date, date, uuid, uuid) is
  'The shared session-fact core for all three Phase 17 reports (01-product.md §10). Returns exactly one row per completed class session in the inclusive date range, with its historical eligible count and recorded present/absent/unmarked counts. Optionally narrowed to one batch (p_batch_id) and/or projected for one student (p_student_id, which also populates student_status as present/absent/unmarked and restricts rows to sessions that student was eligible for or holds a mark for). Eligibility is read from the frozen class_session_eligible_students snapshot; only a session with no snapshot falls back to live resolution, reported per row as eligibility_source. SECURITY INVOKER: RLS remains the ownership boundary, and Reports are gated as Admin-only by the route, not here.';

grant execute on function public.report_session_facts(date, date, uuid, uuid) to authenticated;
