-- Phase 13 — Schedule.
--
-- A batch's recurring weekly meeting pattern (01-product.md §7, §12).
-- Deliberately does NOT create class_sessions: 04-development-plan.md's
-- Phase 13 definition resolves §7's "generate or identify" wording as
-- "compute occurrences for display only" — class_sessions is Phase 14's
-- table, once Attendance needs a stable row to attach records to.

create table if not exists public.schedules (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.batches (id) on delete restrict,
  instructor_id     uuid not null references public.instructors (id) on delete restrict,
  day_of_week       text not null
                      check (day_of_week in (
                        'monday', 'tuesday', 'wednesday', 'thursday',
                        'friday', 'saturday', 'sunday'
                      )),
  start_time        time not null,
  end_time          time not null,
  effective_from    date not null,
  effective_until   date,
  status            text not null default 'active'
                      check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint schedules_end_after_start check (end_time > start_time),
  constraint schedules_until_after_from
    check (effective_until is null or effective_until >= effective_from)
);

comment on table public.schedules is
  'A batch''s recurring weekly meeting pattern. Editing versions the row (close + insert) rather than rewriting it in place; deactivation closes it and never deletes.';

comment on column public.schedules.effective_until is
  'NULL means open-ended. Set when a version is closed (by an edit''s versioning, or by deactivation) — never left dangling on an edit that supersedes it.';

-- No membership_code/student_code-style generated identifier: 01-product.md
-- §7 and the approved wireframe show no product-facing "Schedule ID" field,
-- unlike Student ID or Membership ID. A schedule is identified by its
-- (batch, day, time, effective period), not a sequential code.

-- Indexes --------------------------------------------------------------------
-- One per FK, matching batch_enrollments_batch_id_idx / memberships_student_id_idx
-- — the Schedule list's Batch/Instructor filters and Batch Details' Schedules
-- tab all look up by one side of these two relationships.

create index if not exists schedules_batch_id_idx
  on public.schedules (batch_id);

create index if not exists schedules_instructor_id_idx
  on public.schedules (instructor_id);

-- No overlap/uniqueness constraint: 01-product.md §12 explicitly states V1
-- does not block overlapping schedules for either a batch or an instructor
-- (approved Phase 13 decision — see docs/04-development-plan.md §5). This is
-- a deliberate absence, not an oversight, unlike batch_enrollments' partial
-- unique index or memberships' exclusion constraint, both of which enforce
-- documented "at most one" rules that Schedule has no equivalent of.

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table schedules".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — deactivation replaces deletion
-- (01-product.md §7: "Schedules are deactivated rather than permanently
-- deleted").

grant select, insert, update on public.schedules to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as every prior feature table: schedule management
-- is an Admin capability (01-product.md §7 "Management").
--
-- Note for a later phase: Attendance and instructor-facing "Assigned
-- Classes" will need non-admin instructors to read their own schedules.
-- Relax the select policy then, not now.

alter table public.schedules enable row level security;

drop policy if exists "schedules_select_admin" on public.schedules;
create policy "schedules_select_admin"
  on public.schedules
  for select
  using (public.is_admin());

drop policy if exists "schedules_insert_admin" on public.schedules;
create policy "schedules_insert_admin"
  on public.schedules
  for insert
  with check (public.is_admin());

drop policy if exists "schedules_update_admin" on public.schedules;
create policy "schedules_update_admin"
  on public.schedules
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
