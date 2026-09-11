-- Phase 15 — Attendance foundation.
--
-- One Present/Absent record per (class session, student) (01-product.md §8,
-- §12). Unmarked is never stored — an eligible student with no row here is
-- simply unmarked; the workflow that turns "some rows exist" into "the
-- session is Completed" lives in `save_session_attendance` below, not in
-- application code, because it must hold even under concurrent access.

create table if not exists public.attendance (
  id                uuid primary key default gen_random_uuid(),
  -- restrict, not cascade, matching every FK in this schema: a class
  -- session or student is never actually deleted through this app (no
  -- delete grant/policy on either), but restrict makes that guarantee hold
  -- at the schema level too, and protects attendance from ever being
  -- silently destroyed by a future change elsewhere.
  class_session_id  uuid not null references public.class_sessions (id) on delete restrict,
  student_id        uuid not null references public.students (id) on delete restrict,
  status            text not null check (status in ('present', 'absent')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- At most one attendance record per student per session (01-product.md
  -- §8: "Show... Students initially have an unmarked state" — a status
  -- other than present/absent, including "unmarked", is never persisted;
  -- see the table comment above). This is also the upsert target
  -- `save_session_attendance` relies on to correct a mark without ever
  -- creating a duplicate.
  constraint attendance_session_student_unique unique (class_session_id, student_id)
);

comment on table public.attendance is
  'One Present/Absent record per (class_session, student). A student with no row for a session is unmarked — that state is never itself stored. Never deleted; a correction updates the row in place.';

comment on column public.attendance.status is
  'present or absent only (01-product.md §8). There is no third persisted status — Unmarked is the absence of a row, not a value.';

-- Indexes ----------------------------------------------------------------
-- class_session_id needs no separate index: it is the leading column of
-- attendance_session_student_unique's own btree index, so "every mark for
-- this session" (the Attendance tab, the summary, save_session_attendance
-- itself) is already covered without a redundant duplicate index — same
-- reasoning as 0007_batch_enrollments.sql's own indexing comment.
--
-- student_id needs its own index: it is not the leading column of any
-- existing index, and a student's own attendance history (Phase 16) looks
-- up by student_id alone.

create index if not exists attendance_student_id_idx
  on public.attendance (student_id);

-- Table privileges -----------------------------------------------------------
-- RLS alone is not enough: a role also needs table-level privileges, or the
-- query fails with 42501 "permission denied for table attendance".
--
-- Only `authenticated` is granted anything. `anon` deliberately gets
-- nothing. No delete is granted — a correction updates a row in place
-- (01-product.md §9 "Editing"); nothing in V1 ever removes an attendance
-- record.

grant select, insert, update on public.attendance to authenticated;

-- Row Level Security ---------------------------------------------------------
-- Admin-only for this foundation slice, same as every prior feature table.
-- Instructor access is a later Phase 15 slice (approved decision D6): it is
-- added as its own migration, relaxing these policies and/or the two
-- functions below to also allow an assigned instructor — not by widening
-- this table's grants speculatively now.

alter table public.attendance enable row level security;

drop policy if exists "attendance_select_admin" on public.attendance;
create policy "attendance_select_admin"
  on public.attendance
  for select
  using (public.is_admin());

drop policy if exists "attendance_insert_admin" on public.attendance;
create policy "attendance_insert_admin"
  on public.attendance
  for insert
  with check (public.is_admin());

drop policy if exists "attendance_update_admin" on public.attendance;
create policy "attendance_update_admin"
  on public.attendance
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy is defined, and no delete privilege is granted.

