-- Phase 15A — Schedule assignment architecture correction.
--
-- A batch can run several recurring schedules, including more than one on
-- the same weekday (01-product.md §6). Slices 1–2 resolved attendance
-- eligibility by *batch* alone, which is wrong the moment a batch has more
-- than one schedule: a student enrolled in the batch would show as
-- eligible for every one of its classes, not only the one they actually
-- attend. This migration introduces schedule assignment — which of a
-- batch's schedules a given enrollment attends — and updates the
-- eligibility/save functions to use it.
--
-- 0010_class_sessions.sql, 0011_attendance.sql and
-- 0012_attendance_eligibility_membership_details.sql are already applied
-- and are not touched or reissued here. Everything below is additive
-- (new tables, a new nullable-then-not-null column, function bodies
-- replaced by name) — no existing row in schedules, batch_enrollments,
-- class_sessions, attendance or memberships is deleted, and no existing
-- id changes.

-- ============================================================================
-- A. schedule_series — stable schedule identity
-- ============================================================================
-- Editing a schedule versions it (0009_schedules.sql: close the current
-- row, insert a new one with a new id). Nothing before this migration gave
-- those versions a shared identity, so anything that referenced
-- `schedules.id` directly would silently stop matching the moment an
-- admin edited that schedule. `schedule_series` is that shared identity —
-- "the Monday 6:00 AM Hatha Yoga class" — which schedule versions belong
-- to and which student schedule assignments (enrollment_schedules, below)
-- and session eligibility refer to instead.

