-- Phase 9 — Settings → Instructors.
--
-- Instructor is an independent entity (01-product.md §11). It is assigned to
-- schedules in a later phase, so no schedule/batch relationships appear here.
--
-- No foreign key to auth.users: "provide instructor login access"
-- (02-ux.md Flow 12) is deferred to its own phase and needs separate design.
--
-- Deactivation, never deletion (01-product.md §12): `status` carries
-- active/inactive, and neither a delete privilege nor a delete policy exists.

create table if not exists public.instructors (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  email       text,
  status      text not null default 'active'
                check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.instructors is
  'Instructors who conduct classes. Independent entity; assigned at schedule level. Deactivated via status, never deleted.';

-- Indexes --------------------------------------------------------------------
-- Only a correctness constraint is added. An instructor's email identifies
-- them and must not be duplicated, case-insensitively, when present.
--
-- No indexes are added for the status filter or the full_name sort: at this
-- table's expected size the planner will sequentially scan regardless, so they
-- would be speculative. Add them when data volume actually justifies it.

create unique index if not exists instructors_email_unique
  on public.instructors (lower(email))
  where email is not null;

-- Shared authorization helper ------------------------------------------------
-- Reports whether the calling user holds the admin role. Used by the policies
-- below and reusable by every later feature table, so admin checks stay in one
-- place instead of repeating a subquery in each policy.
--
-- security definer: reads public.profiles independently of that table's own
-- RLS. It discloses nothing beyond a boolean about the caller themselves.
-- stable: lets Postgres evaluate it once per statement rather than per row.
-- search_path = '': every identifier inside is schema-qualified, so the
-- function cannot be hijacked by a caller-controlled search_path.

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True when the calling user has role = admin in public.profiles.';

grant execute on function public.is_admin() to authenticated;

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table instructors".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets nothing.
-- No delete is granted — deactivation replaces deletion (01-product.md §12).

grant select, insert, update on public.instructors to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1: an Instructor does not manage Settings (01-product.md §11).
-- The grants above are role-wide; these policies are what actually restrict
-- access to admins. Both layers are required.
--
-- Note for a later phase: Schedule will need non-admins to read instructor
-- names. Relax the select policy then, not now.

alter table public.instructors enable row level security;

drop policy if exists "instructors_select_admin" on public.instructors;
create policy "instructors_select_admin"
  on public.instructors
  for select
  using (public.is_admin());

drop policy if exists "instructors_insert_admin" on public.instructors;
create policy "instructors_insert_admin"
  on public.instructors
  for insert
  with check (public.is_admin());

drop policy if exists "instructors_update_admin" on public.instructors;
create policy "instructors_update_admin"
  on public.instructors
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
