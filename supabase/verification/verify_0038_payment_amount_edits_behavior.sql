-- ===========================================================================
-- Migration 0038 verification (behaviour) - Editing a payment's amount before its document is issued
-- Exercises supabase/migrations/0038_payment_amount_edits.sql
-- ===========================================================================
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only: one student, one membership of 1000, two payments, their edits and their
--     documents. No existing payment, edit or document is touched; existing ones are fingerprinted and checked.
--   * If a numbering sequence is not configured yet, the script configures it for this run only (rolled back).
--   * It holds the invoice_settings row lock until it ends: run it when no one is issuing documents.
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
--   * NOT COVERED - CONCURRENCY: the fix that makes an issue waiting on the membership lock re-read an edited payment
--     needs two database sessions racing each other, with the first one's transaction held open. That cannot be done
--     safely in the Supabase SQL Editor (each request is its own session; a transaction cannot be held open across
--     requests, and committed test data cannot be rolled back). It is NOT tested and NOT verified by this script. It
--     stays a documented limitation unless a separate disposable/staging database and a multi-session PostgreSQL
--     client (e.g. two psql sessions) are available.
--   * Run after migrations 0034-0038 are applied.
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

-- A returned id as uuid, or NULL when the call returned 'ERR:<sqlstate>' (so a failure is reported, never raised).
create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
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

-- A disposable student (ZZVERIFY) with one Pending membership of p_amount; returns the membership id.
create function pg_temp.fixture(p_label text, p_phone text, p_amount numeric, p_tax_default boolean default true)
returns uuid language plpgsql as $f$
declare
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_student uuid;
  v_mem     uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status, tax_invoice_default)
  values ('ZZVERIFY ' || p_label, p_phone, '+91', v_today - 400, 'active', p_tax_default)
  returning id into v_student;

  insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
  values (v_student, 'monthly', v_today - 20, v_today + 9, p_amount, 'pending', 'INR')
  returning id into v_mem;

  return v_mem;
end $f$;

-- Records a payment as p_admin; returns the payment id, or 'ERR:<sqlstate>'.
create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_methods text, p_tax text default 'null')
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %s::boolean)::text',
    p_membership, p_date, p_methods, p_tax));
end $f$;

-- Edits a payment as p_user; returns the payment id, or 'ERR:<sqlstate>'.
create function pg_temp.edit(p_user uuid, p_payment uuid, p_allocations jsonb)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.edit_payment_amount(%L::uuid, %L::jsonb)::text', p_payment, p_allocations::text));
end $f$;

-- A fingerprint of everything an edit may change for one membership: its row, its payments, their methods and edits.
create function pg_temp.state(p_membership uuid)
returns text language sql as $f$
  select md5(
    (select to_jsonb(m)::text from public.memberships m where m.id = p_membership) || '|' ||
    coalesce((select string_agg(to_jsonb(p)::text, '|' order by p.id) from public.membership_payments p where p.membership_id = p_membership), '') || '|' ||
    coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.membership_payment_methods x
              join public.membership_payments p on p.id = x.payment_id where p.membership_id = p_membership), '') || '|' ||
    coalesce((select string_agg(to_jsonb(e)::text, '|' order by e.id) from public.membership_payment_edits e
              join public.membership_payments p on p.id = e.payment_id where p.membership_id = p_membership), ''))
