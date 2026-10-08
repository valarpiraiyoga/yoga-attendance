-- ===========================================================================
-- V1 Bank Accounts — Migration 0028 BEHAVIOURAL verification
-- Exercises supabase/migrations/0028_bank_accounts.sql
-- ===========================================================================
--
-- Companion to verify_0028_bank_accounts.sql (read-only: proves the machinery is
-- INSTALLED). This script runs it and proves it BEHAVES, then throws the work away.
--
-- SAFETY — ROLLBACK ONLY
--   * Everything runs inside one transaction that ends in ROLLBACK.
--   * It creates test bank accounts, activates and deactivates them. None of it is
--     committed. bank_accounts keys on gen_random_uuid(), so no sequence is consumed.
--   * It never inserts a student, a membership or an invoice, and never modifies one:
--     the existing invoices are fingerprinted first and checked byte-for-byte at the end.
--   * If bank accounts already exist, the script works alongside them: its own accounts
--     are tagged 'ZZVERIFY-', and "exactly one active" is checked over the whole table.
--     (Activating a test account deactivates any pre-existing active one — rolled back.)
--   * The temp table and helper functions disappear with the transaction.
--   * Setup failures record NOT TESTED and carry on rather than raising.
--   * Run the whole file in one go. If the editor reports an open transaction, issue
--     `rollback;` first.
--
-- FIXTURE
--   Needs an admin profile; an instructor profile for the denial checks (reported NOT
--   TESTED without one). No other fixture.
--
-- AUTHENTICATION
--   Client-side behaviour runs as an authenticated ADMIN / INSTRUCTOR by setting
--   request.jwt.claims and switching to the `authenticated` role, as PostgREST does
--   (as verify_0014 / 0015 / 0026 / 0027 do). No service-role key is used.
--
-- CONCURRENCY
--   One SQL session cannot run two transactions at once, so true simultaneous
--   activation cannot be demonstrated here. What is demonstrated: the unique index
--   rejects a second active row (scenario U); both functions are verified to take the
--   invoice_settings row lock (verify_0028_bank_accounts.sql, check 18); consecutive
--   activations always leave exactly one active account. To see two sessions queue,
--   follow the TWO-SESSION PROCEDURE at the bottom of this file.
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
  v_admin       uuid;
  v_instructor  uuid;
  v_a           uuid;
  v_b           uuid;
  v_hash0       text;
  v_hash1       text;
  v_count0      int;
  v_code        text;
  v_out         text;
  v_active      int;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;

  -- Fingerprint every existing invoice before the script does anything.
  select count(*), md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_count0, v_hash0
  from public.invoices i;

  perform pg_temp.info('SETUP',
    format('admin=%s instructor=%s existing bank accounts=%s (active %s) invoices=%s',
           coalesce(v_admin::text, 'none'), coalesce(v_instructor::text, 'none'),
           (select count(*) from public.bank_accounts), (select count(*) from public.bank_accounts where is_active), v_count0));

  if v_admin is null then
    perform pg_temp.skip('every scenario', 'no admin profile found');
  else
    -- =======================================================================
    -- 1-2. Create two accounts as the Admin (client path): both start inactive
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, $q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, branch)
      values ('ZZVERIFY-HDFC', 'Test Yoga', '50200000000001', 'HDFC0000001', 'Sahakarnagar')$q$);
    select id into v_a from public.bank_accounts where bank_name = 'ZZVERIFY-HDFC';
    perform pg_temp.rec('1 an Admin can create an account; it is created inactive',
      v_code = 'OK' and v_a is not null and (select not is_active from public.bank_accounts where id = v_a), 'sqlstate ' || v_code);

    v_code := pg_temp.run_as(v_admin, $q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code)
      values ('ZZVERIFY-SBI', 'Test Yoga', '30000000000002', 'SBIN0000002')$q$);
    select id into v_b from public.bank_accounts where bank_name = 'ZZVERIFY-SBI';
    perform pg_temp.rec('2 a second account can be created (no branch is fine); also inactive',
      v_code = 'OK' and v_b is not null and (select not is_active and branch is null from public.bank_accounts where id = v_b), 'sqlstate ' || v_code);

    -- =======================================================================
    -- 3-4. Activate A
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_a));
    perform pg_temp.rec('3 an Admin can activate account A', v_code = 'OK', 'sqlstate ' || v_code);
    perform pg_temp.rec('4 A is active, and it is the only active account',
      (select is_active from public.bank_accounts where id = v_a)
      and (select count(*) = 1 from public.bank_accounts where is_active), '');

    -- =======================================================================
    -- 5-6. Activate B: A is deactivated automatically
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_b));
    perform pg_temp.rec('5 activating B succeeds', v_code = 'OK', 'sqlstate ' || v_code);
    perform pg_temp.rec('6 B is active, A is inactive, and exactly one account is active',
      (select is_active from public.bank_accounts where id = v_b)
      and (select not is_active from public.bank_accounts where id = v_a)
      and (select count(*) = 1 from public.bank_accounts where is_active), '');
    v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_b));
    perform pg_temp.rec('6b activating the already-active account is harmless', v_code = 'OK'
      and (select count(*) = 1 from public.bank_accounts where is_active), 'sqlstate ' || v_code);

    -- =======================================================================
    -- 7-8. Deactivate B: zero active accounts, and nothing else is activated
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('select public.deactivate_bank_account(%L)', v_b));
    perform pg_temp.rec('7 an Admin can deactivate the active account', v_code = 'OK', 'sqlstate ' || v_code);
    select count(*) into v_active from public.bank_accounts where is_active;
    perform pg_temp.rec('8 zero active accounts is valid, and no other account was activated', v_active = 0, v_active || ' active');
    v_code := pg_temp.run_as(v_admin, format('select public.deactivate_bank_account(%L)', v_b));
    perform pg_temp.rec('8b deactivating an inactive account is harmless', v_code = 'OK', 'sqlstate ' || v_code);

    -- =======================================================================
    -- 9-10. Activate A again
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', v_a));
    perform pg_temp.rec('9 A can be activated again', v_code = 'OK', 'sqlstate ' || v_code);
    perform pg_temp.rec('10 A is active again, and it is the only one',
      (select is_active from public.bank_accounts where id = v_a)
      and (select count(*) = 1 from public.bank_accounts where is_active), '');

    -- =======================================================================
    -- E. Editing details through the client grant; blank required values refused
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set branch = %L, bank_name = %L where id = %L', 'New Branch', 'ZZVERIFY-HDFC-2', v_a));
    perform pg_temp.rec('E1 an Admin can edit the details of the ACTIVE account, and it stays active',
      v_code = 'OK' and (select is_active and branch = 'New Branch' and bank_name = 'ZZVERIFY-HDFC-2' from public.bank_accounts where id = v_a),
      'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set branch = null where id = %L', v_a));
    perform pg_temp.rec('E2 the branch can be cleared (it is optional)', v_code = 'OK', 'sqlstate ' || v_code);

    -- =======================================================================
    -- 11-12. A client cannot write is_active directly
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set is_active = true where id = %L', v_b));
    perform pg_temp.rec('11 a client cannot UPDATE is_active (permission denied, 42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set is_active = false where id = %L', v_a));
    perform pg_temp.rec('11b nor deactivate by writing it directly (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, $q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, is_active)
      values ('ZZVERIFY-X', 'X', '1', 'X1', true)$q$);
    perform pg_temp.rec('11c nor INSERT an account as active (42501)', v_code = '42501', 'sqlstate ' || v_code);
    perform pg_temp.rec('12 the active account is still A and nothing changed',
      (select is_active from public.bank_accounts where id = v_a)
      and (select not is_active from public.bank_accounts where id = v_b)
      and (select count(*) = 1 from public.bank_accounts where is_active)
      and not exists (select 1 from public.bank_accounts where bank_name = 'ZZVERIFY-X'), '');
    v_code := pg_temp.run_as(v_admin, format('delete from public.bank_accounts where id = %L', v_b));
    perform pg_temp.rec('12b a client cannot DELETE an account (42501)', v_code = '42501', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set id = gen_random_uuid() where id = %L', v_b));
    perform pg_temp.rec('12c nor rewrite the id (42501)', v_code = '42501', 'sqlstate ' || v_code);

    -- =======================================================================
    -- U. The database itself guarantees at most one active (owner bypasses the functions)
    -- =======================================================================
    v_code := pg_temp.run_owner(format('update public.bank_accounts set is_active = true where id = %L', v_b));
    perform pg_temp.rec('U1 a second active account is rejected by the unique index, even for the owner (23505)', v_code = '23505', 'sqlstate ' || v_code);
    perform pg_temp.rec('U2 and the rejected write left exactly one active account',
      (select count(*) = 1 from public.bank_accounts where is_active), '');

    -- =======================================================================
    -- V. Light validation
    -- =======================================================================
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values ('   ', 'A', '1', 'X')$q$);
    perform pg_temp.rec('V1 a blank bank name is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values ('B', '', '1', 'X')$q$);
    perform pg_temp.rec('V2 a blank account name is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values ('B', 'A', ' ', 'X')$q$);
    perform pg_temp.rec('V3 a blank account number is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values ('B', 'A', '1', '')$q$);
    perform pg_temp.rec('V4 a blank IFSC code is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, branch) values ('B', 'A', '1', 'X', '  ')$q$);
    perform pg_temp.rec('V5 a blank (non-NULL) branch is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values (null, 'A', '1', 'X')$q$);
    perform pg_temp.rec('V6 a missing required value is rejected (23502)', v_code = '23502', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values (%L, 'A', '1', 'X')$q$, repeat('B', 101)));
    perform pg_temp.rec('V7 a 101-character bank name is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner(format($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code) values ('B', 'A', %L, 'X')$q$, repeat('9', 35)));
    perform pg_temp.rec('V8 a 35-character account number is rejected (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_as(v_admin, format('update public.bank_accounts set account_number = %L where id = %L', '', v_b));
    perform pg_temp.rec('V9 an Admin cannot blank a required value on an existing account (23514)', v_code = '23514', 'sqlstate ' || v_code);
    v_code := pg_temp.run_owner($q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code, branch)
      values ('ZZVERIFY-OK', 'Name With Spaces', 'ABCD 1234', 'HDFC0005315', null)$q$);
    perform pg_temp.rec('V10 ordinary values are accepted (spaces and letters in the account number are not restricted)', v_code = 'OK', 'sqlstate ' || v_code);

    -- =======================================================================
    -- N. Not an Admin: an Instructor has no access
    -- =======================================================================
    if v_instructor is null then
      perform pg_temp.skip('N1-N5 instructor denial', 'no instructor profile found');
    else
      v_out := pg_temp.query_as(v_instructor, 'select count(*)::text from public.bank_accounts');
      perform pg_temp.rec('N1 an Instructor sees no bank accounts (row level security)', v_out = '0', v_out);
      v_code := pg_temp.run_as(v_instructor, $q$insert into public.bank_accounts (bank_name, account_name, account_number, ifsc_code)
        values ('ZZVERIFY-INSTR', 'X', '1', 'X1')$q$);
      perform pg_temp.rec('N2 an Instructor cannot create an account (42501)', v_code = '42501', 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_instructor, format('update public.bank_accounts set bank_name = %L where id = %L', 'HACK', v_a));
      perform pg_temp.rec('N3 an Instructor cannot edit an account (no row is visible, nothing changes)',
        v_code = 'OK' and (select bank_name = 'ZZVERIFY-HDFC-2' from public.bank_accounts where id = v_a), 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_instructor, format('select public.activate_bank_account(%L)', v_b));
      perform pg_temp.rec('N4 an Instructor cannot activate an account (42501)', v_code = '42501', 'sqlstate ' || v_code);
      v_code := pg_temp.run_as(v_instructor, format('select public.deactivate_bank_account(%L)', v_a));
      perform pg_temp.rec('N5 an Instructor cannot deactivate an account (42501)', v_code = '42501', 'sqlstate ' || v_code);
      perform pg_temp.rec('N6 the accounts are exactly as they were after all of that',
        (select is_active from public.bank_accounts where id = v_a) and (select count(*) = 1 from public.bank_accounts where is_active), '');
    end if;

    -- =======================================================================
    -- M. A missing account is reported, and nothing is deactivated by the attempt
    -- =======================================================================
    v_code := pg_temp.run_as(v_admin, $q$select public.activate_bank_account('00000000-0000-4000-8000-000000000000')$q$);
    perform pg_temp.rec('M1 activating an account that does not exist is reported (P0002)', v_code = 'P0002', 'sqlstate ' || v_code);
    perform pg_temp.rec('M2 and the failed attempt did not deactivate the active account',
      (select is_active from public.bank_accounts where id = v_a), '');
    v_code := pg_temp.run_as(v_admin, $q$select public.deactivate_bank_account('00000000-0000-4000-8000-000000000000')$q$);
    perform pg_temp.rec('M3 deactivating one that does not exist is reported (P0002)', v_code = 'P0002', 'sqlstate ' || v_code);

    -- =======================================================================
    -- L. A run of activations always leaves exactly one active account
    -- =======================================================================
    for i in 1..6 loop
      v_code := pg_temp.run_as(v_admin, format('select public.activate_bank_account(%L)', case when i % 2 = 0 then v_a else v_b end));
      exit when v_code <> 'OK';
    end loop;
    perform pg_temp.rec('L1 six alternating activations leave exactly one active account, and it is the last one',
      v_code = 'OK' and (select count(*) = 1 from public.bank_accounts where is_active)
      and (select is_active from public.bank_accounts where id = v_a), 'sqlstate ' || v_code);
  end if;

  -- =========================================================================
  -- I. Existing invoices are untouched; no bank detail reached them
  -- =========================================================================
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), ''))
    into v_hash1
  from public.invoices i;
  perform pg_temp.rec('I1 every existing invoice is byte-for-byte unchanged', v_hash0 = v_hash1, v_count0 || ' invoice(s) fingerprinted');
  perform pg_temp.rec('I2 invoices has no bank column (before 0029) or just the five snapshot columns (0029) — and never a link to an account',
    (select count(*) in (0, 5) from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name like '%bank%')
    and not exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f' and confrelid = 'public.bank_accounts'::regclass), '');
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
--     (select count(*) from public.bank_accounts where bank_name like 'ZZVERIFY-%') as leftover_test_accounts,
--     (select count(*) from public.bank_accounts)                                   as bank_accounts,
--     (select count(*) from public.bank_accounts where is_active)                   as active_accounts,
--     (select count(*) from public.invoices)                                        as invoices;
--
-- leftover_test_accounts must be 0; the others must be what they were in the SETUP row.
--
-- ===========================================================================
-- TWO-SESSION PROCEDURE — two simultaneous activations serialise
-- ===========================================================================
-- Needs two SQL editor tabs (two real sessions) and two accounts P and Q. Do this on a
-- TEST database: it really changes which account is active (not rollback-only).
--
--   Session 1:  begin;
--               select public.activate_bank_account('<P>');   -- holds the invoice_settings row lock
--   Session 2:  begin;
--               select public.activate_bank_account('<Q>');   -- BLOCKS, waiting for session 1's lock
--   Session 1:  select id, is_active from public.bank_accounts where id in ('<P>', '<Q>');
--               commit;
--   Session 2:  -- unblocks now: P is deactivated, Q activated.
--               select id, is_active from public.bank_accounts where id in ('<P>', '<Q>');
--               commit;
--
-- Afterwards exactly one account (Q) is active. The same lock is held while an invoice is
-- being issued, so an activation also waits for (and is waited for by) invoice issuing.
-- ===========================================================================
