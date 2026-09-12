-- ===========================================================================
-- Phase 16A — Historical eligibility snapshot BACKFILL  (THE REAL ONE)
-- Implements steps 2-6 of "Existing-session backfill" (04-development-plan.md)
-- ===========================================================================
--
--   *** THIS SCRIPT WRITES. IT IS ONE-WAY. READ IT BEFORE RUNNING IT. ***
--
-- It is the reviewed counterpart to
-- verify_0015_eligibility_snapshot_backfill_dry_run.sql and applies exactly
-- what that dry run reported. Run the dry run again immediately before this,
-- and only proceed if its numbers still match the constants in section 1.
--
-- WHAT IT DOES
--   For every class session with status = 'completed' and
--   eligibility_snapshot_at IS NULL, with M = students holding an attendance
--   mark and L = the current live eligible set:
--
--     Tier B   M <> {} and M subset of L
--              -> snapshot = L,       provenance 'backfill_consistent'
--     Tier C   M <> {} and M not subset of L
--              -> snapshot = M UNION L, provenance 'backfill_drift'
--              (never less than the set of students who already have a mark)
--     none     M = {}
--              -> NO SNAPSHOT. Left resolving live. Nothing is fabricated.
--
-- WHAT IT NEVER DOES
--   * Never writes, updates or deletes a row in `attendance`. The script is
--     grep-clean of any attendance mutation, and a checksum over every
--     (id, status) pair is compared before and after to prove it.
--   * Never overwrites an existing snapshot row (ON CONFLICT DO NOTHING).
--   * Never re-stamps a session that already has eligibility_snapshot_at.
--   * Never invents history for a session with no attendance evidence.
--
-- MEMBERSHIP DATES — a deliberate, documented gap
--   For students taken from L, membership_start_date / membership_end_date
--   come straight from resolve_eligible_students. For a Tier C student who
--   is in M but NOT in L, they are written as NULL: that student's
--   membership at the time cannot be established, and guessing one would be
--   inventing evidence. This is exactly what migration 0015 anticipated when
--   it made those columns nullable ("a later backfilled row may legitimately
--   not know which membership qualified a student at the time"). Effect:
--   such a student shows blank membership dates on a historical roster.
--   Their presence is proven; their membership is not.
--
-- FAILURE BEHAVIOUR
--   Every precondition and postcondition raises. A raised exception aborts the
--   transaction, and PostgreSQL then turns the final COMMIT into a ROLLBACK,
--   so a failed run commits nothing. If anything raises, the correct response
--   is to issue `rollback;`, re-run the dry run, and work out why reality
--   moved — not to edit the constants until it passes.
--
-- AUTHORIZATION
--   resolve_eligible_students authorizes via is_admin(), which reads
--   auth.uid() — a request GUC, not a role (0014 line 604). Section 0 sets
--   that GUC transaction-locally to a discovered admin. No SET ROLE, no
--   service key, no hardcoded UUID.
--
-- OUTPUT: one result set of BEFORE/AFTER counts and per-session outcomes.
-- ===========================================================================

begin;

create temp table _backfill_report (
  seq    int,
  phase  text,
  metric text,
  value  text
) on commit drop;

-- ===========================================================================
-- 0. Authorize as a real admin (transaction-local)
-- ===========================================================================
do $$
declare
  v_admin uuid;
begin
  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin'
  order by p.created_at
  limit 1;

  if v_admin is null then
    raise exception 'ABORT: no admin profile exists; resolve_eligible_students cannot be authorized';
  end if;

  perform set_config('request.jwt.claims',
          json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
end $$;

-- ===========================================================================
-- 1. Build the plan — once, set-based, before anything is written
-- ===========================================================================
-- Everything downstream reads these tables, so the rows that are inserted are
-- provably the same rows the preconditions validated. No per-session loop.

create temp table _target on commit drop as
select cs.id as class_session_id, cs.session_date, cs.schedule_id,
       cs.batch_id, cs.instructor_id
from public.class_sessions cs
where cs.status = 'completed'
  and cs.eligibility_snapshot_at is null;

-- M — the only provable evidence.
create temp table _marked on commit drop as
select distinct a.class_session_id, a.student_id
from public.attendance a
join _target t on t.class_session_id = a.class_session_id;

-- L — today's live answer, from the real function, one lateral pass.
-- Markers are still NULL at this point, so the function takes its live branch.
create temp table _live on commit drop as
select t.class_session_id, r.student_id,
       r.membership_start_date, r.membership_end_date
from _target t
cross join lateral public.resolve_eligible_students(
             t.batch_id, t.schedule_id, t.session_date) r;

create temp table _plan_session on commit drop as
select t.class_session_id, t.session_date, t.schedule_id, t.batch_id, t.instructor_id,
       coalesce(mc.c, 0) as m_count,
       coalesce(lc.c, 0) as l_count,
       coalesce(dc.c, 0) as drift_count,
       case when coalesce(mc.c, 0) = 0 then 'NO EVIDENCE'
            when coalesce(dc.c, 0) = 0 then 'B'
            else                            'C' end as tier,
       case when coalesce(mc.c, 0) = 0 then null
            when coalesce(dc.c, 0) = 0 then 'backfill_consistent'
            else                            'backfill_drift' end as provenance
from _target t
left join (select class_session_id, count(*) as c from _marked group by 1) mc
       on mc.class_session_id = t.class_session_id
left join (select class_session_id, count(*) as c from _live group by 1) lc
       on lc.class_session_id = t.class_session_id
left join (select mk.class_session_id, count(*) as c
           from _marked mk
           where not exists (select 1 from _live lv
                             where lv.class_session_id = mk.class_session_id
                               and lv.student_id = mk.student_id)
           group by 1) dc
       on dc.class_session_id = t.class_session_id;

-- The exact rows that will be inserted.
create temp table _plan_row on commit drop as
select ps.class_session_id, lv.student_id,
       lv.membership_start_date, lv.membership_end_date,
       ps.provenance, 'live'::text as source
from _plan_session ps
join _live lv on lv.class_session_id = ps.class_session_id
where ps.tier in ('B', 'C')
union all
-- Tier C only: marked students who are no longer live-eligible. Membership
-- unknown by design (see header) — never guessed.
select ps.class_session_id, mk.student_id,
       null::date, null::date,
       ps.provenance, 'mark'::text
from _plan_session ps
join _marked mk on mk.class_session_id = ps.class_session_id
where ps.tier = 'C'
  and not exists (select 1 from _live lv
                  where lv.class_session_id = mk.class_session_id
                    and lv.student_id = mk.student_id);

-- ===========================================================================
-- 2. BEFORE counts + the reviewed dry-run expectations
-- ===========================================================================
insert into _backfill_report (seq, phase, metric, value)
select 100, 'BEFORE', 'snapshot rows', count(*)::text from public.class_session_eligible_students
union all select 101, 'BEFORE', 'sessions with a marker',
       (count(*) filter (where eligibility_snapshot_at is not null))::text from public.class_sessions
union all select 102, 'BEFORE', 'attendance rows', count(*)::text from public.attendance
union all select 103, 'BEFORE', 'completed sessions without snapshot (scope)', count(*)::text from _target
union all select 104, 'PLAN', 'Tier B sessions', count(*)::text from _plan_session where tier = 'B'
union all select 105, 'PLAN', 'Tier C sessions', count(*)::text from _plan_session where tier = 'C'
union all select 106, 'PLAN', 'no-evidence sessions (skipped)', count(*)::text from _plan_session where tier = 'NO EVIDENCE'
union all select 107, 'PLAN', 'snapshot rows to insert', count(*)::text from _plan_row
union all select 108, 'PLAN', 'rows with unknown membership (Tier C, mark-only)',
       count(*)::text from _plan_row where source = 'mark';

-- ===========================================================================
-- 3. PRECONDITIONS — abort loudly before any mutation
-- ===========================================================================
do $$
declare
  -- The reviewed dry run. If reality no longer matches, this script must NOT
  -- run: re-run the dry run and re-review instead of editing these numbers.
  k_sessions_in_scope constant int  := 2;
  k_tier_b            constant int  := 1;
  k_tier_c            constant int  := 1;
  k_no_evidence       constant int  := 0;
  k_snapshot_rows     constant int  := 4;
  k_attendance_rows   constant int  := 4;
  k_defect_date       constant date := date '2026-09-11';
  -- TWO in-scope sessions share 2026-09-11 (Children Yoga, Tier B; and the
  -- Aerial session, Tier C), so the date ALONE is ambiguous and must never be
  -- used to identify the defect. The defect session is pinned by BATCH
  -- IDENTITY as well. Matched on the distinctive word 'aerial' only, so a
  -- "Aerial Yoga" / "Aerial Yogo" spelling difference cannot break it, and
  -- so that neither a UUID nor any student name is needed.
  k_defect_batch_like constant text := '%aerial%';
  k_defect_snapshot   constant int  := 2;
  k_defect_drift      constant int  := 1;
  k_defect_siblings   constant int  := 1;

  v_defect uuid;
  n int; n2 int;
begin
  -- 3.1 Migration 0015 structures must exist.
  if to_regclass('public.class_session_eligible_students') is null then
    raise exception 'ABORT: class_session_eligible_students does not exist — migration 0015 is not applied';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'class_sessions'
                   and column_name = 'eligibility_snapshot_at') then
    raise exception 'ABORT: class_sessions.eligibility_snapshot_at does not exist — migration 0015 is not applied';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'class_session_eligible_students'
                   and column_name = 'provenance') then
    raise exception 'ABORT: class_session_eligible_students.provenance does not exist';
  end if;

  -- 3.2 Every target really is completed with a NULL marker.
  select count(*) into n
  from _target t
  join public.class_sessions cs on cs.id = t.class_session_id
  where cs.status <> 'completed' or cs.eligibility_snapshot_at is not null;
  if n <> 0 then
    raise exception 'ABORT: % target session(s) are not completed-with-NULL-marker', n;
  end if;

  -- 3.3 Write-once: no target may already hold snapshot rows.
  select count(*) into n
  from public.class_session_eligible_students e
  join _target t on t.class_session_id = e.class_session_id;
  if n <> 0 then
    raise exception 'ABORT: % orphan snapshot row(s) already exist for in-scope sessions', n;
  end if;

  -- 3.4 THE CRITICAL ONE — the proposed roster must contain every student who
  -- holds an attendance mark. This assertion alone would have caught the
  -- original defect (backfill step 5).
  select count(*) into n
  from _marked mk
  join _plan_session ps on ps.class_session_id = mk.class_session_id
  where ps.tier in ('B', 'C')
    and not exists (select 1 from _plan_row pr
                    where pr.class_session_id = mk.class_session_id
                      and pr.student_id = mk.student_id);
  if n <> 0 then
    raise exception 'ABORT: % marked student(s) are missing from the proposed snapshot', n;
  end if;

  -- 3.5 No-evidence sessions must contribute nothing.
  select count(*) into n
  from _plan_row pr
  join _plan_session ps on ps.class_session_id = pr.class_session_id
  where ps.tier = 'NO EVIDENCE';
  if n <> 0 then
    raise exception 'ABORT: % proposed row(s) belong to a no-evidence session', n;
  end if;

  -- 3.6 Provenance must be exactly one of the two backfill values.
  select count(*) into n
  from _plan_row
  where provenance is null or provenance not in ('backfill_consistent', 'backfill_drift');
  if n <> 0 then
    raise exception 'ABORT: % proposed row(s) carry an invalid provenance', n;
  end if;

  -- 3.7 Tier arithmetic must be self-consistent.
  select count(*) into n from _plan_session where tier = 'B' and drift_count <> 0;
  if n <> 0 then raise exception 'ABORT: % Tier B session(s) have drift', n; end if;
  select count(*) into n from _plan_session where tier = 'C' and drift_count = 0;
  if n <> 0 then raise exception 'ABORT: % Tier C session(s) have no drift', n; end if;

  -- 3.8 Reality must still match the reviewed dry run (requirement 12).
  select count(*) into n from _target;
  if n <> k_sessions_in_scope then
    raise exception 'ABORT: scope is % session(s), reviewed dry run said % — re-run the dry run and re-review', n, k_sessions_in_scope;
  end if;
  select count(*) into n from _plan_session where tier = 'B';
  if n <> k_tier_b then raise exception 'ABORT: % Tier B session(s), expected %', n, k_tier_b; end if;
  select count(*) into n from _plan_session where tier = 'C';
  if n <> k_tier_c then raise exception 'ABORT: % Tier C session(s), expected %', n, k_tier_c; end if;
  select count(*) into n from _plan_session where tier = 'NO EVIDENCE';
  if n <> k_no_evidence then raise exception 'ABORT: % no-evidence session(s), expected %', n, k_no_evidence; end if;
  select count(*) into n from _plan_row;
  if n <> k_snapshot_rows then raise exception 'ABORT: % row(s) planned, expected %', n, k_snapshot_rows; end if;
  select count(*) into n from public.attendance;
  if n <> k_attendance_rows then raise exception 'ABORT: % attendance row(s), reviewed dry run said %', n, k_attendance_rows; end if;

  -- 3.9 The known defect — pinned by DATE *and* BATCH, never by date alone
  -- (date alone matched two sessions) and never by a hardcoded UUID.
  select count(*) into n
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  where ps.session_date = k_defect_date
    and b.name ilike k_defect_batch_like;
  if n <> 1 then
    raise exception 'ABORT: expected exactly 1 in-scope session on % whose batch matches %, found % — if that batch was renamed, re-run the dry run and re-review before touching this constant', k_defect_date, k_defect_batch_like, n;
  end if;

  select ps.class_session_id into v_defect
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  where ps.session_date = k_defect_date
    and b.name ilike k_defect_batch_like;

  -- It must still be the drifted one.
  select count(*) into n from _plan_session
  where class_session_id = v_defect and tier = 'C';
  if n <> 1 then
    raise exception 'ABORT: the % defect session is not Tier C — the drift it exists to preserve is gone', k_defect_date;
  end if;

  -- Exactly one marked student is no longer live-eligible. THIS is the
  -- Venkatesh guarantee, stated structurally: it is the count of students
  -- whose place in history rests on an attendance mark alone.
  select drift_count into n from _plan_session where class_session_id = v_defect;
  if n <> k_defect_drift then
    raise exception 'ABORT: the defect session has % marked-but-no-longer-live student(s), expected %', n, k_defect_drift;
  end if;

  -- Exactly two proposed snapshot students.
  select count(*) into n from _plan_row where class_session_id = v_defect;
  if n <> k_defect_snapshot then
    raise exception 'ABORT: the defect session would get % snapshot student(s), expected %', n, k_defect_snapshot;
  end if;

  -- Every one of its marks is carried into the snapshot.
  select count(*) into n from _marked where class_session_id = v_defect;
  select count(*) into n2 from _marked mk
  where mk.class_session_id = v_defect
    and exists (select 1 from _plan_row pr
                where pr.class_session_id = v_defect
                  and pr.student_id = mk.student_id);
  if n = 0 or n <> n2 then
    raise exception 'ABORT: only % of % marked student(s) on the defect session are in the proposed snapshot', n2, n;
  end if;

  -- 3.10 The OTHER session sharing that date (Children Yoga) must still be
  -- Tier B and must still be part of the backfill — the date collision that
  -- caused the false abort must not now hide it.
  select count(*) into n
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  where ps.session_date = k_defect_date
    and b.name not ilike k_defect_batch_like;
  if n <> k_defect_siblings then
    raise exception 'ABORT: expected % other in-scope session(s) on %, found %', k_defect_siblings, k_defect_date, n;
  end if;
  select count(*) into n
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  where ps.session_date = k_defect_date
    and b.name not ilike k_defect_batch_like
    and ps.tier <> 'B';
  if n <> 0 then
    raise exception 'ABORT: % non-Aerial session(s) on % are not Tier B', n, k_defect_date;
  end if;

  raise notice 'Preconditions passed: % session(s), % row(s) to write.', k_sessions_in_scope, k_snapshot_rows;
