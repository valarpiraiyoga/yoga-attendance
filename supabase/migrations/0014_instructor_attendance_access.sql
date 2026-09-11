-- Phase 15 — Instructor Access (Step 1: database / RLS foundation).
--
-- Grants an assigned instructor scoped access to Attendance at the database
-- level: their own sessions, the eligible students for those sessions, and
-- the attendance recorded against them (01-product.md §8 "Purpose",
-- "Editing"; §7A's own note that instructor read access to class sessions
-- "will be addressed in Phase 15"; 02-ux.md Flow 01 and Flow 08).
--
-- This migration is the *only* place instructor access is granted. No
-- application file changes in this step — route guards still call
-- requireRole(ROLES.ADMIN), so nothing here is reachable from the UI yet.
-- That is deliberate: the database boundary is put in place, and verified,
-- before any screen is opened to a second role.
--
-- Three principles this migration holds to, and the reasons they matter:
--
-- 1. RLS is the ownership boundary — not JavaScript. Every instructor-facing
--    read is filtered by a policy, so a data-layer query that forgets to add
--    `.eq("instructor_id", ...)` still returns only that instructor's rows.
--    Application-side filtering, where it appears later, is redundant
--    defence, never the enforcement.
--
-- 2. Instructors get reads only. No instructor INSERT/UPDATE policy is added
--    to any table. Both writes an instructor can cause (materializing a
--    session, saving attendance) go through SECURITY DEFINER functions that
--    authorize the caller internally, so the write path stays a single,
--    auditable, authorization-checked entry point rather than a policy
--    predicate spread across a table.
--
-- 3. Student data never becomes table-readable. students,
--    batch_enrollments and memberships keep their admin-only policies
--    untouched. An instructor sees a student's name and phone only through
--    resolve_eligible_students, scoped to one session they own — never by
--    querying the roster.
--
-- Everything here is additive. Every existing admin policy is left exactly
-- as it was, and RLS policies are permissive and OR'd, so admin access is
-- unchanged by construction. Migrations 0010–0013 are not edited.

-- ============================================================================
-- A. can_access_session — the canonical session-ownership predicate
-- ============================================================================
-- The instructor-side counterpart to is_admin() for one specific session,
-- addressed the way this product addresses sessions everywhere else: by
-- (schedule_id, session_date), not by class_sessions.id — a projected
-- occurrence has no id at all (01-product.md §7A), and this must answer for
-- projected and materialized occurrences alike.
--
-- The rule, in order:
--
--   admin                         -> true
--   not a linked, active instructor -> false
--   a materialized row exists     -> that row's instructor_id must match
--   otherwise                     -> the schedule's instructor_id must match
--
-- Snapshot ownership wins (approved decision Q2). Once a session is
-- materialized, class_sessions.instructor_id is authoritative for it
-- (01-product.md §7A "Snapshot and Historical Integrity"), so an admin who
-- reassigns one session through Flow 06 moves access with it: the new
-- instructor gains the session even though the recurring schedule still
-- names the old one, and the old instructor loses it even though the
-- schedule is still theirs. Falling back to the schedule only when no row
-- exists is what makes that true without a second rule.
--
-- current_instructor_id() (0004_instructor_identity.sql) already returns
-- null for a caller who is signed out, unlinked, or linked to an *inactive*
-- instructor — so deactivating an instructor revokes this at the database,
-- not merely in the UI. The explicit null check below is not required for
-- correctness (a null comparison would yield null, never true) but states
-- the intent where a reader will look for it.
--
-- security definer / stable / search_path = '': same reasoning as
-- is_admin() (0002) and current_instructor_id() (0004) — it must not depend
-- on the caller's own visibility of class_sessions or schedules (which is
-- exactly what it is used to decide), it is evaluated once per statement
-- rather than once per row, and every identifier is schema-qualified so a
-- caller-controlled search_path cannot hijack it.

