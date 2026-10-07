-- ===========================================================================
-- V1 Invoice Number Prefix — Migration 0027 BEHAVIOURAL verification
-- Exercises supabase/migrations/0027_invoice_prefix.sql
-- ===========================================================================
--
-- Companion to verify_0027_invoice_prefix.sql (read-only: proves the prefix
-- machinery is INSTALLED). This script runs it and proves it BEHAVES, then throws
-- the work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It genuinely writes: it marks existing Pending memberships Paid (which
--     issues invoices), changes the prefix / tax settings, and edits an invoice
--     number. None of it is committed.
--   * NOTHING THAT CONSUMES A SEQUENCE IS EVER INSERTED. It never inserts a
--     student or a membership (their YC- / MEM- codes come from sequences that
--     nextval() does not give back on rollback), and invoices use no sequence —
--     numbering is a locked counter row — so rolling back the invoices also rolls
--     back the counter. It reuses existing memberships.
--   * The invoices that already exist (the demo invoices 786 and 787, or whatever
--     is there) are never touched: the script fingerprints them first and checks at
--     the end that they are byte-for-byte the same, and that they were not given a
--     prefix.
--   * The temp table and helper functions disappear with the transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction,
--     issue `rollback;` first.
--
-- FIXTURE
--   Needs an admin profile and, for the full run, four existing Pending
--   memberships without an invoice (one per prefix scenario) and one existing Paid
--   membership with no payment date and no invoice (for the manual Issue Invoice
--   scenario). Anything it cannot find is reported NOT TESTED with the reason.
--   If numbering is unconfigured and no invoice exists, the starting number is set
--   to 1224 inside the transaction only; otherwise it is left alone.
--
-- AUTHENTICATION
--   Client-side behaviour runs as an authenticated ADMIN by setting
--   request.jwt.claims and switching to the `authenticated` role, as PostgREST
--   does (as verify_0014 / 0015 / 0026 do). No service-role key is used.
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

-- Run one statement as the owning role; return 'OK' or the SQLSTATE.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

do $$
declare
  v_admin        uuid;
  v_today        date;
  v_pend         uuid[];
  v_paid_null    uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_im uuid;
  v_n1 bigint; v_n2 bigint; v_n3 bigint; v_n4 bigint;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_demo         int;
  v_demo_prefixed int;
  v_next         bigint;
  v_code         text;
  v_inv          public.invoices%rowtype;
  v_mem          public.memberships%rowtype;
  v_tax          numeric(10, 2);
  v_bad          text;