create table if not exists public.schedule_series (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.batches (id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table public.schedule_series is
  'Stable identity for one recurring class slot, shared by every version that schedule has had (0009_schedules.sql versions schedules.id on edit, never this id). Student schedule assignments and attendance eligibility refer to this id, so editing a schedule never orphans them.';

create index if not exists schedule_series_batch_id_idx
  on public.schedule_series (batch_id);

grant select, insert, update on public.schedule_series to authenticated;

alter table public.schedule_series enable row level security;

drop policy if exists "schedule_series_select_admin" on public.schedule_series;
create policy "schedule_series_select_admin"
  on public.schedule_series
  for select
  using (public.is_admin());

drop policy if exists "schedule_series_insert_admin" on public.schedule_series;
create policy "schedule_series_insert_admin"
  on public.schedule_series
  for insert
  with check (public.is_admin());

drop policy if exists "schedule_series_update_admin" on public.schedule_series;
create policy "schedule_series_update_admin"
  on public.schedule_series
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.

-- ============================================================================
-- B. schedules.series_id
-- ============================================================================
-- Added nullable, backfilled, then made NOT NULL — never dropping or
-- recreating any existing schedules row, so every existing id and every
-- existing class_sessions.schedule_id reference stays exactly as it was.
--
-- Version chains cannot be reconstructed here: no column has ever linked
-- one schedule version to the one it replaced, so there is no way to know
-- which existing rows are "the same slot" at different times. Each
-- existing schedule row therefore gets its own, brand-new series. That is
-- harmless — no schedule assignment exists yet for any of them — and every
-- assignment created from this point forward sits on a correctly
-- maintained series, since lib/schedules/actions.js's versioning branch
-- (updated in the following implementation slice, not this migration)
-- will carry `series_id` forward from the row it supersedes.

alter table public.schedules
  add column if not exists series_id uuid references public.schedule_series (id) on delete restrict;

do $$
declare
  r record;
  v_series_id uuid;
begin
  for r in
    select id, batch_id, created_at
    from public.schedules
    where series_id is null
  loop
    -- created_at carries the schedule's own original creation time, not
    -- "now" — general-purpose metadata for when this slot's identity was
    -- first established. Not consumed by the enrollment_schedules backfill
    -- below (D), which dates assignments from the schedule's own
    -- effective_from/effective_until instead — a schedule's product-facing
    -- effective period, not a technical creation timestamp.
    insert into public.schedule_series (batch_id, created_at)
    values (r.batch_id, r.created_at)
    returning id into v_series_id;

    update public.schedules
    set series_id = v_series_id
    where id = r.id;
  end loop;
end;
$$;

alter table public.schedules
  alter column series_id set not null;

create index if not exists schedules_series_id_idx
  on public.schedules (series_id);

comment on column public.schedules.series_id is
  'The stable schedule_series this version belongs to. Constant across every version an edit produces (0009_schedules.sql); what enrollment_schedules and resolve_eligible_students match against instead of a single schedule version.';

-- ============================================================================
-- C. enrollment_schedules — which schedules an enrollment attends
-- ============================================================================
-- Belongs to the batch enrollment, not the student directly (01-product.md
-- §4 "Schedule Assignment") — a student re-enrolling in the same batch
-- later gets a fresh enrollment and fresh assignments, not a shared pool.
-- One enrollment may hold several assignments at once (a student attending
-- both the 6:00 AM and the 7:00 PM class of one batch).
--
-- No status column: effective_start_date/effective_end_date alone
-- determine validity, mirroring `memberships` (which has no status column
-- either) rather than `batch_enrollments` (which has both status and
-- dates) — one source of truth for whether an assignment applies on a
-- given date, not two that can disagree.

create table if not exists public.enrollment_schedules (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: matching every FK in this schema. Neither a
  -- batch enrollment nor a schedule series is ever deleted through this
  -- app (no delete grant/policy on either), but restrict makes that
  -- guarantee hold at the schema level too.
  batch_enrollment_id   uuid not null references public.batch_enrollments (id) on delete restrict,
  schedule_series_id    uuid not null references public.schedule_series (id) on delete restrict,
  effective_start_date  date not null,
  effective_end_date    date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint enrollment_schedules_end_after_start
    check (effective_end_date is null or effective_end_date >= effective_start_date)
);

comment on table public.enrollment_schedules is
  'Which of a batch''s recurring schedules a student''s enrollment attends, and for what period (01-product.md §4 "Schedule Assignment"). No status column — date coverage alone determines validity. Changing a student''s schedule closes the existing assignment and opens a new one rather than rewriting it, so past attendance eligibility stays reconstructable.';

-- Overlap prevention, mirroring memberships_no_overlap_per_student
-- (0008_memberships.sql, which already installed btree_gist): at most one
-- *overlapping* assignment for the same (enrollment, schedule series)
-- pair — the same schedule cannot be double-assigned to one enrollment
-- for the same dates. Scoped per schedule_series_id, not per enrollment
-- alone, so a student's genuinely different, time-overlapping schedules
-- (e.g. two classes that happen to overlap) are NOT blocked by this
-- constraint — 01-product.md §7 "Conflicts" already treats that as
-- operational judgement, not a system-enforced rule, and approved
-- decision 6 carries that forward to schedule assignment.

alter table public.enrollment_schedules
  add constraint enrollment_schedules_no_overlap
  exclude using gist (
    batch_enrollment_id with =,
    schedule_series_id with =,
    daterange(effective_start_date, effective_end_date, '[]') with &&
  );

-- Two plain btree indexes rather than relying on the exclusion
-- constraint's own GiST index for lookups: the eligibility function (E)
-- and the enrollment UI both look up "every assignment for this
-- enrollment" or "every assignment on this series" by plain equality, the
-- same one-index-per-FK-access-path convention schedules_batch_id_idx /
-- schedules_instructor_id_idx already use (0009_schedules.sql) — the GiST
-- index exists to enforce the constraint, not to serve these lookups.

create index if not exists enrollment_schedules_enrollment_id_idx
  on public.enrollment_schedules (batch_enrollment_id);

create index if not exists enrollment_schedules_series_id_idx
  on public.enrollment_schedules (schedule_series_id);

-- Table privileges -----------------------------------------------------------
grant select, insert, update on public.enrollment_schedules to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only, same as batch_enrollments itself. Instructor access is a
-- later Phase 15 slice, same note as every other table in this schema.

alter table public.enrollment_schedules enable row level security;

drop policy if exists "enrollment_schedules_select_admin" on public.enrollment_schedules;
create policy "enrollment_schedules_select_admin"
  on public.enrollment_schedules
  for select
  using (public.is_admin());

drop policy if exists "enrollment_schedules_insert_admin" on public.enrollment_schedules;
create policy "enrollment_schedules_insert_admin"
  on public.enrollment_schedules
  for insert
  with check (public.is_admin());

drop policy if exists "enrollment_schedules_update_admin" on public.enrollment_schedules;
create policy "enrollment_schedules_update_admin"
  on public.enrollment_schedules
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.

-- ============================================================================
-- D. Backfill existing ACTIVE enrollments
-- ============================================================================
-- Without this, every existing enrollment has zero assignments the moment
-- this migration lands, and the corrected eligibility rule in (E) would
-- make every existing student ineligible for everything, past and
-- present.
--
-- Corrected per the read-only architecture audit: the first version of
-- this backfill only assigned enrollments to whichever schedule was
-- *currently* in effect. Because (B) above gives every existing schedule
-- row its own, separate series — the only sound choice, version chains
-- being unreconstructable — that meant an enrollment predating a schedule
-- edit would get no assignment at all to the old, now-superseded series.
-- Any class_sessions row generated under that old schedule would then
-- resolve zero eligible students, silently rewriting who was eligible for
-- a class that already happened. This version fixes that: it assigns an
-- enrollment to *every* schedule row of its batch whose effective period
-- ever overlapped the enrollment's own active period, current or not, so
-- a past session generated under a superseded schedule still resolves
-- against the assignment that was actually in effect for it.
--
-- Scope (approved decisions 1, 3, and the corrected historical rule):
-- - Active batch_enrollments only. Inactive/historical enrollments are
--   untouched — they are not being made eligible for anything, new or
--   historical.
-- - Every schedule row of the enrollment's batch whose own effective
--   period (effective_from/effective_until) overlaps the enrollment's own
--   active period (effective_start_date/effective_end_date) — regardless
--   of that schedule's current `status`. Schedule status is an
--   operational flag, not a historical-eligibility fact: a schedule that
--   is inactive *today* can still have been the live version for part of
--   the enrollment's period, and must still produce an assignment for
--   that part.
-- - Each existing schedule row maps to exactly one series (from (B)), so
--   this produces at most one candidate assignment per (enrollment,
--   schedule) pair — already one (enrollment, series) pair, with no
--   separate de-duplication needed beyond the NOT EXISTS guard, which
--   makes re-running this migration a no-op on rows it already created.
--
-- Overlap and date range: `daterange(..., '[]')` matches the inclusive-
-- both-ends convention this migration's own enrollment_schedules_no_overlap
-- constraint already uses. The `&&` overlap test is both the "should an
-- assignment be created at all" condition and the guarantee that the
-- computed range below is valid (start <= end) — two ranges that overlap
-- always have a non-empty intersection, so no separate validity check is
-- needed.
--
-- effective_start_date = GREATEST(enrollment.effective_start_date,
-- schedule.effective_from) — whichever started later within the
-- overlapping period.
-- effective_end_date = LEAST(enrollment.effective_end_date,
-- schedule.effective_until), treating a null side as open-ended (not as
-- smaller/larger than the other) — null only when *both* sides are
-- open-ended, since the assignment cannot outlive whichever side actually
-- ends.

insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
select
  be.id,
  s.series_id,
  greatest(be.effective_start_date, s.effective_from),
  case
    when be.effective_end_date is null then s.effective_until
    when s.effective_until is null then be.effective_end_date
    else least(be.effective_end_date, s.effective_until)
  end
from public.batch_enrollments be
join public.schedules s
  on s.batch_id = be.batch_id
  and daterange(be.effective_start_date, be.effective_end_date, '[]')
        && daterange(s.effective_from, s.effective_until, '[]')
where be.status = 'active'
  and not exists (
    select 1
    from public.enrollment_schedules es
    where es.batch_enrollment_id = be.id
      and es.schedule_series_id = s.series_id
  );

-- ============================================================================
-- E. resolve_eligible_students — schedule-scoped eligibility
-- ============================================================================
-- Signature changes from (batch_id, session_date) to
-- (batch_id, schedule_id, session_date) — return type changes are not
-- permitted via CREATE OR REPLACE, so this drops and recreates it, the
-- same pattern 0012 already used against this same function. The DROP is
-- safe even though save_session_attendance (F, below) calls it by name:
-- PL/pgSQL function bodies are not dependency-tracked, and this script
-- recreates both functions before either is ever called again.
--
-- Adds exactly one condition to the D1–D3 rule 0011/0012 already
-- established (unchanged): the student's batch enrollment must carry a
-- schedule assignment, on the session's own schedule series, covering the
-- session date. Being enrolled in the batch is no longer sufficient by
-- itself — the enrollment must also be assigned to *this* schedule.

drop function if exists public.resolve_eligible_students(uuid, date);

create function public.resolve_eligible_students(
  p_batch_id uuid,
  p_schedule_id uuid,
  p_session_date date
)
returns table (
  student_id uuid,
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
  if not public.is_admin() then
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
    -- NEW (Phase 15A): the enrollment must carry a schedule assignment on
    -- this session's own schedule series, covering the session date.
    -- Being enrolled in the batch is not sufficient on its own.
    and exists (
      select 1
      from public.enrollment_schedules es
      where es.batch_enrollment_id = be.id
        and es.schedule_series_id = v_series_id
        and es.effective_start_date <= p_session_date
        and (es.effective_end_date is null or es.effective_end_date >= p_session_date)
    )
    -- D3: a membership covers the session date if it was not yet
    -- cancelled as of that date. Cancelling a membership today must not
    -- retroactively invalidate eligibility for an earlier session date —
    -- only dates on/after the cancellation are excluded.
    and m.start_date <= p_session_date
    and m.end_date >= p_session_date
    and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone 'Asia/Kolkata')::date)
  -- Tie-break (unchanged from 0012): prefer a membership not cancelled as
  -- of the session date, then the most recently started.
  order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc;
end;
$$;

comment on function public.resolve_eligible_students(uuid, uuid, date) is
  'The single source of attendance eligibility (01-product.md §8; Phase 15A): active student, active batch enrollment covering the date, a schedule assignment covering the date on the session''s own schedule series (p_schedule_id resolved to its series_id), and active membership covering the date. Evaluated as of p_session_date, never "today". Also returns the qualifying membership''s date range for display; when more than one membership qualifies, prefers one not cancelled as of the session date, then the most recently started (display tie-break only). Admin-only for this slice.';

grant execute on function public.resolve_eligible_students(uuid, uuid, date) to authenticated;

-- ============================================================================
-- F. save_session_attendance — pass the session's schedule through
-- ============================================================================
-- Signature and return type are unchanged (still (uuid, jsonb) -> jsonb),
-- so this is CREATE OR REPLACE, not a drop — every other caller and grant
-- keeps working. The only change from 0011's body is the
-- resolve_eligible_students call now also passing the session's own
-- schedule_id, so eligibility is resolved schedule-scoped rather than
-- batch-scoped. Every other check, the atomicity, the materialization
-- boundary, and the D10 partial-save behaviour are unchanged.

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
  v_today            date;
  v_mark             jsonb;
  v_student_id       uuid;
  v_status           text;
  v_eligible_ids     uuid[];
  v_submitted_ids    uuid[];
  v_invalid_ids      uuid[];
  v_marked_count     integer := 0;
begin
  if not public.is_admin() then
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
  -- batch_id and schedule_id (authoritative per §7A), never the
  -- schedule's current batch.
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
  'The only writer of attendance rows and the only path that sets class_sessions.status = completed. Atomic: validates the session, rejects cancelled/holiday and future dates, re-validates eligibility server-side (schedule-scoped, Phase 15A), upserts present/absent marks (never deletes), then completes the session — all in one transaction. p_marks is a JSON array of {"student_id","status"} objects; an eligible student absent from it stays unmarked. Requires an already-materialized class_sessions.id — see 0011_attendance.sql''s "Materialization boundary" comment.';

grant execute on function public.save_session_attendance(uuid, jsonb) to authenticated;
