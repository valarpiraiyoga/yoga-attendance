-- Phase 16A — Historical eligibility snapshot.
--
-- Fixes the historical-integrity defect browser QA exposed at the end of
-- Phase 16 (04-development-plan.md, "Phase 16A"): a completed session's
-- eligible set was recomputed live on every read, so a later enrollment,
-- assignment, membership, batch or status change silently rewrote history.
-- The reproduced case: Aerial Yoga 2026-09-11 recorded Eligible 2 /
-- Present 1 / Absent 1 / 50%; moving one of those two students to another
-- batch effective that same date turned the same historical session into
-- Eligible 1 / Present 1 / Absent 1 / 100% — two stored marks against one
-- "eligible" student, with the moved student's recorded Absent mark no
-- longer appearing on any roster.
--
-- Five separate predicates inside resolve_eligible_students leaked live
-- state into what is meant to be a historical answer, and each maps onto
-- one of the five scenarios 01-product.md §9 requires to survive:
-- the assignment's own end date, the enrollment's end date, the
-- enrollment's *current* status (not date-scoped), the student's *current*
-- status (not date-scoped), and the membership's editable dates.
--
-- The approved fix (A2) freezes the eligible *set* — not merely a count —
-- at the moment attendance is first saved, and makes every existing reader
-- historically correct without touching a single read path: the
-- snapshot-versus-live decision lives inside resolve_eligible_students
-- itself, which every caller already goes through
-- (listEligibleStudents, listEligibleStudentIds, getAttendanceSummary,
-- every Phase 15 and Phase 16 screen, and save_session_attendance's own
-- re-validation).
--
-- Additive only. 0010–0014 are applied and are not edited. This migration
-- performs **no backfill** — existing completed sessions stay unsnapshotted
-- and keep resolving live until the separate, reviewed backfill step runs
-- (04-development-plan.md, Phase 16A implementation sequence steps 4–5).

-- ============================================================================
-- A. class_session_eligible_students — the frozen eligible set
-- ============================================================================
-- One row per (class session, eligible student), written once when that
-- session's attendance is first saved, and never updated or deleted
-- afterwards. `membership_start_date`/`membership_end_date` mirror what
-- resolve_eligible_students already returns for display
-- (0012_attendance_eligibility_membership_details.sql); they are nullable
-- because a later backfilled row may legitimately not know which
-- membership qualified a student at the time.
--
-- `provenance` records how a row was obtained so an inferred set is never
-- later mistaken for a proven one (04-development-plan.md, Phase 16A
-- "Provenance"). Only 'save' is ever written by this migration; the two
-- backfill values exist so the reviewed backfill step does not need a
-- second schema change.
--
-- restrict, not cascade, on both foreign keys — matching every FK in this
-- schema, and for the same reason attendance itself uses restrict: this
-- table *is* historical evidence, and must not be silently destroyed by a
-- future change elsewhere.

create table if not exists public.class_session_eligible_students (
  class_session_id      uuid not null references public.class_sessions (id) on delete restrict,
  student_id            uuid not null references public.students (id) on delete restrict,
  membership_start_date date,
  membership_end_date   date,
  provenance            text not null default 'save'
                          check (provenance in ('save', 'backfill_consistent', 'backfill_drift')),
  created_at            timestamptz not null default now(),

  primary key (class_session_id, student_id)
);

comment on table public.class_session_eligible_students is
  'The eligible student set for one class session, frozen when its attendance was first saved (Phase 16A). Write-once historical evidence: never updated, never deleted. Absence of rows is meaningful only together with class_sessions.eligibility_snapshot_at — an empty snapshot is valid and is not the same as no snapshot.';

comment on column public.class_session_eligible_students.provenance is
  'save = captured during the original attendance save (exact). backfill_consistent / backfill_drift = reconstructed later by the reviewed backfill step, where current evidence is consistent / has already drifted.';

-- class_session_id needs no separate index: it is the leading column of
-- the primary key's own btree index, so "the snapshot for this session"
-- — the only read this table has — is already covered. student_id does
-- need its own index: it is not the leading column of any existing index,
-- and a student's own historical eligibility is the natural second lookup.

create index if not exists class_session_eligible_students_student_id_idx
  on public.class_session_eligible_students (student_id);

-- ============================================================================
-- B. class_sessions.eligibility_snapshot_at — the snapshot presence marker
-- ============================================================================
-- A child table alone cannot distinguish "snapshot taken, and the eligible
-- set was genuinely empty" (legal — approved decisions D4/D10) from "no
-- snapshot exists yet". This column is that distinction, and it is what
-- resolve_eligible_students branches on below.
--
-- Deliberately NOT keyed off `status = 'completed'`: a session completed
-- before this migration has no snapshot and must keep resolving live
-- rather than reporting an empty eligible set.

