-- ===========================================================================
-- Migration 0036 verification (behaviour) - Payment documents and separate numbering
-- Exercises supabase/migrations/0036_payment_documents.sql (with 0037's current issuing function)
-- ===========================================================================
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only. Documents are issued only for the fixtures' own payments, through the real
--     function, and are rolled back with everything else: the invoice and payment-receipt COUNTERS, the number
--     RESERVATIONS and the documents all return to what they were. Existing documents are fingerprinted and checked.
--   * If a numbering sequence is not configured yet, the script configures it for this run only (rolled back).
--   * It writes to invoice_settings (counters, and a test prefix), so it holds that row's lock until it ends: another
--     session issuing a document at the same moment simply waits. Run it when no one is issuing documents.
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
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

-- Issues a payment's document as p_user; returns the document id, or 'ERR:<sqlstate>'.
create function pg_temp.issue(p_user uuid, p_payment uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.issue_payment_document(%L::uuid)::text', p_payment));
end $f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m          uuid;
  v_p_tax      text;
  v_p_rcpt     text;
  v_out        text;
  v_code       text;
  v_set        public.invoice_settings%rowtype;
  v_inv_next0  bigint;
  v_rcp_next0  bigint;
  v_doc_tax    public.invoices%rowtype;
  v_doc_rcpt   public.invoices%rowtype;
  v_hash0      text;
  v_hash1      text;
  v_docs_hash  text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_hash0 from public.invoices i;

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
  perform pg_temp.run_owner('update public.invoice_settings set payment_receipt_prefix = ''ZZPR-'' where singleton');

  begin
    v_m := pg_temp.fixture('0036', '9000360001', 1000);
  exception when others then
    v_m := null;
    v_err := sqlstate || ' ' || sqlerrm;
  end;

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_m is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  elsif not exists (select 1 from public.center_profile where singleton) then
    perform pg_temp.skip('every scenario', 'the centre profile row is missing, so no document can be issued');
  else
    v_p_tax := pg_temp.pay(v_admin, v_m, v_today - 2, '[{"method":"cash","amount":"600"}]', 'true');
    v_p_rcpt := pg_temp.pay(v_admin, v_m, v_today - 1, '[{"method":"upi","amount":"400","reference_id":"ZZ-UPI-36"}]', 'false');
    perform pg_temp.rec('S0 two payments recorded (tax invoice 600, payment receipt 400); the membership is Paid',
      v_p_tax not like 'ERR:%' and v_p_rcpt not like 'ERR:%'
      and (select payment_status from public.memberships where id = v_m) = 'paid', v_p_tax || ' / ' || v_p_rcpt);
    perform pg_temp.rec('S1 becoming Paid through payments issued no membership-level document',
      not exists (select 1 from public.invoices where membership_id = v_m), '');

    -- N. Independent numbering -------------------------------------------------------------------------------------
    select next_invoice_number, payment_receipt_next_number into v_inv_next0, v_rcp_next0 from public.invoice_settings where singleton;

    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_p_tax));
    select * into v_doc_tax from public.invoices where id = pg_temp.as_uuid(v_out);
    perform pg_temp.rec('N1 the tax-invoice payment gets an invoice-series document for its own amount, linked to it',
      v_doc_tax.id is not null and v_doc_tax.document_series = 'invoice' and v_doc_tax.payment_id = pg_temp.as_uuid(v_p_tax)
      and v_doc_tax.membership_id = v_m and v_doc_tax.total_amount = 600 and v_doc_tax.document_title <> 'payment_receipt'
      and v_doc_tax.invoice_date = v_today - 2 and v_doc_tax.payment_date = v_today - 2, coalesce(v_out, 'NULL'));
    perform pg_temp.rec('N2 it moved only the invoice counter (to its number + 1); the payment receipt counter is untouched',
      (select next_invoice_number from public.invoice_settings where singleton) = v_doc_tax.invoice_number + 1
      and (select payment_receipt_next_number from public.invoice_settings where singleton) is not distinct from v_rcp_next0, '');
    perform pg_temp.rec('N3 its tax follows the settings: taxed only while tax is enabled, and then tax + taxable = total',
      case when (select tax_enabled from public.invoice_settings where singleton)
           then v_doc_tax.tax_enabled and v_doc_tax.taxable_amount + v_doc_tax.tax_amount = v_doc_tax.total_amount
           else not v_doc_tax.tax_enabled and v_doc_tax.tax_amount is null end, '');

    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_p_rcpt));
    select * into v_doc_rcpt from public.invoices where id = pg_temp.as_uuid(v_out);
    perform pg_temp.rec('N4 the non-tax payment gets a PAYMENT RECEIPT from its own series: titled so, no tax, its own prefix',
      v_doc_rcpt.id is not null and v_doc_rcpt.document_series = 'payment_receipt' and v_doc_rcpt.document_title = 'payment_receipt'
      and not v_doc_rcpt.tax_enabled and v_doc_rcpt.tax_amount is null and v_doc_rcpt.total_amount = 400
      and v_doc_rcpt.invoice_prefix = 'ZZPR-', coalesce(v_out, 'NULL'));
    perform pg_temp.rec('N5 it moved only the payment receipt counter; the invoice counter is where N1 left it',
      (select payment_receipt_next_number from public.invoice_settings where singleton) = v_doc_rcpt.invoice_number + 1
      and (select next_invoice_number from public.invoice_settings where singleton) = v_doc_tax.invoice_number + 1, '');
    perform pg_temp.rec('N6 each number is reserved in its own series only: the receipt never consumed an invoice number',
      exists (select 1 from public.invoice_number_reservations where invoice_id = v_doc_tax.id)
      and not exists (select 1 from public.payment_receipt_number_reservations where invoice_id = v_doc_tax.id)
      and exists (select 1 from public.payment_receipt_number_reservations where invoice_id = v_doc_rcpt.id)
      and not exists (select 1 from public.invoice_number_reservations where invoice_id = v_doc_rcpt.id), '');

    -- O. One document per payment; none at membership level ------------------------------------------------------------
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_p_tax));
    perform pg_temp.rec('O1 a second document for the same payment is refused (23505)', v_out = 'ERR:23505', v_out);
    v_out := pg_temp.query_as(v_admin, format('select public.issue_invoice(%L::uuid)::text', v_m));
    perform pg_temp.rec('O2 a membership-level document is refused for a membership with payments (55000 or 23505)',
      v_out in ('ERR:55000', 'ERR:23505') and not exists (select 1 from public.invoices where membership_id = v_m and payment_id is null), v_out);

    -- L. Starting-number locks, per series ----------------------------------------------------------------------------------
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set payment_receipt_starting_number = payment_receipt_starting_number + 1 where singleton');
    perform pg_temp.rec('L1 the payment receipt starting number is locked once a payment receipt exists (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set starting_invoice_number = starting_invoice_number + 1 where singleton');
    perform pg_temp.rec('L2 the invoice starting number is locked once an invoice-series document exists (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set payment_receipt_next_number = 1 where singleton');
    perform pg_temp.rec('L3 an Admin cannot move the payment receipt counter (42501)', v_code = '42501', v_code);

    -- I. Immutability and independence from the membership ---------------------------------------------------------------------
    v_code := pg_temp.run_owner(format('update public.invoices set total_amount = 1 where id = %L', v_doc_rcpt.id));
    perform pg_temp.rec('I1 an issued payment document''s content cannot change, even for the owner (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_owner(format('delete from public.invoices where id = %L', v_doc_rcpt.id));
    perform pg_temp.rec('I2 nor can it be deleted (55006)', v_code = '55006', v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set document_series = ''invoice'' where id = %L', v_doc_rcpt.id));
    perform pg_temp.rec('I3 an Admin cannot change it directly (refused)', v_code <> 'OK', v_code);
    select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) into v_docs_hash from public.invoices i where i.membership_id = v_m;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set end_date = end_date + 5 where id = %L', v_m));
    perform pg_temp.rec('I4 a membership edit does not touch its payment documents (no sync for them)',
      v_code = 'OK' and (select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) from public.invoices i where i.membership_id = v_m) = v_docs_hash, v_code);

    -- P. Permissions --------------------------------------------------------------------------------------------------------------
    if v_instructor is null then
      perform pg_temp.skip('P1 instructor', 'no instructor profile found');
    else
      v_out := pg_temp.issue(v_instructor, pg_temp.as_uuid(v_p_rcpt));
      perform pg_temp.rec('P1 an Instructor cannot issue a document (42501)', v_out = 'ERR:42501', v_out);
    end if;
    v_code := pg_temp.run_anon(format('select public.issue_payment_document(%L::uuid)', v_p_rcpt));
    perform pg_temp.rec('P2 an anonymous caller cannot issue a document (42501)', v_code = '42501', v_code);
  end if;

  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_hash1
  from public.invoices i
  where i.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  perform pg_temp.rec('Z1 every pre-existing document is byte-for-byte unchanged', v_hash0 = v_hash1, '');
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
--          next_invoice_number, payment_receipt_next_number, payment_receipt_prefix
--   from public.invoice_settings;
