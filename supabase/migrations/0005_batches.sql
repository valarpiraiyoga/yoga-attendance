-- Phase 10 — Batches.
--
-- Represents the yoga class types the center offers (01-product.md §6).
-- Independent of Schedule/Class Sessions, which are later phases; a batch
-- can exist with no schedule yet ("the same batch can have multiple
-- schedules across different days and times").
--
-- Deactivation, never deletion (01-product.md §12): `status` carries
-- active/inactive, and neither a delete privilege nor a delete policy exists.

create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null,
  category    text,
  description text,
  status      text not null default 'active'
                check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.batches is
  'Yoga class types offered by the center. Deactivated via status, never deleted.';

-- Indexes --------------------------------------------------------------------
-- Short code identifies a batch and must be unique, case-insensitively
-- (01-product.md §12: the Weekly Schedule identifies a batch by its short
-- code alone, so two batches sharing a code would be ambiguous there). Code
-- is required, unlike an instructor's optional email, so this index is not
-- partial.
--
-- No index is added for the status filter or the name/code search: at this
-- table's expected size (initial data lists seven batches) the planner will
-- sequentially scan regardless, so they would be speculative.

create unique index if not exists batches_code_unique
  on public.batches (lower(code));

-- Shared authorization helper is reused --------------------------------------
-- public.is_admin() already exists (0002_instructors.sql) and is not
-- redefined here.

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table batches".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets nothing.
-- No delete is granted — deactivation replaces deletion (01-product.md §12).

grant select, insert, update on public.batches to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as Instructors: "Admin can create, edit, activate,
-- and deactivate batches" (01-product.md §6).
--
-- Note for a later phase: Schedule and Attendance will need non-admins to
-- read batch names for their assigned classes. Relax the select policy then,
-- not now.

alter table public.batches enable row level security;

drop policy if exists "batches_select_admin" on public.batches;
create policy "batches_select_admin"
  on public.batches
  for select
  using (public.is_admin());

drop policy if exists "batches_insert_admin" on public.batches;
create policy "batches_insert_admin"
  on public.batches
  for insert
  with check (public.is_admin());

drop policy if exists "batches_update_admin" on public.batches;
create policy "batches_update_admin"
  on public.batches
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
