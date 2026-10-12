-- ===========================================================================
-- Migration 0042 verification (behaviour) - Class-count memberships: schema and eligibility isolation
-- Exercises supabase/migrations/0042_class_count_memberships.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0042 is applied (the two membership columns, the three membership constraints, the nullable end
--       dates, the scoped overlap constraint and the re-created eligibility function). If not, every other check is
--       skipped (NOT TESTED) after one clear failure.
--   C   The columns and constraints are what 0042 describes: kind (default 'duration'), total_classes, nullable
--       memberships.end_date and invoices.period_end, and both plan lists (the five existing plans plus class_count).
--   K   The membership constraints: a duration membership still needs an end date and has no class count; a
--       class-count membership needs a positive class count, may have no end date, still cannot end before it starts;
--       an unknown kind is refused; kind and plan must agree; every existing plan is still accepted.
--   O   The overlap rule: two overlapping duration memberships of one student are still refused; a cancelled one still
--       does not count; a duration membership may overlap a class-count membership (fixed validity or none). Overlap
--       between two class-count memberships is reported as INFO only - 0042 neither adds nor removes a rule there.
--   E   Session attendance: only a duration membership makes a student eligible. A student with only a class-count
--       membership (fixed validity or no expiry) is not eligible; one with both is, with the duration membership's
--       dates; a cancelled duration membership plus a class-count one is not; a frozen (snapshotted) session still
--       returns its frozen set verbatim; the signature and result columns are unchanged; anonymous callers are refused.
--   Z   Every pre-existing membership, invoice and attendance row is byte-for-byte unchanged by this script.
--
-- PREREQUISITES
--   * Migrations up to and including 0042 applied. If 0042 is NOT applied, P0 fails and every scenario is skipped.
--   * An Admin profile, and at least one instructor (the eligibility scenarios are skipped without them).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only: students, one batch with one schedule, enrollments, memberships and (for the
--     frozen-set check) one class session. No existing row is written; existing memberships, invoices and attendance
--     are read only to be fingerprinted.
--   * Everything it creates disappears with the rollback. The student and membership code sequences leave a small gap.
--
-- BEFORE / AFTER THE MIGRATION (run separately, to show 0042 itself changed no existing data)
--   Run this query before applying 0042 and again after; the two results must be identical:
--     select count(*) as memberships, md5(coalesce(string_agg((to_jsonb(m) - 'kind' - 'total_classes')::text, '|' order by m.id), '')) as memberships_hash,
--            (select count(*) from public.invoices) as invoices,
--            (select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) from public.invoices i) as invoices_hash
--     from public.memberships m;
--   (The hash leaves out the two new columns, which do not exist before the migration.) After the migration:
--     select count(*) filter (where kind <> 'duration' or total_classes is not null) as not_duration from public.memberships;   -- must be 0
--
-- LIMITATIONS
--   * Concurrency is not tested. The class-count recording workflow does not exist in this phase.
--   * The frozen-set check (E7) writes a class session and its frozen set as the owner; if that cannot be done (a
--     guard or an unexpected column) it is reported NOT TESTED with the reason.
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

-- A disposable student (ZZVERIFY); returns its id.
create function pg_temp.student(p_label text, p_phone text)
returns uuid language plpgsql as $f$
declare
  v_today date := (now() at time zone public.centre_timezone())::date;
  v_id    uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY ' || p_label, p_phone, '+91', v_today - 400, 'active')
  returning id into v_id;
  return v_id;
end $f$;

-- Inserts one membership as the owner. Returns 'OK:<id>' or the SQLSTATE of the refusal (nothing is left behind by a
-- refusal: the failing statement is rolled back with its own sub-transaction).
create function pg_temp.mem(
  p_student uuid, p_kind text, p_plan text, p_start date, p_end date, p_total integer, p_cancelled boolean default false)
returns text language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.memberships (student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency, cancelled_at)
  values (p_student, p_kind, p_plan, p_start, p_end, p_total, 1000, 'pending', 'INR', case when p_cancelled then now() end)
  returning id into v_id;
  return 'OK:' || v_id::text;
exception when others then
  return sqlstate;
end $f$;

