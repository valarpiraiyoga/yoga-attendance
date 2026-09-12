-- ===========================================================================
-- Phase 16A — Eligibility snapshot BACKFILL DRY RUN
-- Classifies every completed session that has no snapshot. Writes nothing.
-- ===========================================================================
--
-- Implements step 1 of the Phase 16A "Existing-session backfill" sequence
-- (docs/04-development-plan.md): "Dry run first — classify every completed
-- session and report the tier counts, writing nothing."
--
-- STRICTLY READ-ONLY
--   * The analysis is SELECT/CTE only. There is no INSERT, UPDATE, DELETE,
--     TRUNCATE, CREATE, ALTER or DROP anywhere in this file, and no temp
--     table. That — not a transaction wrapper — is the safety mechanism.
--   * save_session_attendance is NEVER called: it is a writer. The only
--     function invoked is resolve_eligible_students, which is `stable` and
--     reads only.
--   * Nothing here consumes a sequence, and no fixture is created.
--   * `begin transaction read only` is belt-and-braces on top of the above,
--     and is what scopes the impersonation GUC to this transaction so it
--     cannot leak into a pooled connection afterwards. It is not the thing
--     keeping your data safe; the absence of any write is.
--
-- WHY IT IMPERSONATES
--   resolve_eligible_students authorizes via is_admin(), which reads
--   auth.uid() — a request GUC, not a role (0014, line 604). Setting
--   request.jwt.claims to a real admin is therefore enough to authorize it;
--   no SET ROLE is needed and none is used. Calling the real function is
--   deliberate: re-implementing the five eligibility predicates here would
--   let the dry run drift from the single source of eligibility it is
--   supposed to measure against.
--
-- NOT N+1
--   Live eligibility is resolved with ONE lateral join over the target set,
--   so the whole report is a single statement the planner executes once —
--   not a per-session round trip.
--
-- TIERS — exactly as approved (docs/04-development-plan.md, "Existing-session
-- backfill"; M = students with a mark, L = current live eligible set):
--
--   Tier A          Not applicable here. Tier A is the go-forward first-save
--                   path, which 0015 already handles live. A completed
--                   session is never classified Tier A. Counted separately
--                   under SCOPE for context only.
--   Tier B          M <> {} and M is a subset of L.
--                   provenance backfill_consistent; proposed snapshot = L.
--   Tier C          M <> {} and M is NOT a subset of L.
--                   provenance backfill_drift; proposed snapshot = M union L
--                   — "never less than the set of students who already have
--                   a mark".
--   NO EVIDENCE     M = {}. Includes sessions completed with no marks at
--                   all, which is legal under D10. These REMAIN
--                   UNSNAPSHOTTED and keep resolving live. Nothing is
--                   fabricated for them (backfill step 4).
--
-- WHAT THIS CANNOT RECOVER — read before trusting the proposed counts
--   Three different things are reported and must not be conflated:
--     1. MARKED (M)  proof. A mark exists => that student passed eligibility
--                    at save time, because the save path rejects ineligible
--                    students outright.
--     2. LIVE (L)    today's answer. NOT evidence about the past: enrollment,
--                    assignment and membership rows are mutated in place
--                    with no prior values retained.
--     3. PROPOSED    a reconstruction built from 1 and 2 — which is exactly
--                    why it is stamped backfill_* and never `save`.
--   A student who was eligible but left UNMARKED, and has since dropped out
--   of live eligibility, is in none of these and is permanently
--   unrecoverable: no attendance row, no stored eligible_count, no audit
--   trail. Those sessions will under-report Eligible by that number. This
--   dry run cannot detect them, cannot count them, and does not try.
--
-- OUTPUT: one result set (the editor shows only the last one), ordered by
-- seq: SCOPE, SUMMARY, per-session detail, the known defect, then the
-- post-condition assertions.
-- ===========================================================================

begin transaction read only;

-- Authorize resolve_eligible_students as a real admin. Transaction-local
-- (the trailing `true`), so it is discarded at commit. Both GUCs are set
-- because auth.uid() reads either. If these come back NULL there is no admin
-- profile, and the report below fails with 42501 rather than printing
-- numbers derived from an unauthorized call.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  (select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1),
    'role', 'authenticated'
  )::text, true) as impersonating_claims;