create or replace function public.can_access_session(
  p_schedule_id uuid,
  p_session_date date
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when public.is_admin() then true
    when public.current_instructor_id() is null then false
    when exists (
      select 1
      from public.class_sessions cs
      where cs.schedule_id = p_schedule_id
        and cs.session_date = p_session_date
    ) then exists (
      select 1
      from public.class_sessions cs
      where cs.schedule_id = p_schedule_id
        and cs.session_date = p_session_date
        and cs.instructor_id = public.current_instructor_id()
    )
    else exists (
      select 1
      from public.schedules s
      where s.id = p_schedule_id
        and s.instructor_id = public.current_instructor_id()
    )
  end;
$$;

comment on function public.can_access_session(uuid, date) is
  'The single source of session ownership (Phase 15 Instructor Access). True for an admin; for an instructor, true only for their own session — the materialized row''s instructor_id when one exists (snapshot ownership wins, 01-product.md §7A), the schedule''s instructor_id otherwise. False for a signed-out, unlinked, or inactive instructor.';

grant execute on function public.can_access_session(uuid, date) to authenticated;

-- ============================================================================
-- B. Instructor SELECT policies
-- ============================================================================
-- Additive only. Each `create policy` below is a *new, separate* policy
-- alongside the admin one it sits next to; none of the existing
-- *_select_admin policies are dropped or altered. Policies are permissive
-- and OR'd, so an admin's visible row set is bit-for-bit what it was before
-- this migration.
--
-- No INSERT or UPDATE policy is added for any table (principle 2 above).
-- The table-level grants from 0005–0011 already include insert/update for
-- `authenticated` and are left alone — they were never the restriction;
-- the policies are.

-- B1. schedules -------------------------------------------------------------
-- Required because most occurrences are *projected*, not materialized: both
-- session lists and Session Details read `schedules` through
-- listSchedulesForWeek/getSchedule and compute occurrences from it
-- (lib/class-sessions/data.js). Without this, an instructor's Attendance
-- screens would be empty no matter what class_sessions allowed.
--
-- Scoped to the instructor's own schedules. Note this is the schedule's
-- *current* instructor, which is the right rule here precisely because this
-- policy only matters for occurrences that have no materialized row yet —
-- once a row exists, the session is read from class_sessions (B2) and its
-- snapshot governs instead.

drop policy if exists "schedules_select_instructor" on public.schedules;
create policy "schedules_select_instructor"
  on public.schedules
  for select
  using (instructor_id = public.current_instructor_id());

-- B2. class_sessions --------------------------------------------------------
-- Snapshot ownership, directly: the session's own instructor_id column.
-- This is the same value can_access_session checks for a materialized
-- occurrence, kept as a plain column comparison here rather than a function
-- call so the policy stays index-friendly
-- (class_sessions_instructor_id_idx, 0010).

drop policy if exists "class_sessions_select_instructor" on public.class_sessions;
create policy "class_sessions_select_instructor"
  on public.class_sessions
  for select
  using (instructor_id = public.current_instructor_id());

-- B3. attendance ------------------------------------------------------------
-- Read-only, and only for marks recorded against a session the caller owns.
-- Deliberately expressed against class_sessions rather than by any column on
-- attendance itself: attendance has no instructor column, and adding one
-- would duplicate a fact the session already owns (and could drift from it
-- after a Flow 06 reassignment).
--
-- SELECT only. Writing attendance stays impossible for an instructor
-- directly — save_session_attendance (E) is the only writer, for admins and
-- instructors alike (principle 2; approved requirement 8).

drop policy if exists "attendance_select_instructor" on public.attendance;
create policy "attendance_select_instructor"
  on public.attendance
  for select
  using (
    exists (
      select 1
      from public.class_sessions cs
      where cs.id = attendance.class_session_id
        and cs.instructor_id = public.current_instructor_id()
    )
  );

-- B4. batches ---------------------------------------------------------------
-- Every session query embeds `batches(id, name, code)` (the COLUMNS/
-- LIST_COLUMNS constants in lib/class-sessions/data.js and
-- lib/schedules/data.js). Without a policy the embed comes back null and
-- the Batch column renders "—" for every row.
--
-- Scoped to batches the caller actually teaches — reachable through a
-- session they own, or a schedule they own. Not "all batches": a batch
-- roster is admin information, and an instructor has no need to enumerate
-- batches they do not teach.

drop policy if exists "batches_select_instructor" on public.batches;
create policy "batches_select_instructor"
  on public.batches
  for select
  using (
    exists (
      select 1
      from public.class_sessions cs
      where cs.batch_id = batches.id
        and cs.instructor_id = public.current_instructor_id()
    )
    or exists (
      select 1
      from public.schedules s
      where s.batch_id = batches.id
        and s.instructor_id = public.current_instructor_id()
    )
  );

-- B5. instructors -----------------------------------------------------------
-- No new policy is added here, and that is a deliberate finding rather than
-- an omission.
--
-- Session and schedule queries embed `instructors(id, full_name)`. Every
-- instructors row an instructor can reach through this migration's other
-- policies is their *own*: B2 exposes only sessions whose instructor_id is
-- theirs, and B1 only schedules whose instructor_id is theirs, so the
-- embedded instructor is always the caller. `instructors_select_self`
-- (0004_instructor_identity.sql, `using (user_id = auth.uid())`) already
-- covers exactly that row.
--
-- Adding a second policy here would widen nothing and would give a future
-- reader two overlapping rules to reconcile. If a later phase needs an
-- instructor to see a *different* instructor's name (Attendance History
-- across a reassigned session, say), that phase adds its own policy with
-- its own justification.

