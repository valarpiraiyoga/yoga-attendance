-- =============================================================================
-- V1 Class-count memberships: schema and eligibility isolation (Phase 1)
-- Migration 0042
--
-- ADDITIVE. A membership can now be one of two kinds: 'duration' (every existing row) or
-- 'class_count' (a number of classes, with a fixed validity or none). This migration only
-- makes the table able to hold the second kind, and keeps it out of session attendance.
-- It records nothing about classes and adds no screen, form or recording workflow.
--
-- WHAT IT CHANGES
--   1. memberships.kind ('duration' | 'class_count', default 'duration') and
--      memberships.total_classes (the class count; only a class-count membership has one).
--      Both are added with constant defaults, so no existing row is rewritten.
--   2. memberships.end_date becomes nullable. It stays REQUIRED for a duration membership
--      (memberships_end_date_by_kind); a class-count membership may have none ("No expiry").
--      The existing memberships_end_after_start check still applies when an end date exists.
--   3. invoices.period_end becomes nullable, so a document can later carry a membership
--      without an expiry. invoices_period_end_after_start still applies when one exists.
--      No document function is changed here: they copy the membership's end date as it is.
--   4. memberships.plan and invoices.plan also accept 'class_count'. Every existing plan is
--      still accepted, and a membership's kind and plan must agree (memberships_kind_matches_plan).
--   5. memberships_no_overlap_per_student now covers DURATION memberships only, so a student
--      can hold a duration and a class-count membership at the same time. Duration
--      memberships are protected exactly as before (same range, same cancelled exclusion).
--      No rule between two class-count memberships is added or removed by this migration.
--   6. resolve_eligible_students(uuid, uuid, date) - the single source of session-attendance
--      eligibility - is re-created so that only a DURATION membership qualifies a student.
--      It is 0024's definition with that one condition added; the signature, result columns,
--      authorization, frozen-set (snapshot) branch and every other condition are unchanged.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not INSERT, UPDATE or DELETE any row. Existing memberships keep kind
--     'duration', no total_classes and their end date; existing invoices are untouched.
--   * It does not edit migrations 0001-0041, and re-creates no document, payment or
--     attendance-saving function.
--   * No class-count recording, attendance table, eligibility list for class-count
--     attendance, form, renewal or document wording (later phases).
-- Safe to run again.
-- =============================================================================


-- 1. Membership kind and class count -------------------------------------------------------------

alter table public.memberships
  add column if not exists kind text not null default 'duration';

alter table public.memberships
  add column if not exists total_classes integer;

comment on column public.memberships.kind is
  'duration (a period of time, every membership before class-count memberships) or class_count (a number of classes, with a fixed validity or none). Only duration memberships count towards session attendance eligibility and the overlap rule.';

