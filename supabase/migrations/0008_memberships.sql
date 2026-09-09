-- Phase 12 — Memberships.
--
-- A student's membership period, used as part of attendance eligibility in
-- a later phase (01-product.md §5, §12). Independent of Batch Enrollment;
-- one membership can cover multiple enrollments, derived by date overlap,
-- not a stored link (docs/01-product.md §12).

-- btree_gist is required for the overlap-prevention exclusion constraint
-- below: EXCLUDE USING gist needs gist operator support for `=` on uuid
-- (student_id), which only btree_gist provides — gist has no native uuid
-- equality operator class of its own.
create extension if not exists btree_gist;

create table if not exists public.memberships (
  id               uuid primary key default gen_random_uuid(),
  -- The product-facing "Membership ID" (01-product.md §12: system-generated,
  -- unique, immutable, sequential "MEM-000001"). Named `membership_code`,
  -- matching students.student_code's naming (0006_students.sql) — kept
  -- distinct from any future FK column that would reference this table.
  membership_code  text not null,
  student_id       uuid not null references public.students (id) on delete restrict,
  plan             text not null check (plan in ('monthly', 'quarterly', 'custom')),
  start_date       date not null,
  end_date         date not null,
  amount           numeric(10, 2) not null check (amount > 0),
  payment_status   text not null default 'pending'
                     check (payment_status in ('paid', 'pending')),
  -- Cancellation is a fact, not a mutable status: set once, never cleared.
  -- Upcoming/Active/Expired are derived from start_date/end_date in the data
  -- layer (lib/memberships/data.js), never stored — see 01-product.md §12.
  cancelled_at     timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint memberships_end_after_start check (end_date >= start_date)
);

comment on table public.memberships is
  'A student''s membership period. Renewal always inserts a new row; cancellation sets cancelled_at and never deletes.';

comment on column public.memberships.membership_code is
  'The product-facing "Membership ID" (01-product.md §12). System-generated, unique, immutable — see set_membership_code() below.';

comment on column public.memberships.cancelled_at is
  'Set once when the membership is cancelled; never cleared. NULL means not cancelled. Cancellation overrides date-derived status.';

-- Membership ID generation ----------------------------------------------------
-- Sequential "MEM-000001" format (01-product.md §12), generated server-side,
-- exactly mirroring students.student_code's mechanism
-- (0006_students.sql) — a sequence is safe under concurrent inserts, and
-- the trigger unconditionally overwrites the column so a caller-supplied
-- value can never stick.

create sequence if not exists public.memberships_membership_code_seq;

create or replace function public.set_membership_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unconditional, not "only if not already supplied" — see
  -- set_student_code() in 0006_students.sql for why: membership_code
  -- behaves like an identity column the caller cannot influence.
  new.membership_code := 'MEM-' || lpad(nextval('public.memberships_membership_code_seq')::text, 6, '0');
  return new;
end;
$$;

comment on function public.set_membership_code() is
  'Assigns the sequential MEM-000001 membership_code on every insert, overwriting any value the caller supplied.';

drop trigger if exists set_membership_code_trigger on public.memberships;
create trigger set_membership_code_trigger
  before insert on public.memberships
  for each row
  execute function public.set_membership_code();

-- Immutability: 01-product.md §12 requires membership_code never change
-- once assigned — same reasoning and mechanism as
-- prevent_student_code_change() in 0006_students.sql.

create or replace function public.prevent_membership_code_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.membership_code is distinct from old.membership_code then
    raise exception 'membership_code is immutable and cannot be changed';
  end if;
  return new;
end;
$$;

comment on function public.prevent_membership_code_change() is
  'Rejects any update that changes membership_code (01-product.md §12: immutable).';

drop trigger if exists prevent_membership_code_change_trigger on public.memberships;
create trigger prevent_membership_code_change_trigger
  before update on public.memberships
  for each row
  execute function public.prevent_membership_code_change();

-- Indexes ----------------------------------------------------------------
-- membership_code is system-generated (always "MEM-" + digits), so a plain
-- unique index is sufficient — same reasoning as students_student_code_unique.

create unique index if not exists memberships_membership_code_unique
  on public.memberships (membership_code);

create index if not exists memberships_student_id_idx
  on public.memberships (student_id);

-- Overlap prevention -------------------------------------------------------
-- "A student cannot have overlapping non-cancelled membership periods"
-- (01-product.md §12) — the authoritative, database-level guarantee.
-- Application code validates this too (lib/memberships/validation.js,
-- lib/memberships/actions.js) for a clean, immediate field error, but that
-- check alone cannot close a race between two concurrent requests; this
-- exclusion constraint is what actually makes the rule hold.
--
-- `daterange(start_date, end_date, '[]')` treats both bounds as inclusive,
-- matching "same-day start/end is allowed" — a single-day range still
-- overlaps another range covering that same day. Partial `where` clause
-- mirrors batch_enrollments_one_active_per_batch's partial-unique-index
-- pattern (0007_batch_enrollments.sql): cancelled memberships are excluded
-- entirely, so a cancelled record never blocks a new one over the same
-- period, and this applies on both INSERT and UPDATE — inherent EXCLUDE
-- constraint behavior, not something a trigger has to add.

alter table public.memberships
  add constraint memberships_no_overlap_per_student
  exclude using gist (
    student_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (cancelled_at is null);

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table memberships".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — cancellation replaces deletion
-- (01-product.md §12: cancellation does not delete the record).

grant select, insert, update on public.memberships to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only in V1, same as Students and Batch Enrollments: membership
-- management is part of "Admin can... assign students to batches, change
-- batch enrollments" and Membership is listed as Admin-managed
-- (01-product.md §4, §11: "Instructor does not manage global Students,
-- Memberships, Batches, Schedules, Reports, or Settings").

alter table public.memberships enable row level security;

drop policy if exists "memberships_select_admin" on public.memberships;
create policy "memberships_select_admin"
  on public.memberships
  for select
  using (public.is_admin());

drop policy if exists "memberships_insert_admin" on public.memberships;
create policy "memberships_insert_admin"
  on public.memberships
  for insert
  with check (public.is_admin());

drop policy if exists "memberships_update_admin" on public.memberships;
create policy "memberships_update_admin"
  on public.memberships
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.