end $$;

-- Checksum of every attendance mark, captured before mutation. Compared after
-- to prove not one status changed.
insert into _backfill_report (seq, phase, metric, value)
select 109, 'BEFORE', 'attendance checksum (id+status)',
       coalesce(md5(string_agg(a.id::text || ':' || a.status, ',' order by a.id)), 'empty')
from public.attendance a;

-- ===========================================================================
-- 4. MUTATION — two set-based statements, nothing else
-- ===========================================================================

-- 4a. Insert the snapshot rows. ON CONFLICT DO NOTHING honours the
-- write-once design: an existing row is never overwritten.
insert into public.class_session_eligible_students
  (class_session_id, student_id, membership_start_date, membership_end_date, provenance, created_at)
select pr.class_session_id, pr.student_id,
       pr.membership_start_date, pr.membership_end_date,
       pr.provenance, now()
from _plan_row pr
on conflict (class_session_id, student_id) do nothing;

-- 4b. Stamp the marker ONLY for sessions that now actually hold snapshot
-- rows, and only where it is still NULL. Both conditions make a re-run a
-- no-op rather than a re-snapshot.
update public.class_sessions cs
set eligibility_snapshot_at = now()
where cs.eligibility_snapshot_at is null
  and exists (select 1 from _plan_session ps
              where ps.class_session_id = cs.id and ps.tier in ('B', 'C'))
  and exists (select 1 from public.class_session_eligible_students e
              where e.class_session_id = cs.id);

