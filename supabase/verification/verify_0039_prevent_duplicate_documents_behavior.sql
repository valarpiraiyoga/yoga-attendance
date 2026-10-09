-- ===========================================================================
-- Migration 0039 verification (behaviour) - Preventing duplicate document issuance
-- Exercises supabase/migrations/0039_prevent_duplicate_documents.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   G  A FIRST payment-level document is refused (55000, "A membership invoice already exists for this
--      membership.") while the membership has a membership-level document - for a tax invoice payment and for a
--      payment-receipt payment - and the refusal creates no document and consumes no invoice or receipt number.
--   N  Normal issuing still works when there is no membership-level document, in both series.
--   C  Cancel and Reissue still works: on a normal payment document, and on a payment document whose membership
--      ALSO has a membership-level document (the MEM-000049 shape): the replacement is issued, linked and numbered,
--      and the membership-level document is untouched.
--
-- PREREQUISITES
--   * Migrations 0034-0039 applied. If 0039 is NOT applied, P0 fails and every scenario is skipped (NOT TESTED),
--     so running this before applying 0039 gives one clear failure instead of misleading ones.
--   * An Admin profile, the singleton invoice_settings row and the centre profile row.
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only (three students, one membership each). It never reads or writes any real
--     membership - MEM-000047 and MEM-000049 are not referenced - and every pre-existing invoice and payment is
--     fingerprinted first and compared at the end (Z1, Z2).
--   * If a numbering sequence is not configured yet, it is configured for this run only (rolled back).
--   * It writes to invoice_settings (counters), so it holds that row's lock until it ends: another session issuing
--     a document at the same moment simply waits. Run it when no one is issuing documents.
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
--
-- LIMITATIONS
--   * After 0036 no application path can create "a membership-level document AND payments", so scenarios G and C2
--     BUILD that historical shape as the owning role, inside the transaction: membership A is marked Paid with no
--     payments (the auto-issue trigger issues its membership-level document, as it did before payments existed) and
--     its payment rows are then inserted directly; membership C gets a membership-level document by copying one of
--     its own payment documents. If a build step fails, that scenario is reported NOT TESTED with the reason.
--   * Concurrency (an issue racing another writer) cannot be tested in one transaction and is NOT tested here.
--   * The Payments panel (hiding Issue Document) is application code and is covered by browser QA, not by this file.
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

-- Issues a payment's document as p_user; returns the document id, or 'ERR:<sqlstate>'.
create function pg_temp.issue(p_user uuid, p_payment uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.issue_payment_document(%L::uuid)::text', p_payment));
end $f$;

-- Corrects a document as p_user; returns the replacement's id, or 'ERR:<sqlstate>'.
create function pg_temp.correct(p_user uuid, p_document uuid, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.correct_payment_document(%L::uuid, %L)::text', p_document, p_reason));
end $f$;

-- Issues a payment's document as p_user; returns 'OK' or '<sqlstate> <message>' (the refusal in words).
create function pg_temp.issue_msg(p_user uuid, p_payment uuid)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    perform public.issue_payment_document(p_payment);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- Writes a payment with one cash method directly, as the owner (the historical shape). Returns its id.
create function pg_temp.add_payment(p_membership uuid, p_date date, p_amount numeric, p_tax boolean)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  with p as (
    insert into public.membership_payments (membership_id, payment_date, amount, issue_tax_invoice)
    values (p_membership, p_date, p_amount, p_tax)
    returning id
  )
  insert into public.membership_payment_methods (payment_id, position, method, amount)
  select p.id, 1, 'cash', p_amount from p
  returning payment_id into v_id;
  return v_id;
end $f$;

-- The counters and reservations an issue would move, as one comparable string.
create function pg_temp.numbers()
returns text language sql as $f$
  select concat_ws('|',
    (select coalesce(next_invoice_number::text, 'null') from public.invoice_settings where singleton),
    (select coalesce(payment_receipt_next_number::text, 'null') from public.invoice_settings where singleton),
    (select count(*) from public.invoice_number_reservations),
    (select count(*) from public.payment_receipt_number_reservations),
    (select count(*) from public.invoices))
$f$;

do $$
declare
  v_admin      uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_a uuid;  v_b uuid;  v_c uuid;
  v_a_tax uuid;  v_a_rcpt uuid;
  v_b_tax text;  v_b_rcpt text;
  v_c_tax text;  v_c_rcpt text;
  v_out        text;
  v_code       text;
  v_msg        text;
  v_set        public.invoice_settings%rowtype;
  v_nums       text;
  v_adoc       public.invoices%rowtype;
  v_adoc_json  jsonb;
  v_doc        public.invoices%rowtype;
  v_new        public.invoices%rowtype;
  v_cdoc       uuid;
  v_cdoc_json  jsonb;
  v_inv_next   bigint;
  v_rcp_next   bigint;
  v_inv_hash0  text;
  v_inv_hash1  text;
  v_pay_hash0  text;
  v_pay_hash1  text;
  v_applied    boolean;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash0 from public.membership_payments p;

  -- P0. Is 0039 applied? -----------------------------------------------------------------------------------------------
  v_applied := pg_get_functiondef('public.issue_payment_document_core(uuid, date, text, uuid)'::regprocedure)
               like '%A membership invoice already exists for this membership.%';
  perform pg_temp.rec('P0 migration 0039 is applied (the issuing function contains the guard)', v_applied,
    case when v_applied then '' else 'apply 0039 first; every scenario below is skipped' end);

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
    v_a := pg_temp.fixture('0039 A', '9000390001', 500);
    v_b := pg_temp.fixture('0039 B', '9000390002', 1000);
    v_c := pg_temp.fixture('0039 C', '9000390003', 800);
  exception when others then
    v_a := null;
    v_err := sqlstate || ' ' || sqlerrm;
  end;

  if not v_applied then
    perform pg_temp.skip('G / N / C', 'migration 0039 is not applied');
  elsif v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_a is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  elsif not exists (select 1 from public.center_profile where singleton) or v_set.singleton is null then
    perform pg_temp.skip('every scenario', 'the centre profile or the invoice settings row is missing, so no document can be issued');
  else
    -- ===== G. A first payment document is refused beside a membership-level document ==================================
    -- Build the historical shape on membership A: Paid with no payments -> its membership-level document is issued by
    -- the auto-issue trigger; then its payments are written directly (the application can no longer do this).
    v_code := pg_temp.run_owner(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L',
                                       v_today - 3, v_a));
    select * into v_adoc from public.invoices where membership_id = v_a and payment_id is null;
    if v_adoc.id is null then
      perform pg_temp.skip('G1-G6', 'could not build a membership-level document for fixture A (' || v_code || ')');
    else
      begin
        v_a_tax := pg_temp.add_payment(v_a, v_today - 3, 300, true);
        v_a_rcpt := pg_temp.add_payment(v_a, v_today - 3, 200, false);
        set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger immediate;
        v_code := 'OK';
      exception when others then
        v_code := sqlstate || ' ' || sqlerrm;
        v_a_tax := null;
      end;
      set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger deferred;

      if v_a_tax is null then
        perform pg_temp.skip('G1-G6', 'could not write fixture A''s payments directly (' || v_code || ')');
      else
        v_adoc_json := to_jsonb(v_adoc);
        perform pg_temp.rec('G0 setup: fixture A has a membership-level document and two payments (300 tax invoice, 200 payment receipt), none documented',
          v_adoc.payment_id is null and v_adoc.status = 'issued'
          and (select count(*) from public.membership_payments where membership_id = v_a) = 2
          and not exists (select 1 from public.invoices where payment_id in (v_a_tax, v_a_rcpt)), '');

        v_nums := pg_temp.numbers();
        v_msg := pg_temp.issue_msg(v_admin, v_a_tax);
        perform pg_temp.rec('G1 issuing the TAX INVOICE payment is refused with 55000 and the guard''s message',
          v_msg = '55000 A membership invoice already exists for this membership.', v_msg);
        v_msg := pg_temp.issue_msg(v_admin, v_a_rcpt);
        perform pg_temp.rec('G2 issuing the PAYMENT RECEIPT payment is refused the same way',
          v_msg = '55000 A membership invoice already exists for this membership.', v_msg);
        perform pg_temp.rec('G3 the refusals created no document: none for either payment, and the invoice count is unchanged',
          not exists (select 1 from public.invoices where payment_id in (v_a_tax, v_a_rcpt))
          and (select count(*) from public.invoices where membership_id = v_a) = 1, '');
        perform pg_temp.rec('G4 ... and consumed no number: both counters and both reservation tables are exactly as before',
          pg_temp.numbers() = v_nums, v_nums || ' -> ' || pg_temp.numbers());
        perform pg_temp.rec('G5 the membership-level document is byte-for-byte unchanged',
          (select to_jsonb(i) from public.invoices i where i.id = v_adoc.id) = v_adoc_json, '');
        v_out := pg_temp.issue(v_admin, v_a_tax);
        perform pg_temp.rec('G6 the refusal repeats (nothing was half-done): a second attempt is refused the same way', v_out = 'ERR:55000', v_out);
      end if;
    end if;

    -- ===== N. Normal issuing, no membership-level document ===============================================================
    v_b_tax := pg_temp.pay(v_admin, v_b, v_today - 2, '[{"method":"cash","amount":"600"}]', 'true');
    v_b_rcpt := pg_temp.pay(v_admin, v_b, v_today - 1, '[{"method":"upi","amount":"400","reference_id":"ZZ-UPI-39"}]', 'false');
    perform pg_temp.rec('N0 setup: fixture B is Paid through two payments and has no membership-level document',
      v_b_tax not like 'ERR:%' and v_b_rcpt not like 'ERR:%'
      and (select payment_status from public.memberships where id = v_b) = 'paid'
      and not exists (select 1 from public.invoices where membership_id = v_b), coalesce(v_b_tax, 'NULL') || ' / ' || coalesce(v_b_rcpt, 'NULL'));

    select next_invoice_number, payment_receipt_next_number into v_inv_next, v_rcp_next from public.invoice_settings where singleton;
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_b_tax));
    select * into v_doc from public.invoices where id = pg_temp.as_uuid(v_out);
    perform pg_temp.rec('N1 the tax invoice payment is issued as before: invoice series, its own payment and amount, status issued',
      v_doc.id is not null and v_doc.document_series = 'invoice' and v_doc.payment_id = pg_temp.as_uuid(v_b_tax)
      and v_doc.total_amount = 600 and v_doc.status = 'issued' and v_doc.replaces_id is null, coalesce(v_out, 'NULL'));
    perform pg_temp.rec('N2 it moved only the invoice counter',
      (select next_invoice_number from public.invoice_settings where singleton) = v_doc.invoice_number + 1
      and (select payment_receipt_next_number from public.invoice_settings where singleton) is not distinct from v_rcp_next, '');

    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_b_rcpt));
    select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
    perform pg_temp.rec('N3 the non-tax payment is issued as a PAYMENT RECEIPT from its own series, without tax',
      v_new.id is not null and v_new.document_series = 'payment_receipt' and v_new.document_title = 'payment_receipt'
      and not v_new.tax_enabled and v_new.total_amount = 400
      and (select payment_receipt_next_number from public.invoice_settings where singleton) = v_new.invoice_number + 1, coalesce(v_out, 'NULL'));

    -- ===== C1. Cancel and Reissue on a normal payment document ===============================================================
    if v_doc.id is null then
      perform pg_temp.skip('C1', 'the normal tax invoice could not be issued (see N1)');
    else
      v_out := pg_temp.correct(v_admin, v_doc.id, 'ZZVERIFY correct B');
      select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
      perform pg_temp.rec('C1 a normal payment document can still be corrected: cancelled with the reason, replacement issued, same series, new number, linked',
        v_new.id is not null and v_new.status = 'issued' and v_new.document_series = 'invoice'
        and v_new.invoice_number <> v_doc.invoice_number and v_new.replaces_id = v_doc.id and v_new.payment_id = v_doc.payment_id
        and (select status = 'cancelled' and cancellation_reason = 'ZZVERIFY correct B' from public.invoices where id = v_doc.id), coalesce(v_out, 'NULL'));
    end if;

    -- ===== C2. Cancel and Reissue where the membership ALSO has a membership-level document (the MEM-000049 shape) ===========
    v_c_tax := pg_temp.pay(v_admin, v_c, v_today - 2, '[{"method":"cash","amount":"500"}]', 'true');
    v_c_rcpt := pg_temp.pay(v_admin, v_c, v_today - 1, '[{"method":"cash","amount":"300"}]', 'false');
    -- Issue once, keep the id, then read the row (a volatile call inside a SELECT on invoices runs once per row).
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_c_tax));
    select * into v_doc from public.invoices where id = pg_temp.as_uuid(v_out);
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_c_rcpt));
    select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
    if v_doc.id is null or v_new.id is null then
      perform pg_temp.skip('C2', 'fixture C''s payment documents could not be issued');
    else
      -- Add the membership-level document by copying C's tax invoice (a fresh id and number, no payment link).
      v_code := pg_temp.run_owner(format($q$
        insert into public.invoices
        select (jsonb_populate_record(null::public.invoices, to_jsonb(d) || jsonb_build_object(
                  'id', gen_random_uuid(), 'payment_id', null, 'invoice_number', d.invoice_number + 500000,
                  'created_at', now(), 'updated_at', now()))).*
        from public.invoices d where d.id = %L$q$, v_doc.id));
      select id into v_cdoc from public.invoices where membership_id = v_c and payment_id is null;
      if v_code <> 'OK' or v_cdoc is null then
        perform pg_temp.skip('C2', 'could not build fixture C''s membership-level document (' || v_code || ')');
      else
        select to_jsonb(i) into v_cdoc_json from public.invoices i where i.id = v_cdoc;
        v_nums := pg_temp.numbers();
        v_out := pg_temp.correct(v_admin, v_doc.id, 'ZZVERIFY correct C tax');
        select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
        perform pg_temp.rec('C2a the tax invoice of a membership that ALSO has a membership-level document can still be corrected: replacement issued and linked',
          v_new.id is not null and v_new.status = 'issued' and v_new.document_series = 'invoice' and v_new.replaces_id = v_doc.id
          and v_new.payment_id = v_doc.payment_id and (select status from public.invoices where id = v_doc.id) = 'cancelled', coalesce(v_out, 'NULL'));
        perform pg_temp.rec('C2b ... exactly one new document was added and only the invoice counter moved',
          (select count(*) from public.invoices) = split_part(v_nums, '|', 5)::bigint + 1
          and (select payment_receipt_next_number from public.invoice_settings where singleton)::text = split_part(v_nums, '|', 2), v_nums || ' -> ' || pg_temp.numbers());

        select * into v_new from public.invoices where payment_id = pg_temp.as_uuid(v_c_rcpt) and status = 'issued';
        v_out := pg_temp.correct(v_admin, v_new.id, 'ZZVERIFY correct C receipt');
        perform pg_temp.rec('C2c the payment RECEIPT of that membership can be corrected too (same series, linked)',
          pg_temp.as_uuid(v_out) is not null
          and (select document_series = 'payment_receipt' and replaces_id = v_new.id from public.invoices where id = pg_temp.as_uuid(v_out)), coalesce(v_out, 'NULL'));
        perform pg_temp.rec('C2d the membership-level document is byte-for-byte unchanged by both corrections',
          (select to_jsonb(i) from public.invoices i where i.id = v_cdoc) = v_cdoc_json, '');
      end if;
    end if;
  end if;

  -- Z. Nothing real was touched ---------------------------------------------------------------------------------------------
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1
  from public.invoices i
  where i.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  perform pg_temp.rec('Z1 every pre-existing invoice and receipt is byte-for-byte unchanged', v_inv_hash0 = v_inv_hash1, '');
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash1
  from public.membership_payments p
  where p.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  perform pg_temp.rec('Z2 every pre-existing payment is byte-for-byte unchanged', v_pay_hash0 = v_pay_hash1, '');
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

-- AFTER THE ROLLBACK (run separately) - nothing may remain, and the counters are back:
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%') as leftover_students,
--          (select count(*) from public.invoices where cancellation_reason like 'ZZVERIFY%') as leftover_cancellations,
--          next_invoice_number, payment_receipt_next_number
--   from public.invoice_settings;