-- B6. students / batch_enrollments / memberships -----------------------------
-- Intentionally NOT granted (principle 3; approved requirement 3). Their
-- admin-only policies from 0006/0007/0008 stand unchanged.
--
-- An instructor still sees the eligible students for their own session —
-- through resolve_eligible_students (C) only, which is SECURITY DEFINER and
-- therefore reads these tables as its owner, scoped to one authorized
-- session. That keeps "which students is this instructor allowed to see"
-- a single question answered in a single place, instead of an RLS predicate
-- on three tables that would have to re-derive eligibility to be correct.

-- ============================================================================
-- C. resolve_eligible_students — instructor-authorized, display fields added
-- ============================================================================
-- Two changes, no change at all to the eligibility rule itself.
--
-- 1. Authorization broadens from is_admin() to
--    `is_admin() or can_access_session(...)`. The admin branch is evaluated
--    first and short-circuits, so an admin call is exactly what it was.
--
-- 2. The function now returns the student display fields (full_name, phone,
--    student_code) alongside the membership dates 0012 added (approved
--    decision Q4). This is a security change, not a convenience one:
--    lib/attendance/data.js currently follows this RPC with a separate
--    `.from("students")` query, which is subject to students_select_admin
--    and would return an empty list for an instructor — silently, with no
--    error. Returning the fields here removes the need for that query
--    (Step 2) and keeps student data reachable only through an authorized,
--    session-scoped path.
--
-- The eligibility conditions (D1–D3 plus Phase 15A's schedule-assignment
-- condition), the evaluation against p_session_date rather than "today",
-- the cancelled-membership rule, and the distinct on/order by tie-break are
-- carried over verbatim from 0013. Nothing about who is eligible changes.
--
-- Return type changes are not permitted via CREATE OR REPLACE, so this
-- drops and recreates — the same pattern 0012 and 0013 each already used on
-- this function. The DROP is safe even though save_session_attendance calls
-- it by name: PL/pgSQL bodies are not dependency-tracked, and this script
-- recreates both functions before either is called again.

drop function if exists public.resolve_eligible_students(uuid, uuid, date);

create function public.resolve_eligible_students(
  p_batch_id uuid,
  p_schedule_id uuid,
  p_session_date date
)
returns table (
  student_id uuid,
  full_name text,
  phone text,
  student_code text,
  membership_start_date date,
  membership_end_date date
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_series_id uuid;
begin
  if not (public.is_admin() or public.can_access_session(p_schedule_id, p_session_date)) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select series_id into v_series_id
  from public.schedules
  where id = p_schedule_id;

  if v_series_id is null then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  return query
  select distinct on (be.student_id)
    be.student_id,
    s.full_name,
    s.phone,
    s.student_code,
    m.start_date as membership_start_date,
    m.end_date as membership_end_date
  from public.batch_enrollments be
  join public.students s on s.id = be.student_id
  join public.memberships m on m.student_id = be.student_id
  where be.batch_id = p_batch_id
    -- D2: enrollment must be active and cover the session date.
    and be.status = 'active'
    and be.effective_start_date <= p_session_date
    and (be.effective_end_date is null or be.effective_end_date >= p_session_date)
    -- D1: inactive students are excluded from new eligibility. Reads the
    -- student's *current* status — students has no status-history model,
    -- unlike enrollment/membership, which are both date-ranged.
    and s.status = 'active'
    -- Phase 15A: the enrollment must carry a schedule assignment on this
    -- session's own schedule series, covering the session date. Being
    -- enrolled in the batch is not sufficient on its own.
    and exists (
      select 1
      from public.enrollment_schedules es
      where es.batch_enrollment_id = be.id
        and es.schedule_series_id = v_series_id
        and es.effective_start_date <= p_session_date
        and (es.effective_end_date is null or es.effective_end_date >= p_session_date)
    )
    -- D3: a membership covers the session date if it was not yet cancelled
    -- as of that date. Cancelling a membership today must not retroactively
    -- invalidate eligibility for an earlier session date — only dates
    -- on/after the cancellation are excluded.
    and m.start_date <= p_session_date
    and m.end_date >= p_session_date
    and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone 'Asia/Kolkata')::date)
  -- Tie-break (unchanged from 0012): prefer a membership not cancelled as of
  -- the session date, then the most recently started.
  order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc;