-- Eligibility and atomic save -------------------------------------------------
-- Two SECURITY DEFINER functions (approved decision D6), matching the
-- `is_admin()` / `current_instructor_id()` pattern already established in
-- 0002_instructors.sql / 0004_instructor_identity.sql: each is admin-gated
-- internally rather than by its grant, so the later instructor-access
-- slice can broaden the internal check (is_admin() OR an assigned
-- instructor) without changing who is allowed to call the function at all.
--
-- `resolve_eligible_students` is the single source of the eligibility rule
-- (01-product.md §8; approved decisions D1–D3) — both the read path (a
-- later UI slice's Eligible Students tab, via lib/attendance/data.js) and
-- the write path (`save_session_attendance` below) call this one function,
-- so the rule is defined exactly once. It deliberately takes the batch and
-- date as parameters rather than reading "today" — eligibility for a past
-- session must be evaluated as of that session's own date, not the date the
-- query happens to run (D2, D3).

create or replace function public.resolve_eligible_students(
  p_batch_id uuid,
  p_session_date date
)
returns table (student_id uuid)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select be.student_id
  from public.batch_enrollments be
  join public.students s on s.id = be.student_id
  where be.batch_id = p_batch_id
    -- D2: enrollment must be active and cover the session date.
    and be.status = 'active'
    and be.effective_start_date <= p_session_date
    and (be.effective_end_date is null or be.effective_end_date >= p_session_date)
    -- D1: inactive students are excluded from new eligibility. This reads
    -- the student's *current* status, not a historical one — students has
    -- no status-history model, unlike enrollment/membership, which are
    -- both date-ranged.
    and s.status = 'active'
    and exists (
      select 1
      from public.memberships m
      where m.student_id = be.student_id
        and m.start_date <= p_session_date
        and m.end_date >= p_session_date
        -- D3: a membership covers the session date if it was not yet
        -- cancelled as of that date. Cancelling a membership today must
        -- not retroactively invalidate eligibility for an earlier session
        -- date — only dates on/after the cancellation are excluded.
        and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone 'Asia/Kolkata')::date)
    );
end;
$$;

comment on function public.resolve_eligible_students(uuid, date) is
  'The single source of attendance eligibility (01-product.md §8): active enrollment in the batch covering the date, active membership covering the date, active student. Evaluated as of p_session_date, never "today". Admin-only for this foundation slice.';

grant execute on function public.resolve_eligible_students(uuid, date) to authenticated;

