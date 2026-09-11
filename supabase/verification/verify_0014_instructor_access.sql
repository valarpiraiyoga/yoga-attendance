-- ===========================================================================
-- Phase 15 Instructor Access — A1–A11 security verification
-- Verifies supabase/migrations/0014_instructor_attendance_access.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor. No service key required: it impersonates
-- real users exactly as PostgREST does, by setting request.jwt.claims and
-- switching to the `authenticated` role, so every check is evaluated by RLS.
--
-- SAFETY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * The only mutations attempted are the deny-tests (which should fail)
--     and A11's temporary deactivation of Instructor A — all rolled back.
--   * Expect-error tests run inside PL/pgSQL exception blocks (subtransactions),
--     so a raised error never aborts the outer transaction.
--
-- IDENTITIES: the two instructor UUIDs may be either auth.users.id or
-- instructors.id — the script detects which and derives the other. The admin
-- used for A10 is auto-discovered from public.profiles (role = 'admin'); set
-- v_admin_user explicitly below only if you want a specific admin.
--
-- OUTPUT: a result grid of seq / test / status / detail, plus a SUMMARY row.
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

do $$
declare
  -- ---- test identities (as supplied) --------------------------------------
  v_a_input     uuid := '3a0c6807-12bd-4128-9862-eaad29ef1982';  -- Instructor A — Kannan
  v_b_input     uuid := '1063f1f5-60ae-4b5e-b1d2-d0122b38387c';  -- Instructor B — Test 2
  v_a_session   uuid := 'ec30949f-be9e-4777-94b6-dee0c3ee90ab';  -- Kannan session
  v_b_session   uuid := '00b891d5-2621-4588-8797-9ab0338f236e';  -- Test 2 session

  -- Optional: pin a specific admin. Leave null to auto-discover.
  -- Obtain manually if needed with:
  --   select id from public.profiles where role = 'admin' limit 1;
  v_admin_user  uuid := null;

  -- ---- resolved fixtures --------------------------------------------------
  v_a_user      uuid;  v_a_instr uuid;
  v_b_user      uuid;  v_b_instr uuid;
  v_a_sched uuid; v_a_batch uuid; v_a_date date; v_a_owner uuid; v_a_status text;
  v_b_sched uuid; v_b_batch uuid; v_b_date date; v_b_owner uuid;
  v_any_student uuid;

  v_exp_cs int; v_exp_sch int; v_exp_att int; v_exp_b_att int;
  v_all_cs int; v_all_sch int; v_all_att int; v_all_stu int;

  n int; n2 int; v_after int;
  v_log text[] := '{}';
  v_pass int := 0; v_fail int := 0;

  -- records one outcome
  procedure_stub int;
