-- ===========================================================================
-- FS-D (O1) PROPOSED verification (behaviour) - issued legacy membership-level receipts never change silently
-- Intended for the protection migration (proposed as 0054; NOT written yet). Companion of, and the inverse of, the "receipt follows
-- the membership" scenarios of verify_0030_invoice_membership_sync_behavior.sql, which stays as it is.
-- ===========================================================================
--
-- WHAT IT PROVES (the intended behaviour)
--   An Admin can still edit a legacy membership's amount, plan, start date and end date, and the MEMBERSHIP reflects every edit - but the
--   already-issued membership-level receipt (invoices.payment_id IS NULL) keeps exactly what it was issued with: plan, description,
--   period, total, taxable and tax amounts, and the whole row. Numbering, number and date edits, tax consistency and the
--   direct-update protection are exactly as before.
--
-- READING THE RESULT - TWO RUNS
--   BASELINE, before the protection exists (the current database): the scenarios that say "receipt keeps ..." (R*, C1, T1-T3, W1, and the whole-row comparisons N4 and D2) FAIL
--   by design - that is the problem being demonstrated, on disposable data, rolled back. The edits (E*), numbering (N*, except N4), date (D*, except D2), guards
--   (G*) and the rest PASS, and so do N4b and D2b. The P0 row tells which situation the run is in (it reports whether the legacy sync trigger is installed).
--   N4 and D2 compare the receipt with the row AS ISSUED, so on the baseline they fail with the same sync drift as R1-R6 (their detail names the
--   differing columns); N4b and D2b compare with the row just BEFORE the number / date edit and isolate that edit from the drift.
--   AFTER the protection is applied: everything must PASS (ALL PASS), with no NOT TESTED.
--   Run it before applying the protection and send the result: a baseline with FAILs in exactly those scenarios confirms the script
--   tests the right thing; any other FAIL is a problem with the script or the database to look at first.
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction ending in ROLLBACK. It creates its OWN disposable fixtures (one student 'ZZVERIFY FSD Student', three legacy
--     memberships), issues receipts for them, edits them, changes the invoice settings and edits receipt numbers - none of it committed.
--   * IT TOUCHES NO REAL MEMBERSHIP, STUDENT OR RECEIPT (for example it never uses MEM-000042 / INV-805). The receipts that exist are
--     fingerprinted first and checked at the end to be byte-for-byte the same (Z1).
--   * ONE SIDE EFFECT ROLLBACK CANNOT UNDO: a student and memberships take their YC- / MEM- codes from sequences, which are never given
--     back. Each run leaves a small GAP in the numbering (one student code, three membership codes). No row remains.
--   * The temp table and helper functions disappear with the transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction, issue `rollback;` first.
--
-- QA PROCEDURE (exact)
--   1. Make sure nobody is editing memberships or receipts in the demo database (the script takes locks only on its own rows and the
--      invoice settings row, briefly).
--   2. Supabase SQL Editor -> new query -> paste this WHOLE file -> Run. Do not select part of it.
--   3. Read the result grid: the P0 row, then each scenario's status, then the SUMMARY row. Copy the whole grid.
--   4. Run the commented "AFTER THE ROLLBACK" query at the bottom (uncomment it, run it alone) and confirm: receipts and reserved_numbers
--      equal the SETUP row, and both leftover_fixture_* counts are 0.
--   5. BASELINE expectation: FAILURES, in R1-R6, C1, T1-T3, W1, N4 and D2 only (N4b and D2b PASS). AFTER the protection: ALL PASS.
--
-- FIXTURE
--   Self-contained: one disposable student and three non-overlapping Pending legacy memberships (30 days each). Marking one Paid issues
--   its membership-level receipt through the existing auto-issue path (the legacy shape: Paid, no payment rows). It needs an Admin
--   profile (an Instructor profile for the denial checks) and the centre profile. If numbering is unconfigured and no receipt exists, the
--   starting number is set inside the transaction only.
--
-- NOT COVERED HERE
--   * What the protection should do INSTEAD (a notice, a refusal, a record of the change): this script only fixes what must NOT happen -
--     the issued receipt changing - and what must keep working. That choice belongs to the migration that implements it.
--   * Payment-level documents (they never followed a membership; verify_0036/0037 cover them), package-linked memberships (they cannot hold a
--     membership-level receipt: 0048) and the application's screens.
--   * Concurrency (two edits at once) cannot be staged in one transaction.
--
-- OUTPUT: one grid of seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED (reason in detail), INFO.
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

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- The receipt's synchronized fields still read as issued: plan, description, period, total, taxable and tax amount.
create function pg_temp.as_issued(p_invoice uuid, p_orig public.invoices)
returns boolean language sql as $f$
  select (i.plan, i.description, i.period_start, i.period_end, i.total_amount, i.taxable_amount, i.tax_amount)
         is not distinct from
         (p_orig.plan, p_orig.description, p_orig.period_start, p_orig.period_end, p_orig.total_amount, p_orig.taxable_amount, p_orig.tax_amount)
  from public.invoices i where i.id = p_invoice
