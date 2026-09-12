-- Performance Slice 2A — batched session attendance summaries.
--
-- Attendance (app/attendance/page.js) and Attendance History
-- (lib/attendance-history/data.js) both attach an Eligible/Present/Absent/
-- Unmarked summary to every row by calling getAttendanceSummary once per
-- session. That helper issues two round trips of its own — the
-- resolve_eligible_students RPC plus an attendance read — so a page of ten
-- rows costs twenty round trips, and the cost grows with page size.
--
-- This function does the same work for a whole page in one call. It is the
-- single-session helper's logic, batched: same eligibility source, same
-- counting rule, same authorization gate.
--
-- WHY NOT report_session_facts (0016)
--   It cannot serve these pages, for two structural reasons:
--     * It returns only status = 'completed' rows. Attendance exists to show
--       today's and upcoming sessions, which are 'scheduled'.
--     * It reads only public.class_sessions. A PROJECTED occurrence has no
--       row there at all — lib/class-sessions/data.js synthesises it from
--       `schedules` with id: null — so that function is structurally
--       incapable of returning one.
--   0016 is therefore left completely untouched, and this function is keyed
--   on the occurrence itself rather than on a class_sessions row.
--
-- THE OCCURRENCE KEY IS (schedule_id, session_date), NOT class_session_id.
--   That is already this codebase's natural session key
--   (lib/class-sessions/data.js: "a projected occurrence has no `id` at
--   all, so (schedule_id, session_date)"), and it is the only key that can
--   name a projected occurrence. `class_session_id` is accepted as an input
--   hint — it is what makes the snapshot and marks lookups direct — but it
--   is never required.
--
-- Additive only. No table, no column, no index, no policy, and no change to
-- any existing function. 0010–0016 are applied and are not edited.

-- ============================================================================
-- A. session_attendance_summaries
-- ============================================================================
-- SECURITY INVOKER: this reads only tables the caller can already read, so
-- running as the caller keeps RLS as the ownership boundary with no
-- privilege escalation — the same choice 0016 made, and for the same reason.
-- The two SECURITY DEFINER helpers it calls (can_access_session,
-- resolve_eligible_students) authorize the original caller themselves via
-- auth.uid(), which is a request GUC rather than a role, so that still works
-- through this wrapper.
--
-- STABLE: reads only. Every function it calls (is_admin, can_access_session,
-- current_instructor_id, resolve_eligible_students) is itself STABLE.
--
-- INTERNAL ALIASES: every CTE column is prefixed `k_` so it cannot collide
-- with one of this function's RETURNS TABLE output columns, which are OUT
-- parameters in scope inside a SQL-language body.
--
-- ---------------------------------------------------------------------------
-- THE AUTHORIZATION RULE IS THE WHOLE POINT OF THIS DESIGN
-- ---------------------------------------------------------------------------
-- resolve_eligible_students RAISES 42501 for an occurrence the caller does
-- not own. Today each row is wrapped in its own try/catch, and
-- app/attendance/page.js documents exactly when that fires: an admin
-- reassigns one session (Flow 06), the materialized row now belongs to
-- another instructor, the occurrence is still re-projected from the original
-- instructor's schedule, and resolve correctly answers "no" for it. The row
-- is then shown with no counts.
--
-- Batching those calls into one statement would turn that single-row refusal
-- into a whole-page failure. So this function NEVER relies on catching the
-- exception. Instead it gates every occurrence up front with
-- can_access_session and only calls resolve for those that pass, returning
-- an inaccessible occurrence with NULL counts and
-- eligibility_source = 'forbidden'. That is the set-based equivalent of the
-- per-row catch, and it preserves the existing behaviour exactly.
--
-- The gate deliberately mirrors resolve_eligible_students' own gate verbatim
-- (`is_admin() OR can_access_session(...)`). can_access_session already
-- returns true for an admin, so the first half is redundant today — it is
-- kept so this function can never accept an occurrence that resolve would
-- refuse, even if one of those definitions changes later.

create or replace function public.session_attendance_summaries(p_keys jsonb)
returns table (
  schedule_id        uuid,
  session_date       date,
  eligible_count     integer,
  present_count      integer,
  absent_count       integer,
  unmarked_count     integer,
  eligibility_source text
)
language sql
security invoker
stable
set search_path = ''
as $$
  with raw as (
    -- Input safety. A NULL, a scalar, an object, or anything that is not a
    -- JSON array degrades to "no occurrences requested" rather than raising.
    -- Elements missing the two required fields are skipped, so one malformed
    -- entry cannot take down a page.
    select e
    from jsonb_array_elements(
           case when jsonb_typeof(p_keys) = 'array' then p_keys else '[]'::jsonb end
         ) as t(e)
    where jsonb_typeof(e) = 'object'
      and jsonb_typeof(e -> 'schedule_id')  = 'string'
      and jsonb_typeof(e -> 'session_date') = 'string'
  ),
  parsed as (
    select nullif(r.e ->> 'class_session_id', '')::uuid as k_session,
           nullif(r.e ->> 'batch_id', '')::uuid         as k_batch,
           (r.e ->> 'schedule_id')::uuid                as k_schedule,
           (r.e ->> 'session_date')::date               as k_date
    from raw r
  ),
  keys as (
    -- Exactly one row out per requested occurrence key. `nulls last` prefers
    -- a materialized class_session_id over a null one if the caller happened
    -- to send both spellings of the same occurrence.
    select distinct on (p.k_schedule, p.k_date)
           p.k_session, p.k_batch, p.k_schedule, p.k_date
    from parsed p
    order by p.k_schedule, p.k_date, p.k_session nulls last
  ),
  sess as (
    select k.k_session,
           k.k_batch,
           k.k_schedule,
           k.k_date,
           cs.id                      as k_cs_id,
           cs.eligibility_snapshot_at as k_snap_at,
           (public.is_admin() or public.can_access_session(k.k_schedule, k.k_date)) as k_allowed
    from keys k
    -- Left join: a projected occurrence has no row here, and that is normal.
    left join public.class_sessions cs on cs.id = k.k_session
  ),

  -- Snapshot branch. A direct count of the frozen set, which is exactly what
  -- resolve_eligible_students would return for a snapshotted session — this
  -- only avoids the function call, it does not change the answer.
  snap_counts as (
    select s.k_schedule, s.k_date, count(e.student_id)::integer as k_n
    from sess s
    join public.class_session_eligible_students e on e.class_session_id = s.k_cs_id
    where s.k_allowed and s.k_snap_at is not null
    group by s.k_schedule, s.k_date
  ),

  -- Live branch: no snapshot marker, or no materialized row at all
  -- (a projected occurrence). MATERIALIZED is load-bearing, not cosmetic:
  -- it forces the authorization filter to be evaluated BEFORE the lateral
  -- below, so resolve_eligible_students is never invoked for an occurrence
  -- the caller cannot access. Without it the planner would be free to push
  -- the function call underneath the filter and raise 42501 for the whole
  -- statement — the exact failure this design exists to prevent.
  live_keys as materialized (
    select s.k_batch, s.k_schedule, s.k_date
    from sess s
    where s.k_allowed and s.k_snap_at is null
  ),
  live_counts as (
    select lk.k_schedule, lk.k_date, count(r.student_id)::integer as k_n
    from live_keys lk
    cross join lateral public.resolve_eligible_students(lk.k_batch, lk.k_schedule, lk.k_date) r
    group by lk.k_schedule, lk.k_date
  ),

  -- Recorded marks. A plain read of `attendance` under the caller's own RLS —
  -- no function call, so no 42501 to guard against here. A projected
  -- occurrence has no class_session_id and therefore no marks, which the
  -- join handles by simply matching nothing.
  mark_counts as (
    select s.k_schedule,
           s.k_date,
           count(*)::integer                                     as k_marks,
           (count(*) filter (where a.status = 'present'))::integer as k_present,
           (count(*) filter (where a.status = 'absent'))::integer  as k_absent
    from sess s
    join public.attendance a on a.class_session_id = s.k_cs_id
    where s.k_allowed
    group by s.k_schedule, s.k_date
  )

  select
    s.k_schedule,
    s.k_date,
    -- NULL counts for an inaccessible occurrence: the caller renders the row
    -- with no numbers, exactly as the per-row catch does today. Distinct from
    -- 0, which legitimately means "nobody was eligible" (approved D10).
    case when not s.k_allowed then null
         else coalesce(sc.k_n, lc.k_n, 0) end,
    case when not s.k_allowed then null
         else coalesce(mc.k_present, 0) end,
    case when not s.k_allowed then null
         else coalesce(mc.k_absent, 0) end,
    -- Mirrors computeAttendanceSummary (lib/attendance/validation.js)
    -- exactly: unmarked is eligible minus ALL marks, floored at zero, so a
    -- mark for a student outside the eligible set is never discarded and can
    -- never push unmarked negative.
    case when not s.k_allowed then null
         else greatest(0, coalesce(sc.k_n, lc.k_n, 0) - coalesce(mc.k_marks, 0)) end,
    case when not s.k_allowed          then 'forbidden'
         when s.k_snap_at is not null  then 'snapshot'
         else                               'live' end
  from sess s
  left join snap_counts sc on sc.k_schedule = s.k_schedule and sc.k_date = s.k_date
  left join live_counts lc on lc.k_schedule = s.k_schedule and lc.k_date = s.k_date
  left join mark_counts mc on mc.k_schedule = s.k_schedule and mc.k_date = s.k_date
  order by s.k_date, s.k_schedule;
$$;

comment on function public.session_attendance_summaries(jsonb) is
  'Batched Eligible/Present/Absent/Unmarked counts for a page of class session occurrences (Performance Slice 2). Takes a JSON array of {class_session_id, batch_id, schedule_id, session_date} and returns exactly one row per distinct (schedule_id, session_date) — the occurrence key, which is the only key a projected occurrence has. Replaces one getAttendanceSummary call per row (two round trips each) with a single call per page; the counting rule, eligibility source and authorization gate are unchanged. Eligibility reads the frozen class_session_eligible_students snapshot when the session carries one and resolves live otherwise, including for projected occurrences that have no class_sessions row. An occurrence the caller cannot access returns NULL counts and eligibility_source = forbidden rather than raising, so one inaccessible row can never fail a whole page. SECURITY INVOKER: RLS remains the ownership boundary. No status filtering — cancelled and holiday sessions are summarised exactly as they are today.';

grant execute on function public.session_attendance_summaries(jsonb) to authenticated;