-- ===========================================================================
-- 5. POSTCONDITIONS — abort (and therefore roll back) if anything is wrong
-- ===========================================================================
do $$
declare
  k_defect_date       constant date := date '2026-09-11';
  -- Same pin as the preconditions: date alone matches two sessions.
  k_defect_batch_like constant text := '%aerial%';
  k_defect_snapshot   constant int  := 2;
  v_defect uuid;
  v_before text;
  n int; n2 int;
begin
  -- 5.1 Every planned session now carries a marker.
  select count(*) into n
  from _plan_session ps
  join public.class_sessions cs on cs.id = ps.class_session_id
  where ps.tier in ('B', 'C') and cs.eligibility_snapshot_at is null;
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % backfilled session(s) still have a NULL marker', n;
  end if;

  -- 5.2 Snapshot row count matches the plan exactly.
  select count(*) into n from _plan_row;
  select count(*) into n2
  from public.class_session_eligible_students e
  join _plan_session ps on ps.class_session_id = e.class_session_id;
  if n <> n2 then
    raise exception 'POSTCONDITION FAILED: planned % row(s) but % exist', n, n2;
  end if;

  -- 5.3 Every marked student belongs to its session's snapshot.
  select count(*) into n
  from _marked mk
  join _plan_session ps on ps.class_session_id = mk.class_session_id
  where ps.tier in ('B', 'C')
    and not exists (select 1 from public.class_session_eligible_students e
                    where e.class_session_id = mk.class_session_id
                      and e.student_id = mk.student_id);
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % marked student(s) are absent from the snapshot', n;
  end if;

  -- 5.4 No-evidence sessions got nothing, and kept a NULL marker.
  select count(*) into n
  from _plan_session ps
  join public.class_sessions cs on cs.id = ps.class_session_id
  where ps.tier = 'NO EVIDENCE'
    and (cs.eligibility_snapshot_at is not null
         or exists (select 1 from public.class_session_eligible_students e
                    where e.class_session_id = ps.class_session_id));
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % no-evidence session(s) were snapshotted', n;
  end if;

  -- 5.5 Provenance is exactly what each session's tier called for.
  select count(*) into n
  from public.class_session_eligible_students e
  join _plan_session ps on ps.class_session_id = e.class_session_id
  where e.provenance is distinct from ps.provenance;
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % row(s) carry the wrong provenance', n;
  end if;

  -- 5.6 Attendance is byte-for-byte untouched.
  select value into v_before from _backfill_report where seq = 109;
  if v_before is distinct from
     (select coalesce(md5(string_agg(a.id::text || ':' || a.status, ',' order by a.id)), 'empty')
      from public.attendance a) then
    raise exception 'POSTCONDITION FAILED: attendance changed during the backfill';
  end if;

  -- 5.7 Target session count is still what we planned against.
  select count(*) into n from _plan_session;
  if n = 0 then
    raise exception 'POSTCONDITION FAILED: the plan is empty';
  end if;

  -- 5.8 The known defect landed correctly. Pinned by date AND batch: the
  -- date alone also matches the Children Yoga session, whose rows are
  -- legitimately backfill_consistent and would fail the drift check below.
  select ps.class_session_id into v_defect
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  where ps.session_date = k_defect_date
    and b.name ilike k_defect_batch_like;
  if v_defect is null then
    raise exception 'POSTCONDITION FAILED: the % defect session could not be resolved', k_defect_date;
  end if;

  select count(*) into n
  from public.class_session_eligible_students e
  where e.class_session_id = v_defect;
  if n <> k_defect_snapshot then
    raise exception 'POSTCONDITION FAILED: the defect session has % snapshot student(s), expected %', n, k_defect_snapshot;
  end if;

  select count(*) into n
  from public.class_session_eligible_students e
  where e.class_session_id = v_defect and e.provenance <> 'backfill_drift';
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: the defect session has % non-drift row(s)', n;
  end if;

  select count(*) into n
  from _marked mk
  where mk.class_session_id = v_defect
    and not exists (select 1 from public.class_session_eligible_students e
                    where e.class_session_id = v_defect
                      and e.student_id = mk.student_id);
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % marked student(s) on the defect session are missing from the snapshot', n;
  end if;

  -- 5.9 The sibling session on the same date was backfilled as Tier B.
  select count(*) into n
  from _plan_session ps
  join public.batches b on b.id = ps.batch_id
  join public.class_sessions cs on cs.id = ps.class_session_id
  where ps.session_date = k_defect_date
    and b.name not ilike k_defect_batch_like
    and (cs.eligibility_snapshot_at is null or ps.tier <> 'B');
  if n <> 0 then
    raise exception 'POSTCONDITION FAILED: % same-date non-Aerial session(s) were not backfilled as Tier B', n;
  end if;

  raise notice 'All postconditions passed.';