begin
  select (now() at time zone public.centre_timezone())::date into v_today;
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

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

  -- Fingerprint every invoice that exists before the script does anything.
  select coalesce(array_agg(i.id), '{}'), count(*),
         md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_ids0, v_count0, v_hash0
  from public.invoices i;

  select count(*), count(*) filter (where i.invoice_prefix is not null)
    into v_demo, v_demo_prefixed
  from public.invoices i where i.invoice_number in (786, 787);

  perform pg_temp.info('SETUP',
    format('admin=%s pending fixtures=%s paid-without-date=%s starting=%s invoices-already=%s',
           coalesce(v_admin::text, 'none'), coalesce(array_length(v_pend, 1), 0),
           coalesce(v_paid_null::text, 'none'), coalesce(v_start_before::text, 'not configured'), v_count0));

  -- 1-2. The invoices that already exist ----------------------------------------------
  if v_demo > 0 then
    perform pg_temp.rec('A1 existing invoices 786 / 787 have no prefix (NULL after the migration)', v_demo_prefixed = 0,
      v_demo || ' found, ' || v_demo_prefixed || ' with a prefix');
  else
    perform pg_temp.skip('A1 invoices 786 / 787', 'no invoices numbered 786 or 787 in this database');
  end if;
  perform pg_temp.rec('A2 every invoice that existed before this script has a NULL prefix',
    not exists (select 1 from public.invoices i where i.id = any(v_ids0) and i.invoice_prefix is not null), '');

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif coalesce(array_length(v_pend, 1), 0) < 1 then
    perform pg_temp.skip('every issuing scenario', 'needs at least 1 existing Pending membership without an invoice');
  else
    v_m1 := v_pend[1]; v_m2 := v_pend[2]; v_m3 := v_pend[3]; v_m4 := v_pend[4];

    -- Numbering must be configured for issuing; only if nothing is configured and nothing issued.
    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    update public.invoice_settings
    set tax_enabled = false, invoice_prefix = null
    where singleton;

    -- =======================================================================
    -- S1. Prefix OFF -> a new invoice gets a NULL prefix (automatic issue)
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    select * into v_inv from public.invoices where membership_id = v_m1;
    v_i1 := v_inv.id; v_n1 := v_inv.invoice_number;
    perform pg_temp.rec('S1 prefix OFF: the new invoice is issued with a NULL prefix', v_code = 'OK' and v_i1 is not null and v_inv.invoice_prefix is null,
      'sqlstate ' || v_code || ', prefix ' || coalesce(v_inv.invoice_prefix, 'NULL'));

    if v_m2 is null then
      perform pg_temp.skip('S2-S4 prefix ON / change / OFF', 'needs more Pending memberships without an invoice');
    else
      -- =====================================================================
      -- S2. Prefix ON (INV-), tax ON -> the invoice gets INV-; tax unchanged
      -- =====================================================================
      update public.invoice_settings
      set invoice_prefix = 'INV-', tax_enabled = true, tax_name = 'GST', tax_rate = 18.00
      where singleton;

      v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m2));
      select * into v_inv from public.invoices where membership_id = v_m2;
      v_i2 := v_inv.id; v_n2 := v_inv.invoice_number;
      select * into v_mem from public.memberships where id = v_m2;
      perform pg_temp.rec('S2 prefix ON: an AUTOMATIC issue copies the prefix (INV-)', v_code = 'OK' and v_inv.invoice_prefix = 'INV-',
        'sqlstate ' || v_code || ', prefix ' || coalesce(v_inv.invoice_prefix, 'NULL'));
      perform pg_temp.rec('S2 the earlier invoice keeps its NULL prefix',
        (select invoice_prefix is null from public.invoices where id = v_i1), '');
      perform pg_temp.rec('S2 the numeric sequence continues: the number is a plain bigint above the previous one', v_n2 > v_n1,
        v_n1 || ' then ' || v_n2);
      v_tax := round(v_inv.total_amount * 18.00 / 118.00, 2);
      perform pg_temp.rec('S2 tax calculation unchanged: tax = round(total * rate / (100 + rate), 2), and parts add up',
        v_inv.tax_amount = v_tax and v_inv.taxable_amount + v_inv.tax_amount = v_inv.total_amount,
        coalesce(v_inv.tax_amount::text, 'NULL') || ' vs ' || v_tax);
      perform pg_temp.rec('S2 payment / invoice date behaviour unchanged: invoice date defaults to the payment date, which is today',
        v_inv.invoice_date = v_inv.payment_date and v_inv.payment_date = v_today and v_mem.payment_date = v_inv.payment_date, '');

      if v_m3 is null then
        perform pg_temp.skip('S3-S4 change / OFF', 'needs more Pending memberships without an invoice');
      else
        -- ===================================================================
        -- S3. Change the prefix to YC- AFTER invoices exist (as the Admin, through the grant)
        -- ===================================================================
        v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set invoice_prefix = ''YC-''');
        perform pg_temp.rec('S3 the prefix stays editable by an Admin after invoices exist (not locked)', v_code = 'OK',
          'sqlstate ' || v_code);

        v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m3));
        select * into v_inv from public.invoices where membership_id = v_m3;
        v_i3 := v_inv.id; v_n3 := v_inv.invoice_number;
        perform pg_temp.rec('S3 the new invoice gets the new prefix (YC-)', v_inv.invoice_prefix = 'YC-',
          coalesce(v_inv.invoice_prefix, 'NULL'));
        perform pg_temp.rec('S3 the previous invoice keeps INV- (history unchanged)',
          (select invoice_prefix = 'INV-' from public.invoices where id = v_i2), '');
        perform pg_temp.rec('S3 the first invoice still has no prefix',
          (select invoice_prefix is null from public.invoices where id = v_i1), '');
        perform pg_temp.rec('S3 the numeric sequence continues', v_n3 > v_n2, v_n2 || ' then ' || v_n3);

        if v_m4 is null then
          perform pg_temp.skip('S4 prefix OFF again', 'needs a fourth Pending membership without an invoice');
        else
          -- =================================================================
          -- S4. Turn the prefix OFF (NULL) -> numeric-only again
          -- =================================================================
          v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set invoice_prefix = null');
          perform pg_temp.rec('S4 the Admin can turn the prefix OFF (NULL) after invoices exist', v_code = 'OK', 'sqlstate ' || v_code);
          v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m4));
          select * into v_inv from public.invoices where membership_id = v_m4;
          v_i4 := v_inv.id; v_n4 := v_inv.invoice_number;
          perform pg_temp.rec('S4 the next invoice has a NULL prefix', v_inv.invoice_prefix is null and v_i4 is not null,
            coalesce(v_inv.invoice_prefix, 'NULL'));
          perform pg_temp.rec('S4 the earlier prefixed invoices are untouched',
            (select invoice_prefix = 'YC-' from public.invoices where id = v_i3)
            and (select invoice_prefix = 'INV-' from public.invoices where id = v_i2), '');
          perform pg_temp.rec('S4 numeric sequence: strictly increasing, counter = last + 1',
            v_n1 < v_n2 and v_n2 < v_n3 and v_n3 < v_n4
            and (select next_invoice_number from public.invoice_settings where singleton) = v_n4 + 1,
            v_n1 || ', ' || v_n2 || ', ' || v_n3 || ', ' || v_n4);
        end if;
      end if;

      -- =====================================================================
      -- E. Editing an invoice number does not change the prefix
      -- =====================================================================
      select next_invoice_number into v_next from public.invoice_settings where singleton;
      while exists (select 1 from public.invoices where invoice_number = v_next) loop
        v_next := v_next + 1;
      end loop;
      v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i2, v_next, v_today));
      select * into v_inv from public.invoices where id = v_i2;
      perform pg_temp.rec('E1 editing the invoice number changes the number…', v_code = 'OK' and v_inv.invoice_number = v_next,
        'sqlstate ' || v_code || ', number ' || v_inv.invoice_number);
      perform pg_temp.rec('E2 …and leaves the historical prefix (INV-) alone', v_inv.invoice_prefix = 'INV-',
        coalesce(v_inv.invoice_prefix, 'NULL'));
      perform pg_temp.rec('E3 …and leaves tax and the rest of the snapshot alone',
        v_inv.tax_enabled and v_inv.tax_name = 'GST' and v_inv.tax_rate = 18.00 and v_inv.tax_amount = v_tax, '');

      -- =====================================================================
      -- F. The prefix of an issued invoice cannot be modified
      -- =====================================================================
      v_code := pg_temp.run_owner(format('update public.invoices set invoice_prefix = %L where id = %L', 'HACK-', v_i2));
      perform pg_temp.rec('F1 changing an issued invoice''s prefix is rejected, even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);
      v_code := pg_temp.run_owner(format('update public.invoices set invoice_prefix = %L where id = %L', 'HACK-', v_i1));
      perform pg_temp.rec('F2 giving a prefix to an invoice issued without one is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
      v_code := pg_temp.run_owner(format('update public.invoices set invoice_prefix = null where id = %L', v_i2));
      perform pg_temp.rec('F3 clearing an issued invoice''s prefix is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_admin, format('update public.invoices set invoice_prefix = %L where id = %L', 'HACK-', v_i2));
      perform pg_temp.rec('F4 a client cannot write invoices at all (42501)', v_code = '42501', 'sqlstate ' || v_code);
      perform pg_temp.rec('F5 the prefix is intact after all those attempts',
        (select invoice_prefix = 'INV-' from public.invoices where id = v_i2), '');
    end if;

    -- =======================================================================
    -- M. Manual Issue Invoice copies the prefix too
    -- =======================================================================
    if v_paid_null is null then
      perform pg_temp.skip('M1 manual issue copies the prefix', 'no existing Paid membership without a payment date / invoice');
    else
      update public.invoice_settings set invoice_prefix = 'MAN-', tax_enabled = false where singleton;
      v_code := pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, %L, %L)', v_paid_null, v_today, v_today));
      select * into v_inv from public.invoices where membership_id = v_paid_null;
      v_im := v_inv.id;
      perform pg_temp.rec('M1 a MANUAL Issue Invoice copies the prefix (MAN-)', v_code = 'OK' and v_inv.invoice_prefix = 'MAN-',
        'sqlstate ' || v_code || ', prefix ' || coalesce(v_inv.invoice_prefix, 'NULL'));
      perform pg_temp.rec('M2 the manual invoice has no tax when tax is off, and its dates follow the confirmed payment date',
        not v_inv.tax_enabled and v_inv.tax_amount is null and v_inv.payment_date = v_today and v_inv.invoice_date = v_today, '');
    end if;

    -- =======================================================================
    -- V. The database refuses invalid prefixes; accepts valid ones
    -- =======================================================================
    foreach v_bad in array array[
      ' INV-',                    -- leading space
      'INV- ',                    -- trailing space
      E'INV-\t',                  -- trailing tab
      E'\nINV-',                  -- leading newline
      'INV123',                   -- ends in a digit
      '1',                        -- ends in a digit
      '',                         -- empty string (NULL is the "no prefix")
      repeat('A', 21)             -- 21 characters
    ]
    loop
      v_code := pg_temp.run_owner(format('update public.invoice_settings set invoice_prefix = %L where singleton', v_bad));
      perform pg_temp.rec('V rejected: ' || replace(replace(replace(coalesce(nullif(v_bad, ''), '(empty string)'), E'\t', '<tab>'), E'\n', '<newline>'), repeat('A', 21), '21 characters'),
        v_code = '23514', 'sqlstate ' || v_code);
    end loop;

    foreach v_bad in array array['INV-', 'INV/', 'YC-', 'FY26-', 'Receipt-', 'Yoga Center-', repeat('A', 20), 'A']
    loop
      v_code := pg_temp.run_owner(format('update public.invoice_settings set invoice_prefix = %L where singleton', v_bad));
      perform pg_temp.rec('V accepted: ' || case when v_bad = repeat('A', 20) then '20 characters' else v_bad end,
        v_code = 'OK', 'sqlstate ' || v_code);
    end loop;
    update public.invoice_settings set invoice_prefix = null where singleton;

    -- =======================================================================
    -- L. What did not change: starting-number lock, client write limits
    -- =======================================================================
    if exists (select 1 from public.invoices) then
      v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set starting_invoice_number = starting_invoice_number + 1');
      perform pg_temp.rec('L1 the starting invoice number is still locked once an invoice exists (55006)', v_code = '55006', 'sqlstate ' || v_code);
    end if;
    v_code := pg_temp.run_as(v_admin, 'update public.invoice_settings set next_invoice_number = 5');
    perform pg_temp.rec('L2 a client still cannot write next_invoice_number (42501)', v_code = '42501', 'sqlstate ' || v_code);
  end if;

  -- =========================================================================
  -- Z. Everything that existed before this script is untouched
  -- =========================================================================
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i where i.id = any(v_ids0);
  perform pg_temp.rec('Z1 every pre-existing invoice (786 / 787 included) is byte-for-byte unchanged', v_hash0 = v_hash1,
    v_count0 || ' invoice(s) fingerprinted');
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
--     (select count(*) from public.invoices)                                   as invoices,
--     (select count(*) from public.invoices where invoice_prefix is not null)  as invoices_with_prefix,
--     (select invoice_prefix from public.invoice_settings)                     as setting_prefix,
--     (select next_invoice_number from public.invoice_settings)                as next_invoice_number,
--     (select starting_invoice_number from public.invoice_settings)            as starting_invoice_number;
--
-- Compare with the SETUP row above: the invoice count and the settings must be what
-- they were before (the demo invoices 786 and 787 still there, no prefix).
-- ===========================================================================
