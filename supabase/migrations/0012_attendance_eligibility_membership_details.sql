-- Phase 15 Slice 2 — Eligible Students tab: membership details.
--
-- Extends `resolve_eligible_students` (0011_attendance.sql) to also return
-- the qualifying membership's date range, which the Eligible Students tab
-- needs for its MEMBERSHIP column (approved wireframe). Does not touch
-- 0011_attendance.sql itself — that migration is already applied and
-- verified in production — this redefines the function it created, the
-- same "a later migration replaces what an earlier one defined" pattern
-- already used by 0003_harden_profile_role.sql and 0004_instructor_identity.sql
-- against 0001/0002.
--
-- `save_session_attendance` (0011_attendance.sql) calls this function as
-- `select ... from public.resolve_eligible_students(...)` and reads only
-- its `student_id` column — adding columns after it is compatible with
-- that call without changing 0011's file at all.
--
-- Return type changes are not permitted via CREATE OR REPLACE, so this
-- drops and recreates the function; the DROP is safe even though
-- `save_session_attendance` calls it by name, because PL/pgSQL function
-- bodies are not dependency-tracked the way a view or FK would be — this
-- script recreates it before either function is ever called again.

drop function if exists public.resolve_eligible_students(uuid, date);

-- Membership tie-break (undocumented in 01-product.md/02-ux.md — flagged
-- as an inferred decision, not a silently invented eligibility rule): the
-- overlap-prevention constraint on `memberships`
-- (`memberships_no_overlap_per_student`, 0008_memberships.sql) only
-- applies `where cancelled_at is null`, so a student CAN have more than
-- one membership whose date range covers the same session date — one
-- active, one previously cancelled after that date, or two cancelled ones
-- inserted independently. `resolve_eligible_students` only ever needed a
-- boolean "does at least one qualifying membership exist" before this
-- migration; now that the UI needs to display *one* membership's dates,
-- ties must resolve to a single row. This follows the same preference
-- already established by `getCurrentMembershipForStudent`
-- (lib/memberships/data.js: "preferring an active one... else the most
-- recently started"), adapted to a specific date rather than "today": a
-- membership not cancelled as of the session date is preferred over one
-- that was, and among ties the most recently started membership wins.
-- This is a display tie-break only — it does not change who is eligible,
-- only which membership's dates are shown for a student who has more than
-- one qualifying record.

create function public.resolve_eligible_students(
  p_batch_id uuid,
  p_session_date date
)
returns table (
  student_id uuid,
  membership_start_date date,
  membership_end_date date
)
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
  select distinct on (be.student_id)
    be.student_id,
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
    -- D3: a membership covers the session date if it was not yet
    -- cancelled as of that date. Cancelling a membership today must not
    -- retroactively invalidate eligibility for an earlier session date —
    -- only dates on/after the cancellation are excluded.
    and m.start_date <= p_session_date
    and m.end_date >= p_session_date
    and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone 'Asia/Kolkata')::date)
  -- Tie-break (see comment above): prefer a membership not cancelled as of
  -- the session date, then the most recently started.
  order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc;
end;
$$;

comment on function public.resolve_eligible_students(uuid, date) is
  'The single source of attendance eligibility (01-product.md §8): active enrollment in the batch covering the date, active membership covering the date, active student. Evaluated as of p_session_date, never "today". Also returns the qualifying membership''s date range for display; when more than one membership qualifies, prefers one not cancelled as of the session date, then the most recently started (display tie-break only, does not affect eligibility). Admin-only for this slice.';

grant execute on function public.resolve_eligible_students(uuid, date) to authenticated;