$f$;

-- The column names whose values differ between two receipt rows (as jsonb), ignoring the named columns; 'none' when identical.
create function pg_temp.diff_cols(p_a jsonb, p_b jsonb, p_excl text[])
returns text language sql as $f$
  select coalesce(nullif(string_agg(d.k, ', ' order by d.k), ''), 'none')
  from (select coalesce(a.key, b.key) as k
        from jsonb_each(p_a - p_excl) a full join jsonb_each(p_b - p_excl) b on a.key = b.key
        where a.value is distinct from b.value) d
$f$;

-- The whole receipt row except the named columns, as a digest.
create function pg_temp.row_without(p_invoice uuid, p_drop text[])
returns text language sql as $f$
  select md5((to_jsonb(i) - p_drop)::text) from public.invoices i where i.id = p_invoice
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
  v_i1 uuid; v_i2 uuid;
  v_n1 bigint; v_new bigint;
  v_date1        date;
  v_newdate      date;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_count_before int;
  v_whole0       text;
  v_whole2       text;
  v_nodate0      text;
  v_code         text;
  v_inv          public.invoices%rowtype;
  v_pre          public.invoices%rowtype;
  v_orig         public.invoices%rowtype;
  v_orig2        public.invoices%rowtype;
  v_mem          public.memberships%rowtype;
  v_trigger_on   boolean;
