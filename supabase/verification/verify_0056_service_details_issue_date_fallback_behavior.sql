-- ===========================================================================
-- Migration 0056 verification (behaviour) - service details of a NEW document: the start date, else the date of issue
-- Exercises supabase/migrations/0056_service_details_issue_date_fallback.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0056 is applied (membership_service_details has the issue-date fallback).   PF  Preflight: no fixture name exists.
--   A   The function is SECURITY DEFINER with an empty search_path, and no client role (not even an Admin) can call it.
--   D   Details found at the membership START date are unchanged: the batch, its slots in day / time order, "as_of" = the start date,
--       one schedule version per series (no duplicates), and the shape (version, as_of, batches[batch_id, name, code, slots]).
--   F   Details found ONLY at the date of issue: a membership that starts after the student's enrollment ended - the INV-831 case -
--       now gets the batch and its schedule, "as_of" = today.
--   M   Several batches: all listed once, ordered by name, each with its own slots, no duplicates.
--   P   Precedence: when the start date finds a batch, the issue date is NOT consulted (a batch that applies only today is absent).
--   N   Nothing at either date: NULL (the document keeps the generic description and period). An unknown membership: NULL.
--   E   A membership that starts today uses the one date.
--   Q   First documents: a payment document and a membership-level receipt issued with the fallback store the details (tracked); one with
--       none stores NULL, tracked, and keeps "Monthly Membership" and its period.
--   R   Replacements (0055) preserve the ORIGINAL's snapshot exactly: details survive even after the enrollment is deactivated, and an
--       EMPTY snapshot stays empty even though the live helper would now find details (the INV-831 -> INV-837 situation). The original is
--       unchanged except its cancellation fields.
--   Z   Everything that existed before this script (documents, payments, memberships) is unchanged.
--
-- PREREQUISITES: migrations 0033, 0034-0044, 0048-0051, 0055 and 0056 applied; an Admin profile and the centre profile. If numbering is
-- not configured it is set inside the transaction only.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction ending in ROLLBACK. It creates its OWN disposable fixtures (an instructor, batches, schedules, students named
--   'ZZVERIFY 0056 ...', their enrollments, memberships, payments and documents) and touches no real record. The pre-existing documents,
--   payments and memberships are fingerprinted first and compared at the end (Z1). One side effect rollback cannot undo: YC- / MEM-
--   codes come from sequences, so each run leaves a small gap. No row remains.
--   Run the whole file in one go. If the editor reports an open transaction, issue `rollback;` first.
--
-- LIMITATIONS
--   Concurrency cannot be staged in one transaction. The renderer and the correction page are not exercised here (the unit tests pin them).
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED, INFO.
-- ===========================================================================

begin;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _pre_ids (tbl text, id uuid) on commit drop;

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

create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

create function pg_temp.scalar_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create function pg_temp.as_user(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_amount text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, false)::text',
    p_membership, p_date, format('[{"method":"cash","amount":"%s"}]', p_amount)));
end $f$;

create function pg_temp.issue(p_admin uuid, p_payment uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format('select public.issue_payment_document(%L::uuid)::text', p_payment));
end $f$;

create function pg_temp.corr(p_admin uuid, p_doc uuid, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format('select public.correct_and_reissue_payment_document(%L::uuid, %L)::text', p_doc, p_reason));
end $f$;

create function pg_temp.inv_hash(p_id uuid, p_drop text[])
returns text language sql as $f$
  select md5((to_jsonb(i) - p_drop)::text) from public.invoices i where i.id = p_id
$f$;

-- The details of a membership as the helper returns them now (an owner call: the function has no client grant).
create function pg_temp.details(p_membership uuid)
returns jsonb language sql as $f$
  select public.membership_service_details(p_membership)
$f$;

-- Fixture builders (owner).
create function pg_temp.mk_series(p_batch uuid, p_instr uuid, p_day text, p_start time, p_end time, p_from date, p_until date)
returns uuid language plpgsql as $f$
declare
  v_series uuid;
