-- ===========================================================================
-- V1 Invoice / Receipt — Migration 0025 + 0026 BEHAVIOURAL verification
-- Exercises supabase/migrations/0025_payment_date_invoice_settings.sql and
-- supabase/migrations/0026_invoices.sql
-- ===========================================================================
--
-- Companion to verify_0025_* and verify_0026_invoices.sql. Those are read-only
-- and prove the machinery is INSTALLED. This one runs it and proves it BEHAVES,
-- then throws the work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It genuinely writes: it marks existing Pending memberships Paid (which
--     issues invoices), edits invoice numbers, and changes settings. None of it
--     is committed.
--   * NOTHING THAT CONSUMES A SEQUENCE IS EVER INSERTED. It never inserts a
--     student or a membership (their YC- / MEM- codes come from sequences that
--     nextval() does not give back on rollback). It reuses existing memberships.
--     Invoices use no sequence at all — numbering is a locked counter row — so
--     rolling back the invoices also rolls back the counter.
--   * The temp table and the temp helper functions disappear with the
--     transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor ever reports an open
--     transaction, issue `rollback;` before doing anything else.
--
-- FIXTURE
--   Needs an admin profile and up to four existing Pending memberships with no
--   invoice (and, for scenario L, an existing Paid membership with no payment
--   date). Anything it cannot find is reported NOT TESTED with the reason. If
--   numbering is already configured, or invoices already exist, the starting
--   number is left alone and the counter's current state is used.
--
-- AUTHENTICATION
--   Client-side behaviour is exercised as an authenticated ADMIN (and, where
--   one exists, an INSTRUCTOR) by setting request.jwt.claims and switching to
--   the `authenticated` role, exactly as PostgREST does, as verify_0014 and
--   verify_0015 do. No service-role key is used.
--
-- CONCURRENCY
--   One SQL session cannot run two transactions at once, so true concurrency
--   cannot be demonstrated here. What is demonstrated: consecutive issues get
--   distinct, increasing numbers; the counter row is the single serialisation
--   point (verified structurally in verify_0026_invoices.sql, check 21); the
--   unique index rejects a duplicate (scenario M). To see two sessions queue,
--   follow the TWO-SESSION PROCEDURE at the bottom of this file.
--
-- OUTPUT: one grid of seq / test / status / detail, plus a SUMMARY row.
-- Statuses: PASS, FAIL, NOT TESTED (no safe fixture — reason in detail), INFO.
-- ===========================================================================

begin;

create temp table _verify_results (
  seq    int,
  test   text,
  status text,
  detail text
) on commit drop;

-- Record a PASS/FAIL (owner only — never call while a client role is set).
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

-- Run one scalar query as an authenticated user; return its text or 'ERR:<sqlstate>'.
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

do $$
declare
  v_admin        uuid;
  v_instructor   uuid;
  v_today        date;
  v_pend         uuid[];
  v_paid_null    uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid;
  v_n1 bigint; v_n2 bigint; v_n3 bigint;
  v_start_before bigint;
  v_had_invoices boolean;
  v_expected     bigint;
  v_next         bigint;
  v_counter      bigint;
  v_code         text;
  v_out          text;
  v_inv          public.invoices%rowtype;
  v_mem          public.memberships%rowtype;
  v_student_name text;
  v_center_name  text;
  v_tax          numeric(10, 2);