end;
$$;

comment on function public.resolve_eligible_students(uuid, uuid, date) is
  'The single source of attendance eligibility (01-product.md §8; Phase 15A): active student, active batch enrollment covering the date, a schedule assignment covering the date on the session''s own schedule series, and active membership covering the date. Evaluated as of p_session_date, never "today". Returns the student''s display fields and the qualifying membership''s date range; when more than one membership qualifies, prefers one not cancelled as of the session date, then the most recently started (display tie-break only). Authorized for an admin, or for the instructor who owns that session (can_access_session) — the only path by which an instructor ever reads student data.';

grant execute on function public.resolve_eligible_students(uuid, uuid, date) to authenticated;

-- ============================================================================
-- D. materialize_class_session — the authorized write path for a new session
-- ============================================================================
-- Approved decision Q1, Option B.
--
-- Why this exists at all: materialize-on-first-touch means every session
-- starts life projected, so an instructor's *first* save on any session must
-- create the class_sessions row. Both existing gates block that — the JS
-- helper calls requireRole(ROLES.ADMIN), and class_sessions_insert_admin
-- allows only admins to insert.
--
-- Of the two ways to unblock it, this is the one that does not weaken the
-- table: rather than granting instructors an INSERT policy whose WITH CHECK
-- would have to re-derive the entire occurrence rule (day-of-week,
-- effective range, correct snapshot values) to be safe, the insert stays
-- admin-only at the policy level and happens here, inside a function that
-- authorizes the caller and controls every value written.
--
-- This does supersede 04-development-plan.md's foundation-slice note that
-- the materialization boundary "does not reimplement materializeClassSession's
-- insert-with-retry logic in SQL". That note was written while attendance
-- was admin-only, where the JS helper's admin gate was sufficient; instructor
-- access is the condition that invalidates it. Approved as Q1/Option B.
--
-- Behaviour is otherwise a faithful port of lib/class-sessions/actions.js's
-- materializeClassSession, and stays "ensure it exists", not "I must be the
-- one who created it":
--
--   * already materialized      -> return that row unchanged, no write
--   * schedule missing          -> P0002
--   * not a genuine occurrence  -> 22023 (day-of-week / effective range)
--   * concurrent insert wins    -> return the winner's row, not a conflict
--
-- The snapshot is taken from the schedule, never from a caller argument, so
-- an instructor cannot materialize a session naming a different batch,
-- instructor or time. Combined with can_access_session's schedule-ownership
-- branch, an instructor cannot materialize another instructor's session at
-- all: the authorization check below fails first.
--
-- Weekday matching uses an explicit array rather than to_char(..., 'day'),
-- whose output is lc_time-dependent and would silently stop matching
-- schedules.day_of_week ('monday'…'sunday', 0009) under a non-English
-- locale.

