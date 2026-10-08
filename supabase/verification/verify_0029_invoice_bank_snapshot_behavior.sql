-- ===========================================================================
-- V1 Invoice Bank Account Snapshot — Migration 0029 BEHAVIOURAL verification
-- Exercises supabase/migrations/0029_invoice_bank_account_snapshot.sql
-- ===========================================================================
--
-- Companion to verify_0029_invoice_bank_snapshot.sql (read-only: proves the snapshot
-- machinery is INSTALLED). This script runs it and proves it BEHAVES, then throws the
-- work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It genuinely writes: it creates two test bank accounts, activates and edits them,
--     changes the prefix setting, and marks existing Pending memberships Paid (which issues
--     invoices). None of it is committed.
--   * NOTHING THAT CONSUMES A SEQUENCE IS EVER INSERTED. It never inserts a student, a
--     membership or an invoice directly (their codes come from sequences nextval() does not
--     give back on rollback); invoices use no sequence at all — numbering is a locked
--     counter row — and bank_accounts keys on gen_random_uuid(). It reuses existing
--     memberships.
--   * The invoices that already exist are never touched: the script fingerprints them
--     first and checks at the end that they are byte-for-byte the same.
--   * If bank accounts already exist the script works alongside them: its own are tagged
--     'ZZVERIFY-', and any active account is deactivated inside the transaction (rolled
--     back) so the "no active account" case can be tested.
--   * The temp table and helper functions disappear with the transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction, issue
--     `rollback;` first.
--
-- FIXTURE
--   Needs an admin profile and, for the full run, four existing Pending memberships
--   without an invoice (one per scenario) and one existing Paid membership with no payment
--   date and no invoice (for the manual Issue Invoice scenario). An instructor profile for
--   the denial checks. Anything it cannot find is reported NOT TESTED with the reason. If
--   numbering is unconfigured and no invoice exists, the starting number is set to 1224
--   inside the transaction only.
--
-- AUTHENTICATION
--   Client-side behaviour runs as an authenticated ADMIN / INSTRUCTOR by setting
--   request.jwt.claims and switching to the `authenticated` role, as PostgREST does. No
--   service-role key is used.
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

do $$
declare
  v_admin        uuid;
  v_instructor   uuid;
  v_today        date;
  v_pend         uuid[];
  v_paid_null    uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_h            uuid;
  v_s            uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_im uuid;
  v_n1 bigint; v_n2 bigint; v_n3 bigint; v_n4 bigint;
  v_start_before bigint;
  v_had_invoices boolean;
  v_ids0         uuid[];
  v_hash0        text;
  v_hash1        text;
  v_count0       int;
  v_next         bigint;
  v_code         text;
  v_out          text;
  v_inv          public.invoices%rowtype;
  v_h_name text; v_h_acc text; v_h_num text; v_h_ifsc text; v_h_branch text;
  v_s_name text; v_s_acc text; v_s_num text; v_s_ifsc text; v_s_branch text;
