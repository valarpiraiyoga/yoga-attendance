-- ===========================================================================
-- Migration 0033 verification (behaviour) - Membership service details
-- Verifies supabase/migrations/0033_membership_service_details.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor of the project the application actually uses, AFTER applying 0033.
-- It calls the real functions and triggers against DISPOSABLE fixtures (every name starts with
-- ZZVERIFY: six students, three batches, schedule series and versions, enrollments, assignments and
-- six memberships), and the whole script runs in one transaction that is ROLLED BACK. It writes
-- nothing permanently. It never inserts a receipt directly: a receipt is issued by marking a fixture
-- membership Paid, exactly as the application does. (Sequences - student and membership codes - do
-- move on, as they do for any rolled-back insert; the receipt counter does not.)
--
-- Admin behaviour runs as an authenticated ADMIN by setting request.jwt.claims and switching to the
-- `authenticated` role, as PostgREST does. No service-role key is used.
--
-- THE FIXTURES (T = today in the centre's time zone)
--   S1  enrolled in ZZVERIFY Alpha, Mon-Fri 08:15-09:15            membership M1 starts T-100
--   S2  enrolled in Alpha AND ZZVERIFY Beta (Sat 07:00-08:00)      membership M2 starts T-100
--   S3  Alpha until T-201, then Beta from T-200                    membership M3 starts T-100
--   S4  no enrolment at all                                        membership M4 starts T-100
--   S5  overlapping schedule versions (tie-break checks)           membership M5 starts T-100
--   S6  inactive batch; inactive schedule version still in force;  membership M6 starts T-100
--       a version ended before T-100; a version starting after T-100
--
-- OUTPUT: one grid of seq / test / status / detail, plus a SUMMARY row.
-- Statuses: PASS, FAIL, NOT TESTED (reason in detail), INFO.
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
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- Fixture builders (owner). A series is created with its first schedule version; more versions are
-- added to an existing series with mk_version.
create function pg_temp.mk_series(p_batch uuid, p_instr uuid, p_day text, p_start time, p_end time,
                                  p_from date, p_until date, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_series uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instr, p_day, p_start, p_end, p_from, p_until, p_status, v_series);
  return v_series;
end $f$;

create function pg_temp.mk_version(p_series uuid, p_batch uuid, p_instr uuid, p_day text, p_start time, p_end time,
                                   p_from date, p_until date, p_created timestamptz)
returns void language plpgsql as $f$
begin
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, series_id, created_at)
  values (p_batch, p_instr, p_day, p_start, p_end, p_from, p_until, p_series, p_created);
end $f$;

create function pg_temp.enroll(p_student uuid, p_batch uuid, p_from date, p_until date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date)
  values (p_student, p_batch, p_from, p_until) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.assign(p_enrollment uuid, p_series uuid, p_from date, p_until date)
returns void language plpgsql as $f$
begin
  insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
  values (p_enrollment, p_series, p_from, p_until);
end $f$;

