-- Phase 9b — Instructor identity.
--
-- Links an instructor record to the auth user who signs in as them
-- (01-product.md §11 "Provide instructor login access"; 02-ux.md Flow 12).
--
-- Additive only: 0002_instructors.sql is already applied and is not edited.
-- Every existing instructor keeps working with user_id null — an instructor
-- is a domain entity that exists long before, or entirely without, a login.

alter table public.instructors
  add column if not exists user_id uuid
    references auth.users (id) on delete set null;

comment on column public.instructors.user_id is
  'Auth user who signs in as this instructor. Null until an admin provides login access.';

-- Indexes --------------------------------------------------------------------
-- At most one instructor per auth user. Partial, so the many instructors
-- without login access do not collide with each other on null.
--
-- on delete set null, never cascade: removing an auth user must not remove
-- the instructor record. Deactivation replaces deletion (01-product.md §12),
-- and later schedules and attendance will reference this row.

create unique index if not exists instructors_user_id_unique
  on public.instructors (user_id)
  where user_id is not null;

-- Row Level Security ---------------------------------------------------------
-- Additive. The three admin-only policies from 0002 are unchanged, and
-- policies are permissive and OR'd, so this widens read access by exactly one
-- row — the caller's own instructor record — and by nothing else.
--
-- Deliberately not filtered by status: a deactivated instructor must still
-- resolve their own record, or the application cannot tell "your access is
-- disabled" apart from "you are not an instructor". Status is an
-- authorization question (see current_instructor_id below), not a reason to
-- hide a person's own name from them.
--
-- Read only. No insert/update/delete policy is added, so the table-level
-- privileges 0002 granted to `authenticated` stay unreachable for non-admins:
-- managing instructors remains an admin action (01-product.md §11).

drop policy if exists "instructors_select_self" on public.instructors;
create policy "instructors_select_self"
  on public.instructors
  for select
  using (user_id = auth.uid());

-- Shared authorization helper ------------------------------------------------
-- The instructor-side counterpart to is_admin(): resolves the caller to their
-- own instructor id, or null.
--
-- Null when the caller is signed out, is not linked to an instructor, or is
-- linked to an inactive one — so deactivating an instructor revokes data
-- access at the database, not only in the UI.
--
-- Later phases use this as the RLS predicate for instructor-scoped tables
-- (class_sessions, attendance). Those policies belong to those phases and are
-- deliberately not defined here.
--
-- security definer / stable / search_path = '': same reasoning as is_admin()
-- in 0002 — it must not depend on the caller's own visibility of this table,
-- it is evaluated once per statement rather than once per row, and every
-- identifier is schema-qualified so a caller-controlled search_path cannot
-- hijack it.

create or replace function public.current_instructor_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from public.instructors
  where user_id = auth.uid()
    and status = 'active';
$$;

comment on function public.current_instructor_id() is
  'The calling user''s instructor id when linked and active; null otherwise.';

grant execute on function public.current_instructor_id() to authenticated;