select set_config(
  'request.jwt.claim.sub',
  (select p.id::text from public.profiles p where p.role = 'admin' order by p.created_at limit 1),
  true) as impersonating_sub;

-- ---------------------------------------------------------------------------
-- The dry run
-- ---------------------------------------------------------------------------
with
-- Every completed session with no snapshot: the backfill's entire scope.
target as (
  select cs.id, cs.session_date, cs.schedule_id, cs.batch_id, cs.instructor_id
  from public.class_sessions cs
  where cs.status = 'completed'
    and cs.eligibility_snapshot_at is null
),
-- M — the only thing the database can prove about the past.
marked as (
  select a.class_session_id,
         coalesce(array_agg(distinct a.student_id), '{}') as m
  from public.attendance a
  join target t on t.id = a.class_session_id
  group by a.class_session_id
),
-- L — today's live answer, from the real function. One lateral pass.
live as (
  select t.id as class_session_id,
         coalesce(array_agg(r.student_id) filter (where r.student_id is not null), '{}') as l
  from target t
  left join lateral public.resolve_eligible_students(t.batch_id, t.schedule_id, t.session_date) r
    on true
  group by t.id
),
joined as (
  select t.id, t.session_date, t.schedule_id, t.batch_id, t.instructor_id,
         b.name      as batch_name,
         i.full_name as instructor_name,
         coalesce(mk.m, '{}'::uuid[]) as m,
         coalesce(lv.l, '{}'::uuid[]) as l
  from target t
  left join marked mk on mk.class_session_id = t.id
  left join live   lv on lv.class_session_id = t.id
  left join public.batches     b on b.id = t.batch_id
  left join public.instructors i on i.id = t.instructor_id
),
sets as (
  select j.*,
    (select coalesce(array_agg(u.x order by u.x), '{}')
       from unnest(j.m) as u(x) where not (u.x = any (j.l)))   as m_not_l,
    (select coalesce(array_agg(u.x order by u.x), '{}')
       from unnest(j.m) as u(x) where u.x = any (j.l))         as m_and_l,
    (select coalesce(array_agg(distinct u.x order by u.x), '{}')
       from unnest(j.m || j.l) as u(x))                        as m_union_l
  from joined j
),
tiered as (
  select s.*,
    case when cardinality(s.m) = 0       then 'NO EVIDENCE'
         when cardinality(s.m_not_l) = 0 then 'B'
         else                                 'C' end as tier,
    case when cardinality(s.m) = 0       then null
         when cardinality(s.m_not_l) = 0 then 'backfill_consistent'
         else                                 'backfill_drift' end as provenance,
    case when cardinality(s.m) = 0       then '{}'::uuid[]
         when cardinality(s.m_not_l) = 0 then s.l
         else                                 s.m_union_l end as proposed
  from sets s
),
-- The known defect: 2026-09-11. Matched by DATE only, not by batch name —
-- a renamed batch must not make the defect silently vanish from this report.
defect as (
  select * from tiered where session_date = date '2026-09-11'
),