$f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m          uuid;
  v_p1         uuid;
  v_p2         uuid;
  v_cash1      uuid;   -- P1's cash method
  v_upi1       uuid;   -- P1's UPI method
  v_cash2      uuid;   -- P2's only method
  v_out        text;
  v_code       text;
  v_set        public.invoice_settings%rowtype;
  v_methods0   jsonb;
  v_edit       public.membership_payment_edits%rowtype;
  v_snap       text;
  v_doc        public.invoices%rowtype;
  v_pay_hash0  text;
  v_pay_hash1  text;
  v_edit_hash0 text;
  v_edit_hash1 text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash0 from public.membership_payments p;
  select md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by e.id), '')) into v_edit_hash0 from public.membership_payment_edits e;

  -- Numbering for this run only (rolled back): only where a sequence is not configured yet.
  select * into v_set from public.invoice_settings where singleton;
  if v_set.starting_invoice_number is null then
    perform pg_temp.info('SETUP', 'invoice numbering was not configured; set to 990001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set starting_invoice_number = 990001 where singleton'));
  end if;
  if v_set.payment_receipt_starting_number is null then
    perform pg_temp.info('SETUP', 'payment receipt numbering was not configured; set to 880001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton'));
  end if;

  begin
    v_m := pg_temp.fixture('0038', '9000380001', 1000);
  exception when others then
    v_m := null;
    v_err := sqlstate || ' ' || sqlerrm;
  end;

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_m is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  else
    -- Setup: P1 = cash 300 + UPI 200 (with a reference and notes), P2 = cash 500. The membership is Paid.
    v_p1 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 3,
      '[{"method":"cash","amount":"300"},{"method":"upi","amount":"200","reference_id":"ZZ-UPI-38","notes":"ZZ note"}]', 'true'));
    v_p2 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 1, '[{"method":"cash","amount":"500"}]', 'false'));
    select id into v_cash1 from public.membership_payment_methods where payment_id = v_p1 and method = 'cash';
    select id into v_upi1 from public.membership_payment_methods where payment_id = v_p1 and method = 'upi';
    select id into v_cash2 from public.membership_payment_methods where payment_id = v_p2;
    select jsonb_agg(jsonb_build_object('method', method, 'reference_id', reference_id, 'notes', notes, 'position', position) order by position)
      into v_methods0 from public.membership_payment_methods where payment_id = v_p1;
    perform pg_temp.rec('S0 setup: two payments (500 + 500), the membership is Paid on the later date',
      v_p1 is not null and v_p2 is not null and v_cash1 is not null and v_upi1 is not null
      and (select payment_status = 'paid' and payment_date = v_today - 1 from public.memberships where id = v_m), '');

    if v_p1 is null or v_p2 is null then
      perform pg_temp.skip('E1-E9', 'the setup payments could not be recorded');
    else
      -- E1. Reducing a payment: status and date follow, the edit is audited ---------------------------------------------
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '100')));
      perform pg_temp.rec('E1a an Admin reduces P1 from 500 to 400 (UPI 200 -> 100)',
        v_out = v_p1::text and (select amount from public.membership_payments where id = v_p1) = 400
        and (select amount from public.membership_payment_methods where id = v_upi1) = 100
        and (select amount from public.membership_payment_methods where id = v_cash1) = 300, coalesce(v_out, 'NULL'));
      perform pg_temp.rec('E1b the membership drops to Partially Paid and loses its payment date',
        (select payment_status = 'partially_paid' and payment_date is null from public.memberships where id = v_m), '');
      select * into v_edit from public.membership_payment_edits where payment_id = v_p1 order by edited_at desc, id desc limit 1;
      perform pg_temp.rec('E1c one audit row: this Admin, 500 -> 400, every method''s previous and new amount',
        (select count(*) from public.membership_payment_edits where payment_id = v_p1) = 1
        and v_edit.edited_by = v_admin and v_edit.previous_amount = 500 and v_edit.new_amount = 400
        and jsonb_array_length(v_edit.previous_allocations) = 2 and jsonb_array_length(v_edit.new_allocations) = 2
        and (select (e ->> 'amount')::numeric from jsonb_array_elements(v_edit.previous_allocations) e where e ->> 'id' = v_upi1::text) = 200
        and (select (e ->> 'amount')::numeric from jsonb_array_elements(v_edit.new_allocations) e where e ->> 'id' = v_upi1::text) = 100, '');
      perform pg_temp.rec('E1d method types, order, references and notes are untouched',
        (select jsonb_agg(jsonb_build_object('method', method, 'reference_id', reference_id, 'notes', notes, 'position', position) order by position)
         from public.membership_payment_methods where payment_id = v_p1) = v_methods0, '');
      perform pg_temp.rec('E1e P2 is untouched', (select amount from public.membership_payments where id = v_p2) = 500, '');

      -- E2. Back to the full amount: Paid again, dated by the latest payment ---------------------------------------------------
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '200')));
      perform pg_temp.rec('E2 raising P1 back to 500 makes the membership Paid, dated by the latest payment (P2''s date)',
        v_out = v_p1::text
        and (select payment_status = 'paid' and payment_date = v_today - 1 from public.memberships where id = v_m)
        and (select count(*) from public.membership_payment_edits where payment_id = v_p1) = 2, coalesce(v_out, 'NULL'));

      -- E3-E5. Refusals change nothing; a no-change edit is not audited ------------------------------------------------------------
      v_snap := pg_temp.state(v_m);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '200.01')));
      perform pg_temp.rec('E3 more than the outstanding balance is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300')));
      perform pg_temp.rec('E4a leaving out one of the payment''s methods is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                             jsonb_build_object('id', v_cash2, 'amount', '100')));
      perform pg_temp.rec('E4b another payment''s method is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '150'),
                                                             jsonb_build_object('id', v_cash1, 'amount', '150')));
      perform pg_temp.rec('E4c the same method twice is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '0'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '200')));
      perform pg_temp.rec('E4d a zero amount is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '100.005'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '200')));
      perform pg_temp.rec('E4e three decimals are refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, '[]'::jsonb);
      perform pg_temp.rec('E4f an empty allocation is refused (22023)', v_out = 'ERR:22023', v_out);
      perform pg_temp.rec('E4g ... and none of the refusals changed the membership, payments, methods or audit trail',
        pg_temp.state(v_m) = v_snap, '');
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '200')));
      perform pg_temp.rec('E5 an edit that changes nothing succeeds and writes no audit row',
        v_out = v_p1::text and pg_temp.state(v_m) = v_snap, coalesce(v_out, 'NULL'));

      -- E7-E8. Authorization and the audit trail's protection ---------------------------------------------------------------------
      if v_instructor is null then
        perform pg_temp.skip('E8a instructor', 'no instructor profile found');
      else
        v_out := pg_temp.edit(v_instructor, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                                    jsonb_build_object('id', v_upi1, 'amount', '100')));
        perform pg_temp.rec('E8a an Instructor cannot edit a payment (42501)', v_out = 'ERR:42501', v_out);
        v_out := pg_temp.query_as(v_instructor, 'select count(*)::text from public.membership_payment_edits');
        perform pg_temp.rec('E8b an Instructor sees no audit rows', v_out = '0', v_out);
      end if;
      v_code := pg_temp.run_anon(format('select public.edit_payment_amount(%L::uuid, ''[]''::jsonb)', v_p1));
      perform pg_temp.rec('E8c an anonymous caller cannot edit a payment (42501)', v_code = '42501', v_code);
      v_out := pg_temp.query_as(v_admin, format('select count(*)::text from public.membership_payment_edits where payment_id = %L', v_p1));
      perform pg_temp.rec('E7a an Admin can read the audit trail', v_out = '2', v_out);
      v_code := pg_temp.run_as(v_admin, format(
        'insert into public.membership_payment_edits (payment_id, previous_amount, new_amount, previous_allocations, new_allocations) values (%L, 1, 1, ''[]'', ''[]'')', v_p1));
      perform pg_temp.rec('E7b an Admin cannot write audit rows directly (42501)', v_code = '42501', v_code);
      v_code := pg_temp.run_as(v_admin, format('update public.membership_payment_edits set new_amount = 1 where payment_id = %L', v_p1));
      perform pg_temp.rec('E7c nor change them (42501)', v_code = '42501', v_code);
      v_code := pg_temp.run_as(v_admin, format('delete from public.membership_payment_edits where payment_id = %L', v_p1));
      perform pg_temp.rec('E7d nor delete them (42501)', v_code = '42501', v_code);
      v_code := pg_temp.run_as(v_admin, format('update public.membership_payment_methods set amount = 250 where id = %L', v_upi1));
      perform pg_temp.rec('E7e an Admin cannot bypass the function by writing a method amount directly (42501)', v_code = '42501', v_code);

      -- E9. The document is issued with the EDITED amount ------------------------------------------------------------------------------
      v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '250'),
                                                             jsonb_build_object('id', v_upi1, 'amount', '150')));
      v_out := pg_temp.query_as(v_admin, format('select public.issue_payment_document(%L::uuid)::text', v_p1));
      select * into v_doc from public.invoices where id = pg_temp.as_uuid(v_out);
      perform pg_temp.rec('E9 after an edit to 400, P1''s document is issued for 400 (the edited amount)',
        v_doc.id is not null and v_doc.total_amount = 400 and v_doc.payment_id = v_p1, coalesce(v_out, 'NULL'));

      -- E6. Any document freezes the payment's amount ---------------------------------------------------------------------------------------
      if v_doc.id is not null then
        v_snap := pg_temp.state(v_m);
        v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                               jsonb_build_object('id', v_upi1, 'amount', '200')));
        perform pg_temp.rec('E6a once a document is issued, the payment cannot be edited (55006) and nothing changed',
          v_out = 'ERR:55006' and pg_temp.state(v_m) = v_snap, v_out);
        v_out := pg_temp.query_as(v_admin, format('select public.correct_payment_document(%L::uuid, ''ZZVERIFY 0038'')::text', v_doc.id));
        v_snap := pg_temp.state(v_m);
        v_out := pg_temp.edit(v_admin, v_p1, jsonb_build_array(jsonb_build_object('id', v_cash1, 'amount', '300'),
                                                               jsonb_build_object('id', v_upi1, 'amount', '200')));
        perform pg_temp.rec('E6b after a correction (one cancelled + one issued document) it still cannot be edited (55006)',
          v_out = 'ERR:55006' and pg_temp.state(v_m) = v_snap
          and (select count(*) from public.invoices where payment_id = v_p1 and status = 'cancelled') = 1, v_out);
        v_out := pg_temp.edit(v_admin, v_p2, jsonb_build_array(jsonb_build_object('id', v_cash2, 'amount', '450')));
        perform pg_temp.rec('E6c a document on one payment does not freeze another payment (P2 edited to 450)',
          v_out = v_p2::text and (select amount from public.membership_payments where id = v_p2) = 450
          and (select payment_status from public.memberships where id = v_m) = 'partially_paid', coalesce(v_out, 'NULL'));
      else
        perform pg_temp.skip('E6', 'no document could be issued for P1 (see E9)');
      end if;

      -- E10. The 0034 deferred checks would pass at commit -------------------------------------------------------------------------------
      -- They are DEFERRED, so in a rolled-back run they never fire on their own: force every pending check now.
      begin
        set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger immediate;
        v_code := 'OK';
      exception when others then
        v_code := sqlstate || ' ' || sqlerrm;
      end;
      set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger deferred;
      perform pg_temp.rec('E10 after every edit, the deferred 0034 checks pass (methods add up; no overpayment)', v_code = 'OK', v_code);
    end if;
  end if;

  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash1
  from public.membership_payments p
  where p.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by e.id), '')) into v_edit_hash1
  from public.membership_payment_edits e
  where e.payment_id not in (select p.id from public.membership_payments p join public.memberships m on m.id = p.membership_id
                             join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  perform pg_temp.rec('Z1 every pre-existing payment and audit row is unchanged', v_pay_hash0 = v_pay_hash1 and v_edit_hash0 = v_edit_hash1, '');
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
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%') as leftover_students,
--          (select count(*) from public.membership_payment_methods where reference_id = 'ZZ-UPI-38') as leftover_methods;
