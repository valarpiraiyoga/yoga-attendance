-- Phase 11 — Batch Enrollment.
--
-- Links a student to a batch over an effective period (01-product.md §4,
-- §12). A student can hold multiple simultaneous enrollments across
-- different batches; enrollment changes must preserve historical attendance,
-- so enrollments are deactivated, never deleted or overwritten.

create table if not exists public.batch_enrollments (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict, not cascade, on both FKs: neither students nor batches can
  -- actually be deleted through this app (no delete grant/policy on
  -- either), but restrict makes that guarantee hold at the schema level
  -- too, rather than relying solely on the absent grant. A cascade here
  -- would silently destroy enrollment history exactly where the product
  -- docs require it to be preserved.
  student_id            uuid not null references public.students (id) on delete restrict,
  batch_id              uuid not null references public.batches (id) on delete restrict,
  effective_start_date  date not null,
  effective_end_date    date,
  status                text not null default 'active'
                          check (status in ('active', 'inactive')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint batch_enrollments_end_after_start
    check (effective_end_date is null or effective_end_date >= effective_start_date)
);

comment on table public.batch_enrollments is
  'A student''s enrollment in a batch over an effective period. Deactivated via status, never deleted — historical enrollments are retained.';

-- Indexes --------------------------------------------------------------------
-- At most one ACTIVE enrollment per (student, batch) pair (01-product.md
-- §12): "A student has at most one active enrollment in the same batch at a
-- time." Partial on status = 'active' so a student can freely accumulate
-- inactive/historical enrollments for the same batch (re-enrollment after
-- leaving) without ever colliding with this constraint — only two
-- simultaneously ACTIVE rows for the same pair are rejected.
--
-- This is what a duplicate-active-enrollment attempt actually hits at the
-- database layer; lib/enrollments/actions.js maps its 23505 to a field
-- error the same way lib/batches/actions.js already does for batch code.

create unique index if not exists batch_enrollments_one_active_per_batch
  on public.batch_enrollments (student_id, batch_id)
  where status = 'active';

-- A student's own enrollment list (Student Details) and a batch's own
-- enrolled-student list (future Batch Details "Students" tab) are both
-- looked up by one side of the pair; index the side not already covered by
-- the partial index above.

create index if not exists batch_enrollments_batch_id_idx
  on public.batch_enrollments (batch_id);

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table batch_enrollments".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — deactivation replaces deletion
-- (01-product.md §4, §12).

grant select, insert, update on public.batch_enrollments to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as Students and Batches: enrollment management is
-- part of "Admin can... assign students to batches, change batch
-- enrollments" (01-product.md §4).
--
-- Note for a later phase: Attendance will need non-admin instructors to read
-- enrollments for their assigned sessions' eligibility checks. Relax the
-- select policy then, not now.

alter table public.batch_enrollments enable row level security;

drop policy if exists "batch_enrollments_select_admin" on public.batch_enrollments;
create policy "batch_enrollments_select_admin"
  on public.batch_enrollments
  for select
  using (public.is_admin());

drop policy if exists "batch_enrollments_insert_admin" on public.batch_enrollments;
create policy "batch_enrollments_insert_admin"
  on public.batch_enrollments
  for insert
  with check (public.is_admin());

drop policy if exists "batch_enrollments_update_admin" on public.batch_enrollments;
create policy "batch_enrollments_update_admin"
  on public.batch_enrollments
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
