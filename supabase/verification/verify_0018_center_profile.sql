-- ===========================================================================
-- Phase 19 — Migration 0018 structural verification
-- Verifies supabase/migrations/0018_center_profile.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0018. No service key and no
-- impersonation: every check reads system catalogs and table data, which
-- any signed-in role can read.
--
-- STRICTLY READ-ONLY
--   * One SELECT and nothing else — no insert, update, delete, truncate,
--     create, alter or drop, and no temp table. `begin transaction read
--     only` is belt and braces on top of that.
--
-- OUTPUT: one result set of seq / check_name / status / detail, ordered by
-- seq, ending in SUMMARY. Statuses: PASS, FAIL, INFO.
-- ===========================================================================

begin transaction read only;

with
tbl as (
  select to_regclass('public.center_profile') as rel
),
col as (
  -- `a` must be joined to `t` BEFORE the LEFT JOIN to `d`, and explicitly —
  -- not via a trailing comma. `FROM pg_attribute a, tbl t LEFT JOIN
  -- pg_attrdef d ON ...` parses as `FROM a, (t LEFT JOIN d ON ...)`: JOIN
  -- binds tighter than comma, so that LEFT JOIN's own ON-clause can only
  -- see `t` and `d` — not the comma-joined `a` sitting outside it — which
  -- is exactly the 42P01 "invalid reference to FROM-clause entry for table
  -- a" this produced. An explicit `JOIN ... ON` puts `a` in the same join
  -- tree first, so the subsequent LEFT JOIN's ON-clause can reference it.
  select a.attname, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) as default_expr
  from tbl t
  join pg_attribute a on a.attrelid = t.rel
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
),
pk as (
  select pg_get_constraintdef(c.oid) as def
  from pg_constraint c, tbl t
  where c.conrelid = t.rel and c.contype = 'p'
),
ck as (
  select pg_get_constraintdef(c.oid) as def
  from pg_constraint c, tbl t
  where c.conrelid = t.rel and c.contype = 'c'
),
pol as (
  select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'center_profile'
),
checks as (

  -- 1. Table shape ------------------------------------------------------------
  select 101 as seq, '1.1 table public.center_profile exists' as check_name,
         case when (select rel from tbl) is not null then 'PASS' else 'FAIL' end as status,
         coalesce((select rel::text from tbl), 'missing') as detail
  union all
  select 102, '1.2 singleton is a boolean primary key defaulting true',
         case when (select rel from tbl) is null then 'FAIL'
              when exists (select 1 from col where attname = 'singleton' and typ = 'boolean' and attnotnull)
               and (select def from pk) like '%(singleton)%'
              then 'PASS' else 'FAIL' end,
         coalesce((select def from pk), 'no primary key')
  union all
  select 103, '1.3 CHECK forces singleton = true (at most one row can ever exist)',
         case when exists (select 1 from ck where def like '%singleton%')
              then 'PASS' else 'FAIL' end,
         coalesce((select def from ck), 'no check constraint')
  union all
  select 104, '1.4 name is text NOT NULL with a default',
         case when exists (
                select 1 from col
                where attname = 'name' and typ = 'text' and attnotnull and default_expr is not null
              ) then 'PASS' else 'FAIL' end,
         coalesce((select default_expr from col where attname = 'name'), 'missing')
  union all
  select 105, '1.5 logo_url / address / phone / email are nullable text',
         case when (select count(*) from col
                     where attname in ('logo_url', 'address', 'phone', 'email')
                       and typ = 'text' and not attnotnull) = 4
              then 'PASS' else 'FAIL' end,
         coalesce((select string_agg(attname::text, ', ' order by attname) from col
                   where attname in ('logo_url', 'address', 'phone', 'email')), 'missing')
  union all
  select 106, '1.6 updated_at is timestamptz NOT NULL with a default',
         case when exists (
                select 1 from col
                where attname = 'updated_at' and typ like 'timestamp with time zone%'
                  and attnotnull and default_expr is not null
              ) then 'PASS' else 'FAIL' end,
         coalesce((select default_expr from col where attname = 'updated_at'), 'missing')

  -- 2. Privileges ---------------------------------------------------------------
  union all
  select 201, '2.1 authenticated HAS SELECT',
         case when (select rel from tbl) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from tbl), 'SELECT') then 'PASS'
              else 'FAIL' end,
         'select granted'
  union all
  select 202, '2.2 authenticated HAS UPDATE',
         case when (select rel from tbl) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from tbl), 'UPDATE') then 'PASS'
              else 'FAIL' end,
         'update granted'
  union all
  select 203, '2.3 authenticated has NO INSERT (the singleton row is seeded once, never created by the app)',
         case when (select rel from tbl) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from tbl), 'INSERT') then 'FAIL'
              else 'PASS' end,
         'insert must not be granted'
  union all
  select 204, '2.4 authenticated has NO DELETE (there is no "remove the center profile" concept)',
         case when (select rel from tbl) is null then 'FAIL'
              when has_table_privilege('authenticated', (select rel from tbl), 'DELETE') then 'FAIL'
              else 'PASS' end,
         'delete must not be granted'
  union all
  select 205, '2.5 anon has no SELECT on it',
         case when (select rel from tbl) is null then 'FAIL'
              when has_table_privilege('anon', (select rel from tbl), 'SELECT') then 'FAIL'
              else 'PASS' end,
         'anon must have nothing'

  -- 3. RLS ------------------------------------------------------------------------
  union all
  select 301, '3.1 RLS is enabled',
         case when (select relrowsecurity from pg_class where oid = (select rel from tbl)) then 'PASS' else 'FAIL' end,
         coalesce((select 'relrowsecurity=' || relrowsecurity::text from pg_class where oid = (select rel from tbl)), 'table missing')
  union all
  select 302, '3.2 SELECT policy gated on is_admin()',
         case when exists (select 1 from pol where cmd = 'SELECT' and qual like '%is_admin%')
              then 'PASS' else 'FAIL' end,
         coalesce((select policyname::text from pol where cmd = 'SELECT'), 'missing')
  union all
  select 303, '3.3 UPDATE policy gated on is_admin() for both USING and WITH CHECK',
         case when exists (
                select 1 from pol
                where cmd = 'UPDATE' and qual like '%is_admin%' and with_check like '%is_admin%'
              ) then 'PASS' else 'FAIL' end,
         coalesce((select policyname::text from pol where cmd = 'UPDATE'), 'missing')
  union all
  select 304, '3.4 no INSERT or DELETE policy exists (Admin-only write is UPDATE-only by design)',
         case when exists (select 1 from pol where cmd in ('INSERT', 'DELETE', 'ALL')) then 'FAIL' else 'PASS' end,
         coalesce((select string_agg(policyname::text || ':' || cmd::text, ', ' order by policyname) from pol), 'no policies at all')

  -- 4. Data state -------------------------------------------------------------------
  union all
  select 401, '4.1 exactly one row exists (the seed applied, and the CHECK is holding)',
         case when (select count(*) from public.center_profile) = 1 then 'PASS' else 'FAIL' end,
         (select count(*)::text from public.center_profile) || ' row(s)'
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