comment on column public.memberships.total_classes is
  'The number of classes a class_count membership gives. NULL for a duration membership.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_kind_valid'
                 and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships
      add constraint memberships_kind_valid
      check (kind in ('duration', 'class_count'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memberships_total_classes_by_kind'
                 and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships
      add constraint memberships_total_classes_by_kind
      check (
        (kind = 'class_count' and total_classes is not null and total_classes > 0)
        or (kind = 'duration' and total_classes is null)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memberships_end_date_by_kind'
                 and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships
      add constraint memberships_end_date_by_kind
      check (kind = 'class_count' or end_date is not null);
  end if;
end
$$;

-- The end date is now optional in the column, and required for a duration membership by the
-- check above (added first, so a duration row can never be left without one).
alter table public.memberships
  alter column end_date drop not null;

comment on column public.memberships.end_date is
  'The last day of the membership (inclusive). Required for a duration membership; NULL for a class_count membership with no expiry.';


-- 2. Invoice period end ---------------------------------------------------------------------------

alter table public.invoices
  alter column period_end drop not null;

comment on column public.invoices.period_end is
  'The last day of the membership period on the document, as copied when it was issued. NULL when the membership had no expiry.';


-- 3. Plans -----------------------------------------------------------------------------------------
-- 0031's named constraints are replaced by the same lists plus 'class_count'. Every existing value
-- is still allowed, so the re-check of existing rows passes.

alter table public.memberships drop constraint if exists memberships_plan_valid;
alter table public.memberships
  add constraint memberships_plan_valid
  check (plan in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom', 'class_count'));

alter table public.invoices drop constraint if exists invoices_plan_valid;
alter table public.invoices
  add constraint invoices_plan_valid
  check (plan in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom', 'class_count'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_kind_matches_plan'
                 and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships
      add constraint memberships_kind_matches_plan
      check ((kind = 'class_count') = (plan = 'class_count'));
  end if;
end
$$;


-- 4. Overlap rule: duration memberships only -------------------------------------------------------
-- Same constraint name, range and cancelled exclusion as 0008; the only addition is the kind.
-- A class-count membership has no period that must be exclusive, and may have none at all.

alter table public.memberships drop constraint if exists memberships_no_overlap_per_student;
alter table public.memberships
  add constraint memberships_no_overlap_per_student
  exclude using gist (
    student_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (cancelled_at is null and kind = 'duration');


-- 5. Session-attendance eligibility: duration memberships only -------------------------------------
-- 0024's definition, byte for byte, plus `and m.kind = 'duration'`. CREATE OR REPLACE keeps the
-- grants and every caller (save_session_attendance, the reports, the summaries) as they are.

create or replace function public.resolve_eligible_students(
  p_batch_id uuid,
  p_schedule_id uuid,
  p_session_date date
)
returns table (
  student_id uuid,
  full_name text,
  phone text,
  student_code text,
  membership_start_date date,
  membership_end_date date
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_series_id uuid;
  v_class_session_id uuid;
  v_snapshot_at timestamptz;
begin
  if not (public.is_admin() or public.can_access_session(p_schedule_id, p_session_date)) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Phase 16A: a frozen set wins over any live recomputation. Looked up by
  -- (schedule_id, session_date) — the same pair class_sessions_schedule_date_unique
  -- already treats as this table's natural key, and the only address a
  -- projected occurrence would have.
  select cs.id, cs.eligibility_snapshot_at
    into v_class_session_id, v_snapshot_at
  from public.class_sessions cs
  where cs.schedule_id = p_schedule_id
    and cs.session_date = p_session_date;

  if v_snapshot_at is not null then
    return query
    select
      e.student_id,
      s.full_name,
      s.phone,
      s.student_code,
      e.membership_start_date,
      e.membership_end_date
    from public.class_session_eligible_students e
    join public.students s on s.id = e.student_id
    where e.class_session_id = v_class_session_id;

    return;
  end if;

  -- No snapshot: unchanged live resolution (0014 body, carried over).
  select series_id into v_series_id
  from public.schedules
  where id = p_schedule_id;

  if v_series_id is null then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  return query
  select distinct on (be.student_id)
    be.student_id,
    s.full_name,
    s.phone,
    s.student_code,
    m.start_date as membership_start_date,
    m.end_date as membership_end_date
  from public.batch_enrollments be
  join public.students s on s.id = be.student_id
  join public.memberships m on m.student_id = be.student_id
  where be.batch_id = p_batch_id
    -- D2: enrollment must be active and cover the session date.
    and be.status = 'active'
    and be.effective_start_date <= p_session_date
    and (be.effective_end_date is null or be.effective_end_date >= p_session_date)
    -- D1: inactive students are excluded from new eligibility. Reads the
    -- student's *current* status — students has no status-history model,
    -- unlike enrollment/membership, which are both date-ranged.
    and s.status = 'active'
    -- Phase 15A: the enrollment must carry a schedule assignment on this
    -- session's own schedule series, covering the session date. Being
    -- enrolled in the batch is not sufficient on its own.
    and exists (
      select 1
      from public.enrollment_schedules es
      where es.batch_enrollment_id = be.id
        and es.schedule_series_id = v_series_id
        and es.effective_start_date <= p_session_date
        and (es.effective_end_date is null or es.effective_end_date >= p_session_date)
    )
    -- Class-count memberships: only a duration membership qualifies a student for a
    -- class session. A class-count membership is used by its own attendance workflow.
    and m.kind = 'duration'
    -- D3: a membership covers the session date if it was not yet cancelled
    -- as of that date. Cancelling a membership today must not retroactively
    -- invalidate eligibility for an earlier session date — only dates
    -- on/after the cancellation are excluded.
    and m.start_date <= p_session_date
    and m.end_date >= p_session_date
    and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone public.centre_timezone())::date)
  -- Tie-break (unchanged from 0012): prefer a membership not cancelled as of
  -- the session date, then the most recently started.
  order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc;
end;
$$;

comment on function public.resolve_eligible_students(uuid, uuid, date) is
  'The single source of attendance eligibility (01-product.md §8; Phase 15A; Phase 16A). When the session has a frozen eligible set (class_sessions.eligibility_snapshot_at is not null) that set is returned verbatim, so a completed session''s history cannot be rewritten by later enrollment, assignment, membership, batch or status changes. Otherwise eligibility resolves live: active student, active batch enrollment covering the date, a schedule assignment covering the date on the session''s own schedule series, and a DURATION membership covering the date (a class-count membership never qualifies a student for a class session), evaluated as of p_session_date and never "today". Authorized for an admin, or for the instructor who owns that session (can_access_session).';
