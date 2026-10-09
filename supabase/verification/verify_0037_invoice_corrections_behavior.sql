-- ===========================================================================
-- Migration 0037 verification (behaviour) - Invoice corrections (cancel and reissue)
-- Exercises supabase/migrations/0037_invoice_corrections.sql (with 0038's current issuing function)
-- ===========================================================================
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only. Every document issued, cancelled or reissued here belongs to a fixture
--     payment or fixture membership, and is rolled back with the counters and number reservations.
--     No existing document is corrected, cancelled or edited. Existing documents are fingerprinted and checked (Z1).
--   * FORCED FAILURE (C7) uses no DDL: as the owning role, it moves ONE FIXTURE payment's date to after its
--     document's date, so the reissue inside the correction fails on its own date check. It then checks that the
--     whole correction rolled back, and puts the date back.
--   * If a numbering sequence is not configured yet, the script configures it for this run only (rolled back).
--   * It holds the invoice_settings row lock until it ends: another session issuing a document at the same moment
--     simply waits. Run it when no one is issuing documents.
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

-- Corrects a document as p_user; returns the replacement's id, or 'ERR:<sqlstate>'.
create function pg_temp.correct(p_user uuid, p_document uuid, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.correct_payment_document(%L::uuid, %L)::text', p_document, p_reason));
end $f$;

do $$
declare
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m          uuid;
  v_m_level    uuid;
  v_p_tax      text;
  v_p_rcpt     text;
  v_out        text;
  v_code       text;
  v_set        public.invoice_settings%rowtype;
  v_inv_next   bigint;
  v_rcp_next   bigint;
  v_rcp_res    bigint;
  v_orig_rcpt  public.invoices%rowtype;
  v_orig_tax   public.invoices%rowtype;
  v_new        public.invoices%rowtype;
  v_new2       public.invoices%rowtype;
  v_mdoc       public.invoices%rowtype;
  v_hash0      text;
  v_hash1      text;
  v_snap       text;
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

  begin
    v_m := pg_temp.fixture('0037', '9000370001', 1000);
    v_m_level := pg_temp.fixture('0037 LEVEL', '9000370002', 500);
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
    -- Setup: two payments, each with its issued document.
    v_p_tax := pg_temp.pay(v_admin, v_m, v_today - 2, '[{"method":"cash","amount":"600"}]', 'true');
    v_p_rcpt := pg_temp.pay(v_admin, v_m, v_today - 2, '[{"method":"upi","amount":"400","reference_id":"ZZ-UPI-37"}]', 'false');
    -- Issue once, keep the returned id, then read the row by that id (a volatile call inside a SELECT on invoices
    -- would run once per scanned row).
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_p_tax));
    select * into v_orig_tax from public.invoices where id = pg_temp.as_uuid(v_out);
    v_out := pg_temp.issue(v_admin, pg_temp.as_uuid(v_p_rcpt));
    select * into v_orig_rcpt from public.invoices where id = pg_temp.as_uuid(v_out);
    perform pg_temp.rec('S0 setup: a tax invoice (600) and a payment receipt (400) issued for two fixture payments',
      v_orig_tax.id is not null and v_orig_tax.document_series = 'invoice' and v_orig_tax.status = 'issued'
      and v_orig_rcpt.id is not null and v_orig_rcpt.document_series = 'payment_receipt' and v_orig_rcpt.status = 'issued',
      coalesce(v_p_tax, 'NULL') || ' / ' || coalesce(v_p_rcpt, 'NULL'));

    if v_orig_rcpt.id is null or v_orig_tax.id is null then
      perform pg_temp.skip('C1-C10', 'the setup documents could not be issued');
    else
      -- C7. A failed correction leaves nothing behind -----------------------------------------------------------
      select next_invoice_number, payment_receipt_next_number into v_inv_next, v_rcp_next from public.invoice_settings where singleton;
      select count(*) into v_rcp_res from public.payment_receipt_number_reservations;
      v_code := pg_temp.run_owner(format('update public.membership_payments set payment_date = %L where id = %L',
                                         v_today - 1, v_orig_rcpt.payment_id));
      if v_code <> 'OK' then
        perform pg_temp.skip('C7 forced failure', 'could not move the fixture payment''s date (' || v_code || ')');
      else
        v_out := pg_temp.correct(v_admin, v_orig_rcpt.id, 'ZZVERIFY forced failure');
        perform pg_temp.rec('C7a a correction whose reissue fails is refused as a whole (22023 from the reissue)', v_out = 'ERR:22023', v_out);
        perform pg_temp.rec('C7b ... the original is still ISSUED, unchanged, and has no replacement',
          (select to_jsonb(i) from public.invoices i where i.id = v_orig_rcpt.id) = to_jsonb(v_orig_rcpt)
          and not exists (select 1 from public.invoices where replaces_id = v_orig_rcpt.id), '');
        perform pg_temp.rec('C7c ... no number was consumed: both counters and the receipt reservations are as before',
          (select next_invoice_number from public.invoice_settings where singleton) is not distinct from v_inv_next
          and (select payment_receipt_next_number from public.invoice_settings where singleton) is not distinct from v_rcp_next
          and (select count(*) from public.payment_receipt_number_reservations) = v_rcp_res, '');
        perform pg_temp.run_owner(format('update public.membership_payments set payment_date = %L where id = %L',
                                         v_orig_rcpt.payment_date, v_orig_rcpt.payment_id));
      end if;

      -- C1-C2. Correcting a payment receipt ------------------------------------------------------------------------
      select payment_receipt_next_number, next_invoice_number into v_rcp_next, v_inv_next from public.invoice_settings where singleton;
      v_out := pg_temp.correct(v_admin, v_orig_rcpt.id, '  ZZVERIFY wrong UPI reference  ');
      select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
      perform pg_temp.rec('C1a the original is CANCELLED by this Admin, now, with the trimmed reason',
        (select status = 'cancelled' and cancelled_by = v_admin and cancelled_at is not null
                and cancellation_reason = 'ZZVERIFY wrong UPI reference'
         from public.invoices where id = v_orig_rcpt.id), coalesce(v_out, 'NULL'));
      perform pg_temp.rec('C1b ... and otherwise unchanged (number, date, amounts, snapshot)',
        (select to_jsonb(i) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']
         from public.invoices i where i.id = v_orig_rcpt.id)
        = to_jsonb(v_orig_rcpt) - array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'], '');
      perform pg_temp.rec('C1c the replacement: issued, SAME series, a NEW number, same payment, amount and date, linked to the original',
        v_new.id is not null and v_new.status = 'issued' and v_new.document_series = 'payment_receipt'
        and v_new.invoice_number <> v_orig_rcpt.invoice_number and v_new.payment_id = v_orig_rcpt.payment_id
        and v_new.total_amount = v_orig_rcpt.total_amount and v_new.invoice_date = v_orig_rcpt.invoice_date
        and v_new.replaces_id = v_orig_rcpt.id, '');
      perform pg_temp.rec('C1d the payment still has exactly one issued document',
        (select count(*) from public.invoices where payment_id = v_orig_rcpt.payment_id and status = 'issued') = 1, '');
      perform pg_temp.rec('C2a only the payment receipt counter moved (to the new number + 1); the invoice counter did not',
        (select payment_receipt_next_number from public.invoice_settings where singleton) = v_new.invoice_number + 1
        and (select next_invoice_number from public.invoice_settings where singleton) is not distinct from v_inv_next, '');
      perform pg_temp.rec('C2b the cancelled number stays reserved for the cancelled document (never reused)',
        exists (select 1 from public.payment_receipt_number_reservations
                where receipt_number = v_orig_rcpt.invoice_number and invoice_id = v_orig_rcpt.id), '');

      -- C3-C4. Refusals -------------------------------------------------------------------------------------------------
      v_out := pg_temp.correct(v_admin, v_orig_rcpt.id, 'ZZVERIFY again');
      perform pg_temp.rec('C3 a cancelled document cannot be corrected again (55006)', v_out = 'ERR:55006', v_out);

      v_snap := (select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) from public.invoices i where i.membership_id = v_m);
      v_out := pg_temp.correct(v_admin, v_new.id, '   ');
      perform pg_temp.rec('C4a a blank reason is refused (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.correct(v_admin, v_new.id, repeat('x', 501));
      perform pg_temp.rec('C4b a reason over 500 characters is refused (22023)', v_out = 'ERR:22023', v_out);
      perform pg_temp.rec('C4c ... and the refusals changed nothing',
        (select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) from public.invoices i where i.membership_id = v_m) = v_snap, '');

      -- A fixture membership made Paid with no payments gets a membership-level document (auto-issue, as before 0034).
      v_code := pg_temp.run_owner(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L',
                                         v_today - 3, v_m_level));
      select * into v_mdoc from public.invoices where membership_id = v_m_level and payment_id is null;
      if v_mdoc.id is null then
        perform pg_temp.skip('C4d membership-level document', 'no membership-level fixture document was issued (' || v_code || ')');
      else
        v_out := pg_temp.correct(v_admin, v_mdoc.id, 'ZZVERIFY not a payment document');
        perform pg_temp.rec('C4d a membership-level document cannot be corrected (55000) and stays issued',
          v_out = 'ERR:55000' and (select status from public.invoices where id = v_mdoc.id) = 'issued', v_out);
      end if;

      -- C5-C6. Immutability ----------------------------------------------------------------------------------------------
      v_code := pg_temp.run_owner(format('update public.invoices set invoice_date = invoice_date where id = %L', v_orig_rcpt.id));
      perform pg_temp.rec('C5a a cancelled document cannot change at all - not even a no-op date write (55006)', v_code = '55006', v_code);
      v_code := pg_temp.run_owner(format('update public.invoices set status = ''issued'', cancelled_at = null, cancelled_by = null, cancellation_reason = null where id = %L', v_orig_rcpt.id));
      perform pg_temp.rec('C5b a cancelled document cannot be un-cancelled, even by the owner (55006)', v_code = '55006', v_code);
      v_code := pg_temp.run_owner(format('delete from public.invoices where id = %L', v_orig_rcpt.id));
      perform pg_temp.rec('C5c a cancelled document cannot be deleted', v_code <> 'OK', v_code);
      v_code := pg_temp.run_owner(format(
        'update public.invoices set status = ''cancelled'', cancelled_at = now(), cancellation_reason = ''ZZVERIFY direct'' where id = %L', v_new.id));
      perform pg_temp.rec('C6a an issued document cannot be cancelled outside the correction, even by the owner (55006)', v_code = '55006', v_code);
      v_code := pg_temp.run_as(v_admin, format(
        'update public.invoices set status = ''cancelled'', cancelled_at = now(), cancellation_reason = ''ZZVERIFY direct'' where id = %L', v_new.id));
      perform pg_temp.rec('C6b nor by an Admin directly (refused)',
        v_code <> 'OK' and (select status from public.invoices where id = v_new.id) = 'issued', v_code);

      -- C8. Authorization -------------------------------------------------------------------------------------------------
      if v_instructor is null then
        perform pg_temp.skip('C8a instructor', 'no instructor profile found');
      else
        v_out := pg_temp.correct(v_instructor, v_new.id, 'ZZVERIFY instructor');
        perform pg_temp.rec('C8a an Instructor cannot correct a document (42501)', v_out = 'ERR:42501', v_out);
      end if;
      v_code := pg_temp.run_anon(format('select public.correct_payment_document(%L::uuid, ''ZZVERIFY anon'')', v_new.id));
      perform pg_temp.rec('C8b an anonymous caller cannot correct a document (42501)', v_code = '42501', v_code);
      v_code := pg_temp.run_as(v_admin, format(
        'select public.issue_payment_document_core(%L::uuid, null, ''payment_receipt'', %L::uuid)', v_new.payment_id, v_new.id));
      perform pg_temp.rec('C8c not even an Admin can call the internal issuing function directly (42501)', v_code = '42501', v_code);

      -- C9. Correcting a tax invoice keeps the invoice series ---------------------------------------------------------------------
      select payment_receipt_next_number, next_invoice_number into v_rcp_next, v_inv_next from public.invoice_settings where singleton;
      v_out := pg_temp.correct(v_admin, v_orig_tax.id, 'ZZVERIFY wrong name');
      select * into v_new2 from public.invoices where id = pg_temp.as_uuid(v_out);
      perform pg_temp.rec('C9a a tax invoice is replaced by a tax invoice: invoice series, new number, same amount and tax',
        v_new2.id is not null and v_new2.document_series = 'invoice' and v_new2.invoice_number <> v_orig_tax.invoice_number
        and v_new2.total_amount = v_orig_tax.total_amount and v_new2.tax_enabled = v_orig_tax.tax_enabled
        and v_new2.tax_amount is not distinct from v_orig_tax.tax_amount and v_new2.replaces_id = v_orig_tax.id, coalesce(v_out, 'NULL'));
      perform pg_temp.rec('C9b only the invoice counter moved; the original''s number stays reserved',
        (select next_invoice_number from public.invoice_settings where singleton) = v_new2.invoice_number + 1
        and (select payment_receipt_next_number from public.invoice_settings where singleton) is not distinct from v_rcp_next
        and exists (select 1 from public.invoice_number_reservations where invoice_number = v_orig_tax.invoice_number), '');

      -- C10. A replacement can itself be corrected: the history is a chain ------------------------------------------------------------
      v_out := pg_temp.correct(v_admin, v_new.id, 'ZZVERIFY second correction');
      perform pg_temp.rec('C10 a replacement can be corrected in turn: original <- replacement <- replacement, one issued',
        pg_temp.as_uuid(v_out) is not null
        and (select replaces_id from public.invoices where id = pg_temp.as_uuid(v_out)) = v_new.id
        and (select status from public.invoices where id = v_new.id) = 'cancelled'
        and (select count(*) from public.invoices where payment_id = v_orig_rcpt.payment_id) = 3
        and (select count(*) from public.invoices where payment_id = v_orig_rcpt.payment_id and status = 'issued') = 1, coalesce(v_out, 'NULL'));
    end if;
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
--          (select count(*) from public.invoices where cancellation_reason like 'ZZVERIFY%') as leftover_cancellations,
--          next_invoice_number, payment_receipt_next_number
--   from public.invoice_settings;
