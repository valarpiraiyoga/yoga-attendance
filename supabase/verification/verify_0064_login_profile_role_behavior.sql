-- ===========================================================================
-- Migration 0064 verification (behaviour) - public.login_profile_role(uuid)
-- Exercises supabase/migrations/0064_login_profile_role.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  0064 is applied: the function exists, is SECURITY DEFINER, STABLE, has a pinned search_path, and returns text.
--   G   Privileges: EXECUTE for authenticated; NOT for anon, PUBLIC or service_role (G1). No privilege on public.profiles - table or column - for
--       anon or service_role (G2): the fix must not have opened the table to them. The full grant list of profiles is printed in G2's detail.
--   A   As an ADMIN (a real profile with role 'admin', its id in the request claims): an instructor's role is 'instructor' (A1); another account's
--       role - the Admin's own, or another Admin's - is 'admin' (A2); an id with no profile is NULL (A3); a NULL id is NULL (A4).
--   N   As a NON-Admin: an INSTRUCTOR's own signed-in request is refused with 42501 (N1); a signed-in request with no profile (an unknown user id in
--       the claims) is refused with 42501 (N2); the anon role is refused (N3, 42501 "permission denied for function"); an instructor cannot even
--       ask for their OWN role (N4) - the answer depends only on the caller being an Admin.
--   S   The caller's identity comes from the request claims (auth.uid()), never from the argument: an instructor asking about an Admin's id is still
--       refused (S1).
--
-- PREREQUISITES: 0064 applied; at least one profile with role 'admin'. N1/N4/S1 also need a profile with role 'instructor'; without one they are
-- reported NOT TESTED. Each "as <role>" call sets the request claims and `set local role authenticated` (or anon), exactly as PostgREST does.
--
-- SAFETY - READ ONLY, ROLLBACK
--   One transaction ending in ROLLBACK. It creates nothing in public (only temp helpers), writes no row, changes no grant, and disables nothing.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;

create function pg_temp.rec(p_test text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test,
          case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end $f$;

create function pg_temp.skip(p_test text, p_why text)
returns void language plpgsql as $f$
begin
  insert into _verify_results
  values ((select coalesce(max(seq), 0) + 1 from _verify_results), p_test, 'NOT TESTED', p_why);
end $f$;

-- login_profile_role(p_target) as the user p_caller (NULL = signed in with no user id) under p_role ('authenticated' or 'anon'):
-- 'ROLE:<value>' / 'ROLE:<null>', or 'ERR:<sqlstate>:<message>'. The claims and the role are reset afterwards.
create function pg_temp.ask(p_caller uuid, p_target uuid, p_role text default 'authenticated')
returns text language plpgsql as $f$
declare
  v_out   text;
  v_state text;
  v_msg   text;
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_caller, 'role', p_role)::text, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_caller::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    select 'ROLE:' || coalesce(public.login_profile_role(p_target), '<null>') into v_out;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    v_out := 'ERR:' || v_state || ':' || v_msg;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
end $f$;

do $$
declare
  v_fn        regprocedure := to_regprocedure('public.login_profile_role(uuid)');
  v_applied   boolean;
  v_admin     uuid;
  v_admin2    uuid;
  v_instr     uuid;
  v_unknown   uuid := gen_random_uuid();
  v_grants    text;
  r           text;
begin
  -- P0. Applied, with the intended properties ----------------------------------------------------------------------------------------
  select v_fn is not null
     and exists (select 1 from pg_proc p
                 where p.oid = v_fn and p.prosecdef and p.provolatile = 's' and p.prorettype = 'text'::regtype
                   and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  into v_applied;
  perform pg_temp.rec('P0 migration 0064 is applied (login_profile_role exists: SECURITY DEFINER, STABLE, pinned search_path, returns text)', v_applied, '');
  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0064 is not applied.');
    return;
  end if;

  -- G. Privileges --------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('G1 EXECUTE is granted to authenticated only: not to anon, PUBLIC or service_role',
    has_function_privilege('authenticated', v_fn, 'execute')
    and not has_function_privilege('anon', v_fn, 'execute')
    and not has_function_privilege('service_role', v_fn, 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    '');

  select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type) into v_grants
  from information_schema.role_table_grants where table_schema = 'public' and table_name = 'profiles';
  perform pg_temp.rec('G2 public.profiles is still closed to anon and service_role - no table or column privilege (the fix added none)',
    not has_table_privilege('anon', 'public.profiles', 'select, insert, update, delete')
    and not has_table_privilege('service_role', 'public.profiles', 'select, insert, update, delete')
    and not has_any_column_privilege('anon', 'public.profiles', 'select, insert, update')
    and not has_any_column_privilege('service_role', 'public.profiles', 'select, insert, update'),
    'grants on profiles: ' || coalesce(v_grants, '(none)'));

  -- Fixtures: existing profiles only - nothing is created or changed. ----------------------------------------------------------------------
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_admin2 from public.profiles where role = 'admin' and id <> v_admin order by created_at limit 1;
  select id into v_instr from public.profiles where role = 'instructor' order by created_at limit 1;

  if v_admin is null then
    perform pg_temp.skip('A, N, S all scenarios', 'needs a profile with role admin');
    return;
  end if;

  -- A. As an Admin ---------------------------------------------------------------------------------------------------------------------------
  if v_instr is null then
    perform pg_temp.skip('A1 an Admin reads an instructor''s role', 'needs a profile with role instructor');
  else
    r := pg_temp.ask(v_admin, v_instr);
    perform pg_temp.rec('A1 as an Admin: an existing instructor''s role is ''instructor''', r = 'ROLE:instructor', r);
  end if;

  r := pg_temp.ask(v_admin, coalesce(v_admin2, v_admin));
  perform pg_temp.rec('A2 as an Admin: another existing account''s role is returned (''admin'' - ' || case when v_admin2 is null then 'the Admin''s own' else 'another Admin''s' end || ')',
    r = 'ROLE:admin', r);

  r := pg_temp.ask(v_admin, v_unknown);
  perform pg_temp.rec('A3 as an Admin: an id with no profile returns NULL', r = 'ROLE:<null>', r);

  r := pg_temp.ask(v_admin, null);
  perform pg_temp.rec('A4 as an Admin: a NULL id returns NULL', r = 'ROLE:<null>', r);

  -- N. As a non-Admin ----------------------------------------------------------------------------------------------------------------------
  if v_instr is null then
    perform pg_temp.skip('N1 / N4 / S1 as an instructor', 'needs a profile with role instructor');
  else
    r := pg_temp.ask(v_instr, v_admin);
    perform pg_temp.rec('N1 as a signed-in INSTRUCTOR: refused with 42501', r like 'ERR:42501:%', r);

    r := pg_temp.ask(v_instr, v_instr);
    perform pg_temp.rec('N4 as an instructor: even their OWN role is refused (42501) - only an Admin may ask', r like 'ERR:42501:%', r);

    r := pg_temp.ask(v_instr, v_admin);
    perform pg_temp.rec('S1 the caller is decided by the request claims, not the argument: an instructor asking about an Admin''s id is refused',
      r like 'ERR:42501:%' and r not like '%admin%', r);
  end if;

  r := pg_temp.ask(gen_random_uuid(), v_admin);
  perform pg_temp.rec('N2 as a signed-in user with NO profile: refused with 42501', r like 'ERR:42501:%', r);

  r := pg_temp.ask(null, v_admin, 'anon');
  perform pg_temp.rec('N3 as anon: refused with 42501 (no EXECUTE)', r like 'ERR:42501:%', r);
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;