begin
  insert into public.schedule_series (batch_id) values (p_batch) returning id into v_series;
  insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
  values (p_batch, p_instr, p_day, p_start, p_end, p_from, p_until, 'active', v_series);
  return v_series;
end $f$;

create function pg_temp.enroll(p_student uuid, p_batch uuid, p_from date, p_until date, p_series uuid[])
returns uuid language plpgsql as $f$
declare
  v_id uuid;
  v_s  uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date)
  values (p_student, p_batch, p_from, p_until) returning id into v_id;
  foreach v_s in array p_series loop
    insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date)
    values (v_id, v_s, p_from, null);
  end loop;
  return v_id;
end $f$;

create function pg_temp.student(p_name text, p_phone text, p_join date)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0056 ' || p_name, p_phone, '+91', p_join, 'active') returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.membership(p_student uuid, p_start date, p_currency text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
  values (p_student, 'monthly', p_start, p_start + 30, 1000, 'pending', p_currency) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.world()
returns text language sql as $f$
  select md5(
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.invoices t where t.id in (select id from _pre_ids where tbl = 'invoices')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.membership_payments t where t.id in (select id from _pre_ids where tbl = 'payments')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.memberships t where t.id in (select id from _pre_ids where tbl = 'memberships')), ''))
$f$;