-- Who the eligibility function returns for the fixture schedule on a date, as the Admin: a sorted list of student ids.
create function pg_temp.eligible(p_admin uuid, p_batch uuid, p_sched uuid, p_date date)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format(
    'select coalesce(string_agg(r.student_id::text, '','' order by r.student_id), '''') from public.resolve_eligible_students(%L::uuid, %L::uuid, %L::date) r',
    p_batch, p_sched, p_date));
end $f$;

do $$
declare
  v_admin      uuid;
  v_instr      uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_ready      boolean;
  v_def        text;
  v_out        text;
  v_dow        text;
  v_batch      uuid;  v_series uuid;  v_sched uuid;  v_enr uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid; v_s7 uuid; v_s8 uuid;
  v_list       text;
  v_session    uuid;
  v_err        text;
  v_mem_hash0  text;  v_mem_hash1  text;
  v_inv_hash0  text;  v_inv_hash1  text;
  v_att_hash0  text;  v_att_hash1  text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr from public.instructors order by created_at limit 1;

  -- Fingerprints of everything that already exists (compared at the very end).
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash0
  from public.memberships m
  where m.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash0 from public.attendance a;

  -- P0. Is 0042 applied? ---------------------------------------------------------------------------------------------------
  v_ready := (select count(*) = 2 from information_schema.columns
              where table_schema = 'public' and table_name = 'memberships' and column_name in ('kind', 'total_classes'))
         and (select count(*) = 4 from pg_constraint
              where conrelid = 'public.memberships'::regclass
                and conname in ('memberships_kind_valid', 'memberships_total_classes_by_kind', 'memberships_end_date_by_kind', 'memberships_kind_matches_plan'))
         and (select is_nullable = 'YES' from information_schema.columns
              where table_schema = 'public' and table_name = 'memberships' and column_name = 'end_date')
         and (select is_nullable = 'YES' from information_schema.columns
              where table_schema = 'public' and table_name = 'invoices' and column_name = 'period_end')
         and (select pg_get_constraintdef(oid) like '%kind%' from pg_constraint
              where conname = 'memberships_no_overlap_per_student' and conrelid = 'public.memberships'::regclass)
         and (select prosrc like '%m.kind = ''duration''%' from pg_proc
              where oid = to_regprocedure('public.resolve_eligible_students(uuid, uuid, date)'));
  perform pg_temp.rec('P0 migration 0042 is applied (kind and total_classes, their constraints, nullable end dates, the scoped overlap constraint and the duration-only eligibility function)',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0042 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if not v_ready then
    perform pg_temp.skip('C / K / O / E', 'migration 0042 is not applied');
  else
    -- C. The columns and constraints ---------------------------------------------------------------------------------------
    perform pg_temp.rec('C1 memberships.kind is NOT NULL text defaulting to ''duration''; total_classes is a nullable integer',
      (select data_type = 'text' and is_nullable = 'NO' and column_default like '%duration%'
         from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name = 'kind')
      and (select data_type = 'integer' and is_nullable = 'YES'
         from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name = 'total_classes'), '');
    perform pg_temp.rec('C2 memberships.end_date and invoices.period_end are nullable; the "end not before start" checks still exist',
      (select count(*) = 2 from pg_constraint where conname in ('memberships_end_after_start', 'invoices_period_end_after_start')), '');
    select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'memberships_plan_valid' and conrelid = 'public.memberships'::regclass;
    perform pg_temp.rec('C3 memberships.plan accepts the five existing plans and class_count',
      v_def like '%monthly%' and v_def like '%quarterly%' and v_def like '%half_yearly%' and v_def like '%annual%' and v_def like '%custom%' and v_def like '%class_count%', coalesce(v_def, 'missing'));
    select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'invoices_plan_valid' and conrelid = 'public.invoices'::regclass;
    perform pg_temp.rec('C4 invoices.plan accepts the five existing plans and class_count',
      v_def like '%monthly%' and v_def like '%quarterly%' and v_def like '%half_yearly%' and v_def like '%annual%' and v_def like '%custom%' and v_def like '%class_count%', coalesce(v_def, 'missing'));
    -- A duration membership is one on a duration plan (any plan but class_count). Class-count memberships now legitimately
    -- exist, so they are not judged here; every duration membership must still be kind 'duration' with an end date and no
    -- class count.
    perform pg_temp.rec('C5 every existing duration membership (a plan other than class_count) has kind duration, an end date and no class count',
      (select count(*) = 0 from public.memberships m
        where m.student_id not in (select id from public.students where full_name like 'ZZVERIFY%')
          and m.plan <> 'class_count'
          and (m.kind <> 'duration' or m.total_classes is not null or m.end_date is null)), '');
    select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'memberships_no_overlap_per_student' and conrelid = 'public.memberships'::regclass;
    perform pg_temp.rec('C6 the overlap constraint keeps its name, its range and its cancelled exclusion, and now covers duration memberships only',
      v_def like '%EXCLUDE USING gist%' and v_def like '%daterange(start_date, end_date%' and v_def like '%cancelled_at IS NULL%' and v_def like '%kind%duration%', coalesce(v_def, 'missing'));

    -- K. The membership constraints -----------------------------------------------------------------------------------------
    v_s8 := pg_temp.student('0042 K', '9000420008');
    perform pg_temp.rec('K1 a duration membership still needs an end date (23514)',
      pg_temp.mem(v_s8, 'duration', 'monthly', v_today - 900, null, null) = '23514', '');
    perform pg_temp.rec('K2 a duration membership cannot have a class count (23514)',
      pg_temp.mem(v_s8, 'duration', 'monthly', v_today - 900, v_today - 870, 8) = '23514', '');
    perform pg_temp.rec('K3 a class-count membership needs a class count (23514), and not zero (23514)',
      pg_temp.mem(v_s8, 'class_count', 'class_count', v_today - 900, v_today - 870, null) = '23514'
      and pg_temp.mem(v_s8, 'class_count', 'class_count', v_today - 900, v_today - 870, 0) = '23514', '');
    perform pg_temp.rec('K4 a class-count membership cannot end before it starts (23514)',
      pg_temp.mem(v_s8, 'class_count', 'class_count', v_today - 870, v_today - 900, 8) = '23514', '');
    perform pg_temp.rec('K5 an unknown kind is refused (23514)',
      pg_temp.mem(v_s8, 'package', 'monthly', v_today - 900, v_today - 870, null) = '23514', '');
    perform pg_temp.rec('K6 kind and plan must agree: class_count with a duration plan, and duration with the class_count plan, are refused (23514)',
      pg_temp.mem(v_s8, 'class_count', 'monthly', v_today - 900, v_today - 870, 8) = '23514'
      and pg_temp.mem(v_s8, 'duration', 'class_count', v_today - 900, v_today - 870, null) = '23514', '');
    perform pg_temp.rec('K7 a class-count membership with a fixed validity, and one with no expiry, are accepted',
      pg_temp.mem(v_s8, 'class_count', 'class_count', v_today - 900, v_today - 870, 8) like 'OK:%'
      and pg_temp.mem(v_s8, 'class_count', 'class_count', v_today - 800, null, 12) like 'OK:%', '');
    perform pg_temp.rec('K8 every existing plan is still accepted for a duration membership',
      pg_temp.mem(v_s8, 'duration', 'monthly',     v_today - 700, v_today - 691, null) like 'OK:%'
      and pg_temp.mem(v_s8, 'duration', 'quarterly',   v_today - 680, v_today - 671, null) like 'OK:%'
      and pg_temp.mem(v_s8, 'duration', 'half_yearly', v_today - 660, v_today - 651, null) like 'OK:%'
      and pg_temp.mem(v_s8, 'duration', 'annual',      v_today - 640, v_today - 631, null) like 'OK:%'
      and pg_temp.mem(v_s8, 'duration', 'custom',      v_today - 620, v_today - 611, null) like 'OK:%', '');

    -- O. The overlap rule -----------------------------------------------------------------------------------------------------
    v_s6 := pg_temp.student('0042 O', '9000420006');
    perform pg_temp.rec('O1 a first duration membership is accepted',
      pg_temp.mem(v_s6, 'duration', 'monthly', v_today - 20, v_today + 9, null) like 'OK:%', '');
    perform pg_temp.rec('O2 an overlapping duration membership of the same student is still refused (23P01)',
      pg_temp.mem(v_s6, 'duration', 'monthly', v_today - 5, v_today + 25, null) = '23P01', '');
    perform pg_temp.rec('O3 an overlapping CANCELLED duration membership is still allowed',
      pg_temp.mem(v_s6, 'duration', 'monthly', v_today - 5, v_today + 25, null, true) like 'OK:%', '');
    perform pg_temp.rec('O4 a class-count membership with a fixed validity may overlap the duration membership',
      pg_temp.mem(v_s6, 'class_count', 'class_count', v_today - 10, v_today + 20, 10) like 'OK:%', '');
    perform pg_temp.rec('O5 a class-count membership with no expiry may overlap the duration membership',
      pg_temp.mem(v_s6, 'class_count', 'class_count', v_today - 10, null, 10) like 'OK:%', '');
    perform pg_temp.rec('O6 a duration membership is still refused when it would overlap the existing duration one, whatever class-count memberships exist (23P01)',
      pg_temp.mem(v_s6, 'duration', 'monthly', v_today, v_today + 29, null) = '23P01', '');
    perform pg_temp.info('O7 two overlapping class-count memberships of one student',
      'the database does not restrict them (0042 adds no rule between class-count memberships): ' ||
      pg_temp.mem(v_s6, 'class_count', 'class_count', v_today - 10, v_today + 20, 5));

    -- E. Session attendance eligibility -------------------------------------------------------------------------------------
    if v_admin is null or v_instr is null then
      perform pg_temp.skip('E1-E8', 'needs an Admin profile and an instructor');
    else
      v_s1 := pg_temp.student('0042 E duration', '9000420001');
      v_s2 := pg_temp.student('0042 E class-count fixed', '9000420002');
      v_s3 := pg_temp.student('0042 E class-count no expiry', '9000420003');
      v_s4 := pg_temp.student('0042 E both', '9000420004');
      v_s5 := pg_temp.student('0042 E cancelled duration + class-count', '9000420005');
      v_s7 := pg_temp.student('0042 E no membership', '9000420007');

      perform pg_temp.mem(v_s1, 'duration', 'monthly', v_today - 20, v_today + 9, null);
      perform pg_temp.mem(v_s2, 'class_count', 'class_count', v_today - 20, v_today + 9, 10);
      perform pg_temp.mem(v_s3, 'class_count', 'class_count', v_today - 20, null, 10);
      perform pg_temp.mem(v_s4, 'duration', 'monthly', v_today - 20, v_today + 9, null);
      perform pg_temp.mem(v_s4, 'class_count', 'class_count', v_today - 20, v_today + 9, 10);
      perform pg_temp.mem(v_s4, 'class_count', 'class_count', v_today - 20, null, 10);
      perform pg_temp.mem(v_s5, 'duration', 'monthly', v_today - 20, v_today + 9, null, true);
      perform pg_temp.mem(v_s5, 'class_count', 'class_count', v_today - 20, v_today + 9, 10);
      -- v_s7 has no membership at all.

      v_dow := case extract(dow from v_today)::int
                 when 0 then 'sunday' when 1 then 'monday' when 2 then 'tuesday' when 3 then 'wednesday'
                 when 4 then 'thursday' when 5 then 'friday' else 'saturday' end;

      insert into public.batches (name, code, status)
      values ('ZZVERIFY 0042 batch', 'ZZV42-' || substr(gen_random_uuid()::text, 1, 8), 'active')
      returning id into v_batch;
      insert into public.schedule_series (batch_id) values (v_batch) returning id into v_series;
      insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, status, series_id)
      values (v_batch, v_instr, v_dow, time '06:00', time '07:00', v_today - 30, 'active', v_series)
      returning id into v_sched;

      -- Every fixture student is enrolled and assigned, so the membership is the only thing that differs.
      for v_enr in
        with e as (
          insert into public.batch_enrollments (student_id, batch_id, effective_start_date, status)
          select s, v_batch, v_today - 30, 'active' from unnest(array[v_s1, v_s2, v_s3, v_s4, v_s5, v_s7]) as s
          returning id
        )
        select id from e
      loop
        insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date)
        values (v_enr, v_series, v_today - 30);
      end loop;

      v_list := pg_temp.eligible(v_admin, v_batch, v_sched, v_today);
      perform pg_temp.rec('E0 the eligibility function runs for the fixture schedule (not an error)', v_list not like 'ERR:%', v_list);

      perform pg_temp.rec('E1 a student with a duration membership covering the date is eligible, as before', position(v_s1::text in v_list) > 0, v_list);
      perform pg_temp.rec('E2 a student with ONLY a class-count membership with a fixed validity covering the date is NOT eligible', position(v_s2::text in v_list) = 0, '');
      perform pg_temp.rec('E3 a student with ONLY a class-count membership with no expiry is NOT eligible', position(v_s3::text in v_list) = 0, '');
      perform pg_temp.rec('E4 a student with BOTH kinds is eligible - once',
        position(v_s4::text in v_list) > 0 and (length(v_list) - length(replace(v_list, v_s4::text, ''))) = length(v_s4::text), '');
      v_out := pg_temp.query_as(v_admin, format(
        'select r.membership_start_date::text || ''|'' || r.membership_end_date::text from public.resolve_eligible_students(%L::uuid, %L::uuid, %L::date) r where r.student_id = %L::uuid',
        v_batch, v_sched, v_today, v_s4));
      perform pg_temp.rec('E5 ... and the dates it returns are the duration membership''s, not a class-count one''s',
        v_out = (v_today - 20)::text || '|' || (v_today + 9)::text, coalesce(v_out, 'NULL'));
      perform pg_temp.rec('E6 a CANCELLED duration membership plus a class-count membership is NOT eligible, and a student with no membership is not either',
        position(v_s5::text in v_list) = 0 and position(v_s7::text in v_list) = 0, '');
      perform pg_temp.rec('E7 exactly the two students with a duration membership are returned (the fixture batch has no one else)',
        v_list = (select string_agg(x::text, ',' order by x) from unnest(array[v_s1, v_s4]) as x), v_list);

      -- E8. The signature and result columns are unchanged.
      select pg_get_function_result(oid) into v_def
      from pg_proc where oid = to_regprocedure('public.resolve_eligible_students(uuid, uuid, date)');
      perform pg_temp.rec('E8 the function keeps its signature and its six result columns',
        v_def = 'TABLE(student_id uuid, full_name text, phone text, student_code text, membership_start_date date, membership_end_date date)', coalesce(v_def, 'missing'));

      v_out := pg_temp.run_anon(format('select * from public.resolve_eligible_students(%L::uuid, %L::uuid, %L::date)', v_batch, v_sched, v_today));
      perform pg_temp.rec('E9 an anonymous caller is still refused',
        v_out in ('42501', '42883'), 'returned ' || coalesce(v_out, 'NULL') || ' (expected 42501, or 42883 if the function is not visible to anon)');

      -- E10. A frozen set is returned verbatim, even for a student who now has only a class-count membership.
      begin
        insert into public.class_sessions (schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status, eligibility_snapshot_at)
        values (v_sched, v_batch, v_instr, v_today - 1, time '06:00', time '07:00', 'scheduled', now())
        returning id into v_session;
        insert into public.class_session_eligible_students (class_session_id, student_id, membership_start_date, membership_end_date, provenance)
        values (v_session, v_s2, v_today - 20, v_today + 9, 'save');
        v_list := pg_temp.eligible(v_admin, v_batch, v_sched, v_today - 1);
        perform pg_temp.rec('E10 a frozen eligible set is returned verbatim: the snapshotted student is still returned and no one else is added',
          v_list = v_s2::text, v_list);
      exception when others then
        get stacked diagnostics v_err = message_text;
        perform pg_temp.skip('E10 frozen eligible set', 'could not build a snapshotted session: ' || sqlstate || ' ' || coalesce(v_err, ''));
      end;
    end if;
  end if;

  -- Z. Nothing real was touched ----------------------------------------------------------------------------------------------------
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash1
  from public.memberships m
  where m.student_id not in (select id from public.students where full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into v_att_hash1 from public.attendance a;

  perform pg_temp.rec('Z1 every pre-existing membership is unchanged by this script (fixtures excluded)', v_mem_hash0 = v_mem_hash1, '');
  perform pg_temp.rec('Z2 every pre-existing invoice and receipt is byte-for-byte unchanged', v_inv_hash0 = v_inv_hash1, '');
  perform pg_temp.rec('Z3 every pre-existing attendance row is byte-for-byte unchanged', v_att_hash0 = v_att_hash1, '');
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
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%')       as leftover_students,
--          (select count(*) from public.batches where name like 'ZZVERIFY%')              as leftover_batches,
--          (select count(*) from public.memberships m join public.students s on s.id = m.student_id
--            where s.full_name like 'ZZVERIFY%')                                           as leftover_memberships;
-- All three must be 0.