begin
  select (now() at time zone public.centre_timezone())::date into v_today;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- P0: which situation is this run in? ------------------------------------------------------------------------------------------
  select exists (select 1 from pg_trigger t
                 where t.tgname = 'memberships_sync_invoice_trigger' and t.tgrelid = 'public.memberships'::regclass
                   and not t.tgisinternal and t.tgenabled <> 'D')
    into v_trigger_on;
  perform pg_temp.info('P0 legacy receipt sync trigger memberships_sync_invoice_trigger is ' || case when v_trigger_on then 'INSTALLED' else 'NOT installed' end,
    case when v_trigger_on
         then 'BASELINE run: the "receipt keeps ..." scenarios (R1-R6, C1, T1-T3, W1, N4, D2) are expected to FAIL; all others, N4b and D2b included, to PASS'
         else 'the protection is in place (or the trigger was removed): everything is expected to PASS' end);

  -- Disposable fixtures: one student and three Pending legacy memberships, removed by the final ROLLBACK.
  begin
    insert into public.students (full_name, phone, phone_country_code, join_date, status)
    values ('ZZVERIFY FSD Student', '9000000054', '+91', v_today - 400, 'active')
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

  -- R0. What existed before: every existing number is reserved (the 0030 script's own check) ---------------------------------------
  perform pg_temp.rec('R0 every pre-existing receipt number is already reserved, by its own receipt',
    not exists (
      select 1 from public.invoices i
      where i.id = any(v_ids0)
        and not case i.document_series
          when 'invoice' then exists (
            select 1 from public.invoice_number_reservations r
            where r.invoice_number = i.invoice_number and r.invoice_id = i.id)
          when 'payment_receipt' then exists (
            select 1 from public.payment_receipt_number_reservations p
            where p.receipt_number = i.invoice_number and p.invoice_id = i.id)
          else false
        end
    ), v_count0 || ' document(s) checked');

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif coalesce(array_length(v_pend, 1), 0) < 3 then
    perform pg_temp.skip('every scenario', 'could not create the disposable fixtures: ' || coalesce(v_fixture_err, 'unknown'));
  else
    perform pg_temp.rec('FX the disposable fixtures exist and are Pending with no receipt (3 legacy memberships for 1 student)',
      (select count(*) = 3 from public.memberships m where m.student_id = v_student and m.payment_status = 'pending' and m.package_id is null
         and not exists (select 1 from public.invoices i where i.membership_id = m.id)), '');

    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    -- Tax on at 18 percent, with a prefix, for the first receipt.
    update public.invoice_settings
    set tax_enabled = true, tax_name = 'GST', tax_rate = 18, invoice_prefix = 'FSD-'
    where singleton;

    -- =========================================================================
    -- S. A legacy membership with an ISSUED membership-level receipt
    --    Issued through the existing path: marking the membership Paid (no payment rows). The payment date is set earlier than today so
    --    the receipt's date can later be edited to a different valid date; if that is refused, the plain Paid update is used and the
    --    date scenarios say so.
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 5, v_m1));
    if v_code <> 'OK' then
      v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    end if;
    select * into v_orig from public.invoices where membership_id = v_m1;
    v_i1 := v_orig.id; v_n1 := v_orig.invoice_number; v_date1 := v_orig.invoice_date;
    perform pg_temp.rec('S0 marking a legacy membership Paid issues its membership-level receipt (payment_id IS NULL, tax on)',
      v_code = 'OK' and v_i1 is not null and v_orig.payment_id is null and v_orig.tax_enabled and v_orig.status = 'issued', 'sqlstate ' || v_code);
    perform pg_temp.rec('S1 the receipt carries the membership as issued: Monthly, its period, 1180.00 = 1000.00 + 180.00 GST',
      v_orig.plan = 'monthly' and v_orig.description = 'Monthly Membership' and v_orig.period_start = v_today - 100 and v_orig.period_end = v_today - 70
      and v_orig.total_amount = 1180.00 and v_orig.tax_amount = 180.00 and v_orig.taxable_amount = 1000.00,
      v_orig.description || ' ' || v_orig.total_amount || ' (' || coalesce(v_orig.taxable_amount::text, 'null') || ' + ' || coalesce(v_orig.tax_amount::text, 'null') || ')');

    select count(*) into v_count_before from public.invoices;
    v_whole0 := pg_temp.row_without(v_i1, array[]::text[]);
    v_nodate0 := pg_temp.row_without(v_i1, array['invoice_number', 'invoice_date', 'updated_at']);

    -- =========================================================================
    -- E. The edits SUCCEED and the MEMBERSHIP reflects them
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 1000.01 where id = %L', v_m1));
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('E1 editing the amount succeeds and the membership shows 1000.01', v_code = 'OK' and v_mem.amount = 1000.01, 'sqlstate ' || v_code);
    perform pg_temp.rec('R1 …and the issued receipt keeps its total (1180.00), its taxable amount (1000.00) and its tax (180.00)',
      pg_temp.as_issued(v_i1, v_orig), (select total_amount || ' / ' || coalesce(taxable_amount::text, 'null') || ' / ' || coalesce(tax_amount::text, 'null') from public.invoices where id = v_i1));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''quarterly'' where id = %L', v_m1));
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('E2 changing the plan succeeds and the membership shows quarterly', v_code = 'OK' and v_mem.plan = 'quarterly', 'sqlstate ' || v_code);
    perform pg_temp.rec('R2 …and the issued receipt keeps its plan and description (monthly, Monthly Membership)',
      pg_temp.as_issued(v_i1, v_orig), (select plan || ' / ' || description from public.invoices where id = v_i1));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set plan = ''custom'' where id = %L', v_m1));
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('E3 changing the plan to custom succeeds', v_code = 'OK' and v_mem.plan = 'custom', 'sqlstate ' || v_code);
    perform pg_temp.rec('R3 …and the issued receipt still reads as issued', pg_temp.as_issued(v_i1, v_orig), (select plan || ' / ' || description from public.invoices where id = v_i1));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set start_date = start_date + 1 where id = %L', v_m1));
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('E4 changing the start date succeeds and the membership shows the new date', v_code = 'OK' and v_mem.start_date = v_today - 99, 'sqlstate ' || v_code);
    perform pg_temp.rec('R4 …and the issued receipt keeps its period start', pg_temp.as_issued(v_i1, v_orig), (select period_start::text from public.invoices where id = v_i1));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set end_date = end_date - 1 where id = %L', v_m1));
    select * into v_mem from public.memberships where id = v_m1;
    perform pg_temp.rec('E5 changing the end date succeeds and the membership shows the new date', v_code = 'OK' and v_mem.end_date = v_today - 71, 'sqlstate ' || v_code);
    perform pg_temp.rec('R5 …and the issued receipt keeps its period end', pg_temp.as_issued(v_i1, v_orig), (select period_end::text from public.invoices where id = v_i1));

    v_code := pg_temp.run_as(v_admin, format('update public.memberships set notes = %L where id = %L', 'edited note', v_m1));
    perform pg_temp.rec('E6 editing the notes still succeeds', v_code = 'OK', 'sqlstate ' || v_code);

    -- =========================================================================
    -- C. The tax terms are the receipt's own, and a later tax setting does not reach it
    -- =========================================================================
    update public.invoice_settings set tax_rate = 5, tax_name = 'VAT' where singleton;
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 2000.00 where id = %L', v_m1));
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('C1 after the tax setting changed and the amount was edited again, the receipt still has ITS rate (18), name (GST) and amounts',
      v_code = 'OK' and v_inv.tax_rate = 18 and v_inv.tax_name = 'GST' and pg_temp.as_issued(v_i1, v_orig),
      v_inv.tax_rate || ' ' || v_inv.tax_name || ' total ' || v_inv.total_amount || ' tax ' || coalesce(v_inv.tax_amount::text, 'null'));
    perform pg_temp.rec('R6 after ALL the edits the whole receipt row is byte-for-byte as issued (nothing changed, not even updated_at)',
      pg_temp.row_without(v_i1, array[]::text[]) = v_whole0, '');
    perform pg_temp.rec('W1 the membership kept all its edits: 2000.00, custom, start +1 day, end -1 day, the note, still Paid',
      (select m.amount = 2000.00 and m.plan = 'custom' and m.start_date = v_today - 99 and m.end_date = v_today - 71 and m.notes = 'edited note' and m.payment_status = 'paid'
       from public.memberships m where m.id = v_m1), '');

    -- Tax consistency of the issued receipt still holds as issued.
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('K1 the receipt is tax-consistent as issued: taxable + tax = total, no second receipt was created',
      v_inv.taxable_amount + v_inv.tax_amount = v_inv.total_amount
      and (select count(*) = 1 from public.invoices where membership_id = v_m1) and (select count(*) = v_count_before from public.invoices), '');

    -- =========================================================================
    -- S2. A membership WITHOUT a receipt is edited freely and gains none
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 950.00, plan = ''quarterly'' where id = %L', v_m3));
    perform pg_temp.rec('S2 a Pending legacy membership with no receipt edits normally and no receipt appears',
      v_code = 'OK' and (select amount = 950.00 and plan = 'quarterly' from public.memberships where id = v_m3)
      and not exists (select 1 from public.invoices where membership_id = v_m3), 'sqlstate ' || v_code);

    -- =========================================================================
    -- T. Tax off: a second receipt, kept as issued as well
    -- =========================================================================
    v_code := pg_temp.run_owner('update public.invoice_settings set tax_enabled = false where singleton');
    perform pg_temp.info('tax switched off for receipt 2', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m2));
    select * into v_orig2 from public.invoices where membership_id = v_m2;
    v_i2 := v_orig2.id;
    perform pg_temp.rec('T0 a receipt issued with tax off has no tax values', v_code = 'OK' and v_i2 is not null and not v_orig2.tax_enabled
      and v_orig2.taxable_amount is null and v_orig2.tax_amount is null and v_orig2.total_amount = 500.00, 'sqlstate ' || v_code);
    v_whole2 := pg_temp.row_without(v_i2, array[]::text[]);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set amount = 777.77, plan = ''quarterly'' where id = %L', v_m2));
    perform pg_temp.rec('T1 tax off: editing amount and plan succeeds, and the receipt keeps its total (500.00) and plan',
      v_code = 'OK' and (select amount = 777.77 and plan = 'quarterly' from public.memberships where id = v_m2) and pg_temp.as_issued(v_i2, v_orig2),
      (select total_amount || ' / ' || plan from public.invoices where id = v_i2));
    perform pg_temp.rec('T2 …and the tax columns stay NULL (invoices_tax_consistent)',
      (select taxable_amount is null and tax_amount is null and not tax_enabled from public.invoices where id = v_i2), '');
    perform pg_temp.rec('T3 …with the whole receipt row unchanged', pg_temp.row_without(v_i2, array[]::text[]) = v_whole2, '');

    -- =========================================================================
    -- N. Receipt numbers: the edit still works, numbers are never reused
    -- =========================================================================
    select coalesce(max(invoice_number), 0) + 50 into v_new from public.invoices;
    select * into v_pre from public.invoices where id = v_i1;
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_new, v_date1));
    select * into v_inv from public.invoices where id = v_i1;
    perform pg_temp.rec('N1 an Admin can still change a receipt''s number through the edit', v_code = 'OK' and v_inv.invoice_number = v_new, 'sqlstate ' || v_code);
    perform pg_temp.rec('N2 …no second receipt is created', (select count(*) = 1 from public.invoices where membership_id = v_m1) and v_inv.id = v_i1, '');
    perform pg_temp.rec('N3 …the new number is reserved, and the OLD number stays reserved (retired)',
      exists (select 1 from public.invoice_number_reservations where invoice_number = v_new and invoice_id = v_i1)
      and exists (select 1 from public.invoice_number_reservations where invoice_number = v_n1 and invoice_id = v_i1), '');
    perform pg_temp.rec('N4 …and nothing else on the receipt changed (only the number, and updated_at)',
      (to_jsonb(v_inv) - array['invoice_number', 'updated_at']) = (to_jsonb(v_orig) - array['invoice_number', 'updated_at']),
      'columns differing from the receipt as issued: ' || pg_temp.diff_cols(to_jsonb(v_inv), to_jsonb(v_orig), array['invoice_number', 'updated_at']));
    perform pg_temp.rec('N4b …and, compared with the receipt just BEFORE the edit, only the number and updated_at changed',
      v_inv.invoice_number = v_new
      and (to_jsonb(v_inv) - array['invoice_number', 'updated_at']) = (to_jsonb(v_pre) - array['invoice_number', 'updated_at']),
      'columns differing from the row before the edit: ' || pg_temp.diff_cols(to_jsonb(v_inv), to_jsonb(v_pre), array['invoice_number', 'updated_at']));
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i2, v_n1, v_today));
    perform pg_temp.rec('N5 ANOTHER receipt cannot take the retired number (23505)', v_code = '23505', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_n1, v_date1));
    perform pg_temp.rec('N6 the same receipt cannot return to the number it left (23505)', v_code = '23505', 'sqlstate ' || v_code);

    -- =========================================================================
    -- D. The invoice DATE edit still works within its rules
    -- =========================================================================
    select * into v_inv from public.invoices where id = v_i1;
    v_newdate := case when v_inv.invoice_date = v_today then v_today - 1 else v_today end;
    if v_newdate < v_inv.payment_date then
      perform pg_temp.skip('D1-D4 invoice date edit', 'the receipt''s payment date (' || v_inv.payment_date || ') leaves no different valid invoice date');
    else
      select * into v_pre from public.invoices where id = v_i1;
      v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_inv.invoice_number, v_newdate));
      select * into v_inv from public.invoices where id = v_i1;
      perform pg_temp.rec('D1 an Admin can still change the invoice date to another valid date', v_code = 'OK' and v_inv.invoice_date = v_newdate, 'sqlstate ' || v_code);
      perform pg_temp.rec('D2 …and nothing but the date (and updated_at) changed: the issued fields and snapshots are as issued',
        (to_jsonb(v_inv) - array['invoice_number', 'invoice_date', 'updated_at']) = (to_jsonb(v_orig) - array['invoice_number', 'invoice_date', 'updated_at']),
        'columns differing from the receipt as issued: ' || pg_temp.diff_cols(to_jsonb(v_inv), to_jsonb(v_orig), array['invoice_number', 'invoice_date', 'updated_at']));
      perform pg_temp.rec('D2b …and, compared with the receipt just BEFORE the date edit, only the invoice date and updated_at changed',
        (to_jsonb(v_inv) - array['invoice_number', 'invoice_date', 'updated_at']) = (to_jsonb(v_pre) - array['invoice_number', 'invoice_date', 'updated_at'])
        and v_inv.invoice_number = v_pre.invoice_number,
        'columns differing from the row before the edit: ' || pg_temp.diff_cols(to_jsonb(v_inv), to_jsonb(v_pre), array['invoice_number', 'invoice_date', 'updated_at']));
      v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_inv.invoice_number, v_inv.payment_date - 1));
      perform pg_temp.rec('D3 a date before the payment date is still refused (22022 / 22023)', v_code in ('22022', '22023'), 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i1, v_inv.invoice_number, v_today + 1));
      perform pg_temp.rec('D4 a date in the future is still refused (22022 / 22023)', v_code in ('22022', '22023'), 'sqlstate ' || v_code);
    end if;

    -- =========================================================================
    -- G. The existing protections still hold
    -- =========================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''pending'' where id = %L', v_m1));
    perform pg_temp.rec('G1 Paid -> Pending is still refused once a receipt exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_date = payment_date - 1 where id = %L', v_m1));
    perform pg_temp.rec('G2 the payment date still cannot change (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set total_amount = total_amount + 1 where id = %L', v_i1));
    perform pg_temp.rec('G3 a direct update of the total is refused, even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set plan = ''annual'', description = ''Hacked'' where id = %L', v_i1));
    perform pg_temp.rec('G4 a direct update of the plan or description is refused, even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set tax_rate = 7 where id = %L', v_i1));
    perform pg_temp.rec('G5 a direct update of a frozen column is refused (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set total_amount = 1 where id = %L', v_i1));
    perform pg_temp.rec('G6 no client role can write invoices directly (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('select public.sync_invoice_from_membership(%L)', v_m1));
    perform pg_temp.rec('G7 no client role can call the sync function (42501, or 42883 if the protection removes it)', v_code in ('42501', '42883'), 'sqlstate ' || v_code);

    -- =========================================================================
    -- I. An Instructor cannot reach any of it
    -- =========================================================================
    if v_instructor is null then
      perform pg_temp.skip('I1-I2 instructor denial', 'no instructor profile found');
    else
      v_code := pg_temp.run_as(v_instructor, format('update public.memberships set amount = 1 where id = %L', v_m1));
      perform pg_temp.rec('I1 an Instructor cannot edit a membership (the amount is unchanged)',
        (select amount = 2000.00 from public.memberships where id = v_m1), 'sqlstate ' || v_code);
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
  case when count(*) filter (where status = 'FAIL') > 0 then 'FAILURES'
       when count(*) filter (where status = 'NOT TESTED') > 0 then 'INCOMPLETE'
       else 'ALL PASS' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
    || case when count(*) filter (where status = 'FAIL') > 0
            then ' - on the BASELINE (protection not installed) the expected FAILs are R1-R6, C1, T1-T3, W1, N4 and D2 only; read the P0 row'
            else '' end
from _verify_results;

select seq, test, status, detail
from _verify_results
order by seq;

rollback;

-- ===========================================================================
-- AFTER THE ROLLBACK - confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above. Deliberately commented out: as a live statement it would become the editor's last result set
-- and hide the grid.
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
-- Compare with the SETUP row above: receipts and reserved_numbers must equal the SETUP values, and both leftover_fixture_* counts must be 0.
-- (The YC- / MEM- sequences will have moved on: see the header.)
-- ===========================================================================