do $$
declare
  v_admin    uuid;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_currency text;
  v_ready    boolean;
  v_clash    integer := 0;
  v_world0   text;
  v_r        text;
  v_c        text;
  v_h0       text;
  v_h1       text;
  v_err      text;
  v_ok       boolean := false;
  v_d        jsonb;
  v_orig     public.invoices%rowtype;
  v_inv      public.invoices%rowtype;
  f_instr uuid; f_alpha uuid; f_beta uuid;
  sa1 uuid; sa2 uuid; sb uuid; sa_old uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s7 uuid; s8 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m7 uuid; m8 uuid;
  e2 uuid; e3 uuid;
  p2 uuid; p3 uuid; d2 uuid; d3 uuid; dm8 uuid; r2 uuid; r3 uuid;
  v_start2 date := v_today + 200;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;

  v_ready := to_regprocedure('public.membership_service_details(uuid)') is not null
         and position('v_dates' in pg_get_functiondef(to_regprocedure('public.membership_service_details(uuid)'))) > 0
         and to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)') is not null;
  perform pg_temp.rec('P0 migration 0056 is applied (the helper tries the start date, then the date of issue) on top of 0055', coalesce(v_ready, false),
    case when coalesce(v_ready, false) then '' else 'apply 0055 and 0056 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if v_ready then
    select count(*) into v_clash from public.students where position('ZZVERIFY 0056' in full_name) = 1;
    perform pg_temp.rec('PF no student already has a fixture name (ZZVERIFY 0056 ...)', v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing student(s) clash - nothing was created' end);
    insert into _pre_ids select 'invoices', id from public.invoices;
    insert into _pre_ids select 'payments', id from public.membership_payments;
    insert into _pre_ids select 'memberships', id from public.memberships;
    v_world0 := pg_temp.world();
    perform pg_temp.info('SETUP', format('documents=%s payments=%s memberships=%s reserved invoice numbers=%s reserved receipt numbers=%s',
      (select count(*) from public.invoices), (select count(*) from public.membership_payments), (select count(*) from public.memberships),
      (select count(*) from public.invoice_number_reservations), (select count(*) from public.payment_receipt_number_reservations)));
  end if;

  if not v_ready then
    perform pg_temp.skip('A / D / F / M / P / N / E / Q / R / Z', 'migration 0056 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('A / D / F / M / P / N / E / Q / R / Z', 'preflight PF failed');
  elsif v_admin is null or v_currency is null then
    perform pg_temp.skip('A / D / F / M / P / N / E / Q / R / Z', 'needs an Admin profile and the centre profile');
  else
    -- Numbering inside this transaction only, if it is not configured.
    if (select starting_invoice_number from public.invoice_settings where singleton) is null then
      perform pg_temp.code('update public.invoice_settings set starting_invoice_number = 990001 where singleton');
    end if;
    if (select payment_receipt_starting_number from public.invoice_settings where singleton) is null then
      perform pg_temp.code('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton');
    end if;

    -- A. The function's properties --------------------------------------------------------------------------------------------
    perform pg_temp.rec('A1 membership_service_details is SECURITY DEFINER with an empty search_path',
      (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
         from pg_proc p where p.oid = to_regprocedure('public.membership_service_details(uuid)')), '');
    v_c := pg_temp.as_user(v_admin, 'select public.membership_service_details(gen_random_uuid())');
    perform pg_temp.rec('A2 no client role can call it, not even an Admin (42501)', v_c = '42501', v_c);

    -- Fixtures ------------------------------------------------------------------------------------------------------------------
    begin
      insert into public.instructors (full_name) values ('ZZVERIFY 0056 Instructor') returning id into f_instr;
      insert into public.batches (name, code) values ('ZZVERIFY 0056 Alpha', 'ZZ56A') returning id into f_alpha;
      insert into public.batches (name, code) values ('ZZVERIFY 0056 Beta', 'ZZ56B') returning id into f_beta;
      -- Alpha: Monday 08:15-09:15 (with an OLDER version of the same series, which must not appear) and Wednesday 08:15-09:15. Beta: Saturday 07:00-08:00.
      sa1 := pg_temp.mk_series(f_alpha, f_instr, 'monday', '08:15', '09:15', v_today - 500, null);
      insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
      values (f_alpha, f_instr, 'monday', '06:00', '07:00', v_today - 1000, v_today - 501, 'active', sa1);
      sa2 := pg_temp.mk_series(f_alpha, f_instr, 'wednesday', '08:15', '09:15', v_today - 500, null);
      sb := pg_temp.mk_series(f_beta, f_instr, 'saturday', '07:00', '08:00', v_today - 500, null);

      s1 := pg_temp.student('S1 start date', '9000000061', v_today - 400);
      s2 := pg_temp.student('S2 issue date', '9000000062', v_today - 400);
      s3 := pg_temp.student('S3 none', '9000000063', v_today - 400);
      s4 := pg_temp.student('S4 two batches', '9000000064', v_today - 400);
      s5 := pg_temp.student('S5 precedence', '9000000065', v_today - 400);
      s7 := pg_temp.student('S7 starts today', '9000000067', v_today - 400);
      s8 := pg_temp.student('S8 receipt', '9000000068', v_today - 400);

      m1 := pg_temp.membership(s1, v_today - 20, v_currency);
      m2 := pg_temp.membership(s2, v_start2, v_currency);
      m3 := pg_temp.membership(s3, v_start2, v_currency);
      m4 := pg_temp.membership(s4, v_start2, v_currency);
      m5 := pg_temp.membership(s5, v_start2, v_currency);
      m7 := pg_temp.membership(s7, v_today, v_currency);
      m8 := pg_temp.membership(s8, v_start2, v_currency);

      -- S1: Alpha, open-ended, covers the membership start date.
      perform pg_temp.enroll(s1, f_alpha, v_today - 60, null, array[sa1, sa2]);
      -- S2: Alpha, ends BEFORE the membership starts but covers today (the INV-831 situation).
      e2 := pg_temp.enroll(s2, f_alpha, v_today - 60, v_today + 30, array[sa1, sa2]);
      -- S3: Alpha, starts AFTER both the membership start and today: nothing applies at either date.
      e3 := pg_temp.enroll(s3, f_alpha, v_today + 300, null, array[sa1, sa2]);
      -- S4: Alpha and Beta, both end before the membership starts, both cover today.
      perform pg_temp.enroll(s4, f_alpha, v_today - 60, v_today + 30, array[sa1, sa2]);
      perform pg_temp.enroll(s4, f_beta, v_today - 60, v_today + 30, array[sb]);
      -- S5: Alpha covers the membership start; Beta ends before it (it applies only today).
      perform pg_temp.enroll(s5, f_alpha, v_today - 60, null, array[sa1]);
      perform pg_temp.enroll(s5, f_beta, v_today - 60, v_today + 30, array[sb]);
      -- S7: Alpha, covers today (the membership starts today).
      perform pg_temp.enroll(s7, f_alpha, v_today - 60, null, array[sa1]);
      -- S8: Alpha, ends before the membership starts, covers today.
      perform pg_temp.enroll(s8, f_alpha, v_today - 60, v_today + 30, array[sa2]);
      v_ok := true;
    exception when others then
      v_ok := false;
      v_err := sqlstate || ' ' || sqlerrm;
    end;

    if not v_ok then
      perform pg_temp.skip('D / F / M / P / N / E / Q / R', 'the fixtures could not be built: ' || coalesce(v_err, 'unknown'));
    else
      -- D. Found at the start date: unchanged ----------------------------------------------------------------------------------
      v_d := pg_temp.details(m1);
      perform pg_temp.rec('D1 details found at the membership START date: the batch and its Monday and Wednesday slots in day order, one version per series',
        v_d is not null and v_d ->> 'version' = '1' and jsonb_array_length(v_d -> 'batches') = 1
        and v_d -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha' and v_d -> 'batches' -> 0 ->> 'code' = 'ZZ56A'
        and jsonb_array_length(v_d -> 'batches' -> 0 -> 'slots') = 2
        and v_d -> 'batches' -> 0 -> 'slots' -> 0 = '{"day_of_week":"monday","start_time":"08:15","end_time":"09:15"}'::jsonb
        and v_d -> 'batches' -> 0 -> 'slots' -> 1 = '{"day_of_week":"wednesday","start_time":"08:15","end_time":"09:15"}'::jsonb, coalesce(v_d::text, 'NULL'));
      perform pg_temp.rec('D2 its "as_of" is the membership start date, and the shape is exactly version / as_of / batches[batch_id, name, code, slots]',
        v_d ->> 'as_of' = to_char(v_today - 20, 'YYYY-MM-DD')
        and (select array_agg(k order by k) from jsonb_object_keys(v_d) k) = array['as_of', 'batches', 'version']
        and (select array_agg(k order by k) from jsonb_object_keys(v_d -> 'batches' -> 0) k) = array['batch_id', 'code', 'name', 'slots'], coalesce(v_d ->> 'as_of', ''));

      -- F. Found only at the date of issue -----------------------------------------------------------------------------------------
      v_d := pg_temp.details(m2);
      perform pg_temp.rec('F1 a membership that starts after the enrollment ended now gets the batch and its schedule from TODAY',
        v_d is not null and jsonb_array_length(v_d -> 'batches') = 1 and v_d -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha'
        and jsonb_array_length(v_d -> 'batches' -> 0 -> 'slots') = 2, coalesce(v_d::text, 'NULL'));
      perform pg_temp.rec('F2 its "as_of" says which date was used: today, not the membership start date',
        v_d ->> 'as_of' = to_char(v_today, 'YYYY-MM-DD') and v_d ->> 'as_of' <> to_char(v_start2, 'YYYY-MM-DD'), coalesce(v_d ->> 'as_of', ''));

      -- M. Several batches --------------------------------------------------------------------------------------------------------
      v_d := pg_temp.details(m4);
      perform pg_temp.rec('M1 two batches are both listed once, ordered by name (Alpha then Beta), each with its own slots and no duplicates',
        v_d is not null and jsonb_array_length(v_d -> 'batches') = 2
        and v_d -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha' and jsonb_array_length(v_d -> 'batches' -> 0 -> 'slots') = 2
        and v_d -> 'batches' -> 1 ->> 'name' = 'ZZVERIFY 0056 Beta' and jsonb_array_length(v_d -> 'batches' -> 1 -> 'slots') = 1
        and v_d -> 'batches' -> 1 -> 'slots' -> 0 = '{"day_of_week":"saturday","start_time":"07:00","end_time":"08:00"}'::jsonb
        and (select count(distinct b ->> 'batch_id') = 2 from jsonb_array_elements(v_d -> 'batches') b), coalesce(v_d::text, 'NULL'));

      -- P. Precedence ---------------------------------------------------------------------------------------------------------------
      v_d := pg_temp.details(m5);
      perform pg_temp.rec('P1 when the start date finds a batch, the issue date is NOT consulted: Alpha only, "as_of" = the start date, Beta (applies only today) absent',
        v_d is not null and jsonb_array_length(v_d -> 'batches') = 1 and v_d -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha'
        and v_d ->> 'as_of' = to_char(v_start2, 'YYYY-MM-DD') and jsonb_array_length(v_d -> 'batches' -> 0 -> 'slots') = 1, coalesce(v_d::text, 'NULL'));

      -- N. Nothing at either date -----------------------------------------------------------------------------------------------------
      perform pg_temp.rec('N1 no enrollment applies at the start date or today: NULL (the document keeps its generic description)', pg_temp.details(m3) is null, '');
      perform pg_temp.rec('N2 an unknown membership: NULL', pg_temp.details(gen_random_uuid()) is null, '');

      -- E. A membership that starts today -----------------------------------------------------------------------------------------------
      v_d := pg_temp.details(m7);
      perform pg_temp.rec('E1 a membership that starts today uses the one date: details found, "as_of" = today',
        v_d is not null and v_d ->> 'as_of' = to_char(v_today, 'YYYY-MM-DD') and jsonb_array_length(v_d -> 'batches' -> 0 -> 'slots') = 1, coalesce(v_d::text, 'NULL'));

      -- Q. First documents ------------------------------------------------------------------------------------------------------------------
      p2 := pg_temp.as_uuid(pg_temp.pay(v_admin, m2, v_today - 1, '1000'));
      d2 := pg_temp.as_uuid(pg_temp.issue(v_admin, p2));
      select * into v_orig from public.invoices where id = d2;
      perform pg_temp.rec('Q1 the FIRST document of the issue-date membership stores the batch and schedule (tracked), with the plan wording and its own period',
        d2 is not null and v_orig.service_details_tracked and v_orig.service_details -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha'
        and jsonb_array_length(v_orig.service_details -> 'batches' -> 0 -> 'slots') = 2
        and v_orig.description = 'Monthly Membership' and v_orig.period_start = v_start2 and v_orig.period_end = v_start2 + 30,
        coalesce(v_orig.service_details::text, 'NULL'));

      p3 := pg_temp.as_uuid(pg_temp.pay(v_admin, m3, v_today - 1, '1000'));
      d3 := pg_temp.as_uuid(pg_temp.issue(v_admin, p3));
      select * into v_inv from public.invoices where id = d3;
      perform pg_temp.rec('Q2 with no details at either date the document is tracked, stores NULL, and keeps "Monthly Membership" and its period',
        d3 is not null and v_inv.service_details_tracked and v_inv.service_details is null
        and v_inv.description = 'Monthly Membership' and v_inv.period_start = v_start2 and v_inv.period_end = v_start2 + 30, '');

      v_c := pg_temp.as_user(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', m8));
      select id into dm8 from public.invoices where membership_id = m8 and payment_id is null;
      perform pg_temp.rec('Q3 a FIRST membership-level receipt uses the same rule: details found at the date of issue are stored',
        dm8 is not null and (select service_details_tracked and service_details -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0056 Alpha'
                               from public.invoices where id = dm8), 'v_c=' || v_c);

      -- R. Replacements preserve the original snapshot ------------------------------------------------------------------------------------
      -- The first student's enrollment is deactivated: the helper now finds NOTHING for that membership at either date.
      v_c := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'' where id = %L', e2));
      v_h0 := pg_temp.inv_hash(d2, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
      v_r := pg_temp.corr(v_admin, d2, 'Correct the customer name');
      r2 := pg_temp.as_uuid(v_r);
      select * into v_inv from public.invoices where id = r2;
      perform pg_temp.rec('R1 the replacement keeps the original snapshot exactly - the same batch and slots - although the live helper now finds nothing',
        v_c = 'OK' and r2 is not null and pg_temp.details(m2) is null
        and v_inv.service_details is not distinct from v_orig.service_details and v_inv.service_details is not null
        and v_inv.service_details_tracked = v_orig.service_details_tracked and v_inv.replaces_id = d2
        and v_inv.plan = v_orig.plan and v_inv.description = v_orig.description
        and v_inv.period_start = v_orig.period_start and v_inv.period_end = v_orig.period_end, v_c || ' ' || v_r);
      perform pg_temp.rec('R2 the original is unchanged except its cancellation fields',
        pg_temp.inv_hash(d2, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h0
        and (select status from public.invoices where id = d2) = 'cancelled', '');

      -- The third student's enrollment now starts before today: the live helper WOULD find details; the empty snapshot must stay empty.
      v_c := pg_temp.code(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 5, e3));
      if v_c <> 'OK' then
        perform pg_temp.skip('R3 an EMPTY snapshot stays empty after the live data would give details', 'the enrollment could not be moved: ' || v_c);
      else
        select * into v_orig from public.invoices where id = d3;
        v_h1 := pg_temp.inv_hash(d3, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
        v_r := pg_temp.corr(v_admin, d3, 'Correct the customer name');
        r3 := pg_temp.as_uuid(v_r);
        select * into v_inv from public.invoices where id = r3;
        perform pg_temp.rec('R3 an EMPTY snapshot stays empty: the helper would now find the batch, but the replacement keeps NULL, tracked, and the original dates (the INV-831 -> INV-837 rule)',
          r3 is not null and pg_temp.details(m3) is not null
          and v_inv.service_details is null and v_inv.service_details_tracked and v_inv.replaces_id = d3
          and v_inv.description = v_orig.description and v_inv.period_start = v_orig.period_start and v_inv.period_end = v_orig.period_end
          and pg_temp.inv_hash(d3, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h1, v_r);
      end if;
    end if;

    -- Z. Everything that existed before is unchanged --------------------------------------------------------------------------------------
    perform pg_temp.rec('Z1 every document, payment and membership that existed before this script is byte-for-byte unchanged',
      v_world0 = pg_temp.world(), '');
  end if;
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 and count(*) filter (where status = 'NOT TESTED') = 0 then 'ALL PASS'
       when count(*) filter (where status = 'FAIL') = 0 then 'INCOMPLETE' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- ===========================================================================
-- AFTER THE ROLLBACK - confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above. Deliberately commented out: as a live statement it would become the editor's last result set
-- and hide the grid.
--
--   select
--     (select count(*) from public.invoices)                                   as documents,
--     (select count(*) from public.membership_payments)                        as payments,
--     (select count(*) from public.memberships)                                as memberships,
--     (select count(*) from public.invoice_number_reservations)                as reserved_invoice_numbers,
--     (select count(*) from public.payment_receipt_number_reservations)        as reserved_receipt_numbers,
--     (select count(*) from public.students where position('ZZVERIFY 0056' in full_name) = 1) as leftover_fixture_students,
--     (select count(*) from public.batches where position('ZZVERIFY 0056' in name) = 1)       as leftover_fixture_batches,
--     (select count(*) from public.instructors where position('ZZVERIFY 0056' in full_name) = 1) as leftover_fixture_instructors;
--
-- The first five counts must equal the SETUP row above, and the three leftover_* counts must be 0. (The YC- / MEM- sequences will have
-- moved on: see the header.)
-- ===========================================================================