create function pg_temp.mk_student(p_name text, p_phone text, p_join date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values (p_name, p_phone, '+91', p_join, 'active') returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_membership(p_student uuid, p_start date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
  values (p_student, 'monthly', p_start, p_start + 29, 1000.00, 'pending', 'INR') returning id into v_id;
  return v_id;
end $f$;

do $$
declare
  v_admin        uuid;
  v_instructor   uuid;
  v_today        date;
  v_fixture_err  text;
  v_instr        uuid;
  v_ba uuid; v_bb uuid; v_bi uuid;
  v_sa           uuid[] := '{}';
  v_sb           uuid;
  v_sx uuid; v_sy uuid; v_s6w uuid; v_s6t uuid; v_s6f uuid; v_s6s uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_m5 uuid; v_m6 uuid;
  v_e uuid;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_code         text;
  v_inv          public.invoices%rowtype;
  v_inv1         public.invoices%rowtype;
  v_inv3         public.invoices%rowtype;
  v_inv3b        public.invoices%rowtype;
  v_before1      jsonb;
  v_before3      jsonb;
  v_before       jsonb;
  v_inv2         public.invoices%rowtype;
  v_det          jsonb;
  v_days         text[];
  v_number       bigint;
  v_day          text;
  v_freeze_trg   text;
  v_o1           jsonb;
  v_e4           uuid;
  v_synced       text[] := array['plan', 'description', 'period_start', 'period_end', 'total_amount', 'taxable_amount', 'tax_amount', 'service_details', 'updated_at'];
begin
  select (now() at time zone public.centre_timezone())::date into v_today;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- Disposable fixtures --------------------------------------------------------------------------
  begin
    insert into public.instructors (full_name) values ('ZZVERIFY Instructor') returning id into v_instr;
    insert into public.batches (name, code) values ('ZZVERIFY Alpha', 'ZZVA') returning id into v_ba;
    insert into public.batches (name, code) values ('ZZVERIFY Beta', 'ZZVB') returning id into v_bb;
    insert into public.batches (name, code, status) values ('ZZVERIFY Dormant', 'ZZVC', 'inactive') returning id into v_bi;

    -- Alpha: Monday to Friday 08:15-09:15, open-ended. Beta: Saturday 07:00-08:00.
    foreach v_day in array array['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] loop
      v_sa := v_sa || pg_temp.mk_series(v_ba, v_instr, v_day, '08:15', '09:15', v_today - 900, null);
    end loop;
    v_sb := pg_temp.mk_series(v_bb, v_instr, 'saturday', '07:00', '08:00', v_today - 900, null);

    v_s1 := pg_temp.mk_student('ZZVERIFY S1', '9000000011', v_today - 950);
    v_s2 := pg_temp.mk_student('ZZVERIFY S2', '9000000012', v_today - 950);
    v_s3 := pg_temp.mk_student('ZZVERIFY S3', '9000000013', v_today - 950);
    v_s4 := pg_temp.mk_student('ZZVERIFY S4', '9000000014', v_today - 950);
    v_s5 := pg_temp.mk_student('ZZVERIFY S5', '9000000015', v_today - 950);
    v_s6 := pg_temp.mk_student('ZZVERIFY S6', '9000000016', v_today - 950);

    -- S1: Alpha, all five series, open-ended.
    v_e := pg_temp.enroll(v_s1, v_ba, v_today - 900, null);
    for i in 1..5 loop perform pg_temp.assign(v_e, v_sa[i], v_today - 900, null); end loop;

    -- S2: Alpha (all five) and Beta.
    v_e := pg_temp.enroll(v_s2, v_ba, v_today - 900, null);
    for i in 1..5 loop perform pg_temp.assign(v_e, v_sa[i], v_today - 900, null); end loop;
    v_e := pg_temp.enroll(v_s2, v_bb, v_today - 900, null);
    perform pg_temp.assign(v_e, v_sb, v_today - 900, null);

    -- S3: Alpha until T-201, then Beta from T-200.
    v_e := pg_temp.enroll(v_s3, v_ba, v_today - 500, v_today - 201);
    for i in 1..5 loop perform pg_temp.assign(v_e, v_sa[i], v_today - 500, v_today - 201); end loop;
    v_e := pg_temp.enroll(v_s3, v_bb, v_today - 200, null);
    perform pg_temp.assign(v_e, v_sb, v_today - 200, null);

    -- S5: two series with overlapping versions. X: three versions, the last two share effective_from
    -- (the later created_at wins). Y: two versions (the later effective_from wins).
    v_sx := pg_temp.mk_series(v_ba, v_instr, 'monday', '08:00', '09:00', v_today - 800, null);
    perform pg_temp.mk_version(v_sx, v_ba, v_instr, 'monday', '09:00', '10:00', v_today - 700, null, now() - interval '1 hour');
    perform pg_temp.mk_version(v_sx, v_ba, v_instr, 'monday', '10:00', '11:00', v_today - 700, null, now());
    v_sy := pg_temp.mk_series(v_ba, v_instr, 'tuesday', '06:00', '07:00', v_today - 800, null);
    perform pg_temp.mk_version(v_sy, v_ba, v_instr, 'tuesday', '07:00', '08:00', v_today - 300, null, now());
    v_e := pg_temp.enroll(v_s5, v_ba, v_today - 900, null);
    perform pg_temp.assign(v_e, v_sx, v_today - 900, null);
    perform pg_temp.assign(v_e, v_sy, v_today - 900, null);

    -- S6: an inactive batch; an inactive-status schedule still in force; one ended before T-100; one
    -- starting after T-100; a plain active one.
    v_s6w := pg_temp.mk_series(v_bi, v_instr, 'wednesday', '18:00', '19:00', v_today - 900, null);
    v_s6t := pg_temp.mk_series(v_bi, v_instr, 'thursday', '18:00', '19:00', v_today - 900, null, 'inactive');
    v_s6f := pg_temp.mk_series(v_bi, v_instr, 'friday', '18:00', '19:00', v_today - 900, v_today - 200);
    v_s6s := pg_temp.mk_series(v_bi, v_instr, 'saturday', '18:00', '19:00', v_today - 50, null);
    v_e := pg_temp.enroll(v_s6, v_bi, v_today - 900, null);
    perform pg_temp.assign(v_e, v_s6w, v_today - 900, null);
    perform pg_temp.assign(v_e, v_s6t, v_today - 900, null);
    perform pg_temp.assign(v_e, v_s6f, v_today - 900, null);
    perform pg_temp.assign(v_e, v_s6s, v_today - 900, null);

    v_m1 := pg_temp.mk_membership(v_s1, v_today - 100);
    v_m2 := pg_temp.mk_membership(v_s2, v_today - 100);
    v_m3 := pg_temp.mk_membership(v_s3, v_today - 100);
    v_m4 := pg_temp.mk_membership(v_s4, v_today - 100);
    v_m5 := pg_temp.mk_membership(v_s5, v_today - 100);
    v_m6 := pg_temp.mk_membership(v_s6, v_today - 100);
  exception when others then
    v_m1 := null;
    v_fixture_err := sqlstate || ' ' || sqlerrm;
  end;

  select starting_invoice_number into v_start_before from public.invoice_settings where singleton;
  v_had_invoices := exists (select 1 from public.invoices);

  select coalesce(array_agg(i.id), '{}'), count(*),
         md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_ids0, v_count0, v_hash0
  from public.invoices i;

  perform pg_temp.info('SETUP', format('admin=%s instructor=%s fixtures-created=%s receipts-already=%s',
    coalesce(v_admin::text, 'none'), coalesce(v_instructor::text, 'none'), case when v_m1 is null then 'NO' else 'yes' end, v_count0));

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_m1 is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_fixture_err, 'unknown'));
  else
    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    perform pg_temp.run_owner('update public.invoice_settings set tax_enabled = false where singleton');

    -- Issue: marking a fixture membership Paid issues its receipt (the application's own path). ---------
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id in (%L, %L, %L, %L, %L, %L)',
                                              v_m1, v_m2, v_m3, v_m4, v_m5, v_m6));
    perform pg_temp.rec('S0 the six fixture memberships were marked Paid and each got one receipt',
      v_code = 'OK' and (select count(*) = 6 from public.invoices where membership_id in (v_m1, v_m2, v_m3, v_m4, v_m5, v_m6)),
      'sqlstate ' || v_code);

    -- C. The snapshot ---------------------------------------------------------------------------------
    select service_details into v_det from public.invoices where membership_id = v_m1;
    select array_agg(x ->> 'day_of_week' order by ord) into v_days
    from jsonb_array_elements(v_det -> 'batches' -> 0 -> 'slots') with ordinality t(x, ord);
    perform pg_temp.rec('C1 one batch with five slots: snapshot created, Monday to Friday in order, wall-clock HH:MM times',
      v_det is not null and (select service_details_tracked from public.invoices where membership_id = v_m1)
      and v_det ->> 'version' = '1' and v_det ->> 'as_of' = to_char(v_today - 100, 'YYYY-MM-DD')
      and jsonb_array_length(v_det -> 'batches') = 1 and v_det -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY Alpha'
      and v_det -> 'batches' -> 0 ->> 'code' = 'ZZVA'
      and v_days = array['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      and not exists (select 1 from jsonb_array_elements(v_det -> 'batches' -> 0 -> 'slots') x
                      where x ->> 'start_time' <> '08:15' or x ->> 'end_time' <> '09:15'),
      coalesce(v_det::text, 'NULL'));

    perform pg_temp.rec('C1b the snapshot holds only version, as_of and batches - nothing presentational, no plan, amount or numbering',
      (select array_agg(k order by k) = array['as_of', 'batches', 'version'] from jsonb_object_keys(v_det) k)
      and (select array_agg(k order by k) = array['batch_id', 'code', 'name', 'slots'] from jsonb_object_keys(v_det -> 'batches' -> 0) k)
      and v_det::text !~ '(AM|PM|Sl\. ?No)', '');

    select service_details into v_det from public.invoices where membership_id = v_m2;
    perform pg_temp.rec('C2 two batches: both captured, ordered by name (Alpha, then Beta with its Saturday slot)',
      v_det is not null and jsonb_array_length(v_det -> 'batches') = 2
      and v_det -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY Alpha' and jsonb_array_length(v_det -> 'batches' -> 0 -> 'slots') = 5
      and v_det -> 'batches' -> 1 ->> 'name' = 'ZZVERIFY Beta'
      and v_det -> 'batches' -> 1 -> 'slots' -> 0 = jsonb_build_object('day_of_week', 'saturday', 'start_time', '07:00', 'end_time', '08:00'),
      coalesce(v_det::text, 'NULL'));

    select service_details into v_det from public.invoices where membership_id = v_m3;
    perform pg_temp.rec('C3 the enrollment in force at the START date decides: S3 was in Beta then, not Alpha',
      v_det is not null and jsonb_array_length(v_det -> 'batches') = 1 and v_det -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY Beta',
      coalesce(v_det::text, 'NULL'));

    -- J-L. Which schedule versions count ----------------------------------------------------------------
    select service_details into v_det from public.invoices where membership_id = v_m6;
    select array_agg(x ->> 'day_of_week' order by ord) into v_days
    from jsonb_array_elements(v_det -> 'batches' -> 0 -> 'slots') with ordinality t(x, ord);
    perform pg_temp.rec('J1 a schedule version with status inactive still counts when its dates cover the start date (status is not checked)',
      v_days is not null and 'thursday' = any(v_days), coalesce(v_days::text, 'NULL'));
    perform pg_temp.rec('J2 an inactive batch is still shown (the batch need not be active)',
      v_det -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY Dormant', coalesce(v_det::text, 'NULL'));
    perform pg_temp.rec('K1 a version that ended before the start date is not shown',
      v_days is not null and not ('friday' = any(v_days)), coalesce(v_days::text, 'NULL'));
    perform pg_temp.rec('L1 a version starting after the start date is not shown',
      v_days is not null and not ('saturday' = any(v_days)) and v_days = array['wednesday', 'thursday'], coalesce(v_days::text, 'NULL'));

    -- P. Overlapping versions -----------------------------------------------------------------------------
    select service_details into v_det from public.invoices where membership_id = v_m5;
    perform pg_temp.rec('P1 overlapping versions: the latest effective_from wins, then the latest created_at (Mon 10:00-11:00, Tue 07:00-08:00)',
      v_det -> 'batches' -> 0 -> 'slots' = jsonb_build_array(
        jsonb_build_object('day_of_week', 'monday', 'start_time', '10:00', 'end_time', '11:00'),
        jsonb_build_object('day_of_week', 'tuesday', 'start_time', '07:00', 'end_time', '08:00')),
      coalesce(v_det::text, 'NULL'));
    perform pg_temp.rec('P2 the helper is deterministic: the same call twice gives the same answer',
      public.membership_service_details(v_m5) = public.membership_service_details(v_m5)
      and public.membership_service_details(v_m5) = v_det, '');

    -- N. Nothing applicable --------------------------------------------------------------------------------
    select * into v_inv from public.invoices where membership_id = v_m4;
    perform pg_temp.rec('N1 no applicable enrollment: the receipt is issued, service_details is NULL (not an empty object) and the receipt is still tracked',
      v_inv.id is not null and v_inv.service_details is null and v_inv.service_details_tracked, coalesce(v_inv.service_details::text, 'NULL'));

    -- D. Later changes to the enrollment or schedule never alter an issued snapshot --------------------------
    select * into v_inv1 from public.invoices where membership_id = v_m1;
    v_number := v_inv1.invoice_number;
    v_before1 := to_jsonb(v_inv1) - v_synced;
    v_det := v_inv1.service_details;

    perform pg_temp.run_owner(format('update public.enrollment_schedules set effective_end_date = %L where batch_enrollment_id in (select id from public.batch_enrollments where student_id = %L)', v_today - 200, v_s1));
    perform pg_temp.run_owner(format('update public.batch_enrollments set status = ''inactive'', effective_end_date = %L where student_id = %L', v_today - 200, v_s1));
    perform pg_temp.run_owner(format('update public.schedules set start_time = ''05:00'', end_time = ''06:00'' where batch_id = %L and day_of_week = ''monday''', v_ba));
    perform pg_temp.run_owner(format('update public.batches set name = ''ZZVERIFY Alpha Renamed'' where id = %L', v_ba));
    select * into v_inv1 from public.invoices where membership_id = v_m1;
    perform pg_temp.rec('D1 enrollment ended, batch renamed, schedule time changed: the issued snapshot is byte-for-byte unchanged',
      v_inv1.service_details = v_det and public.membership_service_details(v_m1) is distinct from v_det,
      'the helper would now say ' || coalesce(public.membership_service_details(v_m1)::text, 'NULL'));

    -- E. Membership edits ------------------------------------------------------------------------------------
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = amount + 100 where id = %L', v_m1));
    select * into v_inv1 from public.invoices where membership_id = v_m1;
    perform pg_temp.rec('E1 an amount change follows to the receipt and preserves the snapshot',
      v_code = 'OK' and v_inv1.total_amount = 1100 and v_inv1.service_details = v_det, 'sqlstate ' || v_code);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''quarterly'' where id = %L', v_m1));
    select * into v_inv1 from public.invoices where membership_id = v_m1;
    perform pg_temp.rec('E2 a plan change follows (plan and wording) and preserves the snapshot',
      v_code = 'OK' and v_inv1.plan = 'quarterly' and v_inv1.description = 'Quarterly Membership' and v_inv1.service_details = v_det, 'sqlstate ' || v_code);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set end_date = end_date + 5 where id = %L', v_m1));
    select * into v_inv1 from public.invoices where membership_id = v_m1;
    perform pg_temp.rec('E3 an end-date change follows (period_end) and preserves the snapshot',
      v_code = 'OK' and v_inv1.period_end = (v_today - 100) + 29 + 5 and v_inv1.service_details = v_det, 'sqlstate ' || v_code);

    -- E4. A start-date change recomputes (M3: Beta at T-100, Alpha at T-400) --------------------------------------
    select * into v_inv3 from public.invoices where membership_id = v_m3;
    v_before3 := to_jsonb(v_inv3) - v_synced;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set start_date = %L, end_date = %L where id = %L', v_today - 400, v_today - 371, v_m3));
    select * into v_inv3b from public.invoices where membership_id = v_m3;
    perform pg_temp.rec('E4 a start-date change recomputes the snapshot for the new start date (Beta -> Alpha) on the SAME receipt',
      v_code = 'OK' and v_inv3b.id = v_inv3.id and v_inv3b.service_details -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY Alpha Renamed'
      and v_inv3b.service_details ->> 'as_of' = to_char(v_today - 400, 'YYYY-MM-DD') and v_inv3b.period_start = v_today - 400,
      'sqlstate ' || v_code || ', ' || coalesce(v_inv3b.service_details::text, 'NULL'));

    -- F. The financial synchronization is intact ---------------------------------------------------------------------
    perform pg_temp.rec('F1 the synchronized columns equal their membership after every edit (plan, wording, period, amount, tax)',
      (select bool_and(i.plan = m.plan and i.period_start = m.start_date and i.period_end = m.end_date
                       and i.total_amount = m.amount and i.taxable_amount is null and i.tax_amount is null)
       from public.invoices i join public.memberships m on m.id = i.membership_id where m.id in (v_m1, v_m3)),
      'M1 and M3');
    perform pg_temp.rec('F2 nothing else on the receipt moved: number, prefix, dates, tax settings, bank snapshot, customer and business are identical',
      (to_jsonb(v_inv1) - v_synced) = v_before1 and (to_jsonb(v_inv3b) - v_synced) = v_before3, 'compared as whole rows, without the eight synchronized columns');

    -- I. Number and count ------------------------------------------------------------------------------------------------
    perform pg_temp.rec('I1 the receipt number is unchanged by every edit, and no second receipt was created',
      v_inv1.invoice_number = v_number and v_inv3b.invoice_number = v_inv3.invoice_number
      and (select count(*) = 1 from public.invoices where membership_id = v_m1)
      and (select count(*) = 1 from public.invoices where membership_id = v_m3)
      and (select count(*) = 6 from public.invoices where membership_id in (v_m1, v_m2, v_m3, v_m4, v_m5, v_m6)),
      'number ' || v_inv1.invoice_number);

    -- T. A tracked receipt with NO details at issue can gain them when its start date moves ----------------
    -- S4 had no enrolment at T-100 (M4's receipt: tracked, NULL). Enrol S4 in Alpha at T-400 and move M4 there.
    v_e4 := pg_temp.enroll(v_s4, v_ba, v_today - 500, v_today - 300);
    for i in 1..5 loop perform pg_temp.assign(v_e4, v_sa[i], v_today - 500, v_today - 300); end loop;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = amount + 50 where id = %L', v_m4));
    select * into v_inv from public.invoices where membership_id = v_m4;
    perform pg_temp.rec('T1 an amount edit on that tracked-NULL receipt follows the amount and leaves service_details NULL',
      v_code = 'OK' and v_inv.total_amount = 1050 and v_inv.service_details is null and v_inv.service_details_tracked, 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set start_date = %L, end_date = %L where id = %L', v_today - 400, v_today - 371, v_m4));
    select * into v_inv from public.invoices where membership_id = v_m4;
    perform pg_temp.rec('T2 moving the start date to a date that has a class computes the snapshot (tracked receipt, NULL -> JSON)',
      v_code = 'OK' and v_inv.service_details is not null and v_inv.service_details_tracked
      and jsonb_array_length(v_inv.service_details -> 'batches') = 1 and v_inv.period_start = v_today - 400,
      'sqlstate ' || v_code || ', ' || coalesce(v_inv.service_details::text, 'NULL'));

    -- O. A receipt that existed BEFORE 0033 never gains details --------------------------------------------------
    -- Simulated: in this rolled-back transaction only, the freeze trigger is switched off to put M5's receipt
    -- back into the state a pre-0033 receipt has (tracked = false, service_details NULL), then switched on.
    select t.tgname into v_freeze_trg from pg_trigger t
      where t.tgrelid = 'public.invoices'::regclass and not t.tgisinternal
        and t.tgfoid = 'public.invoices_freeze_snapshot()'::regprocedure;
    v_code := case when v_freeze_trg is null then 'no trigger'
                   else pg_temp.run_owner(format('alter table public.invoices disable trigger %I', v_freeze_trg)) end;
    if v_code = 'OK' then
      v_code := pg_temp.run_owner(format('update public.invoices set service_details_tracked = false, service_details = null where membership_id = %L', v_m5));
      perform pg_temp.run_owner(format('alter table public.invoices enable trigger %I', v_freeze_trg));
    end if;
    if v_code <> 'OK' then
      perform pg_temp.skip('O1-O2 a pre-0033 receipt never gains details', 'could not simulate a pre-0033 receipt (' || v_code || '); the owner role cannot switch the trigger off here');
    else
      select * into v_inv from public.invoices where membership_id = v_m5;
      v_before := to_jsonb(v_inv) - v_synced;
      v_code := pg_temp.run_as(v_admin, format('update public.memberships set start_date = %L, end_date = %L where id = %L', v_today - 400, v_today - 371, v_m5));
      select * into v_inv2 from public.invoices where membership_id = v_m5;
      perform pg_temp.rec('O1 a start-date edit on a pre-0033 receipt (untracked, NULL) does NOT create service details',
        v_code = 'OK' and v_inv2.service_details is null and not v_inv2.service_details_tracked,
        'sqlstate ' || v_code || ', ' || coalesce(v_inv2.service_details::text, 'NULL'));
      perform pg_temp.rec('O2 ...yet its financial columns still follow the membership and nothing else moved',
        v_inv2.period_start = v_today - 400 and v_inv2.period_end = v_today - 371 and v_inv2.id = v_inv.id
        and (to_jsonb(v_inv2) - v_synced) = v_before, 'the seven synchronized columns follow; the marker stays false');
    end if;

    -- G. The column cannot be edited by hand -------------------------------------------------------------------------
    v_code := pg_temp.run_owner(format('update public.invoices set service_details = null where membership_id = %L', v_m1));
    perform pg_temp.rec('G1 service_details cannot be changed directly, even by the owner (the freeze trigger, 55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set service_details = null where membership_id = %L', v_m1));
    perform pg_temp.rec('G2 nor by an Admin through the API (refused)', v_code <> 'OK', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set description = ''x'' where membership_id = %L', v_m1));
    v_code := pg_temp.run_owner(format('update public.invoices set service_details_tracked = false where membership_id = %L', v_m1));
    perform pg_temp.rec('G4 the marker cannot be changed afterwards, even by the owner (the freeze trigger, 55006)', v_code = '55006', 'sqlstate ' || v_code);
    perform pg_temp.rec('G3 the general freeze is intact: another column outside the synchronization is still refused (55006)', v_code = '55006', 'sqlstate ' || v_code);

    -- H. The helper is internal ----------------------------------------------------------------------------------------
    v_code := pg_temp.run_as(v_admin, format('select public.membership_service_details(%L)', v_m1));
    perform pg_temp.rec('H1 an Admin cannot call the helper (42501)', v_code = '42501', 'sqlstate ' || v_code);
    if v_instructor is null then
      perform pg_temp.skip('H2 instructor cannot call the helper', 'no instructor profile found');
    else
      v_code := pg_temp.run_as(v_instructor, format('select public.membership_service_details(%L)', v_m1));
      perform pg_temp.rec('H2 an Instructor cannot call the helper (42501)', v_code = '42501', 'sqlstate ' || v_code);
    end if;
    v_code := pg_temp.run_anon(format('select public.membership_service_details(%L)', v_m1));
    perform pg_temp.rec('H3 an anonymous caller cannot call the helper (42501)', v_code = '42501', 'sqlstate ' || v_code);
  end if;

  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i where i.id = any(v_ids0);
  perform pg_temp.rec('Z1 every pre-existing receipt is byte-for-byte unchanged (and still has NULL service details)',
    v_hash0 = v_hash1 and not exists (select 1 from public.invoices i where i.id = any(v_ids0) and i.service_details is not null),
    v_count0 || ' receipt(s) fingerprinted');
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

-- ===========================================================================
-- AFTER THE ROLLBACK - confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above (commented out so the grid stays the last result).
--
--   select
--     (select count(*) from public.invoices)                                              as receipts,
--     (select count(*) from public.students where full_name like 'ZZVERIFY%')             as leftover_fixture_students,
--     (select count(*) from public.batches where name like 'ZZVERIFY%')                   as leftover_fixture_batches,
--     (select count(*) from public.instructors where full_name like 'ZZVERIFY%')          as leftover_fixture_instructors,
--     (select next_invoice_number from public.invoice_settings)                           as next_invoice_number;
--
-- receipts and next_invoice_number must equal their values before; every leftover count must be 0.
-- ===========================================================================
