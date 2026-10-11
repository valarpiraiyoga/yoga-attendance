-- ===========================================================================
-- Migration 0043 verification (behaviour) - Class Count Attendance: recording and history
-- Exercises supabase/migrations/0043_class_count_attendance.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0043 is applied (the table, both functions, its triggers) on top of 0042. If not, every other check is
--       skipped (NOT TESTED) after one clear failure.
--   T   The table: its columns, the unique request ID, restrict foreign keys, row level security, and its privileges
--       (a client can read, and nothing else); there is no stored counter anywhere.
--   R   Recording: one class is recorded for the right student on the centre's day by the Admin; a retry of the same
--       request records nothing again and returns the original result; the same request cannot be reused for another
--       membership; separate requests on the same day are separate classes; the last class can be taken, the next is
--       refused, and the count never goes below zero - for a fixed validity and for no expiry.
--   V   Validation: a duration membership, a cancelled, an expired, a not-yet-started membership, an inactive student, an
--       unknown membership and missing arguments are refused with the documented SQLSTATE and message, recording nothing.
--   A   Access: an Instructor and an anonymous caller are refused.
--   G   The guard: even a direct insert (as the owner) cannot take a class that is not there, record for a duration
--       membership, or record for the wrong student; a client role cannot insert, update or delete at all.
--   H   History: an update, delete or truncate of a recorded class is refused even for the owner; the one allowed change
--       is clearing recorded_by (what deleting that user account does), with nothing else altered.
--   L   The list: only the class-count memberships a class can be recorded for today, with used / remaining classes, and
--       it follows the recordings; Instructor and anonymous callers are refused.
--   D   Duration memberships and session attendance are unchanged: a student holding both is recorded against the
--       class-count membership only, the duration membership row is untouched, and neither session function mentions
--       the new table.
--   Z   Every pre-existing membership, invoice, session-attendance row and class-count attendance row is byte-for-byte
--       unchanged by this script.
--
-- PREREQUISITES
--   * Migrations up to and including 0043 applied (0042 in particular). If 0043 is NOT applied, P0 fails and every
--     scenario is skipped.
--   * An Admin profile. An Instructor profile is needed for the Instructor checks (skipped without one).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only: students and their memberships, and the class-count attendance rows recorded for
--     them. No existing row is written; existing rows are read only to be fingerprinted.
--   * It exercises refusals that, if a trigger were missing, would change or remove rows of the history table (an owner's
--     update, delete and truncate). Because of the rollback nothing can persist, but that is why it must be run as one
--     transaction and never in a session with autocommit.
--   * The student and membership code sequences leave a small gap; no row remains.
--
-- LIMITATIONS
--   * Concurrency (two simultaneous recordings of the last class) cannot be tested in one transaction and is NOT tested.
--     What is checked instead: the function and the guard both lock the membership row (FOR UPDATE), and the table's own
--     unique request ID and guard backstop any race.
--   * The recording screen is application code, not covered here.
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

-- Inserts one membership as the owner; returns its id.
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

