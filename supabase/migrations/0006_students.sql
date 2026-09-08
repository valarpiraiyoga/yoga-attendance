-- Phase 11 — Students.
--
-- Represents the center's students (01-product.md §4). Independent of
-- Membership and Attendance, which are later phases; a student can exist
-- with no membership or attendance history yet.
--
-- Deactivation, never deletion (01-product.md §4, §12): `status` carries
-- active/inactive, and neither a delete privilege nor a delete policy exists.

create table if not exists public.students (
  id             uuid primary key default gen_random_uuid(),
  -- The product-facing "Student ID" (01-product.md §12: system-generated,
  -- unique, immutable, sequential "YC-000001"). Named `student_code` rather
  -- than `student_id` to avoid colliding with the FK column of that name on
  -- batch_enrollments (0007_batch_enrollments.sql), which references this
  -- table's `id`, not this column.
  student_code   text not null,
  full_name      text not null,
  phone          text not null,
  email          text,
  date_of_birth  date,
  gender         text check (gender in ('male', 'female', 'other')),
  join_date      date not null,
  -- No upload mechanism exists yet (no Supabase Storage bucket, no upload
  -- UI) — out of scope for this phase, matching how Instructor Photo was
  -- explicitly deferred in Phase 9. The column exists so the schema is
  -- forward-compatible; nothing in this phase writes to it.
  photo_url      text,
  notes          text,
  status         text not null default 'active'
                   check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.students is
  'Yoga center students. Deactivated via status, never deleted.';

comment on column public.students.student_code is
  'The product-facing "Student ID" (01-product.md §12). System-generated, unique, immutable — see set_student_code() below.';

-- Student ID generation ------------------------------------------------------
-- Sequential "YC-000001" format (01-product.md §12), generated server-side
-- so the format and uniqueness cannot depend on client behavior. A sequence
-- is safe under concurrent inserts, which application-side "count existing
-- rows + 1" logic would not be.

create sequence if not exists public.students_student_code_seq;

create or replace function public.set_student_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unconditional, not "only if not already supplied": a caller passing
  -- their own student_code in the insert payload must never have it stick.
  -- The column behaves like an identity column the caller cannot influence,
  -- not a default that merely fills in an omitted value.
  new.student_code := 'YC-' || lpad(nextval('public.students_student_code_seq')::text, 6, '0');
  return new;
end;
$$;

comment on function public.set_student_code() is
  'Assigns the sequential YC-000001 student_code on every insert, overwriting any value the caller supplied.';

drop trigger if exists set_student_code_trigger on public.students;
create trigger set_student_code_trigger
  before insert on public.students
  for each row
  execute function public.set_student_code();

-- Immutability: 01-product.md §12 requires student_code never change once
-- assigned. Enforced here rather than only by omitting it from the Edit
-- form, so it holds regardless of how a row is later written.

create or replace function public.prevent_student_code_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_code is distinct from old.student_code then
    raise exception 'student_code is immutable and cannot be changed';
  end if;
  return new;
end;
$$;

comment on function public.prevent_student_code_change() is
  'Rejects any update that changes student_code (01-product.md §12: immutable).';

drop trigger if exists prevent_student_code_change_trigger on public.students;
create trigger prevent_student_code_change_trigger
  before update on public.students
  for each row
  execute function public.prevent_student_code_change();

-- Indexes --------------------------------------------------------------------
-- student_code is system-generated (always "YC-" + digits), so a plain
-- unique index is sufficient — there is no user-typed casing to normalize,
-- unlike batches.code.
--
-- No uniqueness on phone or email: 01-product.md does not require either to
-- be unique, unlike instructor email — do not add a constraint the product
-- docs do not state.
--
-- No index is added for the status filter or the name/phone search: at this
-- table's expected size the planner will sequentially scan regardless, so
-- they would be speculative.

create unique index if not exists students_student_code_unique
  on public.students (student_code);

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table students".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — deactivation replaces deletion
-- (01-product.md §4, §12).

grant select, insert, update on public.students to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as Instructors and Batches: "Admin can view,
-- search, add, edit, activate/deactivate students" (01-product.md §4).
--
-- Note for a later phase: Attendance will need non-admin instructors to read
-- student names for their assigned sessions. Relax the select policy then,
-- not now.

alter table public.students enable row level security;

drop policy if exists "students_select_admin" on public.students;
create policy "students_select_admin"
  on public.students
  for select
  using (public.is_admin());

drop policy if exists "students_insert_admin" on public.students;
create policy "students_insert_admin"
  on public.students
  for insert
  with check (public.is_admin());

drop policy if exists "students_update_admin" on public.students;
create policy "students_update_admin"
  on public.students
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
