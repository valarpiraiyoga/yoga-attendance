-- ===========================================================================
-- Migration 0040 verification (behaviour) - Editing a payment before its document is issued
-- Exercises supabase/migrations/0040_edit_payment_details.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0040 is applied (edit_payment and the two audit date columns) and its prerequisites exist. If not,
--       every other check is skipped (NOT TESTED) after one clear failure.
--   E   A payment's date, method type, amount, reference and notes can be edited; methods can be added and removed;
--       the methods always add up to the payment; an unchanged edit changes nothing and writes no audit row.
--       E7: a reference ID or note made only of spaces is stored as NULL, and the audit row records the normalized
--       (NULL) values next to the values they replaced.
--   S   The membership's payment status (Pending / Partially Paid / Paid) and its payment date are recalculated.
--   A   The audit history records who, the previous and new date, amount and methods.
--   I   Invalid edits (zero amount, future date, over-balance amount, empty methods, unknown method, three decimals,
--       no date) are rejected, and so is a failure AFTER the first write - and the saved data is exactly as it was.
--   D   A payment with an issued document, with an issued-and-cancelled pair, or with ONLY a cancelled document
--       (no replacement) cannot be edited; another payment of the same membership can; the documents are untouched.
--   L   On a membership that also has a legacy membership-level invoice, an edit the invoice guard refuses (a new
--       membership payment date) is rolled back COMPLETELY, even though the function had already written the methods.
--   U   An Instructor and an anonymous caller are refused.
--   Z   Every pre-existing invoice, payment, payment method and audit row is byte-for-byte unchanged.
--
-- PREREQUISITES
--   * Migrations 0034-0040 applied. If 0040 is NOT applied, P0 fails and every scenario is skipped.
--   * An Admin profile, an Instructor profile (its check is skipped without one), the singleton invoice_settings row
--     and the centre profile row.
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only (three students, one membership each). No existing membership, payment,
--     invoice or audit row is read for any purpose but fingerprinting, and none is written.
--   * Everything it creates - students, memberships, payments, methods, audit rows, documents, reservations, counter
--     movements - disappears with the rollback. If a numbering sequence is not configured yet, it is configured for
--     this run only (rolled back).
--   * It writes to invoice_settings (counters), so it holds that row's lock until it ends: another session issuing a
--     document at the same moment simply waits. Run it when no one is issuing documents.
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
--
-- LIMITATIONS
--   * Concurrency (an edit racing an issue or another edit) cannot be tested in one transaction and is NOT tested.
--   * E7 uses values made only of SPACES. The function normalizes with btrim(), which trims spaces and nothing else
--     (the same as record_membership_payment), so a reference or note made only of tabs or line breaks would be stored
--     as it is: that behaviour is neither asserted nor changed here.
--   * Scenario D5 (a payment whose only document is cancelled) cannot arise through the application, because Cancel and
--     Reissue always issues a replacement. The script builds it as the owner, exactly as correct_payment_document
--     cancels - under the yoga.invoice_cancel marker, changing only the cancellation columns - and reports NOT TESTED
--     if that cannot be done.
--   * Scenario L builds the legacy shape ("a membership-level invoice AND payments") as the owning role, since no
--     application path can create it any more; if a build step fails, L is reported NOT TESTED with the reason.
--   * The deferred checks of 0034 only fire at commit, which this script never reaches; it forces them with
--     SET CONSTRAINTS ... IMMEDIATE after the edits instead.
--   * Audit rows made in one transaction share one edited_at, so they are told apart here by their amounts.
--   * The dialog and the Payments panel are application code, covered by browser QA, not by this file.
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

-- Edits a payment as p_user; returns the payment id, or 'ERR:<sqlstate>'. p_date may be NULL.
create function pg_temp.edit(p_user uuid, p_payment uuid, p_date text, p_methods text)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_user, format('select public.edit_payment(%L::uuid, %L::date, %L::jsonb)::text', p_payment, p_date, p_methods));
end $f$;

-- Edits a payment as p_user; returns 'OK' or '<sqlstate> <message>' (the refusal in words).
create function pg_temp.edit_msg(p_user uuid, p_payment uuid, p_date text, p_methods text)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    perform public.edit_payment(p_payment, p_date::date, p_methods::jsonb);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
end $f$;

