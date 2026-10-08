-- ===========================================================================
-- V1 Invoice / Receipt — Migration 0030 BEHAVIOURAL verification
-- Exercises supabase/migrations/0030_invoice_membership_sync.sql
-- ===========================================================================
--
-- Companion to verify_0030_invoice_membership_sync.sql (read-only: proves the machinery is
-- INSTALLED). This script runs it and proves it BEHAVES, then throws the work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It genuinely writes: it creates its OWN disposable fixtures (one student and three Pending
--     memberships, all named ZZVERIFY), marks those memberships Paid (which issues receipts), edits
--     their amount / plan / dates, changes the invoice settings, and edits receipt numbers.
--     None of it is committed.
--   * IT TOUCHES NO REAL MEMBERSHIP, STUDENT OR RECEIPT. Existing rows are neither read as
--     fixtures nor edited. The receipts that already exist are fingerprinted first and checked at
--     the end to be byte-for-byte the same.
--   * ONE SIDE EFFECT THAT ROLLBACK CANNOT UNDO: a student and a membership take their YC- / MEM-
--     codes from sequences, and nextval() is never given back. Each run therefore leaves a small
--     GAP in the numbering (one student code, three membership codes). No row remains - only the
--     skipped numbers. Receipts use no sequence at all (numbering is a locked counter row).
--   * The temp table and helper functions disappear with the transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction, issue
--     `rollback;` first.
--
-- FIXTURE
--   Self-contained. It creates one disposable student and three non-overlapping Pending
--   memberships for that student (30 days each, in the past and present, so each date can move
--   one day inward without overlapping anything). It needs only an admin profile (an instructor
--   profile for the denial checks) and the centre profile. If it cannot create its fixtures it
--   reports NOT TESTED with the reason rather than failing. If numbering is unconfigured and no
--   receipt exists, the starting number is set to 1224 inside the transaction only.
--
-- AUTHENTICATION
--   Client-side behaviour runs as an authenticated ADMIN / INSTRUCTOR by setting
--   request.jwt.claims and switching to the `authenticated` role, as PostgREST does. No
--   service-role key is used.
--
-- NOT COVERED HERE
--   Two sessions racing for the same number cannot be staged in one transaction. That is
--   guaranteed by the PRIMARY KEY on invoice_number_reservations (the second writer waits, then
--   sees the reservation belongs to the first and is refused); see the structural script.
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

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- A receipt's frozen part: the whole row minus the columns that follow the membership.
create function pg_temp.frozen(p_invoice uuid)
returns text language sql as $f$
  select md5((to_jsonb(i) - array['plan', 'description', 'period_start', 'period_end',
                                  'total_amount', 'taxable_amount', 'tax_amount', 'updated_at'])::text)
  from public.invoices i where i.id = p_invoice
$f$;

-- The frozen part without the number either (to prove a number edit changes only the number).
create function pg_temp.frozen_without_number(p_invoice uuid)
returns text language sql as $f$
  select md5((to_jsonb(i) - array['invoice_number', 'plan', 'description', 'period_start', 'period_end',
                                  'total_amount', 'taxable_amount', 'tax_amount', 'updated_at'])::text)
  from public.invoices i where i.id = p_invoice
$f$;

do $$
declare
  v_admin        uuid;
  v_instructor   uuid;
  v_today        date;
  v_pend         uuid[];
  v_student      uuid;
  v_fixture_err  text;
  v_m1 uuid; v_m2 uuid; v_m3 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid;
  v_n1 bigint; v_n2 bigint; v_new bigint; v_new2 bigint; v_n3 bigint;
  v_date1        date;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_count_before int;
  v_frozen0      text;
  v_frozen0n     text;
  v_frozen2      text;
  v_code         text;
  v_out          text;
  v_inv          public.invoices%rowtype;
  v_mem          public.memberships%rowtype;
  v_tax          numeric(10, 2);
