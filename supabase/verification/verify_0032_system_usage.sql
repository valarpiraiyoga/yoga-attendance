-- ===========================================================================
-- Migration 0032 verification — System Usage
-- Verifies supabase/migrations/0032_system_usage.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor of the project the application actually uses, AFTER applying 0032.
-- Part A is the structure of the function and its permissions (read-only catalog queries).
-- Part B calls it for real: as an Admin it must return two byte counts that agree with the database;
-- as an Instructor and as an anonymous caller it must be refused. It writes nothing - the whole
-- script runs in one transaction that is rolled back (helper functions are temporary).
--
-- OUTPUT: seq / test / status / detail. Statuses: PASS, FAIL, NOT TESTED (reason in detail), INFO.
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

create function pg_temp.rec(p_test text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test,
          case when p_ok then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $f$;

create function pg_temp.skip(p_test text, p_why text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'NOT TESTED', p_why);
end $f$;

create function pg_temp.info(p_test text, p_detail text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'INFO', p_detail);
end $f$;

-- Run one scalar query as an authenticated user; return its text, or 'ERR:<sqlstate>'.
create function pg_temp.query_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
          json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- Run one scalar query as the anonymous role; return its text, or 'ERR:<sqlstate>'.
create function pg_temp.query_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  return v_out;
end $f$;

do $$
declare
  v_def        text;
  v_admin      uuid;
  v_instructor uuid;
  v_out        text;
  v_json       jsonb;
  v_db         bigint;
  v_storage    bigint;
  v_expected   bigint;
begin
  -- A. Structure -----------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'system_usage';

  perform pg_temp.rec('A1 public.system_usage() exists', v_def is not null, '');

  perform pg_temp.rec('A2 security definer, empty search_path',
    exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'system_usage'
              and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), '');

  perform pg_temp.rec('A3 it checks public.is_admin() first and refuses with 42501',
    v_def like '%if not public.is_admin() then%' and v_def like '%42501%'
    and position('public.is_admin()' in v_def) < position('pg_database_size' in v_def), '');

  perform pg_temp.rec('A4 it reads only the database size and the storage object sizes',
    v_def like '%pg_database_size(current_database())%' and v_def like '%from storage.objects%'
    and v_def not like '%public.profiles%', '');

  perform pg_temp.rec('A5 it returns only database_bytes and storage_bytes',
    v_def like '%jsonb_build_object(%''database_bytes''%''storage_bytes''%'
    and (select count(*) = 2 from regexp_matches(v_def, '''[a-z_]+_bytes''', 'g')), '');

  perform pg_temp.rec('A6 anon and PUBLIC cannot execute it; authenticated can',
    not has_function_privilege('anon', 'public.system_usage()', 'execute')
    and has_function_privilege('authenticated', 'public.system_usage()', 'execute')
    and not exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = 'public.system_usage()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ), 'PUBLIC grant must be absent');

  -- B. Behaviour ---------------------------------------------------------------------------------
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  if v_admin is null then
    perform pg_temp.skip('B1-B5 admin call', 'no admin profile found');
  else
    v_out := pg_temp.query_as(v_admin, 'select public.system_usage()::text');
    perform pg_temp.rec('B1 an Admin gets an answer (not an error)', v_out not like 'ERR:%', v_out);

    if v_out not like 'ERR:%' then
      v_json := v_out::jsonb;
      v_db := (v_json ->> 'database_bytes')::bigint;
      v_storage := (v_json ->> 'storage_bytes')::bigint;

      perform pg_temp.rec('B2 exactly two keys: database_bytes and storage_bytes',
        (select count(*) = 2 from jsonb_object_keys(v_json)) and v_json ? 'database_bytes' and v_json ? 'storage_bytes', v_out);
      perform pg_temp.rec('B3 both are non-negative whole numbers (an empty storage would be 0, never NULL)',
        v_db >= 0 and v_storage >= 0, 'database ' || v_db || ' bytes, storage ' || v_storage || ' bytes');
      perform pg_temp.rec('B4 the database size agrees with pg_database_size (within the growth of this very script)',
        abs(v_db - pg_database_size(current_database())) < 10 * 1024 * 1024, v_db || ' vs ' || pg_database_size(current_database()));

      select coalesce(sum(case when metadata ->> 'size' ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else 0 end), 0)
        into v_expected from storage.objects;
      perform pg_temp.rec('B5 the storage size equals the sum of the stored object sizes', v_storage = v_expected, v_storage || ' vs ' || v_expected);

      perform pg_temp.info('USAGE', format('database %s MB of 500 MB; storage %s MB of 1024 MB',
        round(v_db / 1048576.0, 1), round(v_storage / 1048576.0, 1)));
    end if;
  end if;

  if v_instructor is null then
    perform pg_temp.skip('B6 instructor refused', 'no instructor profile found');
  else
    v_out := pg_temp.query_as(v_instructor, 'select public.system_usage()::text');
    perform pg_temp.rec('B6 an Instructor is refused (42501)', v_out = 'ERR:42501', v_out);
  end if;

  v_out := pg_temp.query_anon('select public.system_usage()::text');
  perform pg_temp.rec('B7 an anonymous caller is refused (42501, no execute privilege)', v_out = 'ERR:42501', v_out);
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;
