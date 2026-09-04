-- Phase 8 — Login + Supabase authentication foundation.
--
-- Minimum role storage only. Product entities (instructors, students,
-- memberships, batches, batch_enrollments, schedules, class_sessions,
-- attendance, center_profile) belong to later phases and are NOT created here.
--
-- V1 has exactly two application roles: admin and instructor.
-- Students have no login in V1.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'instructor'
                check (role in ('admin', 'instructor')),
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application role for an authenticated user. V1 roles: admin, instructor.';

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table profiles".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets nothing —
-- a signed-out visitor must not read profiles. The grants below match the two
-- RLS policies defined further down, and nothing more (no insert/delete).

grant select, update on public.profiles to authenticated;

-- Row Level Security ---------------------------------------------------------

alter table public.profiles enable row level security;

-- A user may read only their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- A user may update their own display name, but never their own role.
-- Role changes are an administrative action and are not exposed to the client.
drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- No insert or delete policy is defined: profiles are created by the trigger
-- below, and removed by the cascade from auth.users.

-- Provision a profile for every new auth user -------------------------------
-- Defaults to the least-privileged role. An administrator promotes a user to
-- 'admin' out-of-band; there is no self-service signup in V1.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'instructor')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
