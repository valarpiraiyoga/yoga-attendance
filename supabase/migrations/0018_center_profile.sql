-- Phase 19 — Settings: Center Profile.
--
-- The center-wide information Settings' "Center Profile" tab manages
-- (01-product.md §11: "Admin can manage: Yoga Center name, Logo, Address,
-- Phone, Email"; wireframe p.38). There is exactly one center in this
-- product — the singleton-table pattern below is what makes "exactly one
-- row can ever exist" a database guarantee rather than an application
-- convention that a second insert could quietly violate.
--
-- Report-export integration ("Center information may appear in exported
-- attendance reports", same section) is explicitly NOT wired up by this
-- migration or by Phase 19 — Reports is a separate, already-completed
-- feature area and is out of scope here. This migration only makes the
-- data manageable; a later phase decides how (or whether) exports read it.

create table if not exists public.center_profile (
  -- The singleton key: a boolean column that can only ever hold `true`,
  -- as its own primary-key uniqueness constraint. A second `insert`
  -- attempting `singleton = true` collides with the existing row's primary
  -- key, and the CHECK below rules out the only other boolean value — so
  -- "at most one row" is enforced by the schema itself, not by application
  -- discipline.
  singleton   boolean primary key default true,
  name        text not null default 'Yoga Center',
  -- No upload mechanism exists yet (no Supabase Storage bucket, no upload
  -- UI) — deferred, matching how Instructor Photo and Student Profile Photo
  -- were both explicitly deferred (Phase 9, Phase 6). This column exists
  -- for forward compatibility only; nothing in this phase writes to it.
  logo_url    text,
  address     text,
  phone       text,
  email       text,
  updated_at  timestamptz not null default now(),

  constraint center_profile_is_singleton check (singleton)
);

comment on table public.center_profile is
  'The one center-wide profile record (01-product.md §11). The `singleton` primary key guarantees at most one row can ever exist.';

comment on column public.center_profile.logo_url is
  'Forward-compatible only — no upload mechanism exists yet, matching students.photo_url and instructors'' own deferred photo field.';

-- Seed the single row now, so the Settings screen always has something to
-- show and edit rather than needing to handle "no row exists yet" as a real
-- state on every page load. `do nothing` makes this migration safe to run
-- again without creating a second row or overwriting an admin's edits.
insert into public.center_profile (singleton)
values (true)
on conflict (singleton) do nothing;

-- Table privileges -----------------------------------------------------------
-- Only `authenticated` is granted anything; `anon` gets nothing. No insert
-- and no delete: the single row is seeded once by this migration and only
-- ever updated afterwards — there is no "add a center profile" or "remove
-- the center profile" concept in the product.

grant select, update on public.center_profile to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only, same as every other Settings-managed entity (Batches,
-- Instructors): "Admin can manage" (01-product.md §11) has no instructor
-- equivalent — Settings itself is not in an instructor's navigation
-- (02-ux.md's Role-Based IA).

alter table public.center_profile enable row level security;

drop policy if exists "center_profile_select_admin" on public.center_profile;
create policy "center_profile_select_admin"
  on public.center_profile
  for select
  using (public.is_admin());

drop policy if exists "center_profile_update_admin" on public.center_profile;
create policy "center_profile_update_admin"
  on public.center_profile
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No insert policy, no delete policy, and neither privilege is granted.
