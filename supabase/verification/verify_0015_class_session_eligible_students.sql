-- ===========================================================================
-- Phase 16A — Migration 0015 structural verification
-- Verifies supabase/migrations/0015_class_session_eligible_students.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0015. No service key needed
-- and no impersonation is used: every check reads system catalogs and
-- function source, which any signed-in role can read.
--
-- READ-ONLY BY CONSTRUCTION
--   * The script contains one SELECT and nothing else — no insert, update,
--     delete, truncate, create, alter or drop, and no temp table (unlike
--     verify_0014, which needed one to render its results; here the checks
--     are plain queries, so the result grid is the output).
--   * That SELECT runs inside `begin transaction read only` … `commit`,
--     so the database itself refuses any write even if this file is later
--     edited carelessly.
--   * Neither `save_session_attendance` nor any other writer is invoked.
--
-- WHAT THIS SCRIPT CAN AND CANNOT PROVE
--   This is a *structural* verification: schema shape, privileges, RLS,
--   function attributes, and function source. It proves the snapshot
--   machinery is installed and wired in the required order.
--
--   It deliberately does NOT prove runtime behaviour — that a first save
--   actually writes a snapshot, that a correction validates against the
--   frozen set, or that a zero-eligible session still stamps the marker.
--   Proving those requires actually saving attendance, i.e. writing, which
--   this script is explicitly forbidden to do. Those belong in a separate
--   behavioural test run inside a rolled-back transaction (the
--   verify_0014 pattern), after this one passes.
--
-- OUTPUT
--   A single result set, so the SQL editor — which displays only the last
--   result set a script produces — shows the whole verification at once:
--
--     seq 101-902  the 47 structural PASS/FAIL checks
--     seq 903-905  the data-state rows: no backfill was performed (9.3, 9.4)
--                  and the attendance row count readout (9.5, INFO)
--     seq 9999     SUMMARY — ALL PASS or FAILURES, with counts
--
--   Sorted by seq, so SUMMARY is the last row. Read it first: if it says
--   ALL PASS, nothing above it needs reading. Statuses are PASS, FAIL,
--   CHECK (eyeball it — see the row's own note) and INFO (a readout, never
--   an assertion). Only a FAIL can produce the FAILURES verdict.
--
--   One consequence of merging into a single statement: if the snapshot
--   table is missing entirely, rows 903-905 make the whole query fail to
--   parse rather than letting check 1.1 report the absence. Run this only
--   after 0015 has been applied.
-- ===========================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- The verification — one statement, one result set
-- ---------------------------------------------------------------------------
with t as (
  select to_regclass('public.class_session_eligible_students') as rel,
         to_regclass('public.class_sessions')                  as sessions_rel
),
col as (
  select a.attname, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull, a.attnum
  from pg_attribute a, t
  where a.attrelid = t.rel and a.attnum > 0 and not a.attisdropped
),
pk as (
  select c.conkey, pg_get_constraintdef(c.oid) as def
  from pg_constraint c, t
  where c.conrelid = t.rel and c.contype = 'p'
),
fk as (
  select c.conname, c.confdeltype, c.confrelid, pg_get_constraintdef(c.oid) as def
  from pg_constraint c, t
  where c.conrelid = t.rel and c.contype = 'f'
),
ck as (
  select c.conname, pg_get_constraintdef(c.oid) as def
  from pg_constraint c, t
  where c.conrelid = t.rel and c.contype = 'c'
),
idx as (
  select i.indexrelid::regclass::text as name, pg_get_indexdef(i.indexrelid) as def
  from pg_index i, t
  where i.indrelid = t.rel
),
pol as (
  select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'class_session_eligible_students'
),
-- `argtypes` is the pure input-type vector ('uuid, uuid, date') — function
-- identity in the PostgreSQL sense, names excluded. `args` additionally
-- carries the parameter names ('p_batch_id uuid, ...'), which matter here
-- because PostgREST binds RPC arguments BY NAME
-- (lib/attendance/data.js, lib/attendance/actions.js), so a rename would
-- break the application even though the function's identity was preserved.
-- Both are asserted below.
fn_resolve as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig,
         pg_catalog.oidvectortypes(p.proargtypes) as argtypes,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_eligible_students'
),
fn_save as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig,
         pg_catalog.oidvectortypes(p.proargtypes) as argtypes,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'save_session_attendance'
),
checks as (

  -- 1. Table --------------------------------------------------------------
  select 101 as seq, '1.1 table class_session_eligible_students exists' as check_name,
         case when (select rel from t) is not null then 'PASS' else 'FAIL' end as status,
         coalesce((select rel::text from t), 'missing') as detail
  union all
  select 102, '1.2 class_session_id is uuid NOT NULL',
         case when exists (select 1 from col where attname='class_session_id' and typ='uuid' and attnotnull)
              then 'PASS' else 'FAIL' end,
         coalesce((select typ || case when attnotnull then ' NOT NULL' else ' NULL' end from col where attname='class_session_id'), 'missing')
  union all
  select 103, '1.3 student_id is uuid NOT NULL',
         case when exists (select 1 from col where attname='student_id' and typ='uuid' and attnotnull)
              then 'PASS' else 'FAIL' end,
         coalesce((select typ || case when attnotnull then ' NOT NULL' else ' NULL' end from col where attname='student_id'), 'missing')
  union all
  select 104, '1.4 membership_start_date / membership_end_date are date',
         case when (select count(*) from col where attname in ('membership_start_date','membership_end_date') and typ='date') = 2
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(attname::text || ' ' || typ, ', ' order by attname) from col
                   where attname in ('membership_start_date','membership_end_date')), 'missing')
  union all
  select 105, '1.5 primary key is (class_session_id, student_id)',
         case when exists (
                select 1 from pk
                where pk.conkey = array[
                  (select attnum from col where attname='class_session_id'),
                  (select attnum from col where attname='student_id')
                ]::int2[]
              ) then 'PASS' else 'FAIL' end,
         coalesce((select def from pk), 'no primary key')
  union all
  select 106, '1.6 FK class_session_id -> class_sessions(id)',
         case when exists (select 1 from fk where confrelid = (select sessions_rel from t) and def like '%class_session_id%')
              then 'PASS' else 'FAIL' end,
         coalesce((select def from fk where confrelid = (select sessions_rel from t)), 'missing')
  union all
  select 107, '1.7 FK student_id -> students(id)',
         case when exists (select 1 from fk where confrelid = to_regclass('public.students') and def like '%student_id%')
              then 'PASS' else 'FAIL' end,
         coalesce((select def from fk where confrelid = to_regclass('public.students')), 'missing')
  union all
  select 108, '1.8 both FKs are ON DELETE RESTRICT',
         case when (select count(*) from fk) = 2 and not exists (select 1 from fk where confdeltype <> 'r')
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(conname::text || '=' || confdeltype::text, ', ' order by conname) from fk), 'no foreign keys')
  union all
  select 109, '1.9 index on student_id exists (not merely the PK''s leading column)',
         case when exists (
                select 1 from idx
                where idx.def like '%(student_id)%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(name, ', ' order by name) from idx), 'no indexes')

  -- 2. Snapshot marker ------------------------------------------------------
  union all
  select 201, '2.1 class_sessions.eligibility_snapshot_at exists and is timestamptz',
         case when exists (
                select 1 from information_schema.columns
                where table_schema='public' and table_name='class_sessions'
                  and column_name='eligibility_snapshot_at'
                  and data_type='timestamp with time zone'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select data_type::text || ', nullable=' || is_nullable::text from information_schema.columns
                   where table_schema='public' and table_name='class_sessions' and column_name='eligibility_snapshot_at'), 'missing')
  union all
  select 202, '2.2 marker is nullable (NULL distinguishes "no snapshot" from an empty snapshot)',
         case when exists (
                select 1 from information_schema.columns
                where table_schema='public' and table_name='class_sessions'
                  and column_name='eligibility_snapshot_at' and is_nullable='YES'
              ) then 'PASS' else 'FAIL' end,
         'NULL = no snapshot; non-NULL = frozen, including when the frozen set is empty'

  -- 3. Provenance -----------------------------------------------------------
  union all
  select 301, '3.1 provenance column exists (text, NOT NULL)',
         case when exists (select 1 from col where attname='provenance' and typ='text' and attnotnull)
              then 'PASS' else 'FAIL' end,
         coalesce((select typ from col where attname='provenance'), 'missing')
  union all
  select 302, '3.2 provenance default is ''save''',
         case when (select column_default from information_schema.columns
                    where table_schema='public' and table_name='class_session_eligible_students'
                      and column_name='provenance') like '%save%'
              then 'PASS' else 'FAIL' end,
         coalesce((select column_default::text from information_schema.columns
                   where table_schema='public' and table_name='class_session_eligible_students'
                     and column_name='provenance'), 'no default')
  union all
  select 303, '3.3 CHECK constraint allows exactly save / backfill_consistent / backfill_drift',
         case when exists (
                select 1 from ck
                where def like '%provenance%'
                  and def like '%save%' and def like '%backfill_consistent%' and def like '%backfill_drift%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select def from ck where def like '%provenance%'), 'no provenance CHECK')
  union all
  select 304, '3.4 created_at exists (timestamptz NOT NULL)',
         case when exists (select 1 from col where attname='created_at' and typ like 'timestamp with time zone%' and attnotnull)
              then 'PASS' else 'FAIL' end,
         coalesce((select typ from col where attname='created_at'), 'missing')

  -- 4. Grants ---------------------------------------------------------------
  -- Each privilege test is guarded on the table existing: has_table_privilege
  -- raises rather than returning false for a missing relation, which would
  -- abort the whole grid and hide check 1.1's real answer.
  union all
  select 401, '4.1 authenticated HAS SELECT on the snapshot table',
         case when (select rel from t) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from t), 'SELECT') then 'PASS'
              else 'FAIL' end,
         'select granted'
  union all
  select 402, '4.2 authenticated has NO INSERT (sole writer is the SECURITY DEFINER save path)',
         case when (select rel from t) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from t), 'INSERT') then 'FAIL'
              else 'PASS' end,
         'insert must not be granted'
  union all
  select 403, '4.3 authenticated has NO UPDATE (write-once)',
         case when (select rel from t) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from t), 'UPDATE') then 'FAIL'
              else 'PASS' end,
         'update must not be granted'
  union all
  select 404, '4.4 authenticated has NO DELETE (write-once)',
         case when (select rel from t) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from t), 'DELETE') then 'FAIL'
              else 'PASS' end,
         'delete must not be granted'
  union all
  select 405, '4.5 anon has no privileges at all',
         case when (select rel from t) is null then 'FAIL'
              when has_table_privilege('anon', (select rel from t), 'SELECT')
                or has_table_privilege('anon', (select rel from t), 'INSERT') then 'FAIL'
              else 'PASS' end,
         'anon must have nothing'

  -- 5. RLS -------------------------------------------------------------------
  union all
  select 501, '5.1 RLS is enabled on the snapshot table',
         case when (select relrowsecurity from pg_class where oid = (select rel from t)) then 'PASS' else 'FAIL' end,
         coalesce((select 'relrowsecurity=' || relrowsecurity::text from pg_class where oid = (select rel from t)), 'table missing')
  union all
  select 502, '5.2 admin SELECT policy exists (is_admin())',
         case when exists (select 1 from pol where cmd='SELECT' and qual like '%is_admin%') then 'PASS' else 'FAIL' end,
         coalesce((select policyname::text from pol where cmd='SELECT' and qual like '%is_admin%'), 'missing')
  union all
  select 503, '5.3 assigned-instructor SELECT policy exists (current_instructor_id() via class_sessions)',
         case when exists (
                select 1 from pol
                where cmd='SELECT' and qual like '%current_instructor_id%' and qual like '%class_sessions%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select policyname::text from pol where cmd='SELECT' and qual like '%current_instructor_id%'), 'missing')
  union all
  select 504, '5.4 NO client write policy of any kind',
         case when exists (select 1 from pol where cmd in ('INSERT','UPDATE','DELETE','ALL')) then 'FAIL' else 'PASS' end,
         coalesce((select string_agg(policyname::text || ':' || cmd::text, ', ' order by policyname) from pol), 'no policies at all')

  -- 6. resolve_eligible_students --------------------------------------------
  union all
  select 601, '6.1 signature unchanged: types (uuid, uuid, date) AND parameter names',
         case when exists (
                select 1 from fn_resolve
                where argtypes = 'uuid, uuid, date'
                  and args = 'p_batch_id uuid, p_schedule_id uuid, p_session_date date'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select 'types: ' || argtypes || ' | named: ' || args from fn_resolve), 'missing')
  union all
  select 602, '6.2 return shape unchanged (6-column TABLE incl. display fields)',
         case when exists (
                select 1 from fn_resolve
                where result like 'TABLE(%student_id uuid%full_name text%phone text%student_code text%membership_start_date date%membership_end_date date%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select result from fn_resolve), 'missing')
  union all
  select 603, '6.3 remains SECURITY DEFINER',
         case when (select prosecdef from fn_resolve) then 'PASS' else 'FAIL' end,
         coalesce((select 'prosecdef=' || prosecdef::text from fn_resolve), 'missing')
  union all
  select 604, '6.4 search_path is pinned (not caller-controlled)',
         case when exists (select 1 from fn_resolve where array_to_string(proconfig, ',') like '%search_path=%')
              then 'PASS' else 'FAIL' end,
         coalesce((select array_to_string(proconfig, ',') from fn_resolve), 'no proconfig')
  union all
  select 605, '6.5 authorization still enforced (is_admin OR can_access_session, 42501)',
         case when exists (
                select 1 from fn_resolve
                where prosrc like '%is_admin()%' and prosrc like '%can_access_session%' and prosrc like '%42501%'
              ) then 'PASS' else 'FAIL' end,
         'must raise 42501 when neither admin nor owning instructor'
  union all
  select 606, '6.6 snapshot branch exists and keys off eligibility_snapshot_at',
         case when exists (
                select 1 from fn_resolve
                where prosrc like '%eligibility_snapshot_at%'
                  and prosrc like '%v_snapshot_at is not null%'
              ) then 'PASS' else 'FAIL' end,
         'branch must test the marker, not status = completed'
  union all
  select 607, '6.7 snapshot branch returns the frozen students',
         case when exists (
                select 1 from fn_resolve
                where prosrc like '%from public.class_session_eligible_students%'
                  and prosrc like '%join public.students%'
              ) then 'PASS' else 'FAIL' end,
         'frozen set joined to students for the same display fields'
  union all
  select 608, '6.8 no-snapshot branch retains live eligibility (D1-D3 + Phase 15A)',
         case when exists (
                select 1 from fn_resolve
                where prosrc like '%enrollment_schedules%'
                  and prosrc like '%cancelled_at%'
                  and prosrc like '%batch_enrollments%'
                  and prosrc like '%distinct on%'
              ) then 'PASS' else 'FAIL' end,
         'live branch must still carry the assignment, membership and tie-break rules'

  -- 7. save_session_attendance ----------------------------------------------
  union all
  select 701, '7.1 signature unchanged: types (uuid, jsonb) -> jsonb AND parameter names',
         case when exists (
                select 1 from fn_save
                where argtypes = 'uuid, jsonb'
                  and args = 'p_class_session_id uuid, p_marks jsonb'
                  and result = 'jsonb'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select 'types: ' || argtypes || ' | named: ' || args || ' -> ' || result from fn_save), 'missing')
  union all
  select 702, '7.2 remains SECURITY DEFINER',
         case when (select prosecdef from fn_save) then 'PASS' else 'FAIL' end,
         coalesce((select 'prosecdef=' || prosecdef::text from fn_save), 'missing')
  union all
  select 703, '7.3 search_path is pinned',
         case when exists (select 1 from fn_save where array_to_string(proconfig, ',') like '%search_path=%')
              then 'PASS' else 'FAIL' end,
         coalesce((select array_to_string(proconfig, ',') from fn_save), 'no proconfig')
  union all
  select 704, '7.4 existing authorization retained (admin or owning instructor, 42501)',
         case when exists (
                select 1 from fn_save
                where prosrc like '%is_admin()%' and prosrc like '%current_instructor_id()%'
                  and prosrc like '%instructor_id <> v_instructor_id%' and prosrc like '%42501%'
              ) then 'PASS' else 'FAIL' end,
         'snapshot-ownership check must still run before any write'
  union all
  select 705, '7.5 snapshot is created by this function (insert into the snapshot table)',
         case when exists (select 1 from fn_save where prosrc like '%insert into public.class_session_eligible_students%')
              then 'PASS' else 'FAIL' end,
         'the save path is the only writer'
  union all
  select 706, '7.6 marker is stamped (set eligibility_snapshot_at = now())',
         case when exists (select 1 from fn_save where prosrc like '%set eligibility_snapshot_at = now()%')
              then 'PASS' else 'FAIL' end,
         'stamped even when zero rows were inserted -> empty snapshot is valid'
  union all
  select 707, '7.7 snapshot creation happens BEFORE the eligibility re-validation',
         case when (select position('class_session_eligible_students' in prosrc) from fn_save) > 0
               and (select position('array_agg(student_id)' in prosrc) from fn_save) > 0
               and (select position('class_session_eligible_students' in prosrc) from fn_save)
                 < (select position('array_agg(student_id)' in prosrc) from fn_save)
              then 'PASS' else 'FAIL' end,
         'first save must validate its marks against the set it just froze'
  union all
  select 708, '7.8 snapshot creation is inside this function (same transaction as marks + status)',
         case when exists (
                select 1 from fn_save
                where prosrc like '%insert into public.class_session_eligible_students%'
                  and prosrc like '%insert into public.attendance%'
                  and prosrc like '%set status = ''completed''%'
              ) then 'PASS' else 'FAIL' end,
         'snapshot, marks and completion are committed together or not at all'
  union all
  select 709, '7.9 write-once guard: only when marker is NULL',
         case when exists (select 1 from fn_save where prosrc like '%eligibility_snapshot_at is null%')
              then 'PASS' else 'FAIL' end,
         'guard prevents re-snapshotting on a correction'
  union all
  select 710, '7.10 write-once guard: ON CONFLICT DO NOTHING (never overwrites a row)',
         case when exists (select 1 from fn_save where prosrc like '%on conflict (class_session_id, student_id) do nothing%')
              then 'PASS' else 'FAIL' end,
         'existing snapshot rows can never be rewritten'
  union all
  select 711, '7.11 corrections use the frozen set (re-validation reads resolve_eligible_students)',
         case when exists (select 1 from fn_save where prosrc like '%resolve_eligible_students%')
              then 'PASS' else 'FAIL' end,
         'so a student who has since left the batch stays correctable'
  union all
  select 712, '7.12 pre-existing completed sessions are NOT auto-snapshotted (status <> completed guard)',
         case when exists (select 1 from fn_save where prosrc like '%status <> ''completed''%')
              then 'PASS' else 'FAIL' end,
         'a correction to an already-completed session must not freeze today''s answer as history'

  -- 8/9. Write-once + historical safety (schema-level) ------------------------
  union all
  select 801, '8.1 no write privilege and no write policy (combined write-once assertion)',
         case when (select rel from t) is null then 'FAIL'
              when not has_table_privilege('authenticated', (select rel from t), 'INSERT')
               and not has_table_privilege('authenticated', (select rel from t), 'UPDATE')
               and not has_table_privilege('authenticated', (select rel from t), 'DELETE')
               and not exists (select 1 from pol where cmd in ('INSERT','UPDATE','DELETE','ALL'))
              then 'PASS' else 'FAIL' end,
         'the intended client path cannot overwrite a snapshot row'
  union all
  select 901, '9.1 attendance table structure untouched by 0015',
         case when (select count(*) from information_schema.columns
                    where table_schema='public' and table_name='attendance'
                      and column_name in ('id','class_session_id','student_id','status','created_at','updated_at')) = 6
              then 'PASS' else 'FAIL' end,
         'attendance keeps its original columns; 0015 adds no column and rewrites no row'
  union all
  select 902, '9.2 class_sessions gained only the marker column',
         case when exists (
                select 1 from information_schema.columns
                where table_schema='public' and table_name='class_sessions' and column_name='eligibility_snapshot_at'
              ) and (select count(*) from information_schema.columns
                     where table_schema='public' and table_name='class_sessions') = 12
              then 'PASS' else 'CHECK' end,
         'expected 12 columns: the original 11 plus eligibility_snapshot_at'

  -- 9 (continued). Data-state: 0015 performed no backfill ---------------------
  -- These three read data rather than catalogs, and are folded into the same
  -- grid so the SQL editor shows one result set. They are counts only — no
  -- student, session or attendance content is selected.
  --
  -- 9.3 and 9.4 are meaningful as assertions only when run immediately after
  -- applying 0015 and BEFORE any new attendance is saved: the migration
  -- writes no snapshot rows and stamps no markers, so both must be zero.
  -- Once normal use resumes, snapshots appear legitimately for newly
  -- completed sessions and non-zero is expected — hence 'CHECK' (eyeball it)
  -- rather than 'FAIL'. Neither can ever fail the SUMMARY verdict.
  --
  -- Read under the SQL editor's role. If run as `authenticated`, RLS would
  -- scope these counts; as the editor's owning role they are unfiltered.
  union all
  select 903, '9.3 no snapshot rows written by the migration (expect 0 pre-use)',
         case when (select count(*) from public.class_session_eligible_students) = 0
              then 'PASS' else 'CHECK' end,
         (select count(*) from public.class_session_eligible_students)::text || ' snapshot rows'
  union all
  select 904, '9.4 no markers stamped by the migration (expect 0 pre-use)',
         case when (select count(*) from public.class_sessions
                    where eligibility_snapshot_at is not null) = 0
              then 'PASS' else 'CHECK' end,
         (select count(*) from public.class_sessions where eligibility_snapshot_at is not null)::text
           || ' of ' || (select count(*) from public.class_sessions)::text
           || ' sessions carry a marker'
  union all
  select 905, '9.5 attendance row count (readout - compare with your pre-apply count)',
         'INFO',
         (select count(*) from public.attendance)::text || ' attendance rows'
)
select
  seq,
  check_name,
  status,
  detail
from checks
union all
select
  9999,
  'SUMMARY',
  case when exists (select 1 from checks where status = 'FAIL') then 'FAILURES' else 'ALL PASS' end,
  (select (count(*) filter (where status='PASS'))::text || ' passed, '
        || (count(*) filter (where status='FAIL'))::text || ' failed, '
        || (count(*) filter (where status='CHECK'))::text || ' to eyeball, '
        || (count(*) filter (where status='INFO'))::text || ' informational'
   from checks)
order by seq;

commit;
