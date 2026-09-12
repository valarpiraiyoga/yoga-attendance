-- ===========================================================================
-- Performance Slice 2A — Migration 0017 structural verification
-- Verifies supabase/migrations/0017_session_attendance_summaries.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0017. No service key and no
-- impersonation: every check reads system catalogs and function source.
--
-- STRICTLY READ-ONLY
--   * One SELECT and nothing else — no insert, update, delete, truncate,
--     create, alter or drop, and no temp table. That is the safety
--     mechanism; `begin transaction read only` is belt and braces on top.
--   * session_attendance_summaries is NOT executed. This verifies the
--     function is installed with the right identity, attributes and source —
--     not that its counts are right. Proving the counts, and proving the
--     'forbidden' path actually holds for a reassigned session, needs the
--     equivalence and reassignment tests from the Slice 2 plan, which run
--     against real rows and belong with the application refactor.
--
-- OUTPUT: one result set of seq / check_name / status / detail, ordered by
-- seq, ending in SUMMARY. Statuses: PASS, FAIL, INFO.
-- ===========================================================================

begin transaction read only;

with
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
         l.lanname,
         pg_catalog.oidvectortypes(p.proargtypes)  as argtypes,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid)             as result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language  l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'session_attendance_summaries'
),
-- Every function 0017 depends on or must leave alone.
deps as (
  select p.proname,
         p.prosecdef,
         p.provolatile,
         pg_catalog.oidvectortypes(p.proargtypes) as argtypes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('resolve_eligible_students', 'save_session_attendance',
                      'can_access_session', 'is_admin', 'report_session_facts')
),
checks as (

  -- 1. Identity ------------------------------------------------------------
  select 101 as seq,
         '1.1 function public.session_attendance_summaries exists (exactly one overload)' as check_name,
         case when (select count(*) from fn) = 1 then 'PASS' else 'FAIL' end as status,
         ((select count(*) from fn))::text || ' definition(s)' as detail
  union all
  select 102, '1.2 argument type is (jsonb)',
         case when exists (select 1 from fn where argtypes = 'jsonb') then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from fn), 'missing')
  union all
  select 103, '1.3 parameter is named p_keys (PostgREST binds RPC args BY NAME)',
         case when exists (select 1 from fn where args = 'p_keys jsonb') then 'PASS' else 'FAIL' end,
         coalesce((select args from fn), 'missing')
  union all
  select 104, '1.4 language is sql (set-based, not a procedural loop)',
         case when exists (select 1 from fn where lanname = 'sql') then 'PASS' else 'FAIL' end,
         coalesce((select lanname from fn), 'missing')
  union all
  select 105, '1.5 body contains no PL/pgSQL loop construct',
         case when exists (
                select 1 from fn
                where prosrc not ilike '%for %in %loop%' and prosrc not ilike '%while %loop%'
              ) then 'PASS' else 'FAIL' end,
         'batching must not reintroduce per-row iteration'

  -- 2. Return shape ---------------------------------------------------------
  union all
  select 201, '2.1 returns the 7 approved columns, in order, with the approved types',
         case when exists (
                select 1 from fn
                where result like 'TABLE(%schedule_id uuid%session_date date%'
                                    || 'eligible_count integer%present_count integer%'
                                    || 'absent_count integer%unmarked_count integer%'
                                    || 'eligibility_source text%'
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
  union all
  -- search_path is a LIST-type GUC: `set search_path = ''` serialises as the
  -- quoted empty list `search_path=""`, not a bare `search_path=`. Both are
  -- accepted; anything non-empty still fails.
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
  -- new function to PUBLIC, and no migration in this schema has ever revoked
  -- it. The real boundary is SECURITY INVOKER plus anon holding no SELECT on
  -- anything the body reads, so an anon call raises 42501 on the first read.
  select 305, '3.5 anon can reach no data through it (SECURITY INVOKER + no table grants)',
         case when has_table_privilege('anon', 'public.class_sessions', 'SELECT')
               or has_table_privilege('anon', 'public.attendance', 'SELECT')
               or has_table_privilege('anon', 'public.class_session_eligible_students', 'SELECT')
              then 'FAIL' else 'PASS' end,
         'anon has no SELECT on class_sessions / attendance / class_session_eligible_students'

  -- 4. Required objects referenced -------------------------------------------
  union all
  select 401, '4.1 reads the frozen snapshot table',
         case when exists (select 1 from fn where prosrc like '%public.class_session_eligible_students%')
              then 'PASS' else 'FAIL' end,
         'eligibility source of record'
  union all
  select 402, '4.2 delegates live resolution to resolve_eligible_students',
         case when exists (select 1 from fn where prosrc like '%public.resolve_eligible_students%')
              then 'PASS' else 'FAIL' end,
         'not a second eligibility implementation'
  union all
  select 403, '4.3 reads recorded marks from attendance',
         case when exists (select 1 from fn where prosrc like '%public.attendance%')
              then 'PASS' else 'FAIL' end,
         'present/absent/unmarked come from stored rows'
  union all
  select 404, '4.4 joins class_sessions for the snapshot marker',
         case when exists (select 1 from fn where prosrc like '%public.class_sessions%')
              then 'PASS' else 'FAIL' end,
         'eligibility_snapshot_at decides snapshot vs live'

  -- 5. Approved behaviour, asserted in source --------------------------------
  union all
  select 501, '5.1 snapshot-first: the marker decides the branch',
         case when exists (
                select 1 from fn
                where prosrc like '%k_snap_at is not null%' and prosrc like '%k_snap_at is null%'
              ) then 'PASS' else 'FAIL' end,
         'frozen set wins whenever one exists'
  union all
  select 502, '5.2 projected occurrences supported (class_session_id may be NULL)',
         case when exists (
                select 1 from fn
                where prosrc like '%left join public.class_sessions%'
                  and prosrc like '%class_session_id%'
              ) then 'PASS' else 'FAIL' end,
         'LEFT JOIN, so an occurrence with no materialized row still returns a row'
  union all
  select 503, '5.3 keyed on the occurrence (schedule_id, session_date)',
         case when exists (
                select 1 from fn where prosrc like '%distinct on (p.k_schedule, p.k_date)%'
              ) then 'PASS' else 'FAIL' end,
         'the only key a projected occurrence has; also de-duplicates input'
  union all
  select 504, '5.4 FORBIDDEN path: inaccessible occurrence returns NULL counts, never raises',
         case when exists (
                select 1 from fn
                where prosrc like '%can_access_session%'
                  and prosrc like '%''forbidden''%'
                  and prosrc like '%not s.k_allowed then null%'
              ) then 'PASS' else 'FAIL' end,
         'set-based equivalent of the per-row try/catch it replaces'
  union all
  select 505, '5.5 authorization gate mirrors resolve_eligible_students'' own gate',
         case when exists (
                select 1 from fn
                where prosrc like '%public.is_admin() or public.can_access_session%'
              ) then 'PASS' else 'FAIL' end,
         'so this can never accept an occurrence resolve would refuse'
  union all
  select 506, '5.6 MATERIALIZED fence stops the planner calling resolve before the auth filter',
         case when exists (select 1 from fn where prosrc ilike '%as materialized%')
              then 'PASS' else 'FAIL' end,
         'load-bearing: without it a 42501 could abort the whole page'
  union all
  select 507, '5.7 unmarked = eligible - all marks, floored at zero',
         case when exists (select 1 from fn where prosrc like '%greatest(0,%')
              then 'PASS' else 'FAIL' end,
         'mirrors computeAttendanceSummary exactly'
  union all
  select 508, '5.8 no status filtering — cancelled/holiday summarised as they are today',
         case when exists (
                select 1 from fn
                where prosrc not like '%status = ''cancelled''%'
                  and prosrc not like '%status = ''holiday''%'
                  and prosrc not like '%status = ''completed''%'
              ) then 'PASS' else 'FAIL' end,
         'behaviour must be identical to getAttendanceSummary'
  union all
  select 509, '5.9 malformed / empty input degrades instead of raising',
         case when exists (
                select 1 from fn
                where prosrc like '%jsonb_typeof(p_keys) = ''array''%'
                  and prosrc like '%jsonb_typeof(e) = ''object''%'
              ) then 'PASS' else 'FAIL' end,
         'non-array input becomes an empty request; bad elements are skipped'
  union all
  select 510, '5.10 historical integrity: live enrollment/membership state never read directly',
         case when exists (
                select 1 from fn
                where prosrc not like '%batch_enrollments%'
                  and prosrc not like '%enrollment_schedules%'
                  and prosrc not like '%public.memberships%'
              ) then 'PASS' else 'FAIL' end,
         'only resolve_eligible_students may evaluate live eligibility'

  -- 6. Existing objects unchanged --------------------------------------------
  union all
  select 601, '6.1 resolve_eligible_students unchanged: (uuid, uuid, date), DEFINER, STABLE',
         case when exists (
                select 1 from deps
                where proname = 'resolve_eligible_students'
                  and argtypes = 'uuid, uuid, date' and prosecdef and provolatile = 's'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from deps where proname = 'resolve_eligible_students'), 'missing')
  union all
  select 602, '6.2 save_session_attendance unchanged: (uuid, jsonb), DEFINER',
         case when exists (
                select 1 from deps
                where proname = 'save_session_attendance'
                  and argtypes = 'uuid, jsonb' and prosecdef
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from deps where proname = 'save_session_attendance'), 'missing')
  union all
  select 603, '6.3 can_access_session unchanged: (uuid, date), DEFINER, STABLE',
         case when exists (
                select 1 from deps
                where proname = 'can_access_session'
                  and argtypes = 'uuid, date' and prosecdef and provolatile = 's'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from deps where proname = 'can_access_session'), 'missing')
  union all
  select 604, '6.4 is_admin unchanged: (), DEFINER, STABLE',
         case when exists (
                select 1 from deps
                where proname = 'is_admin' and prosecdef and provolatile = 's'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from deps where proname = 'is_admin'), 'missing')
  union all
  select 605, '6.5 report_session_facts (0016) untouched: INVOKER, STABLE',
         case when exists (
                select 1 from deps
                where proname = 'report_session_facts'
                  and argtypes = 'date, date, uuid, uuid'
                  and not prosecdef and provolatile = 's'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select argtypes from deps where proname = 'report_session_facts'), 'missing')
  union all
  select 606, '6.6 snapshot table still write-once for clients (0015 unchanged)',
         case when to_regclass('public.class_session_eligible_students') is null then 'FAIL'
              when not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'INSERT')
               and not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'UPDATE')
               and not has_table_privilege('authenticated', to_regclass('public.class_session_eligible_students'), 'DELETE')
              then 'PASS' else 'FAIL' end,
         'migration 0017 must not have widened it'
  union all
  select 607, '6.7 attendance keeps its original columns',
         case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name = 'attendance'
                       and column_name in ('id','class_session_id','student_id','status','created_at','updated_at')) = 6
              then 'PASS' else 'FAIL' end,
         'no column added, removed or renamed'

  -- 7. No unnecessary new objects ---------------------------------------------
  union all
  select 701, '7.1 no table created by this migration',
         case when (select count(*) from pg_tables
                     where schemaname = 'public' and tablename like '%session_attendance%') = 0
              then 'PASS' else 'FAIL' end,
         'function-only migration'
  union all
  select 702, '7.2 no index created by this migration',
         case when (select count(*) from pg_indexes
                     where schemaname = 'public'
                       and (indexname like '%session_attendance%' or indexname like '%summaries%')) = 0
              then 'PASS' else 'FAIL' end,
         'existing indexes already cover every access path'
  union all
  select 703, '7.3 no policy created by this migration',
         case when (select count(*) from pg_policies
                     where schemaname = 'public' and policyname like '%session_attendance%') = 0
              then 'PASS' else 'FAIL' end,
         'RLS unchanged'
  union all
  select 704, '7.4 session_attendance_summaries is the only function it adds',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like '%session_attendance%'
                       and p.proname <> 'save_session_attendance') = 1
              then 'PASS' else 'FAIL' end,
         'one shared batching function (save_session_attendance predates 0017 and is excluded)'

  -- 8. Readouts ----------------------------------------------------------------
  union all
  select 901, '8.1 indexes the batched reads rely on',
         'INFO',
         (select string_agg(indexname::text, ', ' order by indexname)
          from pg_indexes
          where schemaname = 'public'
            and indexname in ('class_sessions_session_date_idx',
                              'attendance_session_student_unique',
                              'class_session_eligible_students_pkey'))
  union all
  select 902, '8.2 completed sessions still lacking a snapshot',
         'INFO',
         ((select count(*) from public.class_sessions
            where status = 'completed' and eligibility_snapshot_at is null))::text
           || ' session(s) — these take the live branch'
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