begin
  -- =========================================================================
  -- SETUP — runs as the migration owner, so RLS does not apply here
  -- =========================================================================

  -- Instructor A: accept either auth.users.id or instructors.id
  select i.id, i.user_id into v_a_instr, v_a_user
  from public.instructors i where i.user_id = v_a_input;
  if v_a_instr is null then
    select i.id, i.user_id into v_a_instr, v_a_user
    from public.instructors i where i.id = v_a_input;
  end if;

  -- Instructor B: same
  select i.id, i.user_id into v_b_instr, v_b_user
  from public.instructors i where i.user_id = v_b_input;
  if v_b_instr is null then
    select i.id, i.user_id into v_b_instr, v_b_user
    from public.instructors i where i.id = v_b_input;
  end if;

  if v_a_instr is null then
    raise exception 'SETUP FAILED: % matches neither instructors.user_id nor instructors.id', v_a_input;
  end if;
  if v_b_instr is null then
    raise exception 'SETUP FAILED: % matches neither instructors.user_id nor instructors.id', v_b_input;
  end if;
  if v_a_user is null then
    raise exception 'SETUP FAILED: Instructor A (%) has no linked auth user (user_id is null). Provide login access first.', v_a_instr;
  end if;
  if v_b_user is null then
    raise exception 'SETUP FAILED: Instructor B (%) has no linked auth user (user_id is null).', v_b_instr;
  end if;

  -- Sessions
  select cs.schedule_id, cs.batch_id, cs.session_date, cs.instructor_id, cs.status
    into v_a_sched, v_a_batch, v_a_date, v_a_owner, v_a_status
  from public.class_sessions cs where cs.id = v_a_session;
  if v_a_sched is null then
    raise exception 'SETUP FAILED: class_sessions row % (Kannan session) not found', v_a_session;
  end if;

  select cs.schedule_id, cs.batch_id, cs.session_date, cs.instructor_id
    into v_b_sched, v_b_batch, v_b_date, v_b_owner
  from public.class_sessions cs where cs.id = v_b_session;
  if v_b_sched is null then
    raise exception 'SETUP FAILED: class_sessions row % (Test 2 session) not found', v_b_session;
  end if;

  if v_a_owner <> v_a_instr then
    raise exception 'SETUP FAILED: session % belongs to instructor %, not A (%)', v_a_session, v_a_owner, v_a_instr;
  end if;
  if v_b_owner <> v_b_instr then
    raise exception 'SETUP FAILED: session % belongs to instructor %, not B (%)', v_b_session, v_b_owner, v_b_instr;
  end if;

  -- Admin for A10
  if v_admin_user is null then
    select p.id into v_admin_user from public.profiles p where p.role = 'admin' limit 1;
  end if;
  if v_admin_user is null then
    raise exception 'SETUP FAILED: no admin found in public.profiles. Set v_admin_user manually.';
  end if;

  -- Student for A7a. Must NOT already have an attendance row for A's session,
  -- or the INSERT would fail on attendance_session_student_unique (23505)
  -- instead of proving that RLS denies an instructor's direct write.
  select s.id into v_any_student
  from public.students s
  where not exists (
    select 1 from public.attendance a
    where a.class_session_id = v_a_session
      and a.student_id = s.id
  )
  limit 1;

  -- Authoritative expected counts for Instructor A
  select count(*) into v_exp_cs  from public.class_sessions where instructor_id = v_a_instr;
  select count(*) into v_exp_sch from public.schedules       where instructor_id = v_a_instr;
  select count(*) into v_exp_att from public.attendance a
    join public.class_sessions cs on cs.id = a.class_session_id
   where cs.instructor_id = v_a_instr;
  select count(*) into v_exp_b_att from public.attendance where class_session_id = v_b_session;

  -- Global totals for A10
  select count(*) into v_all_cs  from public.class_sessions;
  select count(*) into v_all_sch from public.schedules;
  select count(*) into v_all_att from public.attendance;
  select count(*) into v_all_stu from public.students;

  v_log := v_log || format('SETUP|INFO|A instr=%s user=%s | B instr=%s user=%s | admin=%s',
                           v_a_instr, v_a_user, v_b_instr, v_b_user, v_admin_user);
  v_log := v_log || format('SETUP|INFO|A owns %s sessions / %s schedules / %s attendance rows; DB totals %s/%s/%s',
                           v_exp_cs, v_exp_sch, v_exp_att, v_all_cs, v_all_sch, v_all_att);

  -- =========================================================================
  -- INSTRUCTOR A
  -- =========================================================================
  perform set_config('request.jwt.claims',
          json_build_object('sub', v_a_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a_user::text, true);
  execute 'set local role authenticated';

  ---------------------------------------------------------------- A1
  select count(*) into n  from public.class_sessions;
  select count(*) into n2 from public.class_sessions where instructor_id <> v_a_instr;
  if n = v_exp_cs and n2 = 0 then
    v_pass := v_pass + 1; v_log := v_log || format('A1|PASS|class_sessions: %s visible, all own', n);
  else
    v_fail := v_fail + 1; v_log := v_log || format('A1|FAIL|class_sessions: %s visible (expected %s), %s foreign', n, v_exp_cs, n2);
  end if;

  ---------------------------------------------------------------- A2
  select count(*) into n  from public.schedules;
  select count(*) into n2 from public.schedules where instructor_id <> v_a_instr;
  if n = v_exp_sch and n2 = 0 then
    v_pass := v_pass + 1; v_log := v_log || format('A2|PASS|schedules: %s visible, all own', n);
  else
    v_fail := v_fail + 1; v_log := v_log || format('A2|FAIL|schedules: %s visible (expected %s), %s foreign', n, v_exp_sch, n2);
  end if;

  ---------------------------------------------------------------- A3
  select count(*) into n from public.attendance;
  select count(*) into n2 from public.attendance a
    where not exists (select 1 from public.class_sessions cs
                       where cs.id = a.class_session_id and cs.instructor_id = v_a_instr);
  if n = v_exp_att and n2 = 0 then
    v_pass := v_pass + 1; v_log := v_log || format('A3|PASS|attendance: %s visible, all under own sessions', n);
  else
    v_fail := v_fail + 1; v_log := v_log || format('A3|FAIL|attendance: %s visible (expected %s), %s foreign', n, v_exp_att, n2);
  end if;

  ---------------------------------------------------------------- A4
  select count(*) into n from public.students;
  if n = 0 then v_pass := v_pass + 1; v_log := v_log || 'A4a|PASS|students: 0 rows visible'::text;
  else v_fail := v_fail + 1; v_log := v_log || format('A4a|FAIL|students: %s rows visible', n); end if;

  select count(*) into n from public.batch_enrollments;
  if n = 0 then v_pass := v_pass + 1; v_log := v_log || 'A4b|PASS|batch_enrollments: 0 rows visible'::text;
  else v_fail := v_fail + 1; v_log := v_log || format('A4b|FAIL|batch_enrollments: %s rows visible', n); end if;

  select count(*) into n from public.memberships;
  if n = 0 then v_pass := v_pass + 1; v_log := v_log || 'A4c|PASS|memberships: 0 rows visible'::text;
  else v_fail := v_fail + 1; v_log := v_log || format('A4c|FAIL|memberships: %s rows visible', n); end if;

  select count(*) into n2 from public.instructors where id <> v_a_instr;
  if n2 = 0 then v_pass := v_pass + 1; v_log := v_log || 'A4d|PASS|instructors: own row only'::text;
  else v_fail := v_fail + 1; v_log := v_log || format('A4d|FAIL|instructors: %s foreign rows visible', n2); end if;

  ---------------------------------------------------------------- A5 (deny)
  begin
    perform * from public.resolve_eligible_students(v_b_batch, v_b_sched, v_b_date);
    v_fail := v_fail + 1; v_log := v_log || 'A5|FAIL|resolve_eligible_students on B''s session returned without error'::text;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A5|PASS|resolve_eligible_students on B''s session raised 42501'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A5|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  ---------------------------------------------------------------- A5b (allow)
  begin
    perform * from public.resolve_eligible_students(v_a_batch, v_a_sched, v_a_date);
    v_pass := v_pass + 1; v_log := v_log || 'A5b|PASS|resolve_eligible_students on OWN session authorized'::text;
  exception
    when insufficient_privilege then
      v_fail := v_fail + 1; v_log := v_log || 'A5b|FAIL|own session wrongly denied (42501)'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A5b|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  ---------------------------------------------------------------- A6 (deny)
  begin
    perform public.save_session_attendance(v_b_session, '[]'::jsonb);
    v_fail := v_fail + 1; v_log := v_log || 'A6|FAIL|save_session_attendance on B''s session succeeded'::text;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A6|PASS|save_session_attendance on B''s session raised 42501'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A6|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  execute 'reset role';
  select count(*) into v_after from public.attendance where class_session_id = v_b_session;
  if v_after = v_exp_b_att then
    v_pass := v_pass + 1; v_log := v_log || format('A6b|PASS|B''s attendance unchanged (%s rows)', v_after);
  else
    v_fail := v_fail + 1; v_log := v_log || format('A6b|FAIL|B''s attendance changed %s -> %s', v_exp_b_att, v_after);
  end if;
  execute 'set local role authenticated';

  ---------------------------------------------------------------- A6c (deny)
  begin
    perform public.materialize_class_session(v_b_sched, v_b_date);
    v_fail := v_fail + 1; v_log := v_log || 'A6c|FAIL|materialize_class_session on B''s schedule succeeded'::text;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A6c|PASS|materialize_class_session on B''s schedule raised 42501'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A6c|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  ---------------------------------------------------------------- A6d (allow)
  -- Positive control: authorization must PASS for A's own session. A business
  -- rejection (22023 — cancelled/holiday or future-dated) still proves the
  -- authorization gate was cleared.
  begin
    perform public.save_session_attendance(v_a_session, '[]'::jsonb);
    v_pass := v_pass + 1; v_log := v_log || 'A6d|PASS|save_session_attendance on OWN session authorized (rolled back)'::text;
  exception
    when insufficient_privilege then
      v_fail := v_fail + 1; v_log := v_log || 'A6d|FAIL|own session wrongly denied (42501)'::text;
    when others then
      if sqlstate = '22023' then
        v_pass := v_pass + 1;
        v_log := v_log || format('A6d|PASS|authorized; rejected by business rule as expected (%s, session status=%s)', sqlerrm, v_a_status);
      else
        v_fail := v_fail + 1; v_log := v_log || format('A6d|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
      end if;
  end;

  ---------------------------------------------------------------- A7 (deny)
  begin
    insert into public.attendance (class_session_id, student_id, status)
    values (v_a_session, v_any_student, 'present');
    v_fail := v_fail + 1; v_log := v_log || 'A7a|FAIL|direct attendance INSERT succeeded'::text;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A7a|PASS|direct attendance INSERT denied (42501)'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A7a|FAIL|blocked by %s, not RLS: %s', sqlstate, sqlerrm);
  end;

  begin
    update public.attendance set status = 'absent';
    get diagnostics n = row_count;
    if n = 0 then
      v_pass := v_pass + 1; v_log := v_log || 'A7b|PASS|direct attendance UPDATE affected 0 rows (no write policy)'::text;
    else
      v_fail := v_fail + 1; v_log := v_log || format('A7b|FAIL|direct attendance UPDATE affected %s rows', n);
    end if;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A7b|PASS|direct attendance UPDATE denied (42501)'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A7b|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  ---------------------------------------------------------------- A8 (deny)
  begin
    update public.class_sessions set status = 'completed' where id = v_a_session;
    get diagnostics n = row_count;
    if n = 0 then
      v_pass := v_pass + 1; v_log := v_log || 'A8|PASS|direct class_sessions UPDATE affected 0 rows (no write policy)'::text;
    else
      v_fail := v_fail + 1; v_log := v_log || format('A8|FAIL|instructor updated %s class_sessions rows', n);
    end if;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A8|PASS|direct class_sessions UPDATE denied (42501)'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A8|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  ---------------------------------------------------------------- A9 (deny)
  begin
    update public.profiles set role = 'admin' where id = v_a_user;
    get diagnostics n = row_count;
    if n = 0 then
      v_pass := v_pass + 1; v_log := v_log || 'A9|PASS|role escalation affected 0 rows'::text;
    else
      v_fail := v_fail + 1; v_log := v_log || format('A9|FAIL|role escalation updated %s rows', n);
    end if;
  exception
    when others then
      v_pass := v_pass + 1; v_log := v_log || format('A9|PASS|role escalation blocked (%s)', sqlstate);
  end;

  execute 'reset role';

  -- =========================================================================
  -- A10 — ADMIN ACCESS UNCHANGED
  -- =========================================================================
  perform set_config('request.jwt.claims',
          json_build_object('sub', v_admin_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.class_sessions;
  if n = v_all_cs then v_pass := v_pass + 1; v_log := v_log || format('A10a|PASS|admin sees all %s class_sessions', n);
  else v_fail := v_fail + 1; v_log := v_log || format('A10a|FAIL|admin sees %s of %s class_sessions', n, v_all_cs); end if;

  select count(*) into n from public.schedules;
  if n = v_all_sch then v_pass := v_pass + 1; v_log := v_log || format('A10b|PASS|admin sees all %s schedules', n);
  else v_fail := v_fail + 1; v_log := v_log || format('A10b|FAIL|admin sees %s of %s schedules', n, v_all_sch); end if;

  select count(*) into n from public.attendance;
  if n = v_all_att then v_pass := v_pass + 1; v_log := v_log || format('A10c|PASS|admin sees all %s attendance rows', n);
  else v_fail := v_fail + 1; v_log := v_log || format('A10c|FAIL|admin sees %s of %s attendance rows', n, v_all_att); end if;

  select count(*) into n from public.students;
  if n = v_all_stu then v_pass := v_pass + 1; v_log := v_log || format('A10d|PASS|admin sees all %s students', n);
  else v_fail := v_fail + 1; v_log := v_log || format('A10d|FAIL|admin sees %s of %s students', n, v_all_stu); end if;

  begin
    perform * from public.resolve_eligible_students(v_b_batch, v_b_sched, v_b_date);
    v_pass := v_pass + 1; v_log := v_log || 'A10e|PASS|admin resolve_eligible_students works on any instructor''s session'::text;
  exception when others then
    v_fail := v_fail + 1; v_log := v_log || format('A10e|FAIL|admin blocked: %s %s', sqlstate, sqlerrm);
  end;

  execute 'reset role';

  -- =========================================================================
  -- A11 — INACTIVE INSTRUCTOR LOSES ACCESS  (rolled back)
  -- =========================================================================
  update public.instructors set status = 'inactive' where id = v_a_instr;

  perform set_config('request.jwt.claims',
          json_build_object('sub', v_a_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a_user::text, true);
  execute 'set local role authenticated';

  select count(*) into n  from public.class_sessions;
  select count(*) into n2 from public.schedules;
  if n = 0 and n2 = 0 then
    v_pass := v_pass + 1; v_log := v_log || 'A11a|PASS|inactive instructor sees 0 sessions and 0 schedules'::text;
  else
    v_fail := v_fail + 1; v_log := v_log || format('A11a|FAIL|inactive instructor still sees %s sessions, %s schedules', n, n2);
  end if;

  select count(*) into n from public.attendance;
  if n = 0 then v_pass := v_pass + 1; v_log := v_log || 'A11b|PASS|inactive instructor sees 0 attendance rows'::text;
  else v_fail := v_fail + 1; v_log := v_log || format('A11b|FAIL|inactive instructor sees %s attendance rows', n); end if;

  begin
    perform * from public.resolve_eligible_students(v_a_batch, v_a_sched, v_a_date);
    v_fail := v_fail + 1; v_log := v_log || 'A11c|FAIL|inactive instructor still authorized for own session'::text;
  exception
    when insufficient_privilege then
      v_pass := v_pass + 1; v_log := v_log || 'A11c|PASS|inactive instructor denied (42501)'::text;
    when others then
      v_fail := v_fail + 1; v_log := v_log || format('A11c|FAIL|unexpected %s: %s', sqlstate, sqlerrm);
  end;

  execute 'reset role';

  -- =========================================================================
  -- RECORD RESULTS
  -- =========================================================================
  insert into _verify_results (seq, test, status, detail)
  select t.ord::int,
         split_part(t.x, '|', 1),
         split_part(t.x, '|', 2),
         split_part(t.x, '|', 3)
  from unnest(v_log) with ordinality as t(x, ord);

  insert into _verify_results (seq, test, status, detail)
  values (9999, 'SUMMARY',
          case when v_fail = 0 then 'ALL PASS' else 'FAILURES' end,
          format('%s passed, %s failed', v_pass, v_fail));
end $$;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;