end $$;

-- ===========================================================================
-- 6. AFTER counts + per-session outcome
-- ===========================================================================
insert into _backfill_report (seq, phase, metric, value)
select 200, 'AFTER', 'snapshot rows', count(*)::text from public.class_session_eligible_students
union all select 201, 'AFTER', 'sessions with a marker',
       (count(*) filter (where eligibility_snapshot_at is not null))::text from public.class_sessions
union all select 202, 'AFTER', 'attendance rows (must be unchanged)', count(*)::text from public.attendance
union all select 203, 'AFTER', 'attendance checksum (must match BEFORE)',
       coalesce(md5(string_agg(a.id::text || ':' || a.status, ',' order by a.id)), 'empty') from public.attendance a
union all select 204, 'AFTER', 'rows written as backfill_consistent',
       count(*)::text from public.class_session_eligible_students where provenance = 'backfill_consistent'
union all select 205, 'AFTER', 'rows written as backfill_drift',
       count(*)::text from public.class_session_eligible_students where provenance = 'backfill_drift'
union all select 206, 'AFTER', 'rows still carrying provenance = save (untouched)',
       count(*)::text from public.class_session_eligible_students where provenance = 'save';

-- Per-session outcome.
insert into _backfill_report (seq, phase, metric, value)
select (300 + row_number() over (order by ps.session_date, ps.class_session_id))::int,
       'SESSION',
       format('%s  %s  tier %s', ps.session_date::text, coalesce(b.name, '(no batch)'), ps.tier),
       format('marked=%s live=%s drift=%s -> %s row(s), provenance %s',
              ps.m_count, ps.l_count, ps.drift_count,
              (select count(*) from public.class_session_eligible_students e
                where e.class_session_id = ps.class_session_id),
              coalesce(ps.provenance, 'none — left unsnapshotted'))