-- =========== output ========================================================
scope as (
  select 1 as seq,
         '0. SCOPE' as section,
         'completed sessions with no snapshot (the backfill scope)' as label,
         (select count(*) from target)::int as value,
         null::uuid as class_session_id,
         null::date as session_date,
         null::uuid as schedule_id,
         null::text as batch_name,
         null::text as instructor_name,
         null::int  as live_eligible,
         null::int  as marked,
         null::int  as marked_and_live,
         null::int  as marked_not_live,
         null::text as proposed_tier,
         null::text as proposed_provenance,
         null::int  as proposed_snapshot_rows,
         'status = completed and eligibility_snapshot_at is null'::text as reason
  union all
  select 2, '0. SCOPE', 'NOT in scope: non-completed sessions with no snapshot',
         (select count(*)::int from public.class_sessions
           where eligibility_snapshot_at is null and status <> 'completed'),
         null, null, null, null, null, null, null, null, null, null, null, null,
         'scheduled / cancelled / holiday. Tier A (go-forward first save) covers the scheduled ones live; cancelled and holiday never take attendance.'
  union all
  select 3, '0. SCOPE', 'sessions ALREADY snapshotted (a backfill must not revisit these)',
         (select count(*)::int from public.class_sessions
           where eligibility_snapshot_at is not null),
         null, null, null, null, null, null, null, null, null, null, null, null,
         'write-once'
),
summary as (
  select (100 + row_number() over (order by ord))::int as seq,
         '1. SUMMARY' as section, label, value,
         null::uuid, null::date, null::uuid, null::text, null::text,
         null::int, null::int, null::int, null::int,
         null::text, null::text, null::int, reason
  from (
    select 1 as ord,
           'total completed sessions without snapshot' as label,
           (select count(*)::int from tiered) as value,
           'the population classified below'::text as reason
    union all
    select 2, 'Tier B — backfill_consistent',
           (select count(*)::int from tiered where tier = 'B'),
           'every marked student is still live-eligible; proposed snapshot = L'
    union all
    select 3, 'Tier C — backfill_drift',
           (select count(*)::int from tiered where tier = 'C'),
           'a marked student is no longer live-eligible; proposed snapshot = M union L'
    union all
    select 4, 'no evidence / unrecoverable — LEFT UNSNAPSHOTTED',
           (select count(*)::int from tiered where tier = 'NO EVIDENCE'),
           'zero attendance rows. Nothing is fabricated; these keep resolving live'
    union all
    select 5, 'sessions that WOULD receive a snapshot',
           (select count(*)::int from tiered where tier in ('B', 'C')),
           'Tier B + Tier C only'
    union all
    select 6, 'total proposed snapshot ROWS',
           (select coalesce(sum(cardinality(proposed)), 0)::int from tiered),
           'rows that would be inserted into class_session_eligible_students'
    union all
    select 7, 'attendance rows used as evidence',
           (select count(*)::int from public.attendance a
             join target t on t.id = a.class_session_id),
           'marks belonging to in-scope sessions'
    union all
    select 8, 'sessions containing marked students no longer live-eligible',
           (select count(*)::int from tiered where cardinality(m_not_l) > 0),
           'the drift population — identical to Tier C by definition'
    union all
    select 9, 'marked-but-no-longer-live student/session pairs',
           (select coalesce(sum(cardinality(m_not_l)), 0)::int from tiered),
           'students who would be lost entirely if the backfill used L alone'
  ) s
),
sessions as (
  select (2000 + row_number() over (order by t.session_date, t.id))::int as seq,
         '2. SESSIONS' as section,
         t.tier as label,
         null::int as value,
         t.id, t.session_date, t.schedule_id, t.batch_name, t.instructor_name,
         cardinality(t.l)::int, cardinality(t.m)::int,
         cardinality(t.m_and_l)::int, cardinality(t.m_not_l)::int,
         t.tier, t.provenance, cardinality(t.proposed)::int,
         (case t.tier
            when 'NO EVIDENCE' then 'no attendance rows — nothing provable; left unsnapshotted (backfill step 4)'
            when 'B' then 'every marked student is still live-eligible (M subset of L); snapshot = L'
            else 'DRIFT: ' || cardinality(t.m_not_l)::text ||
                 ' marked student(s) no longer live-eligible; snapshot = M union L so no mark is lost'
          end)::text as reason
  from tiered t
),
defect_rows as (
  select 3000 as seq, '3. KNOWN DEFECT' as section,
         'session on 2026-09-11' as label, null::int as value,
         d.id, d.session_date, d.schedule_id, d.batch_name, d.instructor_name,
         cardinality(d.l)::int, cardinality(d.m)::int,
         cardinality(d.m_and_l)::int, cardinality(d.m_not_l)::int,
         d.tier, d.provenance, cardinality(d.proposed)::int,
         ('the session from the Phase 16 QA defect. Classified ' || d.tier ||
          '. NOT modified by this dry run.')::text
  from defect d
  union all
  -- Honest fallback: never let the defect disappear silently from the report.
  select 3001, '3. KNOWN DEFECT', 'session on 2026-09-11', null,
         null, null, null, null, null, null, null, null, null, null, null, null,
         'NOT FOUND in the in-scope population. Check whether it is still status = completed with a NULL marker.'
  where not exists (select 1 from defect)
  union all
  -- Every mark on that session, named. This is the provable evidence.
  select (3100 + row_number() over (order by st.full_name))::int, '3. KNOWN DEFECT',
         'MARKED (proof)', null,
         d.id, d.session_date, null::uuid, d.batch_name, null::text,
         null::int, null::int, null::int, null::int, null::text, null::text, null::int,
         (st.full_name || ' — ' || a.status ||
          case when st.id = any (d.m_not_l)
               then ' — NO LONGER live-eligible (this is the drift)'
               else ' — still live-eligible' end)::text
  from defect d
  join public.attendance a on a.class_session_id = d.id
  join public.students st on st.id = a.student_id
  union all
  -- The exact membership a backfill would write for that session.
  select (3500 + row_number() over (order by st.full_name))::int, '3. KNOWN DEFECT',
         'PROPOSED snapshot member', null,
         d.id, d.session_date, null::uuid, d.batch_name, null::text,
         null::int, null::int, null::int, null::int, d.tier, d.provenance, null::int,
         (st.full_name ||
          case when st.id = any (d.m) and st.id = any (d.l) then ' — from mark AND live eligibility'
               when st.id = any (d.m)                       then ' — from ATTENDANCE MARK only (would be lost if the backfill used L alone)'
               else ' — from live eligibility only (no mark: presence in the roster, not proof of attendance)' end)::text
  from defect d
  join lateral unnest(d.proposed) as p(sid) on true
  join public.students st on st.id = p.sid
),
postcondition as (
  -- Backfill step 5: "the snapshot never excludes a student who has an
  -- existing attendance mark." Asserted here against the PROPOSED sets.
  select 4000 as seq, '4. POST-CONDITION' as section,
         'proposed snapshot never excludes a marked student' as label,
         (select count(*)::int from tiered
           where tier in ('B', 'C')
             and exists (select 1 from unnest(m) as u(x) where not (u.x = any (proposed)))) as value,
         null::uuid, null::date, null::uuid, null::text, null::text,
         null::int, null::int, null::int, null::int,
         (case when (select count(*) from tiered
                      where tier in ('B', 'C')
                        and exists (select 1 from unnest(m) as u(x) where not (u.x = any (proposed)))) = 0
               then 'PASS' else 'FAIL' end)::text,
         null::text, null::int,
         'must be 0. This assertion alone would have caught the original defect.'::text
  union all
  select 4001, '4. POST-CONDITION',
         'no orphan snapshot rows already exist for in-scope sessions',
         (select count(*)::int from public.class_session_eligible_students e
           join target t on t.id = e.class_session_id),
         null, null, null, null, null, null, null, null, null,
         (case when (select count(*) from public.class_session_eligible_students e
                      join target t on t.id = e.class_session_id) = 0
               then 'PASS' else 'FAIL' end)::text,
         null, null,
         'must be 0 — a snapshot row whose session has a NULL marker would be an inconsistent state'
)
select * from scope
union all select * from summary
union all select * from sessions
union all select * from defect_rows
union all select * from postcondition
order by seq;

commit;