alter table public.class_sessions
  add column if not exists eligibility_snapshot_at timestamptz;

comment on column public.class_sessions.eligibility_snapshot_at is
  'When this session''s eligible student set was frozen into class_session_eligible_students. NULL means no snapshot exists and eligibility still resolves live. Non-NULL means the set is frozen — including when the frozen set is empty.';

-- ============================================================================
-- C. Table privileges
-- ============================================================================
-- SELECT only. No INSERT is granted to `authenticated`, deliberately and
-- unlike 0011's grants on `attendance`: the sole writer is
-- save_session_attendance below, which is SECURITY DEFINER and therefore
-- writes as its owner without needing any grant here at all. Granting
-- insert would widen the surface for no functional gain.
--
-- No UPDATE and no DELETE are granted to anyone — the write-once rule is
-- enforced by the absence of the privilege, not only by convention.
-- `anon` gets nothing.

grant select on public.class_session_eligible_students to authenticated;

-- ============================================================================
-- D. Row Level Security
-- ============================================================================
-- Mirrors `attendance`'s own policy shape exactly (0011 + 0014): admins
-- read everything; an instructor reads only rows belonging to a session
-- they own, expressed through class_sessions rather than a column on this
-- table, because this table has no instructor column and adding one would
-- duplicate a fact the session already owns (and could drift from it after
-- a Flow 06 reassignment).
--
-- Read-only for both roles. There is no insert/update/delete policy for
-- anyone, matching the grants above: the SECURITY DEFINER save path is the
-- only writer.
--
-- Note these policies are defence-in-depth rather than load-bearing for
-- normal reads: application code never selects this table directly — it
-- reaches the snapshot only through resolve_eligible_students, which is
-- SECURITY DEFINER. That indirection is what keeps the Phase 15 property
-- that an instructor never reads `students` directly.

alter table public.class_session_eligible_students enable row level security;

drop policy if exists "class_session_eligible_students_select_admin" on public.class_session_eligible_students;
create policy "class_session_eligible_students_select_admin"
  on public.class_session_eligible_students
  for select
  using (public.is_admin());

drop policy if exists "class_session_eligible_students_select_instructor" on public.class_session_eligible_students;
create policy "class_session_eligible_students_select_instructor"
  on public.class_session_eligible_students
  for select
  using (
    exists (
      select 1
      from public.class_sessions cs
      where cs.id = class_session_eligible_students.class_session_id
        and cs.instructor_id = public.current_instructor_id()
    )
  );

-- ============================================================================
-- E. resolve_eligible_students — prefer the snapshot when one exists
-- ============================================================================
-- Signature and return type are unchanged ((uuid, uuid, date) -> the same
-- six columns), so this is CREATE OR REPLACE, not a drop: every existing
-- caller and grant keeps working, and no application code changes.
--
-- The only change is the branch added after the authorization check: when
-- the session for (p_schedule_id, p_session_date) has a snapshot, return
-- the frozen set joined to `students` for the same display fields; when it
-- does not, fall through to the existing live resolution, whose D1–D3 and
-- Phase 15A conditions are carried over verbatim below.
--
-- Branching on snapshot *existence* (not on status) is what keeps
-- pre-backfill completed sessions working exactly as they do today.
--
-- The authorization check is unchanged and still runs first, for both
-- branches — the snapshot is historical data about students, and is
-- governed by exactly the same rule as live eligibility.