from _plan_session ps
left join public.batches b on b.id = ps.batch_id;

-- The known defect, named, so a reviewer can confirm Venkatesh by eye.
insert into _backfill_report (seq, phase, metric, value)
select (400 + row_number() over (order by st.full_name))::int,
       'DEFECT 2026-09-11',
       st.full_name,
       format('snapshot member, provenance %s%s%s',
              e.provenance,
              case when exists (select 1 from _marked mk
                                where mk.class_session_id = e.class_session_id
                                  and mk.student_id = e.student_id)
                   then ' — HAS an attendance mark (evidence preserved)'
                   else ' — no mark (roster only)' end,
              case when e.membership_start_date is null
                   then '; membership unknown (mark-only reconstruction)' else '' end)
from public.class_session_eligible_students e
join _plan_session ps on ps.class_session_id = e.class_session_id
join public.batches b on b.id = ps.batch_id
join public.students st on st.id = e.student_id
where ps.session_date = date '2026-09-11'
  and b.name ilike '%aerial%';

select seq, phase, metric, value
from _backfill_report
order by seq;

commit;

-- ===========================================================================
-- AFTER COMMIT — independent confirmation (run separately)
-- ===========================================================================
--   select
--     (select count(*) from public.class_session_eligible_students)        as snapshot_rows,      -- expect 4
--     (select count(*) from public.class_sessions
--       where eligibility_snapshot_at is not null)                         as markers,            -- expect 2
--     (select count(*) from public.attendance)                             as attendance_rows,    -- expect 4
--     (select count(*) from public.class_session_eligible_students
--       where provenance = 'backfill_consistent')                          as consistent_rows,
--     (select count(*) from public.class_session_eligible_students
--       where provenance = 'backfill_drift')                               as drift_rows;
--
-- Left commented out so it cannot become the editor's last result set and
-- hide the report above.
-- ===========================================================================
