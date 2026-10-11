-- ===========================================================================
-- Migration 0045 verification (behaviour) - Class Count Attendance: dates and reversals
-- Exercises supabase/migrations/0045_class_count_dates_and_reversals.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0045 is applied (the reversals table, the three-argument record function, the reverse function, the net
--       helper, and the net-based guards) on top of 0042-0044. If not, every other check is skipped (NOT TESTED).
--   P1  Preflight: none of the eleven phone numbers this run gives its fixture students (9000450001 to 9000450011) already
--       belongs to a student. If one does, P1 FAILS, every scenario is skipped, and nothing is created or changed.
--   T   The reversals table: its columns, unique attendance and request IDs, restrict reference, row level security,
--       privileges (a client can read, nothing else), the reason check (trimmed, 3 to 500 characters), read-only history even
--       for the owner (except clearing reversed_by), and the privileges of every function.
--   D   Attendance dates: today, the start date and a date in between are accepted; a future date, a date before the start,
--       and a missing date are refused; the stored date is the one chosen (not today); several classes on one date are
--       separate records; a repeat of a request returns the original, and the same request with a different date is refused;
--       the last class can be taken and the next is refused.
--   E   Eligible now: a cancelled membership, an expired one (even for a date inside its validity), one that has not started,
--       an inactive student, a duration membership and an unknown membership are refused, recording nothing.
--   W   The two-argument function still records for today at the centre, and a retry is a replay.
--   R   Reversal: a trimmed reason of 3 to 500 characters is required; the original record is left byte for byte as it was;
--       who, when and why are kept; one class is restored; a retry is a replay; the same request for another record, and a
--       second reversal of one record, are refused; a reversed class can be recorded again as a new record while its old
--       request ID stays spent; the eligible list follows the net count.
--   X   Reversal after cancellation and after expiry is allowed.
--   F   The class-total floor uses the net count, while kind and student stay frozen once any record exists - reversed or not.
--   A   An Instructor and an anonymous caller are refused.
--   Z   Every pre-existing membership, class-count record, reversal and session-attendance row is byte-for-byte unchanged by this
--       script (only the run's own fixtures, tracked by id, are left out of the comparison).
--
-- PREREQUISITES
--   * Migrations up to and including 0045 applied. If 0045 is NOT applied, P0 fails and every scenario is skipped.
--   * An Admin profile. An Instructor profile is needed for the Instructor checks (skipped without one).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only (eleven students and their class-count or duration memberships, the records and
--     reversals made for them). No existing row is written; existing rows are read only to be fingerprinted. The ids of the
--     students and memberships the run creates are recorded as it creates them (a temporary table).
--   * It exercises refusals that, if a trigger were missing, would change or remove rows of the history tables (an owner's
--     update, delete and truncate). Because of the rollback nothing can persist, but that is why it must be run as one
--     transaction and never in a session with autocommit.
--   * The student and membership code sequences leave a small gap; no row remains.
--
-- LIMITATIONS
--   * Concurrency (a reversal racing a recording of the same membership) cannot be tested in one transaction and is NOT
--     tested. What is checked instead: the functions lock the membership row (FOR UPDATE) before they read a balance.
--   * The check "the attendance date cannot be after the membership ends" cannot be reached through the function: a membership
--     must be eligible now (its end date is today or later) and the date cannot be after today. It is reported as INFO.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row.
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

-- The exact ids of the fixtures this run creates (students and memberships). Everything else the run writes hangs off a
-- fixture membership, so these ids tell the run's rows from the rows that existed before it.
create temp table _fixture_ids (
  tbl text not null,
  id  uuid not null
) on commit drop;

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

-- Run one statement as an authenticated user; return 'OK' or the SQLSTATE.
create function pg_temp.run_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims',
          json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

-- Run one statement as the anonymous role; return 'OK' or the SQLSTATE.
create function pg_temp.run_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  -- query_as sets the legacy sub setting for the rest of the transaction, and auth.uid() reads it first: clear it so an
  -- anonymous call cannot inherit the previous Admin identity.
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

-- Run one statement as the owning role; return 'OK' or '<sqlstate> <message>'.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $f$;

-- A disposable student (ZZVERIFY); returns its id.
create function pg_temp.student(p_label text, p_phone text, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_today date := (now() at time zone public.centre_timezone())::date;
  v_id    uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY ' || p_label, p_phone, '+91', v_today - 400, p_status)
  returning id into v_id;
  return v_id;
end $f$;

-- Inserts one membership as the owner; returns its id. A class-count membership has plan class_count.
create function pg_temp.mem(
  p_student uuid, p_kind text, p_start date, p_end date, p_total integer, p_cancelled boolean default false)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.memberships (student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency, cancelled_at)
  values (p_student, p_kind, case when p_kind = 'class_count' then 'class_count' else 'monthly' end,
          p_start, p_end, p_total, 1000, 'pending', 'INR', case when p_cancelled then now() end)
  returning id into v_id;
  return v_id;
end $f$;

-- Records a class for a chosen date as p_user; returns the result as JSON text, or 'ERR:<sqlstate>'.
create function pg_temp.rec3(p_user uuid, p_membership uuid, p_request uuid, p_date date)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.record_class_count_attendance(%L::uuid, %L::uuid, %L::date)::text', p_membership, p_request, p_date));
end $f$;

-- Records a class for today with the two-argument function as p_user; returns JSON text, or 'ERR:<sqlstate>'.
create function pg_temp.rec2(p_user uuid, p_membership uuid, p_request uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.record_class_count_attendance(%L::uuid, %L::uuid)::text', p_membership, p_request));
end $f$;

-- Records a class as p_user; returns 'OK' or '<sqlstate> <message>' (the refusal in words).
create function pg_temp.rec3_msg(p_user uuid, p_membership uuid, p_request uuid, p_date date)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    perform public.record_class_count_attendance(p_membership, p_request, p_date);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- Reverses a record as p_user; returns the result as JSON text, or 'ERR:<sqlstate>'.
create function pg_temp.rev(p_user uuid, p_attendance uuid, p_reason text, p_request uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.reverse_class_count_attendance(%L::uuid, %L, %L::uuid)::text', p_attendance, p_reason, p_request));
end $f$;

-- Reverses a record as p_user; returns 'OK' or '<sqlstate> <message>'.
create function pg_temp.rev_msg(p_user uuid, p_attendance uuid, p_reason text, p_request uuid)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    perform public.reverse_class_count_attendance(p_attendance, p_reason, p_request);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- One key of a JSON result, or NULL when the call returned 'ERR:<sqlstate>'.
create function pg_temp.field(p_json text, p_key text)
returns text language plpgsql as $f$
begin
  if p_json is null or p_json like 'ERR:%' then
    return null;
  end if;
  return (p_json::jsonb) ->> p_key;
end $f$;

-- The id of the record made by a request, or NULL.
create function pg_temp.att_of(p_request uuid)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  select id into v_id from public.class_count_attendance where request_id = p_request;
  return v_id;
end $f$;

-- Records of a membership, all and net of reversals; reversals of a record.
create function pg_temp.gross(p_membership uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.class_count_attendance where membership_id = p_membership;
  return v_count;
end $f$;

create function pg_temp.net(p_membership uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.class_count_attendance a
  where a.membership_id = p_membership
    and not exists (select 1 from public.class_count_attendance_reversals r where r.attendance_id = a.id);
  return v_count;
end $f$;

create function pg_temp.reversals(p_attendance uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.class_count_attendance_reversals where attendance_id = p_attendance;
  return v_count;
end $f$;

-- A fingerprint of one attendance record.
create function pg_temp.att_hash(p_attendance uuid)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  select md5(to_jsonb(c)::text) into v_out from public.class_count_attendance c where c.id = p_attendance;
  return v_out;
end $f$;

-- A fingerprint of one membership's row.
create function pg_temp.row_hash(p_membership uuid)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  select md5(to_jsonb(m)::text) into v_out from public.memberships m where m.id = p_membership;
  return v_out;
end $f$;

-- The eligible list as the Admin for one membership: 'used|remaining', or '' when it is not listed.
create function pg_temp.listed(p_admin uuid, p_membership uuid)
returns text language plpgsql as $f$
begin
  return coalesce(pg_temp.query_as(p_admin, format(
    'select classes_used || ''|'' || classes_remaining from public.list_class_count_eligible() where membership_id = %L::uuid', p_membership)), '');
end $f$;

do $$
declare
  v_admin      uuid;
  v_instr_user uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_ready      boolean;
  v_clash      integer := 0;
  v_clash_list text;
  v_msg        text;
  v_out        text;
  v_json       text;
  v_hash       text;
  v_s          uuid[] := array_fill(null::uuid, array[11]);
  v_m          uuid[] := array_fill(null::uuid, array[11]);
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid();
  r5 uuid := gen_random_uuid(); r6 uuid := gen_random_uuid();
  w1 uuid := gen_random_uuid();
  ra uuid := gen_random_uuid(); rb uuid := gen_random_uuid(); rc uuid := gen_random_uuid(); rd uuid := gen_random_uuid();
  rv1 uuid := gen_random_uuid(); rv2 uuid := gen_random_uuid(); rv3 uuid := gen_random_uuid(); rv4 uuid := gen_random_uuid();
  v_att_a uuid; v_att_b uuid; v_att_c uuid; v_att_d uuid; v_att_x uuid;
  v_rev        record;   -- not %rowtype: that would resolve the table when the block starts, before P0 can report its absence
  v_mem_hash0  text;  v_mem_hash1  text;
  v_cca_hash0  text;  v_cca_hash1  text;
  v_rev_hash0  text;  v_rev_hash1  text;
  v_att_hash0  text;  v_att_hash1  text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr_user from public.profiles where role = 'instructor' order by created_at limit 1;

  -- P0. Is 0045 applied? ---------------------------------------------------------------------------------------------------
  v_ready := to_regclass('public.class_count_attendance_reversals') is not null
         and to_regprocedure('public.record_class_count_attendance(uuid, uuid, date)') is not null
         and to_regprocedure('public.record_class_count_attendance(uuid, uuid)') is not null
         and to_regprocedure('public.reverse_class_count_attendance(uuid, text, uuid)') is not null
         and to_regprocedure('public.class_count_net_used(uuid)') is not null
         and (select count(*) = 2 from pg_trigger
              where tgrelid = to_regclass('public.class_count_attendance_reversals') and not tgisinternal
                and tgname in ('class_count_attendance_reversals_readonly_trigger', 'class_count_attendance_reversals_readonly_truncate_trigger'))
         and (select prosrc like '%class_count_net_used%' from pg_proc where oid = to_regprocedure('public.memberships_class_count_history_guard()'))
         and (select prosrc like '%class_count_net_used%' from pg_proc where oid = to_regprocedure('public.class_count_attendance_guard()'));
  perform pg_temp.rec('P0 migration 0045 is applied (the reversals table and its triggers, the three-argument record function, the reverse function, the net helper, and the net-based insert and memberships guards) on top of 0042-0044',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0042-0045 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  -- P1. Preflight: the fixture phone numbers must be free. Read-only, and before anything is created. ---------------------------
  select count(*), string_agg(phone, ', ' order by phone) into v_clash, v_clash_list
  from public.students
  where phone in ('9000450001', '9000450002', '9000450003', '9000450004', '9000450005', '9000450006', '9000450007', '9000450008', '9000450009', '9000450010', '9000450011');
  if v_ready then
    perform pg_temp.rec('P1 none of the fixture phone numbers 9000450001 to 9000450011 already belongs to a student (this run creates eleven students with them)',
      v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing student(s) already have: ' || v_clash_list
        || ' - nothing was created or changed; remove the clash (or choose other phone numbers in this script and its cleanup query) and run again' end);
  end if;

  -- Fingerprints of everything that already exists - every row, none excluded - taken before the run creates anything.
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash0 from public.memberships m;
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash0 from public.attendance a;
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash0 from public.class_count_attendance c;
    select md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by r.id), '')) into v_rev_hash0 from public.class_count_attendance_reversals r;
  end if;

  if not v_ready then
    perform pg_temp.skip('T / D / E / W / R / X / F / A', 'migration 0045 (or 0042-0044) is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('T / D / E / W / R / X / F / A', 'preflight P1 failed: a fixture phone number already belongs to an existing student, so no fixture was created');
  elsif v_admin is null then
    perform pg_temp.skip('T / D / E / W / R / X / F / A', 'needs an Admin profile');
  else
    -- Fixtures ---------------------------------------------------------------------------------------------------------------------
    v_s[1] := pg_temp.student('0045 A dates', '9000450001');
    v_s[2] := pg_temp.student('0045 B reversals', '9000450002');
    v_s[3] := pg_temp.student('0045 C cancelled', '9000450003');
    v_s[4] := pg_temp.student('0045 D duration', '9000450004');
    v_s[5] := pg_temp.student('0045 E inactive', '9000450005', 'inactive');
    v_s[6] := pg_temp.student('0045 F not started', '9000450006');
    v_s[7] := pg_temp.student('0045 G expired', '9000450007');
    v_s[8] := pg_temp.student('0045 H cancelled after a record', '9000450008');
    v_s[9] := pg_temp.student('0045 I expired after a record', '9000450009');
    v_s[10] := pg_temp.student('0045 J class total floor', '9000450010');
    v_s[11] := pg_temp.student('0045 K frozen once reversed', '9000450011');

    v_m[1] := pg_temp.mem(v_s[1], 'class_count', v_today - 10, v_today + 20, 5);
    v_m[2] := pg_temp.mem(v_s[2], 'class_count', v_today - 10, null, 3);
    v_m[3] := pg_temp.mem(v_s[3], 'class_count', v_today - 10, v_today + 20, 3, true);
    v_m[4] := pg_temp.mem(v_s[4], 'duration', v_today - 10, v_today + 19, null);
    v_m[5] := pg_temp.mem(v_s[5], 'class_count', v_today - 10, v_today + 20, 3);
    v_m[6] := pg_temp.mem(v_s[6], 'class_count', v_today + 5, v_today + 30, 3);
    v_m[7] := pg_temp.mem(v_s[7], 'class_count', v_today - 40, v_today - 30, 3);
    v_m[8] := pg_temp.mem(v_s[8], 'class_count', v_today - 10, v_today + 20, 3);
    v_m[9] := pg_temp.mem(v_s[9], 'class_count', v_today - 10, v_today + 20, 3);
    v_m[10] := pg_temp.mem(v_s[10], 'class_count', v_today - 10, v_today + 20, 5);
    v_m[11] := pg_temp.mem(v_s[11], 'class_count', v_today - 10, v_today + 20, 4);

    -- The exact fixtures of this run. Their records and reversals all hang off these memberships.
    insert into _fixture_ids (tbl, id) select 'students', x from unnest(v_s) as x;
    insert into _fixture_ids (tbl, id) select 'memberships', x from unnest(v_m) as x;

    -- T. The reversals table, its privileges and its history ---------------------------------------------------------------------
    perform pg_temp.rec('T1 the reversals table has exactly the documented columns',
      (select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'class_count_attendance_reversals')
      = 'attendance_id,id,reason,request_id,reversed_at,reversed_by', '');
    perform pg_temp.rec('T2 a record has at most one reversal and a request ID is used once (unique), and the reason is checked in the table',
      (select count(*) = 2 from pg_constraint
        where conrelid = 'public.class_count_attendance_reversals'::regclass and contype = 'u'
          and conname in ('class_count_attendance_reversals_attendance_key', 'class_count_attendance_reversals_request_id_key'))
      and (select count(*) = 1 from pg_constraint
        where conrelid = 'public.class_count_attendance_reversals'::regclass and contype = 'c' and conname = 'class_count_attendance_reversals_reason_valid'), '');
    perform pg_temp.rec('T3 the reversal references its record with RESTRICT (a record with a reversal can never be removed)',
      (select count(*) = 1 from pg_constraint
        where conrelid = 'public.class_count_attendance_reversals'::regclass and contype = 'f' and confdeltype = 'r'
          and confrelid = 'public.class_count_attendance'::regclass), '');
    perform pg_temp.rec('T4 row level security is on, with an Admin-only select policy',
      (select relrowsecurity from pg_class where oid = 'public.class_count_attendance_reversals'::regclass)
      and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'class_count_attendance_reversals' and cmd = 'SELECT'), '');
    perform pg_temp.rec('T5 a signed-in client can only read the reversals; an anonymous client has no access',
      has_table_privilege('authenticated', 'public.class_count_attendance_reversals', 'select')
      and not has_table_privilege('authenticated', 'public.class_count_attendance_reversals', 'insert')
      and not has_table_privilege('authenticated', 'public.class_count_attendance_reversals', 'update')
      and not has_table_privilege('authenticated', 'public.class_count_attendance_reversals', 'delete')
      and not has_table_privilege('authenticated', 'public.class_count_attendance_reversals', 'truncate')
      and not has_table_privilege('anon', 'public.class_count_attendance_reversals', 'select'), '');
    perform pg_temp.rec('T6 the functions: record (both forms), reverse and the list are open to signed-in users and closed to anon; the net helper to neither',
      has_function_privilege('authenticated', 'public.record_class_count_attendance(uuid, uuid, date)', 'execute')
      and has_function_privilege('authenticated', 'public.record_class_count_attendance(uuid, uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.reverse_class_count_attendance(uuid, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.record_class_count_attendance(uuid, uuid, date)', 'execute')
      and not has_function_privilege('anon', 'public.record_class_count_attendance(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.reverse_class_count_attendance(uuid, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.class_count_net_used(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.class_count_net_used(uuid)', 'execute'), '');
    perform pg_temp.rec('T7 the functions lock the membership row (FOR UPDATE) before they read a balance',
      (select prosrc like '%from public.memberships%for update%' from pg_proc where oid = to_regprocedure('public.record_class_count_attendance(uuid, uuid, date)'))
      and (select prosrc like '%from public.memberships%for update%' from pg_proc where oid = to_regprocedure('public.reverse_class_count_attendance(uuid, text, uuid)')), '');

    -- D. Attendance dates (membership A: today-10 to today+20, 5 classes) -----------------------------------------------------------------
    v_json := pg_temp.rec3(v_admin, v_m[1], r1, v_today);
    perform pg_temp.rec('D1 a class can be recorded for today: 4 of 5 remain, it is not a replay',
      pg_temp.field(v_json, 'attended_on') = v_today::text and pg_temp.field(v_json, 'classes_remaining') = '4' and pg_temp.field(v_json, 'replayed') = 'false', coalesce(v_json, 'NULL'));
    v_json := pg_temp.rec3(v_admin, v_m[1], r2, v_today - 10);
    perform pg_temp.rec('D2 ... for the membership''s start date', pg_temp.field(v_json, 'attended_on') = (v_today - 10)::text and pg_temp.field(v_json, 'classes_remaining') = '3', coalesce(v_json, 'NULL'));
    v_json := pg_temp.rec3(v_admin, v_m[1], r3, v_today - 5);
    perform pg_temp.rec('D3 ... and for a date in between', pg_temp.field(v_json, 'attended_on') = (v_today - 5)::text and pg_temp.field(v_json, 'classes_remaining') = '2', coalesce(v_json, 'NULL'));

    v_msg := pg_temp.rec3_msg(v_admin, v_m[1], gen_random_uuid(), v_today + 1);
    perform pg_temp.rec('D4 a date in the future (at the centre) is refused (22023), and nothing is recorded',
      v_msg = '22023 The attendance date cannot be in the future.' and pg_temp.net(v_m[1]) = 3, v_msg);
    v_msg := pg_temp.rec3_msg(v_admin, v_m[1], gen_random_uuid(), v_today - 11);
    perform pg_temp.rec('D5 a date before the membership starts is refused (22023), and nothing is recorded',
      v_msg = '22023 The attendance date cannot be before the membership starts.' and pg_temp.net(v_m[1]) = 3, v_msg);
    v_msg := pg_temp.rec3_msg(v_admin, v_m[1], gen_random_uuid(), null);
    perform pg_temp.rec('D6 a missing attendance date is refused (22023): today is never substituted for it',
      v_msg = '22023 A membership, a request ID and an attendance date are required.' and pg_temp.net(v_m[1]) = 3, v_msg);

    perform pg_temp.rec('D7 the stored attendance date is the one chosen (not today), while the record itself was made today',
      (select c.attended_on = v_today - 5 and (c.created_at at time zone public.centre_timezone())::date = v_today
         from public.class_count_attendance c where c.request_id = r3), '');
    v_json := pg_temp.rec3(v_admin, v_m[1], r4, v_today - 5);
    perform pg_temp.rec('D8 a second class on the same date is a separate record',
      pg_temp.field(v_json, 'replayed') = 'false' and pg_temp.field(v_json, 'classes_remaining') = '1'
      and (select count(*) = 2 from public.class_count_attendance where membership_id = v_m[1] and attended_on = v_today - 5), coalesce(v_json, 'NULL'));

    v_json := pg_temp.rec3(v_admin, v_m[1], r4, v_today - 5);
    perform pg_temp.rec('D9 a retry of the same request and date records nothing again: it is a replay, and the balance is unchanged',
      pg_temp.field(v_json, 'replayed') = 'true' and pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.gross(v_m[1]) = 4, coalesce(v_json, 'NULL'));
    v_msg := pg_temp.rec3_msg(v_admin, v_m[1], r4, v_today - 6);
    perform pg_temp.rec('D10 the same request with a DIFFERENT date is refused (23505), not answered with the first date, and the record is unchanged',
      v_msg = '23505 This request ID has already been used with a different attendance date.'
      and (select attended_on = v_today - 5 from public.class_count_attendance where request_id = r4) and pg_temp.gross(v_m[1]) = 4, v_msg);

    v_json := pg_temp.rec3(v_admin, v_m[1], r5, v_today - 2);
    v_msg := pg_temp.rec3_msg(v_admin, v_m[1], r6, v_today - 1);
    perform pg_temp.rec('D11 the last class can be taken and the next is refused (55000): the balance never goes below zero',
      pg_temp.field(v_json, 'classes_remaining') = '0' and v_msg = '55000 No classes remain on this membership.' and pg_temp.net(v_m[1]) = 5, v_msg);

    -- E. The membership must be eligible now ---------------------------------------------------------------------------------------------
    perform pg_temp.rec('E1 a cancelled membership takes no new record (55000)',
      pg_temp.rec3_msg(v_admin, v_m[3], gen_random_uuid(), v_today) = '55000 This membership is cancelled.' and pg_temp.gross(v_m[3]) = 0, '');
    perform pg_temp.rec('E2 an expired membership takes no record (55000), even for a date inside its validity',
      pg_temp.rec3_msg(v_admin, v_m[7], gen_random_uuid(), v_today - 35) = '55000 This membership has expired.' and pg_temp.gross(v_m[7]) = 0, '');
    perform pg_temp.rec('E3 a membership that has not started takes no record (55000)',
      pg_temp.rec3_msg(v_admin, v_m[6], gen_random_uuid(), v_today) = '55000 This membership has not started yet.' and pg_temp.gross(v_m[6]) = 0, '');
    perform pg_temp.rec('E4 an inactive student takes no record (55000)',
      pg_temp.rec3_msg(v_admin, v_m[5], gen_random_uuid(), v_today) = '55000 The student is not active.' and pg_temp.gross(v_m[5]) = 0, '');
    perform pg_temp.rec('E5 a duration membership takes no record (22023)',
      pg_temp.rec3_msg(v_admin, v_m[4], gen_random_uuid(), v_today) = '22023 Only a class-count membership can record class attendance.' and pg_temp.gross(v_m[4]) = 0, '');
    perform pg_temp.rec('E6 an unknown membership is refused (P0002)',
      pg_temp.rec3_msg(v_admin, gen_random_uuid(), gen_random_uuid(), v_today) = 'P0002 Membership not found.', '');
    perform pg_temp.info('E7 a date after the membership ends',
      'refused by the function with "The attendance date cannot be after the membership ends." but unreachable here: a membership must be eligible now (end date today or later) and the date cannot be after today');

    -- W. The two-argument form records for today ---------------------------------------------------------------------------------------------
    v_json := pg_temp.rec2(v_admin, v_m[2], w1);
    perform pg_temp.rec('W1 the two-argument function records one class for today at the centre',
      pg_temp.field(v_json, 'attended_on') = v_today::text and pg_temp.field(v_json, 'classes_remaining') = '2' and pg_temp.field(v_json, 'replayed') = 'false', coalesce(v_json, 'NULL'));
    v_json := pg_temp.rec2(v_admin, v_m[2], w1);
    perform pg_temp.rec('W2 ... and a retry of it is a replay', pg_temp.field(v_json, 'replayed') = 'true' and pg_temp.gross(v_m[2]) = 1, coalesce(v_json, 'NULL'));

    -- R. Reversal (membership B: no expiry, 3 classes; one record so far) ----------------------------------------------------------------------
    v_json := pg_temp.rec3(v_admin, v_m[2], ra, v_today - 1);
    v_json := pg_temp.rec3(v_admin, v_m[2], rb, v_today - 2);
    v_att_a := pg_temp.att_of(ra);
    v_att_b := pg_temp.att_of(rb);
    perform pg_temp.rec('R0 setup: all 3 classes of membership B are recorded, and a fourth is refused (55000)',
      pg_temp.net(v_m[2]) = 3 and pg_temp.rec3_msg(v_admin, v_m[2], gen_random_uuid(), v_today) = '55000 No classes remain on this membership.', '');
    perform pg_temp.rec('R0b an exhausted membership is not in the eligible list', pg_temp.listed(v_admin, v_m[2]) = '', pg_temp.listed(v_admin, v_m[2]));

    perform pg_temp.rec('R1 a missing, blank, too short or too long reason is refused (22023), and nothing is reversed',
      pg_temp.rev_msg(v_admin, v_att_a, 'ab', gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, '     ', gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, null, gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, E'\t\n\t\r\n  ', gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, E'\n\n\n\n', gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, E'\tab\n', gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.rev_msg(v_admin, v_att_a, repeat('x', 501), gen_random_uuid()) = '22023 Enter a reason of 3 to 500 characters.'
      and pg_temp.reversals(v_att_a) = 0 and pg_temp.net(v_m[2]) = 3, '');

    v_hash := pg_temp.att_hash(v_att_a);
    v_json := pg_temp.rev(v_admin, v_att_a, '  wrong student  ', rv1);
    select * into v_rev from public.class_count_attendance_reversals where request_id = rv1;
    perform pg_temp.rec('R2 a record is reversed with a trimmed reason: one class is restored (2 used, 1 left)',
      pg_temp.field(v_json, 'classes_used') = '2' and pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.field(v_json, 'replayed') = 'false'
      and v_rev.attendance_id = v_att_a and v_rev.reason = 'wrong student', coalesce(v_json, 'NULL'));
    perform pg_temp.rec('R2b ... who and when are kept, and the original record is byte-for-byte as it was',
      v_rev.reversed_by = v_admin and v_rev.reversed_at is not null and v_rev.request_id = rv1 and pg_temp.att_hash(v_att_a) = v_hash, '');

    v_json := pg_temp.rev(v_admin, v_att_a, '  wrong student  ', rv1);
    perform pg_temp.rec('R3 a retry of the same reversal is a replay: nothing is reversed twice, and the balance is unchanged',
      pg_temp.field(v_json, 'replayed') = 'true' and pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.reversals(v_att_a) = 1 and pg_temp.net(v_m[2]) = 2, coalesce(v_json, 'NULL'));
    perform pg_temp.rec('R4 the same request for another record is refused (23505)',
      pg_temp.rev_msg(v_admin, v_att_b, 'a valid reason', rv1) = '23505 This request ID has already been used for another attendance record.' and pg_temp.reversals(v_att_b) = 0, '');
    perform pg_temp.rec('R5 a second reversal of a reversed record, by a new request, is refused (55000)',
      pg_temp.rev_msg(v_admin, v_att_a, 'a second reason', gen_random_uuid()) = '55000 This class has already been reversed.' and pg_temp.reversals(v_att_a) = 1, '');
    perform pg_temp.rec('R5b an unknown record is refused (P0002)',
      pg_temp.rev_msg(v_admin, gen_random_uuid(), 'a valid reason', gen_random_uuid()) = 'P0002 Attendance record not found.', '');

    v_json := pg_temp.rec3(v_admin, v_m[2], rc, v_today - 1);
    v_att_c := pg_temp.att_of(rc);
    perform pg_temp.rec('R6 the reversed class can be recorded again as a NEW record with a new request ID (3 used again); the reversed record stays',
      pg_temp.field(v_json, 'classes_remaining') = '0' and pg_temp.field(v_json, 'replayed') = 'false' and v_att_c is not null and v_att_c <> v_att_a
      and pg_temp.gross(v_m[2]) = 4 and pg_temp.net(v_m[2]) = 3 and pg_temp.reversals(v_att_a) = 1, coalesce(v_json, 'NULL'));
    v_json := pg_temp.rec3(v_admin, v_m[2], ra, v_today - 1);
    perform pg_temp.rec('R7 the reversed record''s request ID is spent: using it again returns the original record and records nothing',
      pg_temp.field(v_json, 'replayed') = 'true' and pg_temp.field(v_json, 'attendance_id') = v_att_a::text and pg_temp.gross(v_m[2]) = 4, coalesce(v_json, 'NULL'));

    v_json := pg_temp.rev(v_admin, v_att_b, 'abc', rv2);
    perform pg_temp.rec('R8 a reason of exactly 3 characters is accepted', pg_temp.field(v_json, 'classes_used') = '2' and pg_temp.reversals(v_att_b) = 1, coalesce(v_json, 'NULL'));
    perform pg_temp.rec('R8b the eligible list follows the net count: 2 used, 1 left', pg_temp.listed(v_admin, v_m[2]) = '2|1', pg_temp.listed(v_admin, v_m[2]));
    v_json := pg_temp.rec3(v_admin, v_m[2], rd, v_today - 2);
    v_att_d := pg_temp.att_of(rd);
    v_json := pg_temp.rev(v_admin, v_att_d, repeat('y', 500), rv3);
    perform pg_temp.rec('R9 a reason of exactly 500 characters is accepted, and kept whole',
      pg_temp.field(v_json, 'classes_used') = '2' and (select length(reason) = 500 from public.class_count_attendance_reversals where request_id = rv3), coalesce(v_json, 'NULL'));
    perform pg_temp.rec('R9b the history keeps every record: 5 recorded, 3 reversed, 2 used - nothing was deleted',
      pg_temp.gross(v_m[2]) = 5 and (select count(*) = 3 from public.class_count_attendance_reversals r join public.class_count_attendance c on c.id = r.attendance_id where c.membership_id = v_m[2]) and pg_temp.net(v_m[2]) = 2, '');

    -- X. A reversal corrects a record that exists: allowed after cancellation and after expiry -------------------------------------------------
    v_json := pg_temp.rec3(v_admin, v_m[8], gen_random_uuid(), v_today - 3);
    v_att_x := pg_temp.field(v_json, 'attendance_id')::uuid;
    v_msg := pg_temp.run_owner(format('update public.memberships set cancelled_at = now() where id = %L', v_m[8]));
    perform pg_temp.rec('X1 after the membership is cancelled a new record is refused (55000) but its record can be reversed: the class is restored',
      v_msg = 'OK' and pg_temp.rec3_msg(v_admin, v_m[8], gen_random_uuid(), v_today) = '55000 This membership is cancelled.'
      and pg_temp.rev_msg(v_admin, v_att_x, 'cancelled membership correction', gen_random_uuid()) = 'OK' and pg_temp.net(v_m[8]) = 0, coalesce(v_msg, ''));
    v_json := pg_temp.rec3(v_admin, v_m[9], gen_random_uuid(), v_today - 3);
    v_att_x := pg_temp.field(v_json, 'attendance_id')::uuid;
    v_msg := pg_temp.run_owner(format('update public.memberships set end_date = %L where id = %L', v_today - 1, v_m[9]));
    perform pg_temp.rec('X2 after the membership expires a new record is refused (55000) but its record can be reversed: the class is restored',
      v_msg = 'OK' and pg_temp.rec3_msg(v_admin, v_m[9], gen_random_uuid(), v_today - 4) = '55000 This membership has expired.'
      and pg_temp.rev_msg(v_admin, v_att_x, 'expired membership correction', gen_random_uuid()) = 'OK' and pg_temp.net(v_m[9]) = 0, coalesce(v_msg, ''));

    -- F. The class-total floor uses the net count; kind and student stay frozen once any record exists -----------------------------------------------
    v_json := pg_temp.rec3(v_admin, v_m[10], gen_random_uuid(), v_today - 4);
    v_json := pg_temp.rec3(v_admin, v_m[10], gen_random_uuid(), v_today - 3);
    v_json := pg_temp.rec3(v_admin, v_m[10], gen_random_uuid(), v_today - 2);
    v_att_x := pg_temp.field(v_json, 'attendance_id')::uuid;
    v_json := pg_temp.rev(v_admin, v_att_x, 'recorded by mistake', gen_random_uuid());
    perform pg_temp.rec('F0 setup: membership J has 3 records, one reversed: 2 used', pg_temp.gross(v_m[10]) = 3 and pg_temp.net(v_m[10]) = 2, '');
    v_hash := pg_temp.row_hash(v_m[10]);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 1 where id = %L', v_m[10]));
    perform pg_temp.rec('F1 the class total cannot go below the 2 classes used (23514), and the row is unchanged',
      v_msg like '23514 The class total cannot be less than the classes already recorded.%' and pg_temp.row_hash(v_m[10]) = v_hash, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 2 where id = %L', v_m[10]));
    perform pg_temp.rec('F2 ... but it can be set to 2: the reversed class no longer holds the total up (it would have to stay at 3 if every record counted)',
      v_msg = 'OK' and (select total_classes = 2 from public.memberships where id = v_m[10]), v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set kind = ''duration'' where id = %L', v_m[10]));
    perform pg_temp.rec('F3 the type of a membership with recorded classes cannot be changed (55006)',
      v_msg like '55006 The type of a membership with recorded classes cannot be changed.%', v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set student_id = %L where id = %L', v_s[11], v_m[10]));
    perform pg_temp.rec('F4 the student of a membership with recorded classes cannot be changed (55006)',
      v_msg like '55006 The student of a membership with recorded classes cannot be changed.%', v_msg);

    v_json := pg_temp.rec3(v_admin, v_m[11], gen_random_uuid(), v_today - 2);
    v_att_x := pg_temp.field(v_json, 'attendance_id')::uuid;
    v_json := pg_temp.rev(v_admin, v_att_x, 'recorded by mistake', gen_random_uuid());
    perform pg_temp.rec('G0 setup: membership K has one record, reversed: 0 used', pg_temp.gross(v_m[11]) = 1 and pg_temp.net(v_m[11]) = 0, '');
    v_msg := pg_temp.run_owner(format('update public.memberships set kind = ''duration'' where id = %L', v_m[11]));
    perform pg_temp.rec('G1 even with every record reversed, the type stays frozen (55006): the history is still there',
      v_msg like '55006 The type of a membership with recorded classes cannot be changed.%', v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set student_id = %L where id = %L', v_s[10], v_m[11]));
    perform pg_temp.rec('G2 ... and so does the student (55006)', v_msg like '55006 The student of a membership with recorded classes cannot be changed.%', v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 1 where id = %L', v_m[11]));
    perform pg_temp.rec('G3 ... while the class total can be lowered to 1: nothing is in use', v_msg = 'OK' and (select total_classes = 1 from public.memberships where id = v_m[11]), v_msg);

    -- T8. The table-level rules, on records that exist -------------------------------------------------------------------------------------------
    v_att_x := pg_temp.att_of(r1);
    perform pg_temp.rec('T8 the table itself refuses a reason that is too short, untrimmed (spaces, tabs or newlines), whitespace-only or too long (23514)',
      pg_temp.run_owner(format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, ''ab'', gen_random_uuid())', v_att_x)) like '23514 %'
      and pg_temp.run_owner(format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, '' abc '', gen_random_uuid())', v_att_x)) like '23514 %'
      and pg_temp.run_owner(format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, E''\t\n\t'', gen_random_uuid())', v_att_x)) like '23514 %'
      and pg_temp.run_owner(format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, E''abc\n'', gen_random_uuid())', v_att_x)) like '23514 %'
      and pg_temp.run_owner(format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, repeat(''z'', 501), gen_random_uuid())', v_att_x)) like '23514 %'
      and pg_temp.reversals(v_att_x) = 0, '');
    perform pg_temp.rec('T9 a signed-in client cannot insert, update or delete reversals (42501 each)',
      pg_temp.run_as(v_admin, format('insert into public.class_count_attendance_reversals (attendance_id, reason, request_id) values (%L, ''abc'', gen_random_uuid())', v_att_x)) = '42501'
      and pg_temp.run_as(v_admin, 'update public.class_count_attendance_reversals set reason = reason') = '42501'
      and pg_temp.run_as(v_admin, 'delete from public.class_count_attendance_reversals') = '42501'
      and pg_temp.reversals(v_att_x) = 0, '');
    select md5(to_jsonb(r)::text) into v_hash from public.class_count_attendance_reversals r where r.request_id = rv1;
    perform pg_temp.rec('T10 an update of a reversal is refused even for the owner (55006), and so are a delete and a truncate',
      pg_temp.run_owner(format('update public.class_count_attendance_reversals set reason = ''changed'' where request_id = %L', rv1)) like '55006 %'
      and pg_temp.run_owner(format('delete from public.class_count_attendance_reversals where request_id = %L', rv1)) like '55006 %'
      and pg_temp.run_owner('truncate public.class_count_attendance_reversals') like '55006 %'
      and (select md5(to_jsonb(r)::text) from public.class_count_attendance_reversals r where r.request_id = rv1) = v_hash, '');
    perform pg_temp.rec('T11 clearing reversed_by together with any other change is refused (55006)',
      pg_temp.run_owner(format('update public.class_count_attendance_reversals set reversed_by = null, reason = ''changed'' where request_id = %L', rv1)) like '55006 %'
      and (select md5(to_jsonb(r)::text) from public.class_count_attendance_reversals r where r.request_id = rv1) = v_hash, '');
    v_msg := pg_temp.run_owner(format('update public.class_count_attendance_reversals set reversed_by = null where request_id = %L', rv1));
    select * into v_rev from public.class_count_attendance_reversals where request_id = rv1;
    perform pg_temp.rec('T12 clearing ONLY reversed_by (what deleting that user account does) is allowed, and nothing else about the reversal changes',
      v_msg = 'OK' and v_rev.reversed_by is null and v_rev.attendance_id = v_att_a and v_rev.reason = 'wrong student' and v_rev.request_id = rv1, v_msg);

    -- A. Access ---------------------------------------------------------------------------------------------------------------------------------------
    if v_instr_user is null then
      perform pg_temp.skip('A1', 'no Instructor profile to test with');
    else
      perform pg_temp.rec('A1 an Instructor cannot reverse a record, or record a class for a date (42501)',
        pg_temp.rev_msg(v_instr_user, v_att_c, 'a valid reason', gen_random_uuid()) like '42501 %'
        and pg_temp.rec3_msg(v_instr_user, v_m[11], gen_random_uuid(), v_today) like '42501 %'
        and pg_temp.reversals(v_att_c) = 0, '');
    end if;
    v_out := pg_temp.run_anon(format('select public.reverse_class_count_attendance(%L::uuid, ''a valid reason'', gen_random_uuid())', v_att_c));
    perform pg_temp.rec('A2 an anonymous caller cannot reverse a record (42501)', v_out = '42501' and pg_temp.reversals(v_att_c) = 0, 'returned ' || coalesce(v_out, 'NULL'));
    v_out := pg_temp.run_anon(format('select public.record_class_count_attendance(%L::uuid, gen_random_uuid(), current_date)', v_m[11]));
    perform pg_temp.rec('A3 an anonymous caller cannot record a class for a date (42501)', v_out = '42501', 'returned ' || coalesce(v_out, 'NULL'));
  end if;

  -- Z. Nothing real was touched ----------------------------------------------------------------------------------------------------
  -- Every row except those attached to a fixture membership THIS RUN created (tracked by id above). A row that appeared,
  -- vanished or changed anywhere else makes the fingerprint differ. Session attendance is compared whole.
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash1
  from public.memberships m
  where m.id not in (select id from _fixture_ids where tbl = 'memberships');
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash1 from public.attendance a;
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash1
    from public.class_count_attendance c
    where c.membership_id not in (select id from _fixture_ids where tbl = 'memberships');
    select md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by r.id), '')) into v_rev_hash1
    from public.class_count_attendance_reversals r
    where r.attendance_id not in (
      select c.id from public.class_count_attendance c where c.membership_id in (select id from _fixture_ids where tbl = 'memberships'));
  end if;

  perform pg_temp.rec('Z1 every pre-existing membership is unchanged by this script (only its own fixtures excluded, by id)', v_mem_hash0 = v_mem_hash1, '');
  perform pg_temp.rec('Z2 every pre-existing session-attendance row is byte-for-byte unchanged', v_att_hash0 = v_att_hash1, '');
  if v_ready then
    perform pg_temp.rec('Z3 every pre-existing class-count attendance record is byte-for-byte unchanged', v_cca_hash0 = v_cca_hash1, '');
    perform pg_temp.rec('Z4 every pre-existing reversal is byte-for-byte unchanged', v_rev_hash0 = v_rev_hash1, '');
  end if;
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

-- AFTER THE ROLLBACK (run separately, as its own statement - never inside the verification transaction).
-- Nothing of the run may remain. The fixtures are found by the exact phone numbers this run gave its students (not by name):
--
--   with fixture_students as (
--     select id from public.students
--     where phone in ('9000450001', '9000450002', '9000450003', '9000450004', '9000450005', '9000450006',
--                     '9000450007', '9000450008', '9000450009', '9000450010', '9000450011')
--   ),
--   fixture_memberships as (
--     select m.id from public.memberships m join fixture_students s on s.id = m.student_id
--   )
--   select
--     (select count(*) from fixture_students)                                                         as leftover_students,
--     (select count(*) from fixture_memberships)                                                      as leftover_memberships,
--     (select count(*) from public.class_count_attendance c
--       join fixture_memberships fm on fm.id = c.membership_id
--       join fixture_students fs on fs.id = c.student_id)                                             as leftover_records,
--     (select count(*) from public.class_count_attendance_reversals r
--       join public.class_count_attendance c on c.id = r.attendance_id
--       join fixture_memberships fm on fm.id = c.membership_id)                                       as leftover_reversals;
--
-- Every leftover_* must be 0. (If a student at the centre already has one of those eleven phone numbers, leftover_students
-- would not be 0 before any run: the run's preflight P1 refuses to start in that case.)
