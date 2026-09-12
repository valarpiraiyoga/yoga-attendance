-- ===========================================================================
-- Phase 17 — Migration 0016 structural verification
-- Verifies supabase/migrations/0016_report_session_facts.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0016. No service key and no
-- impersonation: every check reads system catalogs and function source,
-- which any signed-in role can read.
--
-- STRICTLY READ-ONLY
--   * One SELECT and nothing else — no insert, update, delete, truncate,
--     create, alter or drop, and no temp table. That is the safety
--     mechanism; the `begin transaction read only` wrapper is belt and
--     braces on top of it.
--   * report_session_facts is NOT executed. This verifies that the function
--     is installed with the right identity, attributes and source — not
--     that it returns correct numbers. Proving the numbers requires running
--     it against real sessions and comparing with the existing
--     implementation, which belongs in the refactor's own equivalence
--     check, not here.
--
-- OUTPUT: one result set (the editor shows only the last one) of
-- seq / check_name / status / detail, ordered by seq, ending in SUMMARY.
-- Statuses: PASS, FAIL, and INFO (a readout, never an assertion).
-- ===========================================================================

begin transaction read only;

with
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
         l.lanname,
         pg_catalog.oidvectortypes(p.proargtypes)        as argtypes,
         pg_get_function_identity_arguments(p.oid)       as args,
         pg_get_function_result(p.oid)                   as result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language  l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'report_session_facts'
),
-- The two Phase 15/16A functions this migration must leave alone.
fn_resolve as (
  select p.oid, p.prosecdef,
         pg_catalog.oidvectortypes(p.proargtypes) as argtypes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_eligible_students'
),
fn_save as (
  select p.oid, p.prosecdef,
         pg_catalog.oidvectortypes(p.proargtypes) as argtypes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'save_session_attendance'
),
pol as (
  select policyname, cmd
  from pg_policies
  where schemaname = 'public' and tablename = 'class_session_eligible_students'
),
checks as (

  -- 1. Identity ------------------------------------------------------------
  select 101 as seq,
         '1.1 function public.report_session_facts exists (exactly one overload)' as check_name,
         case when (select count(*) from fn) = 1 then 'PASS' else 'FAIL' end as status,
         ((select count(*) from fn))::text || ' definition(s)' as detail
  union all
  select 102, '1.2 argument types are (date, date, uuid, uuid)',
         case when exists (select 1 from fn where argtypes = 'date, date, uuid, uuid')
              then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from fn), 'missing')
  union all
  select 103, '1.3 parameter names are the approved ones (PostgREST binds RPC args BY NAME)',
         case when exists (
                select 1 from fn
                where args = 'p_date_from date, p_date_to date, p_batch_id uuid, p_student_id uuid'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select args from fn), 'missing')
  union all
  select 104, '1.4 language is sql (set-based, not a procedural loop)',
         case when exists (select 1 from fn where lanname = 'sql') then 'PASS' else 'FAIL' end,
         coalesce((select lanname from fn), 'missing')

  -- 2. Return shape ---------------------------------------------------------
  union all
  select 201, '2.1 returns a TABLE of the 15 approved columns, in order',
         case when exists (
                select 1 from fn
                where result like 'TABLE(%class_session_id uuid%session_date date%start_time time%end_time time%'
                                    || 'batch_id uuid%batch_name text%batch_code text%'
                                    || 'instructor_id uuid%instructor_name text%'
                                    || 'eligible_count integer%present_count integer%absent_count integer%'
                                    || 'unmarked_count integer%student_status text%eligibility_source text%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select result from fn), 'missing')

  -- 3. Security and volatility ----------------------------------------------
  union all
  select 301, '3.1 SECURITY INVOKER (not DEFINER) — RLS stays the ownership boundary',
         case when exists (select 1 from fn where prosecdef = false) then 'PASS' else 'FAIL' end,
         coalesce((select 'prosecdef=' || prosecdef::text from fn), 'missing')
  union all
  select 302, '3.2 STABLE',
         case when exists (select 1 from fn where provolatile = 's') then 'PASS' else 'FAIL' end,
         coalesce((select 'provolatile=' || provolatile::text from fn), 'missing')
  -- search_path is a LIST-type GUC, so `set search_path = ''` is serialised
  -- into proconfig as the quoted empty list, `search_path=""` — not a bare
  -- `search_path=`. Both spellings are accepted here; anything non-empty
  -- (`search_path=public`) still fails, so the assertion keeps its teeth.
  union all
  select 303, '3.3 search_path is pinned and EMPTY (not ''public'')',
         case when exists (
                select 1 from fn, unnest(fn.proconfig) as c(entry)
                where c.entry in ('search_path=', 'search_path=""')
              ) then 'PASS' else 'FAIL' end,
         coalesce((select array_to_string(proconfig, ',') from fn), 'no proconfig')
  union all
  select 304, '3.4 EXECUTE granted to authenticated',
         case when (select count(*) from fn) = 1
               and has_function_privilege('authenticated', (select oid from fn), 'EXECUTE')
              then 'PASS' else 'FAIL' end,
         'authenticated must be able to call it'
  union all
  -- Deliberately NOT "anon lacks EXECUTE": PostgreSQL grants EXECUTE on every
  -- newly created function to PUBLIC, and has_function_privilege reports
  -- privileges held through PUBLIC. Asserting its absence would assert
  -- something this schema has never done — no migration contains a REVOKE.
  -- The real boundary for an anon caller is that this function is SECURITY
  -- INVOKER and anon holds no SELECT on anything it reads, so the call raises
  -- 42501 on the first table read and no data is reachable.
  select 305, '3.5 anon can reach no data through it (SECURITY INVOKER + no table grants)',
         case when has_table_privilege('anon', 'public.class_sessions', 'SELECT')
               or has_table_privilege('anon', 'public.attendance', 'SELECT')
               or has_table_privilege('anon', 'public.class_session_eligible_students', 'SELECT')
              then 'FAIL' else 'PASS' end,
         'EXECUTE is held via PUBLIC by default; the boundary is SECURITY INVOKER plus anon having no SELECT on class_sessions / attendance / class_session_eligible_students'

  -- 4. Source: the approved rules --------------------------------------------
  union all
  select 401, '4.1 completed sessions only',
         case when exists (select 1 from fn where prosrc like '%status = ''completed''%')
              then 'PASS' else 'FAIL' end,
         'cancelled/holiday never take attendance; projected occurrences have no row'
  union all
  select 402, '4.2 inclusive date bounds (>= p_date_from and <= p_date_to)',
         case when exists (
                select 1 from fn
                where prosrc like '%session_date >= p_date_from%'
                  and prosrc like '%session_date <= p_date_to%'
              ) then 'PASS' else 'FAIL' end,
         'a single-date report is p_date_from = p_date_to'
  union all
  select 403, '4.3 optional batch filter (p_batch_id is null or ...)',
         case when exists (select 1 from fn where prosrc like '%p_batch_id is null or%')
              then 'PASS' else 'FAIL' end,
         'null means all batches, not none'
  union all
  select 404, '4.4 snapshot is the primary eligibility source',
         case when exists (
                select 1 from fn
                where prosrc like '%public.class_session_eligible_students%'
                  and prosrc like '%snap_at is not null%'
              ) then 'PASS' else 'FAIL' end,
         'frozen set used for any session carrying a marker'
  union all
  select 405, '4.5 live fallback runs ONLY for unsnapshotted sessions, inside the function',
         case when exists (
                select 1 from fn
                where prosrc like '%public.resolve_eligible_students%'
                  and prosrc like '%snap_at is null%'
                  and prosrc like '%cross join lateral%'
              ) then 'PASS' else 'FAIL' end,
         'no second round trip from the application'
  union all
  select 406, '4.6 eligibility_source reports snapshot / live_fallback per row',
         case when exists (
                select 1 from fn
                where prosrc like '%''snapshot''%' and prosrc like '%''live_fallback''%'
              ) then 'PASS' else 'FAIL' end,
         'so a growing fallback set is visible, not silent'
  union all
  select 407, '4.7 historical integrity: live enrollment/membership state is never read',
         case when exists (
                select 1 from fn
                where prosrc not like '%batch_enrollments%'
                  and prosrc not like '%enrollment_schedules%'
                  and prosrc not like '%public.memberships%'
              ) then 'PASS' else 'FAIL' end,
         'recomputing a completed session from live state is the Phase 16A defect'
  union all
  select 408, '4.8 "a mark is proof": a student''s session is kept even without a snapshot row',
         case when exists (select 1 from fn where prosrc like '%sm.id is not null%')
              then 'PASS' else 'FAIL' end,
         'an attendance row proves eligibility at save time'
  union all
  select 409, '4.9 unmarked = eligible - all marks, floored at zero',
         case when exists (select 1 from fn where prosrc like '%greatest(0,%')
              then 'PASS' else 'FAIL' end,
         'mirrors computeAttendanceSummary so reports and Attendance Details agree'
  union all
  select 410, '4.10 student_status is NULL unless p_student_id was supplied',
         case when exists (select 1 from fn where prosrc like '%p_student_id is null then null%')
              then 'PASS' else 'FAIL' end,
         'and present/absent/unmarked when it was'

  -- 5. No unexpected schema objects ------------------------------------------
  union all
  select 501, '5.1 no table was created by this migration',
         case when (select count(*) from pg_tables
                     where schemaname = 'public' and tablename like 'report%') = 0
              then 'PASS' else 'FAIL' end,
         'this migration is function-only'
  union all
  select 502, '5.2 no index was created by this migration',
         case when (select count(*) from pg_indexes
                     where schemaname = 'public' and indexname like 'report%') = 0
              then 'PASS' else 'FAIL' end,
         'no speculative indexes — the query uses existing ones'
  union all
  select 503, '5.3 no policy was created by this migration',
         case when (select count(*) from pg_policies
                     where schemaname = 'public' and policyname like 'report%') = 0
              then 'PASS' else 'FAIL' end,
         'RLS is unchanged'
  union all
  select 504, '5.4 report_session_facts is the only new public function',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'report%') = 1
              then 'PASS' else 'FAIL' end,
         'one shared core, not three per-report functions'

  -- 6. Migration 0015 objects unchanged --------------------------------------
  union all
  select 601, '6.1 class_session_eligible_students still exists',
         case when to_regclass('public.class_session_eligible_students') is not null
              then 'PASS' else 'FAIL' end,
         coalesce(to_regclass('public.class_session_eligible_students')::text, 'missing')
  union all
  select 602, '6.2 its primary key is still (class_session_id, student_id)',
         case when exists (
                select 1 from pg_constraint c
                where c.conrelid = to_regclass('public.class_session_eligible_students')
                  and c.contype = 'p'
                  and pg_get_constraintdef(c.oid) like '%(class_session_id, student_id)%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.class_session_eligible_students')
                      and c.contype = 'p'), 'no primary key')
  union all
  select 603, '6.3 provenance CHECK still admits exactly the three approved values',
         case when exists (
                select 1 from pg_constraint c
                where c.conrelid = to_regclass('public.class_session_eligible_students')
                  and c.contype = 'c'
                  and pg_get_constraintdef(c.oid) like '%save%'
                  and pg_get_constraintdef(c.oid) like '%backfill_consistent%'
                  and pg_get_constraintdef(c.oid) like '%backfill_drift%'
              ) then 'PASS' else 'FAIL' end,
         'save / backfill_consistent / backfill_drift'
  union all
  select 604, '6.4 class_sessions.eligibility_snapshot_at still exists and is nullable',
         case when exists (
                select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'class_sessions'
                  and column_name = 'eligibility_snapshot_at' and is_nullable = 'YES'
              ) then 'PASS' else 'FAIL' end,
         'NULL still distinguishes "no snapshot" from an empty snapshot'
  union all
  select 605, '6.5 snapshot table is still write-once for clients (no write grant, no write policy)',
         case when to_regclass('public.class_session_eligible_students') is null then 'FAIL'
              when not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'INSERT')
               and not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'UPDATE')
               and not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'DELETE')
               and not exists (select 1 from pol where cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
              then 'PASS' else 'FAIL' end,
         'migration 0016 must not have widened it'
  union all
  select 606, '6.6 its two SELECT policies are still present',
         case when (select count(*) from pol where cmd = 'SELECT') = 2 then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(policyname::text, ', ' order by policyname) from pol), 'no policies')

  -- 7. Attendance / history objects unmodified --------------------------------
  union all
  select 701, '7.1 attendance keeps its original columns',
         case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name = 'attendance'
                       and column_name in ('id','class_session_id','student_id','status','created_at','updated_at')) = 6
              then 'PASS' else 'FAIL' end,
         'no column added, removed or renamed'
  union all
  select 702, '7.2 attendance_session_student_unique still present',
         case when exists (
                select 1 from pg_constraint c
                where c.conrelid = to_regclass('public.attendance')
                  and c.conname = 'attendance_session_student_unique'
              ) then 'PASS' else 'FAIL' end,
         'one mark per (session, student) — what stops the student join multiplying rows'
  union all
  select 703, '7.3 resolve_eligible_students unchanged: (uuid, uuid, date), SECURITY DEFINER',
         case when exists (
                select 1 from fn_resolve
                where argtypes = 'uuid, uuid, date' and prosecdef = true
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes || ', prosecdef=' || prosecdef::text from fn_resolve), 'missing')
  union all
  select 704, '7.4 save_session_attendance unchanged: (uuid, jsonb), SECURITY DEFINER',
         case when exists (
                select 1 from fn_save
                where argtypes = 'uuid, jsonb' and prosecdef = true
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes || ', prosecdef=' || prosecdef::text from fn_save), 'missing')

  -- 8. Indexes this function relies on already exist ---------------------------
  union all
  select 801, '8.1 class_sessions_session_date_idx (the range scan)',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'class_sessions_session_date_idx')
              then 'PASS' else 'FAIL' end, '0010'
  union all
  select 802, '8.2 class_sessions_batch_id_idx (the optional batch filter)',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'class_sessions_batch_id_idx')
              then 'PASS' else 'FAIL' end, '0010'
  union all
  select 803, '8.3 attendance_session_student_unique (marks by session, and the student join)',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'attendance_session_student_unique')
              then 'PASS' else 'FAIL' end, '0011'
  union all
  select 804, '8.4 attendance_student_id_idx',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'attendance_student_id_idx')
              then 'PASS' else 'FAIL' end, '0011'
  union all
  select 805, '8.5 class_session_eligible_students_pkey (snapshot rows by session)',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'class_session_eligible_students_pkey')
              then 'PASS' else 'FAIL' end, '0015'
  union all
  select 806, '8.6 class_session_eligible_students_student_id_idx',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'class_session_eligible_students_student_id_idx')
              then 'PASS' else 'FAIL' end, '0015'

  -- 9. Readouts ----------------------------------------------------------------
  union all
  select 901, '9.1 completed sessions still lacking a snapshot (fallback population)',
         'INFO',
         ((select count(*) from public.class_sessions
            where status = 'completed' and eligibility_snapshot_at is null))::text
           || ' session(s) — each costs one lateral resolve when in range'
  union all
  select 902, '9.2 snapshot rows / markers present',
         'INFO',
         ((select count(*) from public.class_session_eligible_students))::text || ' snapshot row(s), '
           || ((select count(*) from public.class_sessions where eligibility_snapshot_at is not null))::text
           || ' marker(s)'
)
select seq, check_name, status, detail from checks
union all
select 9999, 'SUMMARY',
       case when exists (select 1 from checks where status = 'FAIL') then 'FAILURES' else 'ALL PASS' end,
       (select (count(*) filter (where status = 'PASS'))::text || ' passed, '
             || (count(*) filter (where status = 'FAIL'))::text || ' failed, '
             || (count(*) filter (where status = 'INFO'))::text || ' informational'
        from checks)
order by seq;

commit;