begin
  select (now() at time zone public.centre_timezone())::date into v_today;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- Disposable fixtures: one student and three Pending memberships, created here and removed by
  -- the final ROLLBACK. (Codes are overwritten by the sequences; periods never overlap.)
  begin
    insert into public.students (full_name, phone, phone_country_code, join_date, status)
    values ('ZZVERIFY Sync Student', '9000000000', '+91', v_today - 400, 'active')
    returning id into v_student;

    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'monthly', v_today - 100, v_today - 70, 1180.00, 'pending', 'INR')
    returning id into v_m1;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'monthly', v_today - 60, v_today - 30, 500.00, 'pending', 'INR')
    returning id into v_m2;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency)
    values (v_student, 'monthly', v_today - 20, v_today + 10, 900.00, 'pending', 'INR')
    returning id into v_m3;

    v_pend := array[v_m1, v_m2, v_m3];
  exception when others then
    v_pend := null;
    v_fixture_err := sqlstate || ' ' || sqlerrm;
  end;

  select starting_invoice_number into v_start_before from public.invoice_settings where singleton;
  v_had_invoices := exists (select 1 from public.invoices);

  -- Fingerprint every receipt that exists before the script does anything.
  select coalesce(array_agg(i.id), '{}'), count(*),
         md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_ids0, v_count0, v_hash0
  from public.invoices i;

  perform pg_temp.info('SETUP',
    format('admin=%s instructor=%s disposable memberships created=%s receipts-already=%s reserved-numbers=%s',
           coalesce(v_admin::text, 'none'), coalesce(v_instructor::text, 'none'),
           coalesce(array_length(v_pend, 1), 0), v_count0,
           (select count(*) from public.invoice_number_reservations)));

  -- R0. What existed before: every existing number is reserved ---------------------------
  perform pg_temp.rec('R0 every pre-existing receipt number is already reserved, by its own receipt',
    not exists (
      select 1 from public.invoices i
      where i.id = any(v_ids0)
        and not exists (select 1 from public.invoice_number_reservations r where r.invoice_number = i.invoice_number and r.invoice_id = i.id)
    ), '');

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif coalesce(array_length(v_pend, 1), 0) < 3 then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_fixture_err, 'unknown'));
  else
    perform pg_temp.rec('FX the disposable fixtures exist and are Pending with no receipt (3 memberships for 1 student)',
      (select count(*) = 3 from public.memberships m where m.student_id = v_student and m.payment_status = 'pending'
         and not exists (select 1 from public.invoices i where i.membership_id = m.id)), '');

    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    -- Tax on at 18 percent, with a prefix, for the first receipt.
    update public.invoice_settings
    set tax_enabled = true, tax_name = 'GST', tax_rate = 18, invoice_prefix = 'SYNC-'
    where singleton;

    -- =========================================================================
    -- Receipt 1: tax on. Issue it by marking the membership Paid.
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    select * into v_inv from public.invoices where membership_id = v_m1;
    v_i1 := v_inv.id; v_n1 := v_inv.invoice_number; v_date1 := v_inv.invoice_date;
    perform pg_temp.rec('S0 marking the membership Paid issues its receipt (tax on)', v_code = 'OK' and v_i1 is not null and v_inv.tax_enabled, 'sqlstate ' || v_code);
    perform pg_temp.rec('S1 …and the number is reserved as it is assigned',
      exists (select 1 from public.invoice_number_reservations where invoice_number = v_n1 and invoice_id = v_i1), '');

    v_frozen0 := pg_temp.frozen(v_i1);
    v_frozen0n := pg_temp.frozen_without_number(v_i1);
    select count(*) into v_count_before from public.invoices;

    -- =========================================================================
    -- A. Amount: the receipt follows, with the receipt's own rate; odd amount
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 1000.01 where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    v_tax := round(1000.01 * 18.00 / 118.00, 2);
    perform pg_temp.rec('A1 editing a Paid membership''s amount succeeds', v_code = 'OK', 'sqlstate ' || v_code);
    perform pg_temp.rec('A2 the receipt total follows the membership amount', v_inv.total_amount = 1000.01, v_inv.total_amount::text);
    perform pg_temp.rec('A3 tax = round(amount x rate / (100 + rate), 2), taxable = amount - tax',
      v_inv.tax_amount = v_tax and v_inv.taxable_amount = 1000.01 - v_tax, v_inv.tax_amount || ' / ' || v_inv.taxable_amount || ' (expected ' || v_tax || ')');
    perform pg_temp.rec('A4 taxable + tax = total exactly (invoices_tax_consistent held)', v_inv.taxable_amount + v_inv.tax_amount = v_inv.total_amount, '');
    perform pg_temp.rec('A5 the SAME receipt: same id, number, prefix and invoice date',
      v_inv.id = v_i1 and v_inv.invoice_number = v_n1 and v_inv.invoice_prefix = 'SYNC-' and v_inv.invoice_date = v_date1, 'number ' || v_inv.invoice_number);
    perform pg_temp.rec('A6 no second receipt was created (still one per membership, same total count)',
      (select count(*) = 1 from public.invoices where membership_id = v_m1) and (select count(*) = v_count_before from public.invoices), '');

    -- =========================================================================
    -- B. Plan, start date, end date
    -- =========================================================================
    select * into v_mem from public.memberships where id = v_m1;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''quarterly'' where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('B1 changing the plan updates the receipt''s plan and description',
      v_code = 'OK' and v_inv.plan = 'quarterly' and v_inv.description = 'Quarterly Membership', 'sqlstate ' || v_code || ', ' || v_inv.description);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''custom'' where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('B2 …and ''custom'' reads Custom duration Membership, the issue wording',
      v_code = 'OK' and v_inv.plan = 'custom' and v_inv.description = 'Custom duration Membership', v_inv.description);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set start_date = start_date + 1 where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('B3 changing the start date updates period_start (and only it)',
      v_code = 'OK' and v_inv.period_start = v_mem.start_date and v_inv.period_end = v_mem.end_date, 'sqlstate ' || v_code);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set end_date = end_date - 1 where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('B4 changing the end date updates period_end',
      v_code = 'OK' and v_inv.period_end = v_mem.end_date and v_inv.period_start = v_mem.start_date, 'sqlstate ' || v_code);

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set notes = %L where id = %L', 'edited note', v_m1));
    perform pg_temp.rec('B5 editing the notes succeeds and the receipt needs nothing', v_code = 'OK'
      and (select total_amount = 1000.01 and plan = 'custom' from public.invoices where id = v_i1), 'sqlstate ' || v_code);

    -- =========================================================================
    -- C. The tax terms are the receipt's own: a later settings change does not apply
    -- =========================================================================
    update public.invoice_settings set tax_rate = 5, tax_name = 'VAT' where singleton;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 2000.00 where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    v_tax := round(2000.00 * 18.00 / 118.00, 2);
    perform pg_temp.rec('C1 after the tax setting changed, the receipt still uses ITS rate (18) and name',
      v_code = 'OK' and v_inv.tax_rate = 18 and v_inv.tax_name = 'GST' and v_inv.tax_amount = v_tax and v_inv.taxable_amount = 2000.00 - v_tax,
      v_inv.tax_rate || ' ' || v_inv.tax_name || ' tax ' || v_inv.tax_amount);

    -- =========================================================================
    -- F. Everything frozen is exactly as issued
    -- =========================================================================
    perform pg_temp.rec('F1 after all those edits the frozen part of the receipt is byte-for-byte unchanged (number, prefix, dates, tax terms, currency, customer, business, logo, bank, terms, signatory, signature)',
      pg_temp.frozen(v_i1) = v_frozen0, '');
    select * into v_inv from public.invoices where id = v_i1;
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('F2 the payment date is still the membership''s, unchanged', v_inv.payment_date = v_mem.payment_date, '');

    -- =========================================================================
    -- G. The existing protections still hold
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''pending'' where id = %L', v_m1));
    perform pg_temp.rec('G1 Paid -> Pending is still refused once a receipt exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_date = payment_date - 1 where id = %L', v_m1));
    perform pg_temp.rec('G2 the payment date still cannot change (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set total_amount = total_amount + 1 where id = %L', v_i1));
    perform pg_temp.rec('G3 a direct update of a synchronized column is still refused, even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set tax_rate = 7 where id = %L', v_i1));
    perform pg_temp.rec('G4 a direct update of a frozen column is refused (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set total_amount = 1 where id = %L', v_i1));
    perform pg_temp.rec('G5 no client role can write invoices directly (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.sync_invoice_from_membership(%L)', v_m1));
    perform pg_temp.rec('G6 no client role can call the sync function (42501)', v_code = '42501', 'sqlstate ' || v_code);
    perform pg_temp.rec('G7 the marker does not linger after a sync: a direct update right afterwards is still refused',
      pg_temp.run_owner(format('update public.invoices set description = ''Hacked'' where id = %L', v_i1)) = '55006', '');

    -- =========================================================================
    -- T. Tax off: the total follows, the tax columns stay NULL
    -- =========================================================================
    v_code := pg_temp.run_owner('update public.invoice_settings set tax_enabled = false where singleton');
    perform pg_temp.info('tax switched off for receipt 2', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m2));
    select * into v_inv from public.invoices where membership_id = v_m2;
    v_i2 := v_inv.id; v_n2 := v_inv.invoice_number;
    perform pg_temp.rec('T0 a receipt issued with tax off has no tax values', v_code = 'OK' and not v_inv.tax_enabled
      and v_inv.taxable_amount is null and v_inv.tax_amount is null, 'sqlstate ' || v_code);
    v_frozen2 := pg_temp.frozen(v_i2);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 777.77 where id = %L', v_m2));
    select * into v_inv from public.invoices where id = v_i2;
    perform pg_temp.rec('T1 tax off: the total follows the membership amount',  v_code = 'OK' and v_inv.total_amount = 777.77, v_inv.total_amount::text);
    perform pg_temp.rec('T2 …and the tax columns stay NULL (invoices_tax_consistent)', v_inv.taxable_amount is null and v_inv.tax_amount is null and not v_inv.tax_enabled, '');
    perform pg_temp.rec('T3 …with the frozen part unchanged', pg_temp.frozen(v_i2) = v_frozen2, '');

    -- =========================================================================
    -- N. Receipt numbers are never reused
    -- =========================================================================
    select coalesce(max(invoice_number), 0) + 50 into v_new from public.invoices;
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_new, v_date1));
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('N1 an Admin can still change a receipt''s number through the edit', v_code = 'OK' and v_inv.invoice_number = v_new, 'sqlstate ' || v_code);
    perform pg_temp.rec('N2 …no second receipt is created',
      (select count(*) = 1 from public.invoices where membership_id = v_m1) and v_inv.id = v_i1, '');
    perform pg_temp.rec('N3 …the new number is reserved, and the OLD number stays reserved (retired)',
      exists (select 1 from public.invoice_number_reservations where invoice_number = v_new and invoice_id = v_i1)
      and exists (select 1 from public.invoice_number_reservations where invoice_number = v_n1 and invoice_id = v_i1), '');
    perform pg_temp.rec('N4 …and nothing else on the receipt changed (prefix, dates, tax terms, every snapshot)',
      pg_temp.frozen_without_number(v_i1) = v_frozen0n and pg_temp.frozen(v_i1) <> v_frozen0, 'only the number differs');

    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i2, v_n1, v_today));
    perform pg_temp.rec('N5 ANOTHER receipt cannot take the retired number through the edit (23505)', v_code = '23505', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set invoice_number = %s where id = %L', v_n1, v_i2));
    perform pg_temp.rec('N6 …nor by a direct write: the database itself refuses (23505)', v_code = '23505', 'sqlstate ' || v_code);
    perform pg_temp.rec('N7 …and receipt 2 still has its own number', (select invoice_number = v_n2 from public.invoices where id = v_i2), '');

    -- The counter must skip a retired number it reaches.
    update public.invoice_settings set next_invoice_number = v_n1 where singleton;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m3));
    select * into v_inv from public.invoices where membership_id = v_m3;
    v_i3 := v_inv.id; v_n3 := v_inv.invoice_number;
    perform pg_temp.rec('N8 the numbering counter skips retired numbers: with the counter wound back to the retired number, the next receipt gets another',
      v_code = 'OK' and v_i3 is not null and v_n3 <> v_n1 and v_n3 > v_n1
      and not exists (select 1 from public.invoice_number_reservations r where r.invoice_number = v_n3 and r.invoice_id <> v_i3),
      'asked for ' || v_n1 || ', got ' || coalesce(v_n3::text, 'NULL') || ', sqlstate ' || v_code);
    perform pg_temp.rec('N9 …and its number is reserved too', exists (select 1 from public.invoice_number_reservations where invoice_number = v_n3 and invoice_id = v_i3), '');

    -- A number is consumed for good: the receipt that held it cannot get it back either.
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_n1, v_date1));
    perform pg_temp.rec('N10 the SAME receipt cannot return to the number it left (23505), and keeps its current number',
      v_code = '23505' and (select invoice_number = v_new from public.invoices where id = v_i1), 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set invoice_number = %s where id = %L', v_n1, v_i1));
    perform pg_temp.rec('N10b …nor by a direct write: the database itself refuses (23505)', v_code = '23505', 'sqlstate ' || v_code);

    -- Move receipt 1 on again: the number it just left is retired too, to everyone.
    select coalesce(max(invoice_number), 0) + 50 into v_new2 from public.invoices;
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_new2, v_date1));
    perform pg_temp.rec('N11 a second edit succeeds with a fresh number', v_code = 'OK' and (select invoice_number = v_new2 from public.invoices where id = v_i1), 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i3, v_new, v_today));
    perform pg_temp.rec('N11b …and the number it left is refused to another receipt (23505)', v_code = '23505', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_new, v_date1));
    perform pg_temp.rec('N11c …and to the receipt itself (23505)', v_code = '23505', 'sqlstate ' || v_code);
    perform pg_temp.rec('N11d …and a no-change save of the current number still works (nothing new is consumed)',
      pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_new2, v_date1)) = 'OK'
      and (select count(*) from public.invoice_number_reservations where invoice_number = v_new2) = 1, '');

    -- Reservations are closed to clients.
    v_out := pg_temp.query_as(v_admin, 'select count(*)::text from public.invoice_number_reservations');
    perform pg_temp.rec('N12 no client can read the reservations (42501)', v_out = 'ERR:42501', v_out);

    -- =========================================================================
    -- I. An Instructor cannot reach any of it
    -- =========================================================================
    if v_instructor is null then
      perform pg_temp.skip('I1-I2 instructor denial', 'no instructor profile found');
    else
      v_code := pg_temp.run_as(v_instructor, format('update public.memberships set amount = 1 where id = %L', v_m1));
      perform pg_temp.rec('I1 an Instructor cannot edit a membership, so cannot move a receipt (amount unchanged)',
        (select total_amount = 2000.00 from public.invoices where id = v_i1), 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_instructor, format('select public.update_invoice_details(%L, 1, %L)', v_i1, v_today));
      perform pg_temp.rec('I2 an Instructor cannot call the receipt edit (42501)', v_code = '42501', 'sqlstate ' || v_code);
    end if;
  end if;

  -- =========================================================================
  -- Z. Everything that existed before this script is untouched
  -- =========================================================================
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i where i.id = any(v_ids0);
  perform pg_temp.rec('Z1 every pre-existing receipt is byte-for-byte unchanged', v_hash0 = v_hash1, v_count0 || ' receipt(s) fingerprinted');
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
--     (select count(*) from public.invoices)                      as receipts,
--     (select count(*) from public.invoice_number_reservations)   as reserved_numbers,
--     (select count(*) from public.students where full_name like 'ZZVERIFY%')                       as leftover_fixture_students,
--     (select count(*) from public.memberships m join public.students s on s.id = m.student_id
--        where s.full_name like 'ZZVERIFY%')                                                         as leftover_fixture_memberships,
--     (select invoice_prefix from public.invoice_settings)        as setting_prefix,
--     (select tax_enabled from public.invoice_settings)           as setting_tax_enabled,
--     (select next_invoice_number from public.invoice_settings)   as next_invoice_number;
--
-- Compare with the SETUP row above: receipts and reserved_numbers must equal the SETUP values, and
-- both leftover_fixture_* counts must be 0. (The YC- / MEM- sequences will have moved on: see the header.)
-- ===========================================================================
