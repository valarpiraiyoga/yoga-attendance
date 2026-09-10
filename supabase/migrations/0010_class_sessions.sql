-- Phase 14 — Class Sessions.
--
-- One dated occurrence of a recurring schedule (01-product.md §7A, §12).
-- Rows here exist only for occurrences that have been *materialized* — an
-- occurrence that has never needed a session-specific change, a
-- cancellation/holiday, or attendance stays purely projected
-- (lib/schedules/data.js's `projectUpcomingSessions`) and has no row here
-- at all. This table is therefore always a strict subset of what could be
-- projected from `schedules`, never the full set.

create table if not exists public.class_sessions (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.schedules (id) on delete restrict,
  -- Snapshots of the schedule at the moment this session was materialized
  -- (01-product.md §7A "Snapshot and Historical Integrity"): once written,
  -- these never change because a later schedule edit, version, or
  -- deactivation touched the schedule row. Only Edit This Session (a
  -- later Phase 14 UI slice) may change them, and only for this one row.
  batch_id       uuid not null references public.batches (id) on delete restrict,
  instructor_id  uuid not null references public.instructors (id) on delete restrict,
  session_date   date not null,
  start_time     time not null,
  end_time       time not null,
  status         text not null default 'scheduled'
                   check (status in ('scheduled', 'completed', 'cancelled', 'holiday')),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint class_sessions_end_after_start check (end_time > start_time),
  -- At most one materialized session per schedule per date
  -- (01-product.md §7A "Data Requirements") — this is also what makes the
  -- materialization helper (lib/class-sessions/actions.js) safe to call
  -- repeatedly for the same occurrence without ever creating a duplicate.
  constraint class_sessions_schedule_date_unique unique (schedule_id, session_date)
);

comment on table public.class_sessions is
  'A materialized occurrence of a recurring schedule. Only occurrences that needed a session-specific change, a cancellation/holiday, or attendance are rows here — everything else stays projected. Never deleted; cancellation/holiday are statuses, not removal.';

comment on column public.class_sessions.status is
  'Persisted states only: scheduled, completed, cancelled, holiday. Upcoming/In Progress are derived from session_date/start_time/end_time against the centre timezone at read time, never stored (01-product.md §7A).';

comment on column public.class_sessions.note is
  'Optional — set when a session is marked cancelled or holiday (Flow 07). Nullable for every other status.';

-- No membership_code/student_code-style generated identifier: 01-product.md
-- §7A states plainly that a class session has no product-facing
-- identifier, unlike Student ID or Membership ID.

-- Indexes ----------------------------------------------------------------
-- session_date: both session lists (Today's Sessions, All Sessions) filter
-- and sort by it. batch_id/instructor_id: one per FK, matching every prior
-- feature table's own-FK indexes (schedules_batch_id_idx and
-- schedules_instructor_id_idx are the immediate precedent) — the same
-- Batch/Instructor filters Schedule already has are expected on session
-- lists once Phase 14's UI slice adds them.

create index if not exists class_sessions_session_date_idx
  on public.class_sessions (session_date);

create index if not exists class_sessions_batch_id_idx
  on public.class_sessions (batch_id);

create index if not exists class_sessions_instructor_id_idx
  on public.class_sessions (instructor_id);

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table class_sessions".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — class sessions are never deleted
-- (01-product.md §7A "Data Requirements": "Sessions are never deleted —
-- cancellation replaces deletion").

grant select, insert, update on public.class_sessions to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as every prior feature table
-- (01-product.md §7A "Data Requirements": "Admin-only in V1").
--
-- Note for Phase 15: Attendance and instructor-facing "Assigned Classes"
-- will need non-admin instructors to read (and, for their own assigned
-- sessions, update — attendance status) their own class sessions. Relax
-- the select policy then, not now — see 01-product.md §7A's own note that
-- instructor read access "will be addressed in Phase 15".

alter table public.class_sessions enable row level security;

drop policy if exists "class_sessions_select_admin" on public.class_sessions;
create policy "class_sessions_select_admin"
  on public.class_sessions
  for select
  using (public.is_admin());

drop policy if exists "class_sessions_insert_admin" on public.class_sessions;
create policy "class_sessions_insert_admin"
  on public.class_sessions
  for insert
  with check (public.is_admin());

drop policy if exists "class_sessions_update_admin" on public.class_sessions;
create policy "class_sessions_update_admin"
  on public.class_sessions
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