-- `save_session_attendance` is the only writer of `attendance` rows and the
-- only path that transitions a class session to `completed`
-- (01-product.md §7A, §8, §12: "A session's stored status becomes
-- completed only when its attendance is saved"). Everything from
-- eligibility re-validation through the status transition happens inside
-- this one function body, which Postgres executes as a single atomic unit
-- — a failure at any point (an ineligible student submitted, a bad status
-- value, an unexpected error) rolls back the whole call, so a session can
-- never end up half-saved or marked Completed with rejected marks silently
-- dropped.
--
-- Boundary with `materializeClassSession` (lib/class-sessions/actions.js):
-- this function takes an existing `class_sessions.id` — it does not
-- materialize a projected occurrence itself, and does not duplicate that
-- logic in SQL. See the migration's own trailing comment and this slice's
-- report for why that boundary is deliberate, not an oversight.

create or replace function public.save_session_attendance(
  p_class_session_id uuid,
  p_marks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session          public.class_sessions%rowtype;
  v_today            date;
  v_mark             jsonb;
  v_student_id       uuid;
  v_status           text;
  v_eligible_ids     uuid[];
  v_submitted_ids    uuid[];
  v_invalid_ids      uuid[];
  v_marked_count     integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 1. The session must exist. `for update` holds the row lock for the
  -- rest of this transaction, so a concurrent call against the same
  -- session (another save, or Flow 07's markSessionException) cannot
  -- interleave with this one.
  select *
  into v_session
  from public.class_sessions
  where id = p_class_session_id
  for update;

  if not found then
    raise exception 'Class session not found.' using errcode = 'P0002';
  end if;

  -- 2. Cancelled/Holiday sessions do not take attendance (01-product.md §8
  -- "Cancelled / Holiday").
  if v_session.status in ('cancelled', 'holiday') then
    raise exception 'Cancelled or Holiday sessions do not take attendance.' using errcode = '22023';
  end if;

  -- 3. Future sessions are rejected (approved decision D5), evaluated
  -- against the centre timezone, matching every other Asia/Kolkata-derived
  -- check in this product (01-product.md §7A "Centre Timezone").
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  if v_session.session_date > v_today then
    raise exception 'Attendance cannot be taken for a future session.' using errcode = '22023';
  end if;

  -- 4. Resolve eligible students for this session's own batch and date —
  -- the session's snapshot batch_id (authoritative per §7A), never the
  -- schedule's current batch.
  select coalesce(array_agg(student_id), '{}')
  into v_eligible_ids
  from public.resolve_eligible_students(v_session.batch_id, v_session.session_date);

  select coalesce(array_agg((mark->>'student_id')::uuid), '{}')
  into v_submitted_ids
  from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as mark;

  -- 5. Every submitted student must be eligible. Rejecting the whole call
  -- rather than silently dropping the ineligible ones — a caller that
  -- submitted a mark for the wrong student has a bug worth surfacing, not
  -- papering over.
  select array_agg(sid)
  into v_invalid_ids
  from unnest(v_submitted_ids) as sid
  where sid <> all (v_eligible_ids);

  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'One or more students are not eligible for this session.' using errcode = '22023';
  end if;

  -- 6. Upsert Present/Absent for exactly the submitted students.
  -- 8. A student with no entry in p_marks gets no row — unmarked is
  -- represented by absence, never by a stored value.
  -- 9. Never deletes: an existing row for a student not resubmitted this
  -- time is left exactly as it was.
  for v_mark in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    v_student_id := (v_mark->>'student_id')::uuid;
    v_status := v_mark->>'status';

    if v_status not in ('present', 'absent') then
      raise exception 'Invalid attendance status: %', v_status using errcode = '22023';
    end if;

    insert into public.attendance (class_session_id, student_id, status)
    values (p_class_session_id, v_student_id, v_status)
    on conflict (class_session_id, student_id)
    do update set status = excluded.status, updated_at = now();

    v_marked_count := v_marked_count + 1;
  end loop;

  -- 7. Saving completes the session — unconditionally, even with zero or
  -- partial marks (approved decision D10).
  update public.class_sessions
  set status = 'completed'
  where id = p_class_session_id;

  -- 10.
  return jsonb_build_object(
    'success', true,
    'class_session_id', p_class_session_id,
    'eligible_count', coalesce(array_length(v_eligible_ids, 1), 0),
    'marked_count', v_marked_count
  );
end;
$$;

comment on function public.save_session_attendance(uuid, jsonb) is
  'The only writer of attendance rows and the only path that sets class_sessions.status = completed. Atomic: validates the session, rejects cancelled/holiday and future dates, re-validates eligibility server-side, upserts present/absent marks (never deletes), then completes the session — all in one transaction. p_marks is a JSON array of {"student_id","status"} objects; an eligible student absent from it stays unmarked. Requires an already-materialized class_sessions.id — see the migration header comment on the materialization boundary.';

grant execute on function public.save_session_attendance(uuid, jsonb) to authenticated;

-- Materialization boundary --------------------------------------------------
-- `save_session_attendance` takes an existing `class_sessions.id`. It does
-- not materialize a projected occurrence itself, and deliberately does not
-- reimplement `materializeClassSession`'s insert-with-23505-retry logic in
-- SQL — that logic already exists exactly once
-- (lib/class-sessions/actions.js) and duplicating it here would create two
-- places that can disagree about what "materialize" means.
--
-- The practical shape, once a later slice builds the Take Attendance UI:
-- the server action first calls the existing `materializeClassSession`
-- (unchanged) to guarantee a row exists, then calls this function with the
-- resulting id. Those are two separate round-trips, not one transaction —
-- the same shape `updateClassSession` and `markSessionException` already
-- use for the identical reason (Phase 14). The narrow race between them
-- (the session changing between the two calls) is not a new risk this
-- migration introduces: this function's own checks — session exists, not
-- cancelled/holiday, not in the future, eligibility re-validated — are the
-- authoritative gate at the moment of saving, so a session that became
-- ineligible in that window is rejected here rather than silently
-- corrupted, exactly as Flow 06/07's equivalent gap already is.
