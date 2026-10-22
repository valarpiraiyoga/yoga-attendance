-- Safe schedule version deletion: the latest version of a schedule can be deleted when it has no class session of its own
--
-- WHY
--   delete_unused_schedule (0021, 0024) refused any schedule whose series had more than one version, and counted class sessions across the
--   whole series. A version created by mistake, or a deactivated one, could therefore never be removed once the class had been edited
--   before, although nothing protected by history depended on it. What really protects history is narrower:
--     * a class session on THIS version row (class_sessions.schedule_id is ON DELETE RESTRICT; attendance hangs off the session), and
--     * a student assignment that has started, when deleting would remove the series' LAST version (assignments belong to the series).
--   A version in the middle of the chain is different again: removing it would leave a gap in the series.
--
-- WHAT THIS MIGRATION DOES
--   Replaces public.delete_unused_schedule(uuid) (CREATE OR REPLACE: same signature, same SECURITY DEFINER / search_path / grants, the same
--   42501 / P0002 / 22023 errors with a reason in DETAIL, the same lock order). Under the locks it takes, in this order:
--     1. 'sessions'      - a class session references THIS schedule row (of any status). Other versions' sessions do not matter.
--     2. 'later_version' - another version of the series is LATER (by effective_from, then created_at, then id). Only the latest version can
--                          be deleted; an earlier or middle one would leave a gap in the chain. New reason value.
--     3. If other versions remain (this is the latest of several): ONLY this row is deleted. The series, its capacity and every student
--        assignment are untouched - the series continues - and nothing is withdrawn. Started assignments do not matter here.
--     4. If this is the series' ONLY version: as before - 'started_assignments' when an assignment on the series has started (the centre's
--        date); otherwise the unstarted assignments are withdrawn, the row is deleted and the then-empty series is deleted.
--   Status plays no part: an inactive schedule follows the same rules as an active one.
--   The result gains two keys: {success, batch_id, withdrawn_assignments, series_deleted, versions_remaining}.
--
-- WHAT IT DOES NOT DO
--   * It changes no table, column, constraint, policy, trigger or grant, and no other function: schedule_usage and correct_unused_schedule
--     (Direct Edit keeps its stricter "unused" test: one version, no session on the series, no started assignment), Activate, Deactivate
--     and the instructor-conflict trigger (0062, which fires on insert and update, never on delete) are untouched.
--   * It never reopens or edits the previous version: deleting the latest version leaves the previous one with the end date it already
--     had, so the class does not continue past that date. The application tells the Admin this before confirming.
--   * It creates, cancels and alters no class session.
--
-- CONCURRENCY (READ COMMITTED - the default, and what PostgREST uses)
--   The function locks the schedule row FOR UPDATE, then its series row FOR UPDATE - the order delete/correct/save functions already use.
--   Inserting a class session takes a FOR KEY SHARE lock on its schedule row, which conflicts with FOR UPDATE, so a session cannot be
--   materialized for this version while it is being deleted. A session committed BEFORE the lock is seen by the check (the count is a new
--   statement after the lock), and one that arrives AFTER cannot reference a row that is then gone: its insert fails on the foreign key
--   instead of orphaning anything. This is analysis, not a measurement; a two-session check is in the verification script's header.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE. Run it as one transaction.

do $$
begin
  if to_regprocedure('public.delete_unused_schedule(uuid)') is null then
    raise exception '0063 needs public.delete_unused_schedule (0021/0024).';
  end if;
  if to_regprocedure('public.schedule_usage(uuid, date)') is null then
    raise exception '0063 needs public.schedule_usage (0021/0024).';
  end if;
  if to_regclass('public.class_sessions') is null or to_regclass('public.enrollment_schedules') is null then
    raise exception '0063 needs class_sessions (0010) and enrollment_schedules (0013).';
  end if;
end
$$;


create or replace function public.delete_unused_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule        public.schedules%rowtype;
  v_today           date;
  v_usage           jsonb;
  v_own_sessions    integer;
  v_others          integer;
  v_withdrawn       integer := 0;
  v_series_deleted  boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Lock the schedule, then its series (always in this order). From here to commit no session can be added to this version and no
  -- version or assignment to the series.
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

  v_today := (now() at time zone public.centre_timezone())::date;

  -- 1. A class session on THIS version (any status). Sessions of other versions are not this row's history.
  select count(*) into v_own_sessions
  from public.class_sessions
  where schedule_id = p_schedule_id;

  if v_own_sessions > 0 then
    raise exception 'This schedule has session history and cannot be deleted.'
      using errcode = '22023', detail = 'sessions';
  end if;

  -- 2. Only the LATEST version can go: removing an earlier or middle one would leave a gap in the chain.
  if exists (
    select 1
    from public.schedules s
    where s.series_id = v_schedule.series_id
      and s.id <> p_schedule_id
      and (s.effective_from, s.created_at, s.id) > (v_schedule.effective_from, v_schedule.created_at, v_schedule.id)
  ) then
    raise exception 'This schedule has a later version, so it cannot be deleted. Delete the later version first.'
      using errcode = '22023', detail = 'later_version';
  end if;

  select count(*) into v_others
  from public.schedules
  where series_id = v_schedule.series_id
    and id <> p_schedule_id;

  if v_others > 0 then
    -- 3. The latest of several versions: only this row. The series, its capacity and every assignment stay; the class continues as the
    --    previous version left it.
    delete from public.schedules
    where id = p_schedule_id;
  else
    -- 4. The series' only version: the checks and cleanup it always had.
    v_usage := public.schedule_usage(p_schedule_id, v_today);

    if (v_usage ->> 'started_assignment_count')::int > 0 then
      raise exception 'Students have already been assigned to this schedule, so it cannot be deleted.'
        using errcode = '22023', detail = 'started_assignments';
    end if;

    -- Only assignments that have not started - the same predicate as enrollment_schedules_delete_unstarted_admin (0020). By the check
    -- above every remaining assignment is one of these.
    delete from public.enrollment_schedules
    where schedule_series_id = v_schedule.series_id
      and effective_start_date >= v_today;
    get diagnostics v_withdrawn = row_count;

    delete from public.schedules
    where id = p_schedule_id;

    -- The series goes only when nothing is left on it (restrict foreign keys would refuse otherwise).
    delete from public.schedule_series ss
    where ss.id = v_schedule.series_id
      and not exists (select 1 from public.schedules s where s.series_id = ss.id);
    v_series_deleted := found;
  end if;

  return jsonb_build_object(
    'success', true,
    'batch_id', v_schedule.batch_id,
    'withdrawn_assignments', v_withdrawn,
    'series_deleted', v_series_deleted,
    'versions_remaining', v_others
  );
end;
$$;

comment on function public.delete_unused_schedule(uuid) is
  'Admin only. Deletes a schedule version that has no class session of its own. Only the LATEST version of a series can be deleted (22023, DETAIL later_version, otherwise); when others remain only that row goes and the series and its assignments stay; the series'' only version is deleted as before (started assignments block it - DETAIL started_assignments; unstarted ones are withdrawn; the empty series is removed). Status plays no part. Returns {success, batch_id, withdrawn_assignments, series_deleted, versions_remaining} (0063; replaces 0024).';