begin
  -- =========================================================================
  -- SETUP — as the owning role (no RLS)
  -- =========================================================================
  select (now() at time zone public.centre_timezone())::date into v_today;

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  select array_agg(id) into v_pend from (
    select m.id from public.memberships m
    where m.payment_status = 'pending'
      and not exists (select 1 from public.invoices i where i.membership_id = m.id)
    order by m.created_at
    limit 4
  ) s;

  select m.id into v_paid_null from public.memberships m
  where m.payment_status = 'paid' and m.payment_date is null
    and not exists (select 1 from public.invoices i where i.membership_id = m.id)
  order by m.created_at limit 1;

  select starting_invoice_number into v_start_before from public.invoice_settings where singleton;
  v_had_invoices := exists (select 1 from public.invoices);

  perform pg_temp.info('SETUP',
    format('admin=%s instructor=%s pending fixtures=%s paid-without-date=%s starting=%s invoices-already=%s',
           coalesce(v_admin::text, 'none'), coalesce(v_instructor::text, 'none'),
           coalesce(array_length(v_pend, 1), 0), coalesce(v_paid_null::text, 'none'),
           coalesce(v_start_before::text, 'not configured'), v_had_invoices));

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found; every scenario needs an authorized caller');
  elsif coalesce(array_length(v_pend, 1), 0) < 3 then
    perform pg_temp.skip('every numbering scenario',
      'needs at least 3 existing Pending memberships without an invoice; this database has ' ||
      coalesce(array_length(v_pend, 1), 0));
  else
    v_m1 := v_pend[1]; v_m2 := v_pend[2]; v_m3 := v_pend[3]; v_m4 := v_pend[4];

    -- Deterministic configuration for this run (rolled back).
    update public.invoice_settings
    set tax_enabled = false, terms = 'TERMS-ONE',
        signatory_name = 'SIGNATORY-ONE', signatory_designation = 'DESIGNATION-ONE',
        document_title = 'invoice'
    where singleton;

    -- =======================================================================
    -- A. Unconfigured numbering: becoming Paid saves, defaults the date, issues nothing
    -- =======================================================================
    if v_start_before is null and not v_had_invoices then
      v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
      select * into v_mem from public.memberships where id = v_m1;
      perform pg_temp.rec('A1 numbering unconfigured: the membership still saves as Paid', v_code = 'OK' and v_mem.payment_status = 'paid', 'sqlstate ' || v_code);
      perform pg_temp.rec('A2 payment_date defaulted to today in the centre timezone', v_mem.payment_date = v_today,
        coalesce(v_mem.payment_date::text, 'NULL') || ' vs ' || v_today);
      perform pg_temp.rec('A3 no invoice was issued while numbering is unconfigured',
        not exists (select 1 from public.invoices where membership_id = v_m1), '');
      v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''pending'' where id = %L', v_m1));
      select * into v_mem from public.memberships where id = v_m1;
      perform pg_temp.rec('A4 Paid -> Pending without an invoice is allowed and clears payment_date',
        v_code = 'OK' and v_mem.payment_status = 'pending' and v_mem.payment_date is null, 'sqlstate ' || v_code);
      -- Configure for the rest of the run, using the documented example.
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    else
      perform pg_temp.skip('A1-A4 unconfigured behaviour',
        'numbering is already configured or invoices already exist in this database');
    end if;

    -- The number the next issue must receive (skipping any already used).
    select coalesce(next_invoice_number, starting_invoice_number) into v_expected from public.invoice_settings where singleton;
    while exists (select 1 from public.invoices where invoice_number = v_expected) loop
      v_expected := v_expected + 1;
    end loop;

    -- =======================================================================
    -- B. Becoming Paid issues the invoice, atomically, with a full snapshot
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    select * into v_inv from public.invoices where membership_id = v_m1;
    v_i1 := v_inv.id; v_n1 := v_inv.invoice_number;
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('B1 Pending -> Paid saved and issued an invoice', v_code = 'OK' and v_i1 is not null, 'sqlstate ' || v_code);
    perform pg_temp.rec('B2 first invoice got the expected number (configured start / counter)', v_n1 = v_expected,
      coalesce(v_n1::text, 'NULL') || ' vs expected ' || v_expected);
    perform pg_temp.rec('B3 invoice_date defaults to payment_date, which is today',
      v_inv.invoice_date = v_inv.payment_date and v_inv.payment_date = v_today and v_mem.payment_date = v_inv.payment_date, '');
    select s.full_name into v_student_name from public.students s where s.id = v_mem.student_id;
    select cp.name into v_center_name from public.center_profile cp where cp.singleton;
    perform pg_temp.rec('B4 snapshot copied from membership, student and centre profile',
      v_inv.total_amount = v_mem.amount and v_inv.currency = v_mem.currency
      and v_inv.plan = v_mem.plan and v_inv.period_start = v_mem.start_date and v_inv.period_end = v_mem.end_date
      and v_inv.customer_name = v_student_name and v_inv.business_name = v_center_name
      and v_inv.description like '% Membership', '');
    perform pg_temp.rec('B5 settings copied: document title, terms, signatory',
      v_inv.document_title = 'invoice' and v_inv.terms = 'TERMS-ONE'
      and v_inv.signatory_name = 'SIGNATORY-ONE' and v_inv.signatory_designation = 'DESIGNATION-ONE', '');
    perform pg_temp.rec('B6 tax disabled: every tax field is NULL',
      not v_inv.tax_enabled and v_inv.tax_name is null and v_inv.tax_rate is null
      and v_inv.taxable_amount is null and v_inv.tax_amount is null, '');

    -- =======================================================================
    -- C. Consecutive issues: distinct, increasing numbers; counter advances
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m2));
    select id, invoice_number into v_i2, v_n2 from public.invoices where membership_id = v_m2;
    perform pg_temp.rec('C1 second invoice issued with a different, higher number', v_i2 is not null and v_n2 > v_n1,
      coalesce(v_n1::text, '?') || ' then ' || coalesce(v_n2::text, 'NULL'));
    perform pg_temp.rec('C2 counter advanced to last issued + 1',
      (select next_invoice_number from public.invoice_settings where singleton) = v_n2 + 1, '');
    if not v_had_invoices then
      perform pg_temp.rec('C3 fresh sequence is gapless: n, n+1', v_n2 = v_n1 + 1, '');
    end if;

    -- =======================================================================
    -- D / E. Paid -> Pending and payment_date are locked once an invoice exists
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''pending'' where id = %L', v_m1));
    perform pg_temp.rec('D1 Paid -> Pending is rejected once an invoice exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    perform pg_temp.rec('D2 the membership is still Paid with its payment date',
      (select payment_status = 'paid' and payment_date = v_today from public.memberships where id = v_m1), '');
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_date = payment_date - 1 where id = %L', v_m1));
    perform pg_temp.rec('E1 payment_date cannot change once an invoice exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = amount where id = %L', v_m1));
    perform pg_temp.rec('E2 other membership edits are unaffected (existing behaviour)', v_code = 'OK', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    perform pg_temp.rec('E3 re-saving a Paid membership does not issue another invoice or change anything',
      v_code = 'OK' and (select count(*) = 1 from public.invoices where membership_id = v_m1), 'sqlstate ' || v_code);

    -- =======================================================================
    -- F. Clients cannot write invoices directly; instructors see nothing
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('insert into public.invoices (membership_id) values (%L)', v_m3));
    perform pg_temp.rec('F1 admin cannot INSERT into invoices directly (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set invoice_number = 7 where id = %L', v_i1));
    perform pg_temp.rec('F2 admin cannot UPDATE invoices directly (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('delete from public.invoices where id = %L', v_i1));
    perform pg_temp.rec('F3 admin cannot DELETE invoices (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_out := pg_temp.query_as(v_admin, 'select count(*)::text from public.invoices');
    perform pg_temp.rec('F4 admin can SELECT invoices', v_out ~ '^[0-9]+$' and v_out::int >= 2, v_out);
    if v_instructor is null then
      perform pg_temp.skip('F5-F6 instructor access', 'no instructor profile found');
    else
      v_out := pg_temp.query_as(v_instructor, 'select count(*)::text from public.invoices');
      perform pg_temp.rec('F5 an instructor sees no invoices', v_out = '0', v_out);
      v_code := pg_temp.run_as(v_instructor, format('select public.issue_invoice(%L, (now() at time zone public.centre_timezone())::date, (now() at time zone public.centre_timezone())::date)', v_m4));
      perform pg_temp.rec('F6 an instructor cannot call issue_invoice (42501)', v_code = '42501', 'sqlstate ' || v_code);
    end if;

    -- =======================================================================
    -- G. The snapshot is frozen — for every caller, even the owner
    -- =======================================================================
    begin
      update public.invoices set total_amount = total_amount + 1 where id = v_i1;
      v_code := 'OK';
    exception when others then v_code := sqlstate; end;
    perform pg_temp.rec('G1 changing the amount of an issued invoice is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
    begin
      update public.invoices set customer_name = 'X' where id = v_i1;
      v_code := 'OK';
    exception when others then v_code := sqlstate; end;
    perform pg_temp.rec('G2 changing customer identity is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
    begin
      delete from public.invoices where id = v_i1;
      v_code := 'OK';
    exception when others then v_code := sqlstate; end;
    perform pg_temp.rec('G3 deleting an invoice is rejected even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);

    -- =======================================================================
    -- H. Settings: starting number locked; the counter is not client-writable
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set next_invoice_number = 5');
    perform pg_temp.rec('H1 a client cannot update next_invoice_number (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set starting_invoice_number = starting_invoice_number + 1');
    perform pg_temp.rec('H2 the starting number is locked once an invoice exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set starting_invoice_number = starting_invoice_number - 1');
    perform pg_temp.rec('H3 it cannot be lowered either (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set terms = terms');
    perform pg_temp.rec('H4 other settings stay editable by an admin', v_code = 'OK', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, 'insert into public.invoice_settings (singleton) values (false)');
    perform pg_temp.rec('H5 no client insert into invoice_settings (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, 'delete from public.invoice_settings');
    perform pg_temp.rec('H6 no client delete from invoice_settings (42501)', v_code = '42501', 'sqlstate ' || v_code);

    -- =======================================================================
    -- I. Manual number / date edit (update_invoice_details)
    -- =======================================================================
    select starting_invoice_number into v_expected from public.invoice_settings where singleton;
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, (now() at time zone public.centre_timezone())::date)', v_i2, v_expected - 1));
    perform pg_temp.rec('I1 a number below the starting number is rejected (22023)', v_code = '22023', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, 0, (now() at time zone public.centre_timezone())::date)', v_i2));
    perform pg_temp.rec('I2 zero is rejected (22023)', v_code = '22023', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, (now() at time zone public.centre_timezone())::date)', v_i2, v_n1));
    perform pg_temp.rec('I3 a duplicate number is rejected (23505)', v_code = '23505', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, ((now() at time zone public.centre_timezone())::date + 1))', v_i2, v_n2));
    perform pg_temp.rec('I4 a future invoice date is rejected (22023)', v_code = '22023', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, ((now() at time zone public.centre_timezone())::date - 4000))', v_i2, v_n2));
    perform pg_temp.rec('I5 an invoice date before the payment date is rejected (22023)', v_code = '22023', 'sqlstate ' || v_code);
    if v_instructor is not null then
      v_code := pg_temp.run_as(v_instructor, format('select public.update_invoice_details(%L, %s, (now() at time zone public.centre_timezone())::date)', v_i2, v_n2 + 500));
      perform pg_temp.rec('I6 an instructor cannot edit an invoice (42501)', v_code = '42501', 'sqlstate ' || v_code);
    end if;
    -- Direct duplicate through the unique index (owner bypasses the function's own check).
    begin
      update public.invoices set invoice_number = v_n1 where id = v_i2;
      v_code := 'OK';
    exception when others then v_code := sqlstate; end;
    perform pg_temp.rec('I7 the unique index is the final protection against a duplicate number (23505)', v_code = '23505', 'sqlstate ' || v_code);

    -- Move invoice 2 AHEAD of the counter; the next issue must skip it.
    select next_invoice_number into v_counter from public.invoice_settings where singleton;
    v_next := v_counter;
    while exists (select 1 from public.invoices where invoice_number = v_next) loop
      v_next := v_next + 1;
    end loop;
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, (now() at time zone public.centre_timezone())::date)', v_i2, v_next));
    perform pg_temp.rec('I8 moving a number ahead of the counter is allowed', v_code = 'OK'
      and (select invoice_number = v_next from public.invoices where id = v_i2), 'sqlstate ' || v_code);
    perform pg_temp.rec('I9 the old number is freed but not reused automatically',
      not exists (select 1 from public.invoices where invoice_number = v_n2), '');
    perform pg_temp.rec('I10 an edit changed nothing but number and date',
      (select total_amount = (select amount from public.memberships where id = v_m2) from public.invoices where id = v_i2), '');

    -- Tax enabled for the next invoice only; membership 3 becomes Paid.
    update public.invoice_settings
    set tax_enabled = true, tax_name = 'GST', tax_rate = 18.00
    where singleton;

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m3));
    select id, invoice_number into v_i3, v_n3 from public.invoices where membership_id = v_m3;
    perform pg_temp.rec('J1 the next issue SKIPS the number an admin moved ahead',
      v_i3 is not null and v_n3 <> v_next and v_n3 <> v_n2 and v_n3 >= v_counter,
      coalesce(v_n3::text, 'NULL') || ' (moved number ' || v_next || ', counter was ' || v_counter || ')');
    if v_counter = v_next then
      perform pg_temp.rec('J2 when the counter pointed at the moved number, the next issue is the one after it', v_n3 > v_next, '');
    end if;

    -- =======================================================================
    -- K. Tax-inclusive calculation and the snapshot
    -- =======================================================================
    select * into v_inv from public.invoices where id = v_i3;
    v_tax := round(v_inv.total_amount * 18.00 / 118.00, 2);
    perform pg_temp.rec('K1 tax_amount = round(total * rate / (100 + rate), 2)', v_inv.tax_amount = v_tax,
      coalesce(v_inv.tax_amount::text, 'NULL') || ' vs ' || v_tax);
    perform pg_temp.rec('K2 taxable_amount + tax_amount = total_amount exactly',
      v_inv.taxable_amount + v_inv.tax_amount = v_inv.total_amount, '');
    perform pg_temp.rec('K3 tax name and rate are snapshotted',
      v_inv.tax_enabled and v_inv.tax_name = 'GST' and v_inv.tax_rate = 18.00, '');
    perform pg_temp.rec('K4 the membership amount keeps meaning "the final amount"',
      v_inv.total_amount = (select amount from public.memberships where id = v_m3), '');

    -- =======================================================================
    -- L. Settings / profile / student / membership changes never alter an issued invoice
    -- =======================================================================
    update public.invoice_settings
    set terms = 'TERMS-CHANGED', signatory_name = 'SIGNATORY-CHANGED', signatory_designation = 'DESIGNATION-CHANGED',
        tax_enabled = false, document_title = 'receipt', signature_path = 'signatures/changed.png'
    where singleton;
    update public.center_profile set name = 'ZZ CHANGED NAME', address = 'CHANGED', phone = '0', email = 'changed@example.com' where singleton;
    update public.students set full_name = 'ZZ CHANGED STUDENT' where id = (select student_id from public.memberships where id = v_m1);
    update public.memberships set amount = amount + 100 where id = v_m1;

    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('L1 later settings changes do not alter an issued invoice',
      v_inv.terms = 'TERMS-ONE' and v_inv.signatory_name = 'SIGNATORY-ONE'
      and v_inv.signatory_designation = 'DESIGNATION-ONE' and v_inv.document_title = 'invoice'
      and not v_inv.tax_enabled and v_inv.signature_path is distinct from 'signatures/changed.png', '');
    perform pg_temp.rec('L2 later Center Profile changes do not alter an issued invoice',
      v_inv.business_name = v_center_name and v_inv.business_name <> 'ZZ CHANGED NAME'
      and v_inv.business_email is distinct from 'changed@example.com', '');
    perform pg_temp.rec('L3 later student changes do not alter an issued invoice',
      v_inv.customer_name = v_student_name, '');
    perform pg_temp.rec('L4 later membership changes do not alter an issued invoice',
      v_inv.total_amount = (select amount from public.memberships where id = v_m1) - 100, '');
    select * into v_inv from public.invoices where id = v_i3;
    perform pg_temp.rec('L5 the tax snapshot of an issued invoice survives a tax-settings change',
      v_inv.tax_enabled and v_inv.tax_name = 'GST' and v_inv.tax_rate = 18.00, '');

    -- =======================================================================
    -- M. Pending membership cannot be invoiced; unconfigured numbering is refused
    -- =======================================================================
    if v_m4 is null then
      perform pg_temp.skip('M1 a Pending membership cannot be invoiced', 'no fourth Pending membership');
    else
      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, (now() at time zone public.centre_timezone())::date, (now() at time zone public.centre_timezone())::date)', v_m4));
      perform pg_temp.rec('M1 a Pending membership cannot be invoiced (55000)', v_code = '55000', 'sqlstate ' || v_code);
    end if;

    -- =======================================================================
    -- N. Existing Paid membership: manual Issue Invoice, no invented date
    -- =======================================================================
    if v_paid_null is null then
      perform pg_temp.skip('N1-N5 Issue Invoice for an existing Paid membership',
        'no existing Paid membership without a payment date / invoice');
    else
      -- Restore a clean settings state for the manual issue.
      update public.invoice_settings set tax_enabled = false, document_title = 'invoice' where singleton;

      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L)', v_paid_null));
      perform pg_temp.rec('N1 without a payment date the Admin must supply one (22023)', v_code = '22023', 'sqlstate ' || v_code);
      perform pg_temp.rec('N2 nothing was invented: the membership still has no payment_date and no invoice',
        (select payment_date is null from public.memberships where id = v_paid_null)
        and not exists (select 1 from public.invoices where membership_id = v_paid_null), '');
      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, ((now() at time zone public.centre_timezone())::date + 1), null)', v_paid_null));
      perform pg_temp.rec('N3 a future payment date is rejected (22023)', v_code = '22023', 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, (now() at time zone public.centre_timezone())::date, (now() at time zone public.centre_timezone())::date)', v_paid_null));
      select * into v_inv from public.invoices where membership_id = v_paid_null;
      perform pg_temp.rec('N4 the confirmed date becomes membership.payment_date AND invoice.payment_date',
        v_code = 'OK' and v_inv.id is not null
        and (select payment_date from public.memberships where id = v_paid_null) = v_inv.payment_date
        and v_inv.payment_date = (now() at time zone public.centre_timezone())::date, 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, (now() at time zone public.centre_timezone())::date, (now() at time zone public.centre_timezone())::date)', v_paid_null));
      perform pg_temp.rec('N5 issuing a second invoice for the same membership is rejected (23505)', v_code = '23505', 'sqlstate ' || v_code);
    end if;
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

