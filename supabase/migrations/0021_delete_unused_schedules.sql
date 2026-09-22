-- Delete and directly correct a schedule that has not become part of the
-- historical record.
--
-- Until now schedules were never deleted (0009: "deactivation replaces
-- deletion") and an edit always versioned. That leaves no way to remove a
-- schedule created by mistake, or to correct its day. The approved rule
-- (01-product.md §7 "Deleting and correcting an unused schedule"):
--
--   A schedule is UNUSED when, together,
--     1. no class_sessions row references it (any status — attendance,
--        cancelled, holiday, edited, completed: a materialized session is
--        historical data and is never deleted, 01-product.md §7A),
--     2. its schedule series has exactly one schedule row (an edit that
--        versioned it would have added another; the version chain is
--        history), and
--     3. no enrollment_schedules assignment on the series has started —
--        i.e. every assignment starts today or later in the centre's
--        timezone (the same "unstarted" rule as 0020, which already lets an
--        unstarted assignment be withdrawn).
--
--   An unused schedule may be deleted (its unstarted assignments are
--   withdrawn with it) and may be corrected in place — day, time,
--   instructor, effective dates — without creating a new version. Anything
--   else keeps the existing versioning / Deactivate model.
--
-- WHY FUNCTIONS, NOT A DELETE GRANT. schedules, schedule_series and
-- class_sessions deliberately have no DELETE grant or policy, and this
-- migration does not add one. A policy could express "no session
-- references it", but the decision must also be atomic with the delete —
-- a session can be materialized (by an admin or an instructor) between a
-- check and the delete — and it must remove the series and the unstarted
-- assignments with the schedule. The two write functions below therefore
-- run as SECURITY DEFINER, admin-only (the same pattern as
-- save_session_attendance / materialize_class_session), and lock the
-- schedule and its series before re-checking:
--   * FOR UPDATE on the schedule row conflicts with the FOR KEY SHARE lock
--     that inserting a class_sessions row takes through its foreign key, so
--     a concurrent materialization either committed first (the re-check
--     then sees it and refuses) or waits until this transaction is done.
--   * FOR UPDATE on the series row does the same for a concurrent new
--     version or new assignment on the series.
-- The ON DELETE RESTRICT foreign keys (class_sessions.schedule_id,
-- enrollment_schedules.schedule_series_id, …) remain the last line of
-- defence: even a logic error here cannot delete a referenced row.
--
-- Additive. No existing migration is edited.

-- ============================================================================
-- A. schedule_usage — read-only facts about one schedule
-- ============================================================================
-- Returns the counts the rule and the confirmation dialog need, as JSON.
-- "Today" is the centre's calendar date (Asia/Kolkata), never the server's
-- UTC date, matching 0014/0020. `p_today` exists only so the boundary can be
-- exercised with a fixed date; every application call leaves it null, and
-- the two write functions below never accept it.
--
-- unrecorded_past_occurrence_count: how many dates before today the
-- schedule's weekday falls on inside its effective period and that have no
-- class_sessions row. They exist only as a projection (01-product.md §7A):
-- deleting the schedule removes them from the session lists.

create or replace function public.schedule_usage(
  p_schedule_id uuid,
  p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule            public.schedules%rowtype;
  v_today               date;
  v_session_count       integer;
  v_past_session_count  integer;
  v_version_count       integer;
  v_started             integer;
  v_unstarted           integer;
  v_students            integer;
  v_elapsed             integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_schedule
  from public.schedules
  where id = p_schedule_id;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  v_today := coalesce(p_today, (now() at time zone 'Asia/Kolkata')::date);

  select count(*) into v_version_count
  from public.schedules
  where series_id = v_schedule.series_id;

  -- Any version of the series, though a single-version series is the only
  -- one that can ever be deleted.
  select count(*), count(*) filter (where cs.session_date < v_today)
  into v_session_count, v_past_session_count
  from public.class_sessions cs
  join public.schedules s on s.id = cs.schedule_id
  where s.series_id = v_schedule.series_id;

  select
    count(*) filter (where es.effective_start_date <  v_today),
    count(*) filter (where es.effective_start_date >= v_today),
    count(distinct be.student_id) filter (where es.effective_start_date >= v_today)
  into v_started, v_unstarted, v_students
  from public.enrollment_schedules es
  join public.batch_enrollments be on be.id = es.batch_enrollment_id
  where es.schedule_series_id = v_schedule.series_id;

  -- timestamp (not timestamptz) so extract(dow) does not depend on the
  -- session time zone. An empty range (effective_from after yesterday)
  -- simply yields zero rows.
  select count(*) into v_elapsed
  from generate_series(
         v_schedule.effective_from::timestamp,
         least(coalesce(v_schedule.effective_until, v_today - 1), v_today - 1)::timestamp,
         interval '1 day'
       ) as g(d)
  where (array['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
          [extract(dow from g.d)::int + 1] = v_schedule.day_of_week;

  return jsonb_build_object(
    'schedule_id', v_schedule.id,
    'series_id', v_schedule.series_id,
    'batch_id', v_schedule.batch_id,
    'day_of_week', v_schedule.day_of_week,
    'start_time', v_schedule.start_time,
    'end_time', v_schedule.end_time,
    'session_count', v_session_count,
    'version_count', v_version_count,
    'started_assignment_count', v_started,
    'unstarted_assignment_count', v_unstarted,
    'affected_student_count', v_students,
    'unrecorded_past_occurrence_count', greatest(v_elapsed - v_past_session_count, 0),
    'today', v_today
  );
end;
$$;

comment on function public.schedule_usage(uuid, date) is
  'Read-only usage facts for one schedule: class session count, series version count, started / unstarted schedule assignments, students affected by unstarted assignments, and elapsed occurrences never recorded as sessions — all as of the centre''s (Asia/Kolkata) date. The rule that a schedule is unused (no sessions, one version, no started assignment) is enforced again, atomically, by delete_unused_schedule and correct_unused_schedule; this function only informs the UI. Admin only.';

-- ============================================================================
-- B. delete_unused_schedule
-- ============================================================================

create or replace function public.delete_unused_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule   public.schedules%rowtype;
  v_today      date;
  v_usage      jsonb;
  v_withdrawn  integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Lock the schedule, then its series (always in this order). From here to
  -- commit no session, version or assignment can be added to either.
  select * into v_schedule
  from public.schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.schedule_series
  where id = v_schedule.series_id
  for update;

  v_today := (now() at time zone 'Asia/Kolkata')::date;

  -- Re-check under the locks. Reasons are reported in DETAIL so the
  -- application can say which condition failed.
  v_usage := public.schedule_usage(p_schedule_id, v_today);

  if (v_usage ->> 'session_count')::int > 0 then
    raise exception 'This schedule has session history and cannot be deleted.'
      using errcode = '22023', detail = 'sessions';
  end if;

  if (v_usage ->> 'version_count')::int > 1 then
    raise exception 'This schedule has earlier versions and cannot be deleted.'
      using errcode = '22023', detail = 'versions';
  end if;

  if (v_usage ->> 'started_assignment_count')::int > 0 then
    raise exception 'Students have already been assigned to this schedule, so it cannot be deleted.'
      using errcode = '22023', detail = 'started_assignments';
  end if;

  -- Only assignments that have not started — the same predicate as
  -- enrollment_schedules_delete_unstarted_admin (0020). By the check above
  -- every remaining assignment is one of these.
  delete from public.enrollment_schedules
  where schedule_series_id = v_schedule.series_id
    and effective_start_date >= v_today;
  get diagnostics v_withdrawn = row_count;

  delete from public.schedules
  where id = p_schedule_id;

  -- The series is deleted only when nothing is left on it (it was the only
  -- version, so nothing is) — restrict foreign keys would refuse otherwise.
  delete from public.schedule_series ss
  where ss.id = v_schedule.series_id
    and not exists (select 1 from public.schedules s where s.series_id = ss.id);

  return jsonb_build_object(
    'success', true,
    'batch_id', v_schedule.batch_id,
    'withdrawn_assignments', v_withdrawn
  );
end;
$$;

comment on function public.delete_unused_schedule(uuid) is
  'Deletes a schedule that is not part of the historical record — no class_sessions row, a single-version series, no started schedule assignment — together with its unstarted assignments and its now-empty series. Locks the schedule and series and re-checks everything in the same transaction; raises 22023 (DETAIL = sessions | versions | started_assignments) when the schedule is not deletable. Admin only. The only way a schedule row is ever deleted.';

-- ============================================================================
-- C. correct_unused_schedule
-- ============================================================================
-- In-place correction of an unused schedule. Batch and series are never
-- changed. Same locks and the same re-check as the delete: a schedule that
-- gained a session, a version or a started assignment since the form was
-- opened is refused and must be edited through the versioned flow.

create or replace function public.correct_unused_schedule(
  p_schedule_id     uuid,
  p_day_of_week     text,
  p_instructor_id   uuid,
  p_start_time      time,
  p_end_time        time,
  p_effective_from  date,
  p_effective_until date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule  public.schedules%rowtype;
  v_today     date;
  v_usage     jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_schedule
  from public.schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.schedule_series
  where id = v_schedule.series_id
  for update;

  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_usage := public.schedule_usage(p_schedule_id, v_today);

  if (v_usage ->> 'session_count')::int > 0 then
    raise exception 'This schedule has session history and cannot be edited directly.'
      using errcode = '22023', detail = 'sessions';
  end if;

  if (v_usage ->> 'version_count')::int > 1 then
    raise exception 'This schedule has earlier versions and cannot be edited directly.'
      using errcode = '22023', detail = 'versions';
  end if;

  if (v_usage ->> 'started_assignment_count')::int > 0 then
    raise exception 'Students have already been assigned to this schedule, so it cannot be edited directly.'
      using errcode = '22023', detail = 'started_assignments';
  end if;

  -- Column CHECKs still apply: valid weekday, end after start, until not
  -- before from. Status is untouched (Deactivate is its own action).
  update public.schedules
  set day_of_week     = p_day_of_week,
      instructor_id   = p_instructor_id,
      start_time      = p_start_time,
      end_time        = p_end_time,
      effective_from  = p_effective_from,
      effective_until = p_effective_until,
      updated_at      = now()
  where id = p_schedule_id;

  return jsonb_build_object(
    'success', true,
    'id', v_schedule.id,
    'batch_id', v_schedule.batch_id
  );
end;
$$;

comment on function public.correct_unused_schedule(uuid, text, uuid, time, time, date, date) is
  'Updates day, instructor, times and effective dates of an unused schedule in place (no class_sessions row, a single-version series, no started schedule assignment) — no new version is created. Locks and re-checks in the same transaction; raises 22023 (DETAIL = sessions | versions | started_assignments) otherwise. Admin only.';

-- ============================================================================
-- D. Privileges
-- ============================================================================
-- Execute for signed-in users only (each function also refuses anyone who is
-- not an admin). No table-level DELETE is granted to anyone.

revoke execute on function public.schedule_usage(uuid, date) from public, anon;
revoke execute on function public.delete_unused_schedule(uuid) from public, anon;
revoke execute on function public.correct_unused_schedule(uuid, text, uuid, time, time, date, date) from public, anon;

grant execute on function public.schedule_usage(uuid, date) to authenticated;
grant execute on function public.delete_unused_schedule(uuid) to authenticated;
grant execute on function public.correct_unused_schedule(uuid, text, uuid, time, time, date, date) to authenticated;