begin
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

  -- Fingerprint every invoice that exists before the script does anything.
  select coalesce(array_agg(i.id), '{}'), count(*),
         md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_ids0, v_count0, v_hash0
  from public.invoices i;

  perform pg_temp.info('SETUP',
    format('admin=%s instructor=%s pending fixtures=%s paid-without-date=%s invoices-already=%s (with a bank snapshot: %s)',
           coalesce(v_admin::text, 'none'), coalesce(v_instructor::text, 'none'),
           coalesce(array_length(v_pend, 1), 0), coalesce(v_paid_null::text, 'none'), v_count0,
           (select count(*) from public.invoices where bank_name is not null)));

  -- A. What existed before ---------------------------------------------------------------
  perform pg_temp.rec('A1 no pre-existing invoice has a PARTIAL snapshot (all five NULL, or the required four set)',
    not exists (
      select 1 from public.invoices i
      where i.id = any(v_ids0)
        and not ((i.bank_name is null and i.bank_account_name is null and i.bank_account_number is null and i.bank_ifsc_code is null and i.bank_branch is null)
                 or (i.bank_name is not null and i.bank_account_name is not null and i.bank_account_number is not null and i.bank_ifsc_code is not null))
    ), '');

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  elsif coalesce(array_length(v_pend, 1), 0) < 2 then
    perform pg_temp.skip('every issuing scenario', 'needs at least 2 existing Pending memberships without an invoice; this database has ' || coalesce(array_length(v_pend, 1), 0));
  else
    v_m1 := v_pend[1]; v_m2 := v_pend[2]; v_m3 := v_pend[3]; v_m4 := v_pend[4];

    -- Numbering must be configured for issuing; only if nothing is configured and nothing issued.
    if v_start_before is null and not v_had_invoices then
      update public.invoice_settings set starting_invoice_number = 1224 where singleton;
    end if;
    update public.invoice_settings set tax_enabled = false, invoice_prefix = null where singleton;

    -- Two test accounts (owner, inactive) and NO active account to begin with.
    insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, branch)
    values ('ZZVERIFY-HDFC', 'Nagendran Yoga International', '50200059863366', 'HDFC0005315', 'Sahakarnagar Branch')
    returning id, bank_name, account_name, account_number, ifsc_code, branch
    into v_h, v_h_name, v_h_acc, v_h_num, v_h_ifsc, v_h_branch;
    insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, branch)
    values ('ZZVERIFY-SBI', 'Sri Yoga Trust', '30000000000002', 'SBIN0000002', null)
    returning id, bank_name, account_name, account_number, ifsc_code, branch
    into v_s, v_s_name, v_s_acc, v_s_num, v_s_ifsc, v_s_branch;
    update public.bank_accounts set is_active = false where is_active;

    -- =======================================================================
    -- N. No active account: issuing still works, the snapshot is NULL
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m1));
    select * into v_inv from public.invoices where membership_id = v_m1;
    v_i1 := v_inv.id; v_n1 := v_inv.invoice_number;
    perform pg_temp.rec('N1 with NO active bank account the invoice is still issued', v_code = 'OK' and v_i1 is not null, 'sqlstate ' || v_code);
    perform pg_temp.rec('N2 …and every snapshot column is NULL',
      v_inv.bank_name is null and v_inv.bank_account_name is null and v_inv.bank_account_number is null
      and v_inv.bank_ifsc_code is null and v_inv.bank_branch is null, '');

    -- =======================================================================
    -- S. Active account H: the invoice gets its exact details
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_h));
    v_code := v_code || '/' || pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m2));
    select * into v_inv from public.invoices where membership_id = v_m2;
    v_i2 := v_inv.id; v_n2 := v_inv.invoice_number;
    perform pg_temp.rec('S1 with account H active the invoice is issued and carries H''s five details exactly',
      v_code = 'OK/OK' and v_inv.bank_name = v_h_name and v_inv.bank_account_name = v_h_acc
      and v_inv.bank_account_number = v_h_num and v_inv.bank_ifsc_code = v_h_ifsc and v_inv.bank_branch = v_h_branch,
      'sqlstate ' || v_code || ', bank ' || coalesce(v_inv.bank_name, 'NULL'));
    perform pg_temp.rec('S2 the earlier no-bank invoice is untouched (still NULL)',
      (select bank_name is null and bank_account_name is null and bank_account_number is null and bank_ifsc_code is null and bank_branch is null
       from public.invoices where id = v_i1), '');
    perform pg_temp.rec('S3 the numeric sequence continues as before', v_n2 > v_n1, v_n1 || ' then ' || v_n2);

    -- =======================================================================
    -- C. Editing the account afterwards does not change the invoice
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set bank_name = %L, account_number = %L, branch = %L where id = %L',
                                             'ZZVERIFY-HDFC-EDITED', '999', 'Changed Branch', v_h));
    select * into v_inv from public.invoices where id = v_i2;
    perform pg_temp.rec('C1 editing the account succeeds…', v_code = 'OK'
      and (select bank_name = 'ZZVERIFY-HDFC-EDITED' and account_number = '999' from public.bank_accounts where id = v_h), 'sqlstate ' || v_code);
    perform pg_temp.rec('C2 …and the issued invoice still shows the details it was issued with',
      v_inv.bank_name = v_h_name and v_inv.bank_account_number = v_h_num and v_inv.bank_branch = v_h_branch
      and v_inv.bank_account_name = v_h_acc and v_inv.bank_ifsc_code = v_h_ifsc, '');

    if v_m3 is null then
      perform pg_temp.skip('S4-S6 activate another / deactivate', 'needs a third Pending membership without an invoice');
    else
      -- =====================================================================
      -- Activate S: the old invoice is unchanged; the next one gets S (and the prefix, unchanged behaviour)
      -- =====================================================================
      update public.invoice_settings set invoice_prefix = 'BK-' where singleton;
      v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_s));
      perform pg_temp.rec('S4 activating another account succeeds, and H is deactivated', v_code = 'OK'
        and (select not is_active from public.bank_accounts where id = v_h) and (select is_active from public.bank_accounts where id = v_s), 'sqlstate ' || v_code);
      perform pg_temp.rec('S5 …without changing the old invoice',
        (select bank_name = v_h_name and bank_account_number = v_h_num and bank_branch = v_h_branch from public.invoices where id = v_i2), '');

      v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m3));
      select * into v_inv from public.invoices where membership_id = v_m3;
      v_i3 := v_inv.id; v_n3 := v_inv.invoice_number;
      perform pg_temp.rec('S6 the next invoice carries the NEW active account (S), exactly; its branch is NULL like S''s',
        v_code = 'OK' and v_inv.bank_name = v_s_name and v_inv.bank_account_name = v_s_acc and v_inv.bank_account_number = v_s_num
        and v_inv.bank_ifsc_code = v_s_ifsc and v_inv.bank_branch is null, 'sqlstate ' || v_code || ', bank ' || coalesce(v_inv.bank_name, 'NULL'));
      perform pg_temp.rec('S7 the invoice prefix still works alongside it (BK-) and the sequence still increases',
        v_inv.invoice_prefix = 'BK-' and v_n3 > v_n2
        and (select next_invoice_number from public.invoice_settings where singleton) = v_n3 + 1
        and (select invoice_prefix is null from public.invoices where id = v_i2), v_n2 || ' then ' || v_n3);

      if v_m4 is null then
        perform pg_temp.skip('D1-D2 deactivate then issue', 'needs a fourth Pending membership without an invoice');
      else
        -- ===================================================================
        -- Deactivate S: old invoices unchanged; the next invoice has no snapshot
        -- ===================================================================
        v_code := pg_temp.run_as(v_admin, format('select public.deactivate_bank_account(%L)', v_s));
        perform pg_temp.rec('D1 deactivating the active account succeeds and leaves none active', v_code = 'OK'
          and (select count(*) = 0 from public.bank_accounts where is_active), 'sqlstate ' || v_code);
        perform pg_temp.rec('D2 …without changing any issued invoice',
          (select bank_name = v_s_name and bank_account_number = v_s_num from public.invoices where id = v_i3)
          and (select bank_name = v_h_name and bank_account_number = v_h_num from public.invoices where id = v_i2)
          and (select bank_name is null from public.invoices where id = v_i1), '');
        v_code := pg_temp.run_as(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', v_m4));
        select * into v_inv from public.invoices where membership_id = v_m4;
        v_i4 := v_inv.id; v_n4 := v_inv.invoice_number;
        perform pg_temp.rec('D3 with no active account again, the next invoice has a NULL snapshot',
          v_code = 'OK' and v_i4 is not null and v_inv.bank_name is null and v_inv.bank_account_name is null
          and v_inv.bank_account_number is null and v_inv.bank_ifsc_code is null and v_inv.bank_branch is null, 'sqlstate ' || v_code);
        perform pg_temp.rec('D4 numbers: strictly increasing, counter = last + 1',
          v_n1 < v_n2 and v_n2 < v_n3 and v_n3 < v_n4
          and (select next_invoice_number from public.invoice_settings where singleton) = v_n4 + 1,
          v_n1 || ', ' || v_n2 || ', ' || v_n3 || ', ' || v_n4);
      end if;
    end if;

    -- =======================================================================
    -- M. Manual Issue Invoice snapshots the CURRENT active account
    -- =======================================================================
    if v_paid_null is null then
      perform pg_temp.skip('M1 manual issue copies the active account', 'no existing Paid membership without a payment date / invoice');
    else
      v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_h));
      v_code := v_code || '/' || pg_temp.run_as(v_admin, format('select public.issue_invoice(%L, %L, %L)', v_paid_null, v_today, v_today));
      select * into v_inv from public.invoices where membership_id = v_paid_null;
      v_im := v_inv.id;
      perform pg_temp.rec('M1 a MANUAL Issue Invoice copies the account that is active NOW (H, with its edited details)',
        v_code = 'OK/OK' and v_inv.bank_name = 'ZZVERIFY-HDFC-EDITED' and v_inv.bank_account_number = '999'
        and v_inv.bank_branch = 'Changed Branch' and v_inv.bank_account_name = v_h_acc and v_inv.bank_ifsc_code = v_h_ifsc,
        'sqlstate ' || v_code || ', bank ' || coalesce(v_inv.bank_name, 'NULL'));
      perform pg_temp.rec('M2 the invoice issued earlier from H still has H''s ORIGINAL details',
        (select bank_name = v_h_name and bank_account_number = v_h_num and bank_branch = v_h_branch from public.invoices where id = v_i2), '');
    end if;

    -- =======================================================================
    -- F. The snapshot is frozen — for every caller, even the owner
    -- =======================================================================
    v_code := pg_temp.run_owner(format('update public.invoices set bank_name = %L where id = %L', 'HACK', v_i2));
    perform pg_temp.rec('F1 changing a snapshot value is rejected, even for the owner (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format('update public.invoices set bank_account_number = %L where id = %L', '1', v_i2));
    perform pg_temp.rec('F2 changing the account number is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format($q$update public.invoices set bank_name = 'A', bank_account_name = 'B', bank_account_number = 'C', bank_ifsc_code = 'D' where id = %L$q$, v_i1));
    perform pg_temp.rec('F3 giving a snapshot to an invoice issued without one is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format($q$update public.invoices set bank_name = null, bank_account_name = null, bank_account_number = null, bank_ifsc_code = null, bank_branch = null where id = %L$q$, v_i2));
    perform pg_temp.rec('F4 clearing an issued invoice''s snapshot is rejected (55006)', v_code = '55006', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.invoices set bank_name = %L where id = %L', 'HACK', v_i2));
    perform pg_temp.rec('F5 a client (even an Admin) cannot write an invoice at all (42501)', v_code = '42501', 'sqlstate ' || v_code);
    perform pg_temp.rec('F6 the snapshot is intact after all those attempts',
      (select bank_name = v_h_name and bank_account_number = v_h_num and bank_account_name = v_h_acc and bank_ifsc_code = v_h_ifsc and bank_branch = v_h_branch
       from public.invoices where id = v_i2), '');

    -- =======================================================================
    -- E. Number and date editing still works, and leaves the snapshot alone
    -- =======================================================================
    if v_i3 is not null then
      select next_invoice_number into v_next from public.invoice_settings where singleton;
      while exists (select 1 from public.invoices where invoice_number = v_next) loop
        v_next := v_next + 1;
      end loop;
      v_code := pg_temp.run_as(v_admin, format('select public.update_invoice_details(%L, %s, %L)', v_i3, v_next, v_today));
      select * into v_inv from public.invoices where id = v_i3;
      perform pg_temp.rec('E1 an Admin can still edit an invoice''s number and date', v_code = 'OK' and v_inv.invoice_number = v_next, 'sqlstate ' || v_code);
      perform pg_temp.rec('E2 …and the bank snapshot and prefix are unchanged by it',
        v_inv.bank_name = v_s_name and v_inv.bank_account_number = v_s_num and v_inv.bank_ifsc_code = v_s_ifsc and v_inv.invoice_prefix = 'BK-', '');
    end if;

    -- =======================================================================
    -- I. An Instructor cannot see or manipulate invoices or their snapshot
    -- =======================================================================
    if v_instructor is null then
      perform pg_temp.skip('I1-I3 instructor denial', 'no instructor profile found');
    else
      v_out := pg_temp.query_as(v_instructor, 'select count(*)::text from public.invoices');
      perform pg_temp.rec('I1 an Instructor sees no invoices (and so no bank details)', v_out = '0', v_out);
      v_code := pg_temp.run_as(v_instructor, format('update public.invoices set bank_name = %L where id = %L', 'HACK', v_i2));
      perform pg_temp.rec('I2 an Instructor cannot write the snapshot (42501)', v_code = '42501', 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_instructor, format('select public.update_invoice_details(%L, 1, %L)', v_i2, v_today));
      perform pg_temp.rec('I3 an Instructor cannot call the invoice edit (42501)', v_code = '42501', 'sqlstate ' || v_code);
    end if;

    perform pg_temp.rec('K1 at most one bank account is active at the end (the unique index)',
      (select count(*) <= 1 from public.bank_accounts where is_active), '');
  end if;

  -- =========================================================================
  -- Z. Everything that existed before this script is untouched
  -- =========================================================================
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i where i.id = any(v_ids0);
  perform pg_temp.rec('Z1 every pre-existing invoice is byte-for-byte unchanged', v_hash0 = v_hash1, v_count0 || ' invoice(s) fingerprinted');
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
--     (select count(*) from public.invoices)                                         as invoices,
--     (select count(*) from public.invoices where bank_name is not null)             as invoices_with_bank_snapshot,
--     (select count(*) from public.bank_accounts where bank_name like 'ZZVERIFY-%')  as leftover_test_accounts,
--     (select count(*) from public.bank_accounts where is_active)                    as active_accounts,
--     (select invoice_prefix from public.invoice_settings)                           as setting_prefix,
--     (select next_invoice_number from public.invoice_settings)                      as next_invoice_number;
--
-- Compare with the SETUP row above: nothing should have changed, and leftover_test_accounts
-- must be 0.
-- ===========================================================================