-- ===========================================================================
-- AFTER THE ROLLBACK — confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above. Deliberately commented out: as a live
-- statement it would become the editor's last result set and hide the grid.
--
--   select
--     (select count(*) from public.invoices)                          as invoices,
--     (select next_invoice_number from public.invoice_settings)       as next_invoice_number,
--     (select starting_invoice_number from public.invoice_settings)   as starting_invoice_number,
--     (select count(*) from public.memberships
--       where payment_status = 'paid' and payment_date is null)       as paid_without_date;
--
-- Compare with the SETUP row above: the counts must be what they were before.
--
-- ===========================================================================
-- TWO-SESSION PROCEDURE — proving concurrent issues cannot share a number
-- ===========================================================================
-- Needs two SQL editor tabs (two real sessions) and two Pending memberships
-- X and Y. Do this on a TEST database, or accept that it really issues two
-- invoices (then it is not rollback-only; use the application's data with care).
--
--   Session 1:  begin;
--               update public.memberships set payment_status = 'paid' where id = '<X>';
--               -- invoice issued; the invoice_settings row is now locked by session 1.
--   Session 2:  begin;
--               update public.memberships set payment_status = 'paid' where id = '<Y>';
--               -- BLOCKS: it is waiting for session 1's lock on invoice_settings.
--   Session 1:  select invoice_number from public.invoices where membership_id = '<X>';
--               commit;
--   Session 2:  -- unblocks now.
--               select invoice_number from public.invoices where membership_id = '<Y>';
--               -- must be exactly X's number + 1.
--               commit;
--
-- If session 2 had NOT blocked, both could read the same counter value and the
-- unique index on invoice_number would reject one of them — that is the second,
-- independent protection.
-- ===========================================================================