-- Records a class as p_user; returns the result as JSON text, or 'ERR:<sqlstate>'.
create function pg_temp.record(p_user uuid, p_membership uuid, p_request uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.record_class_count_attendance(%L::uuid, %L::uuid)::text', p_membership, p_request));
end $f$;

-- Records a class as p_user; returns 'OK' or '<sqlstate> <message>' (the refusal in words).
create function pg_temp.record_msg(p_user uuid, p_membership uuid, p_request uuid)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    perform public.record_class_count_attendance(p_membership, p_request);
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

-- Rows recorded for a membership (as the owner).
-- (plpgsql, not sql: a SQL function is validated when it is created, which would fail before P0 if 0043 is absent.)
create function pg_temp.used(p_membership uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.class_count_attendance where membership_id = p_membership;
  return v_count;
end $f$;

-- The eligible list as the Admin: the fixture memberships in it, sorted, as text.
create function pg_temp.listed(p_admin uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin,
    'select coalesce(string_agg(membership_id::text, '','' order by membership_id), '''') from public.list_class_count_eligible() where full_name like ''ZZVERIFY%''');
end $f$;

do $$
declare
  v_admin      uuid;
  v_instr_user uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_ready      boolean;
  v_def        text;
  v_out        text;
  v_msg        text;
  v_json       text;
  v_json2      text;
  -- students
  v_sa uuid; v_sb uuid; v_sd uuid; v_sc uuid; v_sx uuid; v_sf uuid; v_si uuid; v_sm uuid;
  -- memberships: A fixed validity (3), B no expiry (2), D duration, C cancelled, X expired, F future, I inactive student, M duration+class-count
  v_ma uuid; v_mb uuid; v_md uuid; v_mc uuid; v_mx uuid; v_mf uuid; v_mi uuid; v_mm_dur uuid; v_mm_cc uuid;
  v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_r3 uuid := gen_random_uuid(); v_r4 uuid := gen_random_uuid();
  v_rb1 uuid := gen_random_uuid(); v_rb2 uuid := gen_random_uuid(); v_rb3 uuid := gen_random_uuid();
  v_row        record;   -- not %rowtype: that would resolve the table when the block starts, before P0 can report its absence
  v_row_hash   text;
  v_mm_hash    text;
  v_list       text;
  v_expected   text;
  v_mem_hash0  text;  v_mem_hash1  text;
  v_inv_hash0  text;  v_inv_hash1  text;
  v_att_hash0  text;  v_att_hash1  text;
  v_cca_hash0  text;  v_cca_hash1  text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr_user from public.profiles where role = 'instructor' order by created_at limit 1;

  -- P0. Is 0043 applied? ---------------------------------------------------------------------------------------------------
  v_ready := to_regclass('public.class_count_attendance') is not null
         and to_regprocedure('public.record_class_count_attendance(uuid, uuid)') is not null
         and to_regprocedure('public.list_class_count_eligible()') is not null
         and (select count(*) = 3 from pg_trigger
              where tgrelid = to_regclass('public.class_count_attendance') and not tgisinternal
                and tgname in ('class_count_attendance_guard_trigger', 'class_count_attendance_readonly_trigger', 'class_count_attendance_readonly_truncate_trigger'))
         and (select count(*) = 2 from information_schema.columns
              where table_schema = 'public' and table_name = 'memberships' and column_name in ('kind', 'total_classes'));
  perform pg_temp.rec('P0 migration 0043 is applied (class_count_attendance, record_class_count_attendance, list_class_count_eligible and its three triggers) on top of 0042',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0042 and 0043 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  -- Fingerprints of everything that already exists (compared at the very end).
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash0
  from public.memberships m
  where m.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash0 from public.attendance a;
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash0
    from public.class_count_attendance c
    where c.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  end if;

  if not v_ready then
    perform pg_temp.skip('T / R / V / A / G / H / L / D', 'migration 0043 (or 0042) is not applied');
  elsif v_admin is null then
    perform pg_temp.skip('T / R / V / A / G / H / L / D', 'needs an Admin profile');
  else
    -- T. The table -------------------------------------------------------------------------------------------------------------
    perform pg_temp.rec('T1 the table has exactly the documented columns',
      (select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'class_count_attendance')
      = 'attended_on,created_at,id,membership_id,recorded_by,request_id,student_id', '');
    perform pg_temp.rec('T2 there is no stored counter: no remaining/used column on memberships or on the table, and no integer column on the table',
      (select count(*) = 0 from information_schema.columns
        where table_schema = 'public' and table_name in ('memberships', 'class_count_attendance')
          and (column_name like '%remaining%' or column_name like '%used%' or column_name like '%balance%'))
      and (select count(*) = 0 from information_schema.columns
        where table_schema = 'public' and table_name = 'class_count_attendance' and data_type in ('integer', 'bigint', 'smallint', 'numeric')), '');
    perform pg_temp.rec('T3 request_id is unique',
      (select count(*) = 1 from pg_constraint where conname = 'class_count_attendance_request_id_key' and contype = 'u'
         and conrelid = 'public.class_count_attendance'::regclass), '');
    perform pg_temp.rec('T4 the membership and student references are RESTRICT (history is never cascaded away)',
      (select count(*) = 2 from pg_constraint
        where conrelid = 'public.class_count_attendance'::regclass and contype = 'f' and confdeltype = 'r'), '');
    perform pg_temp.rec('T5 row level security is on, with an Admin-only select policy',
      (select relrowsecurity from pg_class where oid = 'public.class_count_attendance'::regclass)
      and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'class_count_attendance' and cmd = 'SELECT'), '');
    perform pg_temp.rec('T6 a signed-in client can only read: select yes; insert, update, delete, truncate no',
      has_table_privilege('authenticated', 'public.class_count_attendance', 'select')
      and not has_table_privilege('authenticated', 'public.class_count_attendance', 'insert')
      and not has_table_privilege('authenticated', 'public.class_count_attendance', 'update')
      and not has_table_privilege('authenticated', 'public.class_count_attendance', 'delete')
      and not has_table_privilege('authenticated', 'public.class_count_attendance', 'truncate'), '');
    perform pg_temp.rec('T7 an anonymous client has no access at all',
      not has_table_privilege('anon', 'public.class_count_attendance', 'select')
      and not has_table_privilege('anon', 'public.class_count_attendance', 'insert'), '');
    perform pg_temp.rec('T8 both the function and the guard lock the membership row (FOR UPDATE)',
      -- Any form of the record function: from 0045 the lock is in the three-argument form, which the two-argument one calls.
      (select bool_or(prosrc like '%from public.memberships%for update%') from pg_proc
        where proname = 'record_class_count_attendance' and pronamespace = 'public'::regnamespace)
      and (select prosrc like '%from public.memberships%for update%' from pg_proc where oid = to_regprocedure('public.class_count_attendance_guard()')), '');
    perform pg_temp.rec('T9 the two functions are not executable by anon',
      not has_function_privilege('anon', 'public.record_class_count_attendance(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.list_class_count_eligible()', 'execute')
      and has_function_privilege('authenticated', 'public.record_class_count_attendance(uuid, uuid)', 'execute'), '');

    -- Fixtures ---------------------------------------------------------------------------------------------------------------------
    v_sa := pg_temp.student('0043 A fixed validity', '9000430001');
    v_sb := pg_temp.student('0043 B no expiry', '9000430002');
    v_sd := pg_temp.student('0043 D duration only', '9000430003');
    v_sc := pg_temp.student('0043 C cancelled', '9000430004');
    v_sx := pg_temp.student('0043 X expired', '9000430005');
    v_sf := pg_temp.student('0043 F future', '9000430006');
    v_si := pg_temp.student('0043 I inactive', '9000430007', 'inactive');
    v_sm := pg_temp.student('0043 M both kinds', '9000430008');

    v_ma := pg_temp.mem(v_sa, 'class_count', v_today - 5, v_today + 20, 3);
    v_mb := pg_temp.mem(v_sb, 'class_count', v_today - 5, null, 2);
    v_md := pg_temp.mem(v_sd, 'duration', v_today - 5, v_today + 20, null);
    v_mc := pg_temp.mem(v_sc, 'class_count', v_today - 5, v_today + 20, 3, true);
    v_mx := pg_temp.mem(v_sx, 'class_count', v_today - 60, v_today - 30, 3);
    v_mf := pg_temp.mem(v_sf, 'class_count', v_today + 5, v_today + 30, 3);
    v_mi := pg_temp.mem(v_si, 'class_count', v_today - 5, v_today + 20, 3);
    v_mm_dur := pg_temp.mem(v_sm, 'duration', v_today - 5, v_today + 20, null);
    v_mm_cc := pg_temp.mem(v_sm, 'class_count', v_today - 5, v_today + 20, 2);

    -- L1. The list before anything is recorded ----------------------------------------------------------------------------------
    v_list := pg_temp.listed(v_admin);
    v_expected := (select string_agg(x::text, ',' order by x) from unnest(array[v_ma, v_mb, v_mm_cc]) as x);
    perform pg_temp.rec('L1 the list holds exactly the class-count memberships a class can be recorded for today (a duration, a cancelled, an expired, a not-yet-started membership and an inactive student are not in it)',
      v_list = v_expected, v_list);
    v_out := pg_temp.query_as(v_admin, format(
      'select concat_ws(''|'', total_classes, classes_used, classes_remaining, (end_date is null)::text) from public.list_class_count_eligible() where membership_id = %L::uuid', v_mb));
    perform pg_temp.rec('L2 a no-expiry membership is listed with its class count, nothing used, and no end date', v_out = '2|0|2|true', coalesce(v_out, 'NULL'));

    -- R. Recording ----------------------------------------------------------------------------------------------------------------------
    v_json := pg_temp.record(v_admin, v_ma, v_r1);
    perform pg_temp.rec('R1 the Admin records the first class: 2 of 3 remain, it is not a replay',
      pg_temp.field(v_json, 'classes_remaining') = '2' and pg_temp.field(v_json, 'classes_used') = '1'
      and pg_temp.field(v_json, 'total_classes') = '3' and pg_temp.field(v_json, 'replayed') = 'false', coalesce(v_json, 'NULL'));
    select * into v_row from public.class_count_attendance where request_id = v_r1;
    perform pg_temp.rec('R2 the row is for the membership''s own student, on the centre''s day, recorded by the Admin, with the request ID',
      v_row.membership_id = v_ma and v_row.student_id = v_sa and v_row.attended_on = v_today and v_row.recorded_by = v_admin
      and v_row.request_id = v_r1 and v_row.created_at is not null, '');

    v_json2 := pg_temp.record(v_admin, v_ma, v_r1);
    perform pg_temp.rec('R3 a retry of the same request records nothing again: it is a replay with the same result, and still 1 class used',
      pg_temp.field(v_json2, 'replayed') = 'true' and pg_temp.field(v_json2, 'classes_remaining') = '2'
      and pg_temp.field(v_json2, 'attendance_id') = pg_temp.field(v_json, 'attendance_id') and pg_temp.used(v_ma) = 1, coalesce(v_json2, 'NULL'));

    v_msg := pg_temp.record_msg(v_admin, v_mb, v_r1);
    perform pg_temp.rec('R4 the same request ID cannot be used for another membership (23505), and that membership is untouched',
      v_msg = '23505 This request ID has already been used for another membership.' and pg_temp.used(v_mb) = 0, v_msg);

    v_json := pg_temp.record(v_admin, v_ma, v_r2);
    perform pg_temp.rec('R5 a second request on the same day is a second class: 1 of 3 remains',
      pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.field(v_json, 'replayed') = 'false' and pg_temp.used(v_ma) = 2
      and (select count(*) = 2 from public.class_count_attendance where membership_id = v_ma and attended_on = v_today), coalesce(v_json, 'NULL'));

    -- L3. The list follows the recordings.
    v_out := pg_temp.query_as(v_admin, format(
      'select concat_ws(''|'', total_classes, classes_used, classes_remaining) from public.list_class_count_eligible() where membership_id = %L::uuid', v_ma));
    perform pg_temp.rec('L3 after two recordings the list shows 3 classes, 2 used, 1 remaining', v_out = '3|2|1', coalesce(v_out, 'NULL'));

    v_json := pg_temp.record(v_admin, v_ma, v_r3);
    perform pg_temp.rec('R6 the last class can be taken: 0 remain', pg_temp.field(v_json, 'classes_remaining') = '0' and pg_temp.used(v_ma) = 3, coalesce(v_json, 'NULL'));
    v_msg := pg_temp.record_msg(v_admin, v_ma, v_r4);
    perform pg_temp.rec('R7 the next request is refused (55000) and nothing is recorded: the count never goes below zero',
      v_msg = '55000 No classes remain on this membership.' and pg_temp.used(v_ma) = 3
      and (select total_classes from public.memberships where id = v_ma) - pg_temp.used(v_ma) = 0, v_msg);
    v_json2 := pg_temp.record(v_admin, v_ma, v_r3);
    perform pg_temp.rec('R8 a retry of the LAST request after the membership is used up is still a replay, not an error',
      pg_temp.field(v_json2, 'replayed') = 'true' and pg_temp.field(v_json2, 'classes_remaining') = '0' and pg_temp.used(v_ma) = 3, coalesce(v_json2, 'NULL'));
    perform pg_temp.rec('L4 a membership with no classes left is no longer in the list', position(v_ma::text in pg_temp.listed(v_admin)) = 0, '');

    v_json := pg_temp.record(v_admin, v_mb, v_rb1);
    v_json2 := pg_temp.record(v_admin, v_mb, v_rb2);
    v_msg := pg_temp.record_msg(v_admin, v_mb, v_rb3);
    perform pg_temp.rec('R9 a no-expiry membership records its 2 classes and refuses a third (55000)',
      pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.field(v_json2, 'classes_remaining') = '0'
      and v_msg = '55000 No classes remain on this membership.' and pg_temp.used(v_mb) = 2, v_msg);

    -- V. Validation ----------------------------------------------------------------------------------------------------------------
    perform pg_temp.rec('V1 a duration membership is refused (22023) and nothing is recorded',
      pg_temp.record_msg(v_admin, v_md, gen_random_uuid()) = '22023 Only a class-count membership can record class attendance.' and pg_temp.used(v_md) = 0, '');
    perform pg_temp.rec('V2 a cancelled membership is refused (55000)',
      pg_temp.record_msg(v_admin, v_mc, gen_random_uuid()) = '55000 This membership is cancelled.' and pg_temp.used(v_mc) = 0, '');
    perform pg_temp.rec('V3 an expired membership is refused (55000)',
      pg_temp.record_msg(v_admin, v_mx, gen_random_uuid()) = '55000 This membership has expired.' and pg_temp.used(v_mx) = 0, '');
    perform pg_temp.rec('V4 a membership that has not started is refused (55000)',
      pg_temp.record_msg(v_admin, v_mf, gen_random_uuid()) = '55000 This membership has not started yet.' and pg_temp.used(v_mf) = 0, '');
    perform pg_temp.rec('V5 an inactive student is refused (55000)',
      pg_temp.record_msg(v_admin, v_mi, gen_random_uuid()) = '55000 The student is not active.' and pg_temp.used(v_mi) = 0, '');
    perform pg_temp.rec('V6 an unknown membership is refused (P0002)',
      pg_temp.record_msg(v_admin, gen_random_uuid(), gen_random_uuid()) = 'P0002 Membership not found.', '');
    perform pg_temp.rec('V7 a missing membership or request ID is refused (22023)',
      pg_temp.record_msg(v_admin, null, gen_random_uuid()) = '22023 A membership and a request ID are required.'
      and pg_temp.record_msg(v_admin, v_mm_cc, null) = '22023 A membership and a request ID are required.' and pg_temp.used(v_mm_cc) = 0, '');

    -- A. Access ---------------------------------------------------------------------------------------------------------------------
    if v_instr_user is null then
      perform pg_temp.skip('A1 / L5', 'no Instructor profile to test with');
    else
      perform pg_temp.rec('A1 an Instructor cannot record a class (42501), and nothing is recorded',
        pg_temp.record_msg(v_instr_user, v_mm_cc, gen_random_uuid()) like '42501 %' and pg_temp.used(v_mm_cc) = 0, '');
      perform pg_temp.rec('L5 an Instructor cannot read the list (42501)',
        pg_temp.query_as(v_instr_user, 'select count(*)::text from public.list_class_count_eligible()') = 'ERR:42501', '');
    end if;
    v_out := pg_temp.run_anon(format('select public.record_class_count_attendance(%L::uuid, %L::uuid)', v_mm_cc, gen_random_uuid()));
    perform pg_temp.rec('A2 an anonymous caller cannot record a class (42501)', v_out = '42501' and pg_temp.used(v_mm_cc) = 0,
      'returned ' || coalesce(v_out, 'NULL'));
    v_out := pg_temp.run_anon('select count(*) from public.list_class_count_eligible()');
    perform pg_temp.rec('L6 an anonymous caller cannot read the list (42501)', v_out = '42501', 'returned ' || coalesce(v_out, 'NULL'));
    perform pg_temp.rec('A3 the Admin can read the history through the table''s select policy',
      pg_temp.query_as(v_admin, format('select count(*)::text from public.class_count_attendance where membership_id = %L::uuid', v_ma)) = '3', '');

    -- G. The guard (direct inserts, as the owner and as a client) ------------------------------------------------------------------
    v_msg := pg_temp.run_owner(format(
      'insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id) values (%L, %L, %L, gen_random_uuid())', v_ma, v_sa, v_today));
    perform pg_temp.rec('G1 even a direct insert cannot take a class that is not there (55000): the membership is used up', v_msg like '55000 %' and pg_temp.used(v_ma) = 3, v_msg);
    v_msg := pg_temp.run_owner(format(
      'insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id) values (%L, %L, %L, gen_random_uuid())', v_md, v_sd, v_today));
    perform pg_temp.rec('G2 a direct insert for a duration membership is refused (22023)', v_msg like '22023 %' and pg_temp.used(v_md) = 0, v_msg);
    v_msg := pg_temp.run_owner(format(
      'insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id) values (%L, %L, %L, gen_random_uuid())', v_mm_cc, v_sa, v_today));
    perform pg_temp.rec('G3 a direct insert for the wrong student is refused (22023)', v_msg like '22023 %' and pg_temp.used(v_mm_cc) = 0, v_msg);
    perform pg_temp.rec('G4 a signed-in client cannot insert, update or delete the table (42501 each)',
      pg_temp.run_as(v_admin, format('insert into public.class_count_attendance (membership_id, student_id, attended_on, request_id) values (%L, %L, %L, gen_random_uuid())', v_mm_cc, v_sm, v_today)) = '42501'
      and pg_temp.run_as(v_admin, 'update public.class_count_attendance set attended_on = attended_on') = '42501'
      and pg_temp.run_as(v_admin, 'delete from public.class_count_attendance') = '42501'
      and pg_temp.used(v_mm_cc) = 0, '');

    -- H. History ---------------------------------------------------------------------------------------------------------------------
    select md5(to_jsonb(c)::text) into v_row_hash from public.class_count_attendance c where c.request_id = v_r1;
    perform pg_temp.rec('H1 an update of a recorded class is refused even for the owner (55006) and the row is unchanged',
      pg_temp.run_owner(format('update public.class_count_attendance set attended_on = attended_on - 1 where request_id = %L', v_r1)) like '55006 %'
      and (select md5(to_jsonb(c)::text) from public.class_count_attendance c where c.request_id = v_r1) = v_row_hash, '');
    perform pg_temp.rec('H2 a delete is refused even for the owner (55006) and every row is still there',
      pg_temp.run_owner(format('delete from public.class_count_attendance where request_id = %L', v_r1)) like '55006 %'
      and pg_temp.used(v_ma) = 3, '');
    -- A truncate must never get through, whichever protection stops it. The history trigger refuses it (55006). Once 0045
    -- adds a foreign key from the reversals to the records, PostgreSQL refuses a plain TRUNCATE of the referenced table itself
    -- (0A000) before any trigger runs; the form that key would allow, TRUNCATE ... CASCADE, must then still be stopped by the
    -- history trigger (55006). Any other result - including success - is a failure, and the rows must all still be there.
    v_msg := pg_temp.run_owner('truncate public.class_count_attendance');
    v_out := case when to_regclass('public.class_count_attendance_reversals') is null
                  then '55006 (no foreign key yet: the plain truncate is the whole test)'
                  else pg_temp.run_owner('truncate public.class_count_attendance cascade') end;
    perform pg_temp.rec('H3 a truncate is refused even for the owner: by the history trigger (55006) or, once 0045 exists, by the foreign key from the reversals (0A000) - and TRUNCATE ... CASCADE is still refused by the trigger (55006)',
      (v_msg like '55006 %' or v_msg like '0A000 %') and v_out like '55006 %' and pg_temp.used(v_ma) = 3 and pg_temp.used(v_mb) = 2,
      'plain: ' || coalesce(v_msg, 'NULL') || ' | cascade: ' || coalesce(v_out, 'NULL'));
    perform pg_temp.rec('H4 clearing recorded_by together with changing anything else is refused (55006)',
      pg_temp.run_owner(format('update public.class_count_attendance set recorded_by = null, attended_on = attended_on - 1 where request_id = %L', v_r1)) like '55006 %'
      and (select md5(to_jsonb(c)::text) from public.class_count_attendance c where c.request_id = v_r1) = v_row_hash, '');
    v_msg := pg_temp.run_owner(format('update public.class_count_attendance set recorded_by = null where request_id = %L', v_r1));
    select * into v_row from public.class_count_attendance where request_id = v_r1;
    perform pg_temp.rec('H5 clearing ONLY recorded_by (what deleting that user account does) is allowed, and nothing else about the row changes',
      v_msg = 'OK' and v_row.recorded_by is null and v_row.membership_id = v_ma and v_row.student_id = v_sa
      and v_row.attended_on = v_today and v_row.request_id = v_r1, v_msg);

    -- D. Duration memberships and session attendance are unchanged -------------------------------------------------------------
    select md5(to_jsonb(m)::text) into v_mm_hash from public.memberships m where m.id = v_mm_dur;
    v_json := pg_temp.record(v_admin, v_mm_cc, gen_random_uuid());
    perform pg_temp.rec('D1 a student holding both kinds is recorded against the CLASS-COUNT membership only: 1 of 2 remains, and the duration membership has no class-count row',
      pg_temp.field(v_json, 'classes_remaining') = '1' and pg_temp.field(v_json, 'membership_id') = v_mm_cc::text
      and pg_temp.used(v_mm_cc) = 1 and pg_temp.used(v_mm_dur) = 0
      and (select count(*) = 1 from public.class_count_attendance where student_id = v_sm), coalesce(v_json, 'NULL'));
    perform pg_temp.rec('D2 the duration membership row is byte-for-byte unchanged by the recording',
      (select md5(to_jsonb(m)::text) from public.memberships m where m.id = v_mm_dur) = v_mm_hash, '');
    perform pg_temp.rec('D3 neither session-attendance function mentions the new table or its functions',
      (select count(*) = 0 from pg_proc
        where oid in (to_regprocedure('public.resolve_eligible_students(uuid, uuid, date)'), to_regprocedure('public.save_session_attendance(uuid, jsonb)'))
          and (prosrc like '%class_count_attendance%' or prosrc like '%record_class_count%')), '');
    perform pg_temp.rec('D4 session eligibility is still duration-only (the 0042 condition is still in the function)',
      (select prosrc like '%m.kind = ''duration''%' from pg_proc where oid = to_regprocedure('public.resolve_eligible_students(uuid, uuid, date)')), '');
    perform pg_temp.rec('D5 recording never changed a membership: every fixture membership still has its original class count and dates',
      (select total_classes = 3 and end_date = v_today + 20 from public.memberships where id = v_ma)
      and (select total_classes = 2 and end_date is null from public.memberships where id = v_mb), '');
  end if;

  -- Z. Nothing real was touched ----------------------------------------------------------------------------------------------------
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash1
  from public.memberships m
  where m.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash1 from public.attendance a;
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash1
    from public.class_count_attendance c
    where c.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  end if;

  perform pg_temp.rec('Z1 every pre-existing membership is unchanged by this script (fixtures excluded)', v_mem_hash0 = v_mem_hash1, '');
  perform pg_temp.rec('Z2 every pre-existing invoice and receipt is byte-for-byte unchanged', v_inv_hash0 = v_inv_hash1, '');
  perform pg_temp.rec('Z3 every pre-existing session-attendance row is byte-for-byte unchanged', v_att_hash0 = v_att_hash1, '');
  if v_ready then
    perform pg_temp.rec('Z4 every pre-existing class-count attendance row is byte-for-byte unchanged', v_cca_hash0 = v_cca_hash1, '');
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

-- AFTER THE ROLLBACK (run separately) - nothing may remain:
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%')                               as leftover_students,
--          (select count(*) from public.memberships m join public.students s on s.id = m.student_id
--            where s.full_name like 'ZZVERIFY%')                                                                  as leftover_memberships,
--          (select count(*) from public.class_count_attendance c join public.students s on s.id = c.student_id
--            where s.full_name like 'ZZVERIFY%')                                                                  as leftover_class_count_rows;
-- All three must be 0.