create or replace function public.resolve_eligible_students(
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
  v_class_session_id uuid;
  v_snapshot_at timestamptz;
begin
  if not (public.is_admin() or public.can_access_session(p_schedule_id, p_session_date)) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Phase 16A: a frozen set wins over any live recomputation. Looked up by
  -- (schedule_id, session_date) — the same pair class_sessions_schedule_date_unique
  -- already treats as this table's natural key, and the only address a
  -- projected occurrence would have.
  select cs.id, cs.eligibility_snapshot_at
    into v_class_session_id, v_snapshot_at
  from public.class_sessions cs
  where cs.schedule_id = p_schedule_id
    and cs.session_date = p_session_date;

  if v_snapshot_at is not null then
    return query
    select
      e.student_id,
      s.full_name,
      s.phone,
      s.student_code,
      e.membership_start_date,
      e.membership_end_date
    from public.class_session_eligible_students e
    join public.students s on s.id = e.student_id
    where e.class_session_id = v_class_session_id;

    return;
  end if;

  -- No snapshot: unchanged live resolution (0014 body, carried over).
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
  'The single source of attendance eligibility (01-product.md §8; Phase 15A; Phase 16A). When the session has a frozen eligible set (class_sessions.eligibility_snapshot_at is not null) that set is returned verbatim, so a completed session''s history cannot be rewritten by later enrollment, assignment, membership, batch or status changes. Otherwise eligibility resolves live: active student, active batch enrollment covering the date, a schedule assignment covering the date on the session''s own schedule series, and active membership covering the date, evaluated as of p_session_date and never "today". Authorized for an admin, or for the instructor who owns that session (can_access_session) — the only path by which an instructor ever reads student data.';

grant execute on function public.resolve_eligible_students(uuid, uuid, date) to authenticated;

-- ============================================================================
-- F. save_session_attendance — freeze the eligible set on the first save
-- ============================================================================
-- Signature and return type are unchanged ((uuid, jsonb) -> jsonb), so this
-- is CREATE OR REPLACE. Authorization, the row lock, the cancelled/holiday
-- and future-date rejections, the eligibility re-validation, the
-- never-deleting upsert, unconditional completion (D10) and the return
-- shape are all carried over unchanged from 0014.
--
-- The one addition is section 3b below: on the save that first completes a
-- session, the live eligible set is frozen into
-- class_session_eligible_students and the marker is stamped — inside this
-- same transaction, so the snapshot, the marks and the completed status
-- are all committed together or not at all.
--
-- Write-once, three ways over: the guard below only fires while the marker
-- is null, `on conflict do nothing` cannot overwrite an existing row, and
-- no update/delete privilege on the table exists for any role.
--
-- The guard also requires the session not to be `completed` already. That
-- is what keeps this migration's promise not to backfill: a session
-- completed *before* Phase 16A has no snapshot, and a correction to it must
-- not quietly freeze today's (possibly already-drifted) eligibility as if
-- it were historical fact. Those sessions are left for the reviewed
-- backfill step, which has the evidence rules to reconstruct them
-- honestly.
--
-- Because the snapshot is written before the re-validation below reads
-- eligibility, the very first save validates its marks against exactly the
-- set it just froze, and every later correction validates against that
-- same frozen set — which is what makes a student who has since left the
-- batch still correctable rather than rejected with 22023.

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
  -- interleave with this one — which is also what makes the snapshot
  -- write below safe against a double first-save.
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

  -- 3b. Phase 16A: freeze the eligible set on the save that first completes
  -- this session. Zero eligible students inserts zero rows and still stamps
  -- the marker — an empty snapshot is a real answer, distinct from having
  -- no snapshot at all.
  if v_session.eligibility_snapshot_at is null and v_session.status <> 'completed' then
    insert into public.class_session_eligible_students (
      class_session_id, student_id, membership_start_date, membership_end_date, provenance
    )
    select
      p_class_session_id,
      r.student_id,
      r.membership_start_date,
      r.membership_end_date,
      'save'
    from public.resolve_eligible_students(v_session.batch_id, v_session.schedule_id, v_session.session_date) r
    on conflict (class_session_id, student_id) do nothing;

    update public.class_sessions
    set eligibility_snapshot_at = now()
    where id = p_class_session_id
      and eligibility_snapshot_at is null;
  end if;

  -- 4. Resolve eligible students for this session's own batch, schedule
  -- and date — schedule-scoped (Phase 15A), using the session's snapshot
  -- batch_id and schedule_id (authoritative per §7A), never the schedule's
  -- current batch. As of Phase 16A this returns the frozen set whenever one
  -- exists — including the one just written above — so a correction is
  -- validated against the session's own history rather than against who
  -- happens to be enrolled today. auth.uid() is a request GUC, not a role,
  -- so the nested call still authorizes the original caller.
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
  'The only writer of attendance rows, the only path that sets class_sessions.status = completed, and (Phase 16A) the only writer of class_session_eligible_students. Atomic: validates the session, authorizes the caller (admin, or the instructor named on the session''s own snapshot), rejects cancelled/holiday and future dates, freezes the eligible set on the save that first completes the session, re-validates eligibility against that frozen set, upserts present/absent marks (never deletes), then completes the session — all in one transaction. The snapshot is write-once and is never created for a session completed before Phase 16A; those are left to the reviewed backfill step.';

grant execute on function public.save_session_attendance(uuid, jsonb) to authenticated;

-- ============================================================================
-- G. What this migration deliberately does not do
-- ============================================================================
-- * No backfill. Every session completed before this migration keeps
--   resolving eligibility live until the separate, reviewed backfill step
--   runs. Until then, a correction to such a session can still be rejected
--   with 22023 for a student who has since left — the pre-existing Phase 16
--   defect, unchanged here rather than papered over by freezing today's
--   answer as if it were history.
-- * No historical eligibility is invented anywhere: the only set this
--   migration ever writes is the one resolve_eligible_students returned at
--   the moment attendance was first saved.
-- * No UPDATE or DELETE privilege, and no such policy, on the new table —
--   for any role, including admin.
-- * No change to application code, UI, enrollment validation, or
--   materialization behaviour.
-- * No change to existing attendance rows, and no change to migrations
--   0010–0014.