-- Writes a payment with one cash method directly, as the owner (the legacy shape). Returns its id.
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

-- A payment's methods add up to its amount.
create function pg_temp.balanced(p_payment uuid)
returns boolean language sql as $f$
  select coalesce((select sum(amount) from public.membership_payment_methods where payment_id = p_payment), 0)
         = (select amount from public.membership_payments where id = p_payment)
$f$;

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
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m uuid;  v_m2 uuid;  v_m3 uuid;
  v_p1 uuid;  v_p2 uuid;  v_pa uuid;  v_pb uuid;  v_pl uuid;
  v_out        text;
  v_code       text;
  v_msg        text;
  v_set        public.invoice_settings%rowtype;
  v_mem        public.memberships%rowtype;
  v_pay        public.membership_payments%rowtype;
  v_edit       public.membership_payment_edits%rowtype;
  v_snap       text;
  v_nums       text;
  v_audit      bigint;
  v_doc        public.invoices%rowtype;
  v_doc_json   jsonb;
  v_ldoc       uuid;
  v_ready      boolean;
  v_inv_hash0  text;  v_inv_hash1  text;
  v_pay_hash0  text;  v_pay_hash1  text;
  v_met_hash0  text;  v_met_hash1  text;
  v_aud_hash0  text;  v_aud_hash1  text;
  v_fixture_payments uuid[];
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- Fingerprints of everything that already exists (compared at the very end).
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash0 from public.membership_payments p;
  select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) into v_met_hash0 from public.membership_payment_methods x;
  select md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by e.id), '')) into v_aud_hash0 from public.membership_payment_edits e;

  -- P0. Is 0040 applied, and are its prerequisites there? --------------------------------------------------------------------
  v_ready := to_regprocedure('public.edit_payment(uuid, date, jsonb)') is not null
         and (select count(*) = 2 from information_schema.columns
              where table_schema = 'public' and table_name = 'membership_payment_edits'
                and column_name in ('previous_payment_date', 'new_payment_date'));
  perform pg_temp.rec('P0 migration 0040 is applied (edit_payment(uuid, date, jsonb) and the audit columns previous_payment_date / new_payment_date)',
    v_ready, case when v_ready then '' else 'apply 0040 first; every scenario below is skipped' end);
  if v_ready then
    v_ready := to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is not null
           and to_regprocedure('public.issue_payment_document(uuid, date)') is not null
           and to_regprocedure('public.correct_payment_document(uuid, text)') is not null
           and to_regclass('public.membership_payment_edits') is not null;
    perform pg_temp.rec('P0b the earlier migrations it builds on are applied (payments, documents, corrections, the audit table)', v_ready, '');
  end if;

  -- Numbering for this run only (rolled back): only where a sequence is not configured yet.
  select * into v_set from public.invoice_settings where singleton;
  if v_ready and v_set.starting_invoice_number is null then
    perform pg_temp.info('SETUP', 'invoice numbering was not configured; set to 990001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set starting_invoice_number = 990001 where singleton'));
  end if;
  if v_ready and v_set.payment_receipt_starting_number is null then
    perform pg_temp.info('SETUP', 'payment receipt numbering was not configured; set to 880001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton'));
  end if;

  if v_ready then
    begin
      v_m := pg_temp.fixture('0040 A', '9000400001', 1000);
      v_m2 := pg_temp.fixture('0040 B', '9000400002', 600);
      v_m3 := pg_temp.fixture('0040 C', '9000400003', 500);
    exception when others then
      v_m := null;
      v_err := sqlstate || ' ' || sqlerrm;
    end;
  end if;

  if not v_ready then
    perform pg_temp.skip('E / S / A / I / D / L / U', 'migration 0040 (or a prerequisite) is not applied');
  elsif v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif v_m is null then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
  elsif not exists (select 1 from public.center_profile where singleton) or v_set.singleton is null then
    perform pg_temp.skip('every scenario', 'the centre profile or the invoice settings row is missing, so no document can be issued');
  else
    -- ===== Setup: membership A (1000) with two payments ====================================================================
    v_p1 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 5,
      '[{"method":"cash","amount":"300"},{"method":"upi","amount":"200","reference_id":"ZZ-UPI-40","notes":"ZZ note"}]', 'true'));
    v_p2 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 3, '[{"method":"cash","amount":"300"}]', 'false'));
    select * into v_mem from public.memberships where id = v_m;
    perform pg_temp.rec('S0 setup: payment 1 = cash 300 + UPI 200 (500), payment 2 = cash 300; the membership is Partially Paid with no payment date',
      v_p1 is not null and v_p2 is not null and v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null
      and pg_temp.balanced(v_p1) and pg_temp.balanced(v_p2), coalesce(v_mem.payment_status, 'NULL'));

    if v_p1 is null or v_p2 is null then
      perform pg_temp.skip('E / S / A / I', 'the setup payments could not be recorded');
    else
      v_nums := pg_temp.numbers();

      -- ===== E1. Date, method, amount, reference and notes all change in one edit =======================================
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 4)::text,
        '[{"method":"card","amount":"350","reference_id":"  ZZ-CARD-1  ","notes":"n1"}]');
      select * into v_pay from public.membership_payments where id = v_p1;
      perform pg_temp.rec('E1a the date and the total change: payment 1 is now 350 on the new date, its tax choice untouched',
        v_out = v_p1::text and v_pay.payment_date = v_today - 4 and v_pay.amount = 350 and v_pay.issue_tax_invoice, coalesce(v_out, 'NULL'));
      perform pg_temp.rec('E1b its methods were REPLACED: one card method of 350 with the trimmed reference and the note, and the old cash and UPI rows are gone',
        (select count(*) from public.membership_payment_methods where payment_id = v_p1) = 1
        and exists (select 1 from public.membership_payment_methods where payment_id = v_p1 and position = 1
                      and method = 'card' and amount = 350 and reference_id = 'ZZ-CARD-1' and notes = 'n1')
        and pg_temp.balanced(v_p1), '');
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('E1c payment 2 is untouched, and the membership is still Partially Paid (350 + 300 of 1000) with no payment date',
        (select amount from public.membership_payments where id = v_p2) = 300
        and (select payment_date from public.membership_payments where id = v_p2) = v_today - 3
        and v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null, '');

      -- A1. The audit row.
      select * into v_edit from public.membership_payment_edits where payment_id = v_p1 and previous_amount = 500 and new_amount = 350;
      perform pg_temp.rec('A1a the edit is audited: who, the previous and new amount, and the previous and new payment date',
        v_edit.id is not null and v_edit.edited_by = v_admin
        and v_edit.previous_payment_date = v_today - 5 and v_edit.new_payment_date = v_today - 4, '');
      -- The audit allocations of THIS migration are {method, amount, reference_id, notes} - no method id, because the
      -- method rows are replaced and their ids mean nothing afterwards. 0038's edit_payment_amount rows carry
      -- {id, method, amount} instead; both shapes live in membership_payment_edits.
      perform pg_temp.rec('A1b ... with the previous methods (cash 300; UPI 200 with its reference and note) and the new method (card 350 with its trimmed reference)',
        jsonb_array_length(v_edit.previous_allocations) = 2
        and v_edit.previous_allocations -> 0 ->> 'method' = 'cash' and (v_edit.previous_allocations -> 0 ->> 'amount')::numeric = 300
        and v_edit.previous_allocations -> 1 ->> 'method' = 'upi' and (v_edit.previous_allocations -> 1 ->> 'amount')::numeric = 200
        and v_edit.previous_allocations -> 1 ->> 'reference_id' = 'ZZ-UPI-40' and v_edit.previous_allocations -> 1 ->> 'notes' = 'ZZ note'
        and jsonb_array_length(v_edit.new_allocations) = 1
        and v_edit.new_allocations -> 0 ->> 'method' = 'card' and (v_edit.new_allocations -> 0 ->> 'amount')::numeric = 350
        and v_edit.new_allocations -> 0 ->> 'reference_id' = 'ZZ-CARD-1' and v_edit.new_allocations -> 0 ->> 'notes' = 'n1', '');

      -- ===== E2. Methods are ADDED; the total reaches the membership amount: Paid ==========================================
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 4)::text,
        '[{"method":"cash","amount":"400"},{"method":"upi","amount":"250","reference_id":"ZZ-UPI-2"},{"method":"bank_transfer","amount":"50","notes":"bt"}]');
      perform pg_temp.rec('E2a adding methods: three rows in the order given, positions 1-3, adding up to the new payment total of 700',
        v_out = v_p1::text
        and (select count(*) from public.membership_payment_methods where payment_id = v_p1) = 3
        and (select string_agg(m.position || ':' || m.method || ':' || m.amount, ',' order by m.position) from public.membership_payment_methods m where m.payment_id = v_p1)
            = '1:cash:400.00,2:upi:250.00,3:bank_transfer:50.00'
        and (select amount from public.membership_payments where id = v_p1) = 700 and pg_temp.balanced(v_p1), coalesce(v_out, 'NULL'));
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('S1 700 + 300 now covers the 1000: the membership becomes Paid, its payment date is the latest payment''s date, and no membership-level invoice appears',
        v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 3
        and not exists (select 1 from public.invoices where membership_id = v_m), coalesce(v_mem.payment_status, 'NULL') || ' ' || coalesce(v_mem.payment_date::text, 'NULL'));
      perform pg_temp.rec('A2 the audit row of that edit holds the previous single card method and the three new ones',
        exists (select 1 from public.membership_payment_edits e where e.payment_id = v_p1 and e.previous_amount = 350 and e.new_amount = 700
                  and jsonb_array_length(e.previous_allocations) = 1 and jsonb_array_length(e.new_allocations) = 3
                  and e.previous_payment_date = v_today - 4 and e.new_payment_date = v_today - 4), '');

      -- ===== E3. A method is REMOVED; the total falls: Partially Paid again ============================================
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 4)::text, '[{"method":"cash","amount":"400"}]');
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('E3 removing methods: one cash row of 400 remains (the others are gone), the payment total is 400 and the methods add up to it',
        v_out = v_p1::text and (select count(*) from public.membership_payment_methods where payment_id = v_p1) = 1
        and (select amount from public.membership_payments where id = v_p1) = 400 and pg_temp.balanced(v_p1), coalesce(v_out, 'NULL'));
      perform pg_temp.rec('S2 700 of 1000 is covered: the membership falls back to Partially Paid and loses its payment date',
        v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null, coalesce(v_mem.payment_status, 'NULL'));

      -- ===== E4. Back to Paid; then a DATE-only edit moves the membership's payment date ==================================
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 4)::text, '[{"method":"cash","amount":"700"}]');
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('S3 raising payment 1 to 700 makes the membership Paid again, dated by the latest payment (payment 2, 3 days ago)',
        v_out = v_p1::text and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 3, coalesce(v_out, 'NULL'));
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"700"}]');
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('S4 moving payment 1 to a later date (yesterday) with nothing else changed: still Paid, and the membership''s payment date follows the latest payment',
        v_out = v_p1::text and (select payment_date from public.membership_payments where id = v_p1) = v_today - 1
        and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 1, coalesce(v_out, 'NULL'));
      perform pg_temp.rec('A3 a date-only edit is audited too: same amount before and after, the two dates differ',
        exists (select 1 from public.membership_payment_edits e where e.payment_id = v_p1 and e.previous_amount = 700 and e.new_amount = 700
                  and e.previous_payment_date = v_today - 4 and e.new_payment_date = v_today - 1), '');

      -- ===== E5. An unchanged edit changes nothing and is not audited =======================================================
      v_snap := pg_temp.state(v_m);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"700"}]');
      perform pg_temp.rec('E5 an edit that changes nothing succeeds, changes no row and writes no audit row', v_out = v_p1::text and pg_temp.state(v_m) = v_snap, coalesce(v_out, 'NULL'));

      -- ===== E7. A reference ID and notes made only of spaces are stored as NULL ============================================
      -- Payment 1 (no document, cash 700 on T-1, no reference or note) first gets a reference and a note, so that the next
      -- edit has something to remove: submitting spaces-only values must then CLEAR them (NULL), not keep or store spaces.
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text,
        '[{"method":"cash","amount":"700","reference_id":"ZZ-REF-7","notes":"ZZ note 7"}]');
      perform pg_temp.rec('E7a setup: the same payment now carries a reference ID and a note (date, amount and status unchanged)',
        v_out = v_p1::text
        and exists (select 1 from public.membership_payment_methods where payment_id = v_p1 and position = 1 and method = 'cash'
                      and amount = 700 and reference_id = 'ZZ-REF-7' and notes = 'ZZ note 7')
        and (select payment_date = v_today - 1 and amount = 700 from public.membership_payments where id = v_p1), coalesce(v_out, 'NULL'));

      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text,
        '[{"method":"cash","amount":"700","reference_id":"   ","notes":"      "}]');
      select * into v_mem from public.memberships where id = v_m;
      perform pg_temp.rec('E7b spaces-only reference ID and notes: the edit succeeds and both are stored as NULL; one cash row of 700, the date and the membership (Paid, dated yesterday) are unchanged',
        v_out = v_p1::text
        and (select count(*) from public.membership_payment_methods where payment_id = v_p1) = 1
        and exists (select 1 from public.membership_payment_methods where payment_id = v_p1 and position = 1 and method = 'cash'
                      and amount = 700 and reference_id is null and notes is null)
        and (select payment_date = v_today - 1 and amount = 700 from public.membership_payments where id = v_p1)
        and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 1 and pg_temp.balanced(v_p1), coalesce(v_out, 'NULL'));

      -- The audit row of the second edit (the one whose previous method still had the reference ID).
      select * into v_edit from public.membership_payment_edits
        where payment_id = v_p1 and previous_allocations -> 0 ->> 'reference_id' = 'ZZ-REF-7';
      perform pg_temp.rec('E7c that edit is audited with the NORMALIZED values: previous reference ID and note, new ones NULL (not spaces), amounts and dates equal, and no method id',
        v_edit.id is not null and v_edit.edited_by = v_admin
        and v_edit.previous_amount = 700 and v_edit.new_amount = 700
        and v_edit.previous_payment_date = v_today - 1 and v_edit.new_payment_date = v_today - 1
        and v_edit.previous_allocations -> 0 ->> 'notes' = 'ZZ note 7'
        and jsonb_typeof(v_edit.new_allocations -> 0 -> 'reference_id') = 'null'
        and jsonb_typeof(v_edit.new_allocations -> 0 -> 'notes') = 'null'
        and not ((v_edit.new_allocations -> 0) ? 'id') and not ((v_edit.previous_allocations -> 0) ? 'id'), '');

      -- ===== I. Invalid edits are rejected and change nothing ================================================================
      -- Payment 1 may now total up to 700 (1000 less payment 2's 300).
      select count(*) into v_audit from public.membership_payment_edits where payment_id = v_p1;
      v_snap := pg_temp.state(v_m);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"0"}]');
      perform pg_temp.rec('I1 a zero amount is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today + 1)::text, '[{"method":"cash","amount":"700"}]');
      perform pg_temp.rec('I2 a future payment date is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"700.01"}]');
      perform pg_temp.rec('I3 a total above what the membership allows (700.01 > 700) is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"400"},{"method":"upi","amount":"300.01"}]');
      perform pg_temp.rec('I4 the SUM of several methods over the limit is rejected too (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[]');
      perform pg_temp.rec('I5 an empty list of methods is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, null);
      perform pg_temp.rec('I5b no methods at all (null) is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cheque","amount":"10"}]');
      perform pg_temp.rec('I6 an unknown method is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"10.005"}]');
      perform pg_temp.rec('I7 more than two decimals is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, v_p1, null, '[{"method":"cash","amount":"700"}]');
      perform pg_temp.rec('I8 a missing payment date is rejected (22023)', v_out = 'ERR:22023', v_out);
      v_out := pg_temp.edit(v_admin, gen_random_uuid(), (v_today - 1)::text, '[{"method":"cash","amount":"10"}]');
      perform pg_temp.rec('I9 a payment that does not exist is rejected (P0002)', v_out = 'ERR:P0002', v_out);
      -- This one fails only at the INSERT, AFTER the old methods were deleted and nothing else: the whole edit must undo.
      v_out := pg_temp.edit(v_admin, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"700","reference_id":"' || repeat('x', 101) || '"}]');
      perform pg_temp.rec('I10 a failure AFTER the first write (a 101-character reference violates the table check, 23514) undoes the whole edit', v_out = 'ERR:23514', v_out);
      perform pg_temp.rec('I11 after every rejection the saved data is exactly as it was: membership, payments, methods and audit rows byte for byte',
        pg_temp.state(v_m) = v_snap and (select count(*) from public.membership_payment_edits where payment_id = v_p1) = v_audit, '');

      -- ===== Authorization ====================================================================================================
      if v_instructor is null then
        perform pg_temp.skip('U1 instructor', 'no instructor profile found');
      else
        v_out := pg_temp.edit(v_instructor, v_p1, (v_today - 1)::text, '[{"method":"cash","amount":"600"}]');
        perform pg_temp.rec('U1 an Instructor cannot edit a payment (42501)', v_out = 'ERR:42501' and pg_temp.state(v_m) = v_snap, v_out);
      end if;
      v_code := pg_temp.run_anon(format('select public.edit_payment(%L::uuid, %L::date, ''[]''::jsonb)', v_p1, v_today));
      perform pg_temp.rec('U2 an anonymous caller cannot edit a payment (42501)', v_code = '42501', v_code);

      -- ===== The deferred checks of 0034 are satisfied by everything above =====================================================
      begin
        set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger immediate;
        v_code := 'OK';
      exception when others then
        v_code := sqlstate || ' ' || sqlerrm;
      end;
      set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger deferred;
      perform pg_temp.rec('E6 forcing the deferred 0034 checks after all those edits: methods add up to each payment, and no membership is over-paid', v_code = 'OK', v_code);

      -- ===== N. Editing consumes no number ====================================================================================
      perform pg_temp.rec('N1 none of the edits, valid or rejected, moved a counter, a reservation or the invoice count', pg_temp.numbers() = v_nums, v_nums || ' -> ' || pg_temp.numbers());
    end if;

    -- ===== D. Documents freeze a payment ===================================================================================
    v_pa := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m2, v_today - 4, '[{"method":"cash","amount":"400"}]', 'true'));
    v_pb := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m2, v_today - 2, '[{"method":"cash","amount":"200"}]', 'false'));
    if v_pa is null or v_pb is null then
      perform pg_temp.skip('D', 'the document-scenario payments could not be recorded');
    else
      v_out := pg_temp.edit(v_admin, v_pb, (v_today - 2)::text, '[{"method":"upi","amount":"200","reference_id":"ZZ-UPI-B","notes":"b"}]');
      perform pg_temp.rec('D0 setup: before any document, payment B (200) is edited from cash to UPI with a reference',
        v_out = v_pb::text and exists (select 1 from public.membership_payment_methods where payment_id = v_pb and method = 'upi' and reference_id = 'ZZ-UPI-B'), coalesce(v_out, 'NULL'));

      v_out := pg_temp.issue(v_admin, v_pa);
      select * into v_doc from public.invoices where id = pg_temp.as_uuid(v_out);
      if v_doc.id is null then
        perform pg_temp.skip('D1-D5', 'payment A''s document could not be issued (' || coalesce(v_out, 'NULL') || ')');
      else
        v_doc_json := to_jsonb(v_doc);
        v_snap := pg_temp.state(v_m2);
        v_msg := pg_temp.edit_msg(v_admin, v_pa, (v_today - 4)::text, '[{"method":"card","amount":"400"}]');
        perform pg_temp.rec('D1 once a document is issued the payment cannot be edited: 55006 and the message that points to the correction', v_msg = '55006 A document has been issued for this payment, so it cannot be edited.', v_msg);
        v_out := pg_temp.edit(v_admin, v_pa, (v_today - 5)::text, '[{"method":"cash","amount":"300"}]');
        perform pg_temp.rec('D2 ... whatever the edit (date, method and a smaller amount too) - and nothing changed, the document included',
          v_out = 'ERR:55006' and pg_temp.state(v_m2) = v_snap and (select to_jsonb(i) from public.invoices i where i.id = v_doc.id) = v_doc_json, v_out);

        v_out := pg_temp.edit(v_admin, v_pb, (v_today - 1)::text, '[{"method":"upi","amount":"200","reference_id":"ZZ-UPI-B","notes":"b"}]');
        perform pg_temp.rec('D3 another payment of the same membership, with no document, can still be edited', v_out = v_pb::text and (select payment_date from public.membership_payments where id = v_pb) = v_today - 1, coalesce(v_out, 'NULL'));

        v_out := pg_temp.correct(v_admin, v_doc.id, 'ZZVERIFY 0040 correction');
        v_snap := pg_temp.state(v_m2);
        v_msg := pg_temp.edit_msg(v_admin, v_pa, (v_today - 4)::text, '[{"method":"card","amount":"400"}]');
        perform pg_temp.rec('D4 after Cancel and Reissue (one cancelled + one issued document) the payment still cannot be edited (55006)',
          v_msg like '55006 %' and pg_temp.state(v_m2) = v_snap
          and (select count(*) from public.invoices where payment_id = v_pa and status = 'cancelled') = 1
          and (select count(*) from public.invoices where payment_id = v_pa and status = 'issued') = 1, coalesce(v_out, 'NULL') || ' / ' || v_msg);

        -- D5. A payment whose ONLY document is cancelled stays frozen. Cancel and Reissue always issues a replacement,
        -- so this state is built as the owner, the way correct_payment_document cancels: inside the transaction, under
        -- the yoga.invoice_cancel marker that the freeze trigger honours, changing only the cancellation columns.
        v_out := pg_temp.issue(v_admin, v_pb);
        select * into v_doc from public.invoices where id = pg_temp.as_uuid(v_out);
        if v_doc.id is null then
          perform pg_temp.skip('D5', 'payment B''s document could not be issued (' || coalesce(v_out, 'NULL') || ')');
        else
          perform set_config('yoga.invoice_cancel', v_doc.id::text, true);
          v_code := pg_temp.run_owner(format(
            'update public.invoices set status = ''cancelled'', cancelled_at = now(), cancelled_by = %L, cancellation_reason = %L, updated_at = now() where id = %L',
            v_admin, 'ZZVERIFY 0040 cancelled, not replaced', v_doc.id));
          perform set_config('yoga.invoice_cancel', '', true);

          select * into v_doc from public.invoices where id = v_doc.id;
          if v_code <> 'OK' or v_doc.status <> 'cancelled' or (select count(*) from public.invoices where payment_id = v_pb) <> 1 then
            perform pg_temp.skip('D5', 'could not build a payment whose only document is cancelled (' || v_code || ')');
          else
            perform pg_temp.rec('D5a setup: payment B has exactly one document, it is CANCELLED, and no issued or replacing document exists',
              (select count(*) from public.invoices where payment_id = v_pb) = 1
              and not exists (select 1 from public.invoices where payment_id = v_pb and status = 'issued')
              and not exists (select 1 from public.invoices where replaces_id = v_doc.id)
              and v_doc.replaces_id is null, '');

            v_doc_json := to_jsonb(v_doc);
            select * into v_pay from public.membership_payments where id = v_pb;
            select * into v_mem from public.memberships where id = v_m2;
            v_snap := pg_temp.state(v_m2);
            select count(*) into v_audit from public.membership_payment_edits where payment_id = v_pb;

            -- An edit that would be valid without the document: 150 is within the 200 this payment may total.
            v_msg := pg_temp.edit_msg(v_admin, v_pb, (v_today - 3)::text, '[{"method":"card","amount":"150","reference_id":"ZZ-CXL","notes":"x"}]');
            perform pg_temp.rec('D5b editing a payment whose only document is cancelled is refused: 55006 and the same message',
              v_msg = '55006 A document has been issued for this payment, so it cannot be edited.', v_msg);
            perform pg_temp.rec('D5c ... and nothing changed: the payment''s amount, date and methods, the membership''s status and payment date, the audit history and the cancelled document',
              (select amount from public.membership_payments where id = v_pb) = v_pay.amount
              and (select payment_date from public.membership_payments where id = v_pb) = v_pay.payment_date
              and exists (select 1 from public.membership_payment_methods where payment_id = v_pb and method = 'upi' and reference_id = 'ZZ-UPI-B')
              and not exists (select 1 from public.membership_payment_methods where payment_id = v_pb and reference_id = 'ZZ-CXL')
              and (select payment_status from public.memberships where id = v_m2) = v_mem.payment_status
              and (select payment_date from public.memberships where id = v_m2) is not distinct from v_mem.payment_date
              and (select count(*) from public.membership_payment_edits where payment_id = v_pb) = v_audit
              and (select to_jsonb(i) from public.invoices i where i.id = v_doc.id) = v_doc_json
              and pg_temp.state(v_m2) = v_snap, '');
          end if;
        end if;
      end if;
    end if;

    -- ===== L. The edit is atomic even when the membership update at the END is refused ======================================
    -- Legacy shape: a membership-level invoice (issued when a membership is marked Paid with no payments) AND a payment.
    v_code := pg_temp.run_owner(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 3, v_m3));
    select id into v_ldoc from public.invoices where membership_id = v_m3 and payment_id is null;
    if v_ldoc is null then
      perform pg_temp.skip('L1-L3', 'could not build a membership-level invoice for fixture C (' || v_code || ')');
    else
      begin
        v_pl := pg_temp.add_payment(v_m3, v_today - 3, 500, true);
        set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger immediate;
        v_code := 'OK';
      exception when others then
        v_code := sqlstate || ' ' || sqlerrm;
        v_pl := null;
      end;
      set constraints membership_payments_check_totals_trigger, membership_payment_methods_check_totals_trigger deferred;

      if v_pl is null then
        perform pg_temp.skip('L1-L3', 'could not write fixture C''s payment directly (' || v_code || ')');
      else
        v_snap := pg_temp.state(v_m3);
        select count(*) into v_audit from public.membership_payment_edits where payment_id = v_pl;
        v_msg := pg_temp.edit_msg(v_admin, v_pl, (v_today - 2)::text, '[{"method":"upi","amount":"500","reference_id":"ZZ-UPI-L"}]');
        perform pg_temp.rec('L1 a new payment date would move the membership''s payment date, which its invoice locks: the edit is refused (55006)', v_msg like '55006 %', v_msg);
        perform pg_temp.rec('L2 ... and EVERYTHING is rolled back although the function had already replaced the methods and the date: the payment, its methods, the audit trail and the membership are exactly as before',
          pg_temp.state(v_m3) = v_snap and (select count(*) from public.membership_payment_edits where payment_id = v_pl) = v_audit
          and (select method from public.membership_payment_methods where payment_id = v_pl) = 'cash', '');
        v_out := pg_temp.edit(v_admin, v_pl, (v_today - 3)::text, '[{"method":"upi","amount":"500","reference_id":"ZZ-UPI-L"}]');
        select * into v_mem from public.memberships where id = v_m3;
        perform pg_temp.rec('L3 an edit that leaves the membership''s status and payment date alone is allowed (cash -> UPI), and the membership is untouched',
          v_out = v_pl::text and (select method from public.membership_payment_methods where payment_id = v_pl) = 'upi'
          and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 3, coalesce(v_out, 'NULL'));
      end if;
    end if;
  end if;

  -- Z. Nothing real was touched ----------------------------------------------------------------------------------------------------
  select array_agg(p.id) into v_fixture_payments
  from public.membership_payments p
  join public.memberships m on m.id = p.membership_id
  join public.students s on s.id = m.student_id
  where s.full_name like 'ZZVERIFY%';
  v_fixture_payments := coalesce(v_fixture_payments, '{}');

  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1
  from public.invoices i
  where i.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash1
  from public.membership_payments p where p.id <> all (v_fixture_payments);
  select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) into v_met_hash1
  from public.membership_payment_methods x where x.payment_id <> all (v_fixture_payments);
  select md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by e.id), '')) into v_aud_hash1
  from public.membership_payment_edits e where e.payment_id <> all (v_fixture_payments);

  perform pg_temp.rec('Z1 every pre-existing invoice and receipt is byte-for-byte unchanged', v_inv_hash0 = v_inv_hash1, '');
  perform pg_temp.rec('Z2 every pre-existing payment is byte-for-byte unchanged', v_pay_hash0 = v_pay_hash1, '');
  perform pg_temp.rec('Z3 every pre-existing payment method is byte-for-byte unchanged', v_met_hash0 = v_met_hash1, '');
  perform pg_temp.rec('Z4 every pre-existing audit row is byte-for-byte unchanged', v_aud_hash0 = v_aud_hash1, '');
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
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%')                              as leftover_students,
--          (select count(*) from public.membership_payment_methods where reference_id like 'ZZ-%')              as leftover_methods,
--          (select count(*) from public.membership_payment_edits e
--             join public.membership_payments p on p.id = e.payment_id
--             join public.memberships m on m.id = p.membership_id
--             join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%')                 as leftover_audit_rows,
--          (select count(*) from public.invoices where cancellation_reason like 'ZZVERIFY%')                    as leftover_cancellations,
--          next_invoice_number, payment_receipt_next_number
--   from public.invoice_settings;
-- leftover_* must all be 0, and both counters must equal their values before the run.