create or replace function public.materialize_class_session(
  p_schedule_id uuid,
  p_session_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   public.class_sessions%rowtype;
  v_schedule  public.schedules%rowtype;
  v_day_name  text;
begin
  if not public.can_access_session(p_schedule_id, p_session_date) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 1. Already materialized: return it untouched. Viewing and re-saving
  -- must never create a second row (class_sessions_schedule_date_unique,
  -- 0010, is the backstop rather than the primary defence).
  select * into v_session
  from public.class_sessions
  where schedule_id = p_schedule_id
    and session_date = p_session_date;

  if found then
    return to_jsonb(v_session);
  end if;

  -- 2. The schedule must exist.
  select * into v_schedule
  from public.schedules
  where id = p_schedule_id;

  if not found then
    raise exception 'Could not find that schedule.' using errcode = 'P0002';
  end if;

  -- 3. The date must be a genuine occurrence of this schedule — the same
  -- three-condition rule as lib/schedules/data.js's scheduleOccursOnDate.
  -- Deliberately does not check schedule.status: a deactivated schedule's
  -- effective_until already bounds the last date it applied (0009), so the
  -- date check alone is both correct and sufficient. This is also what
  -- enforces 01-product.md §7A "Inactive or Ended Schedules" without a
  -- separate rule.
  v_day_name := (array[
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
  ])[extract(dow from p_session_date)::int + 1];

  if p_session_date < v_schedule.effective_from
     or (v_schedule.effective_until is not null and p_session_date > v_schedule.effective_until)
     or v_schedule.day_of_week <> v_day_name then
    raise exception 'This schedule does not occur on that date.' using errcode = '22023';
  end if;

  -- 4. Insert, snapshotting the schedule's current batch, instructor and
  -- time (01-product.md §7A "Snapshot and Historical Integrity"). From this
  -- moment on nothing about the schedule can change this row.
  insert into public.class_sessions (
    schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status
  )
  values (
    v_schedule.id,
    v_schedule.batch_id,
    v_schedule.instructor_id,
    p_session_date,
    v_schedule.start_time,
    v_schedule.end_time,
    'scheduled'
  )
  on conflict (schedule_id, session_date) do nothing
  returning * into v_session;

  -- 5. A concurrent caller materialized this same occurrence between step 1
  -- and step 4. Their row is just as valid as the one this call would have
  -- created, so return it rather than surfacing a conflict.
  if not found then
    select * into v_session
    from public.class_sessions
    where schedule_id = p_schedule_id
      and session_date = p_session_date;

    if not found then
      raise exception 'Could not create the class session.' using errcode = 'P0002';
    end if;
  end if;

  return to_jsonb(v_session);
end;
$$;

comment on function public.materialize_class_session(uuid, date) is
  'Materialize-on-first-touch (01-product.md §7A) as an authorized database function: ensures a class_sessions row exists for one occurrence, creating it as scheduled if it does not and returning the existing row if it does. Authorized by can_access_session, so an instructor can only materialize their own session; the snapshot is always read from the schedule, never from caller input. Admin behaviour is identical to the existing application-side helper.';

grant execute on function public.materialize_class_session(uuid, date) to authenticated;

-- ============================================================================
-- E. save_session_attendance — instructor-authorized by snapshot ownership
-- ============================================================================
-- Signature and return type are unchanged ((uuid, jsonb) -> jsonb), so this
-- is CREATE OR REPLACE — every existing caller and grant keeps working.
--
-- The only change from 0013's body is the authorization check, which moves
-- and broadens:
--
--   * It now runs in two parts. A cheap check first — the caller must be an
--     admin or a linked, active instructor — so a caller with no instructor
--     identity at all is rejected before the session is even looked up, and
--     cannot use this function to probe whether a given id exists.
--   * The ownership check itself runs after the session row is read,
--     against v_session.instructor_id: the snapshot, which is authoritative
--     for a materialized session (approved decision Q2). Using the snapshot
--     rather than can_access_session is not a different rule — by this point
--     the row demonstrably exists, which is exactly the branch
--     can_access_session would take — but it reuses the row already locked
--     here instead of re-reading it.
--
-- Everything else is carried over verbatim: the row lock, the
-- cancelled/holiday rejection, the future-date rejection, the server-side
-- eligibility re-resolution, the ineligible-student rejection, the
-- never-deleting upsert, unconditional completion (D10), and the return
-- shape. An admin's path through this function is unchanged.
--
-- This remains the only writer of attendance rows and the only path that
-- sets class_sessions.status = 'completed'. Being SECURITY DEFINER, it
-- writes as its owner, which is why instructors need no INSERT/UPDATE
-- policy on attendance or class_sessions for any of this to work — and why
-- they are not given one.

create or replace function public.save_session_attendance(
  p_class_session_id uuid,
  p_marks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session          public.class_sessions%rowtype;
  v_instructor_id    uuid;
  v_is_admin         boolean;
  v_today            date;
  v_mark             jsonb;
  v_student_id       uuid;
  v_status           text;
  v_eligible_ids     uuid[];
  v_submitted_ids    uuid[];
  v_invalid_ids      uuid[];
  v_marked_count     integer := 0;
begin
  v_is_admin := public.is_admin();
  v_instructor_id := public.current_instructor_id();

  -- Rejected before anything is read: not an admin, and not a linked,
  -- active instructor. A deactivated or unlinked instructor stops here.
  if not v_is_admin and v_instructor_id is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 1. The session must exist. `for update` holds the row lock for the
  -- rest of this transaction, so a concurrent call against the same
  -- session (another save, or Flow 07's markSessionException) cannot
  -- interleave with this one.
  select *
  into v_session
  from public.class_sessions
  where id = p_class_session_id
  for update;

  if not found then
    raise exception 'Class session not found.' using errcode = 'P0002';
  end if;

  -- 1b. Snapshot ownership (approved decision Q2): an instructor may only
  -- save attendance for a session whose own instructor_id is theirs. An
  -- admin skips this entirely.
  if not v_is_admin and v_session.instructor_id <> v_instructor_id then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 2. Cancelled/Holiday sessions do not take attendance (01-product.md §8
  -- "Cancelled / Holiday").
  if v_session.status in ('cancelled', 'holiday') then
    raise exception 'Cancelled or Holiday sessions do not take attendance.' using errcode = '22023';
  end if;

  -- 3. Future sessions are rejected (approved decision D5), evaluated
  -- against the centre timezone, matching every other Asia/Kolkata-derived
  -- check in this product (01-product.md §7A "Centre Timezone").
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  if v_session.session_date > v_today then
    raise exception 'Attendance cannot be taken for a future session.' using errcode = '22023';
  end if;

  -- 4. Resolve eligible students for this session's own batch, schedule
  -- and date — schedule-scoped (Phase 15A), using the session's snapshot
  -- batch_id and schedule_id (authoritative per §7A), never the schedule's
  -- current batch. auth.uid() is a request GUC, not a role, so the nested
  -- call still authorizes the original caller: an instructor who reached
  -- this line owns the session, so its own can_access_session check passes
  -- for the same reason this one did.
  select coalesce(array_agg(student_id), '{}')
  into v_eligible_ids
  from public.resolve_eligible_students(v_session.batch_id, v_session.schedule_id, v_session.session_date);

  select coalesce(array_agg((mark->>'student_id')::uuid), '{}')
  into v_submitted_ids
  from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as mark;

  -- 5. Every submitted student must be eligible. Rejecting the whole call
  -- rather than silently dropping the ineligible ones — a caller that
  -- submitted a mark for the wrong student has a bug worth surfacing, not
  -- papering over.
  select array_agg(sid)
  into v_invalid_ids
  from unnest(v_submitted_ids) as sid
  where sid <> all (v_eligible_ids);

  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'One or more students are not eligible for this session.' using errcode = '22023';
  end if;

  -- 6. Upsert Present/Absent for exactly the submitted students.
  -- 8. A student with no entry in p_marks gets no row — unmarked is
  -- represented by absence, never by a stored value.
  -- 9. Never deletes: an existing row for a student not resubmitted this
  -- time is left exactly as it was.
  for v_mark in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    v_student_id := (v_mark->>'student_id')::uuid;
    v_status := v_mark->>'status';

    if v_status not in ('present', 'absent') then
      raise exception 'Invalid attendance status: %', v_status using errcode = '22023';
    end if;

    insert into public.attendance (class_session_id, student_id, status)
    values (p_class_session_id, v_student_id, v_status)
    on conflict (class_session_id, student_id)
    do update set status = excluded.status, updated_at = now();

    v_marked_count := v_marked_count + 1;
  end loop;

  -- 7. Saving completes the session — unconditionally, even with zero or
  -- partial marks (approved decision D10).
  update public.class_sessions
  set status = 'completed'
  where id = p_class_session_id;

  -- 10.
  return jsonb_build_object(
    'success', true,
    'class_session_id', p_class_session_id,
    'eligible_count', coalesce(array_length(v_eligible_ids, 1), 0),
    'marked_count', v_marked_count
  );
end;
$$;

comment on function public.save_session_attendance(uuid, jsonb) is
  'The only writer of attendance rows and the only path that sets class_sessions.status = completed. Atomic: validates the session, authorizes the caller (admin, or the instructor named on the session''s own snapshot), rejects cancelled/holiday and future dates, re-validates eligibility server-side (schedule-scoped, Phase 15A), upserts present/absent marks (never deletes), then completes the session — all in one transaction. p_marks is a JSON array of {"student_id","status"} objects; an eligible student absent from it stays unmarked. Requires an already-materialized class_sessions.id — see materialize_class_session.';

grant execute on function public.save_session_attendance(uuid, jsonb) to authenticated;

-- ============================================================================
-- F. What this migration deliberately does not do
-- ============================================================================
-- * No INSERT/UPDATE/DELETE policy for instructors on any table. Both
--   instructor-caused writes go through D and E, which are SECURITY DEFINER
--   and authorize internally.
-- * No delete privilege or delete policy anywhere, for any role — unchanged
--   from every prior migration.
-- * No change to students, batch_enrollments or memberships.
-- * No change to any existing admin policy, and no change to migrations
--   0010–0013.
-- * No application change. Route guards still require admin, so none of the
--   access granted here is reachable from the UI until a later step opens
--   it deliberately.
