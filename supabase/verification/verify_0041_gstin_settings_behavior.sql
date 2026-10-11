-- ===========================================================================
-- Migration 0041 verification (structure and behaviour) - The GSTIN setting and the GSTIN on documents
-- Exercises supabase/migrations/0041_gstin_settings.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0041 is applied (the setting, the snapshot column, both CHECK constraints) and its prerequisites
--       exist. If not, every other check is skipped (NOT TESTED) after one clear failure.
--   S   Structure: both columns are nullable text with no default; both CHECKs hold the GSTIN format; an Admin can
--       update the setting and no client can write the snapshot; the guard and the two issuing functions carry the
--       GSTIN; the existing data satisfies the format.
--   B   The setting: an Admin updates it and the guard moves updated_at; invalid values are refused without changing
--       it; it can be cleared and set again; an Instructor changes nothing and an anonymous caller is refused.
--   D   Documents: a TAX INVOICE copies the setting when it is issued - a payment's tax invoice, a membership-level
--       invoice, and the replacement made by Cancel and Reissue; a PAYMENT RECEIPT (not a tax document) never carries a
--       GSTIN, nor does its replacement; changing the setting later alters NO document already issued (the cancelled
--       original keeps its own value); the snapshot cannot be edited. Changing the setting moves no counter,
--       reservation or document.
--   Z   The settings row is back to what it was, and every pre-existing invoice and receipt is byte-for-byte unchanged.
--
-- PREREQUISITES
--   * Migrations 0034-0041 applied. If 0041 is NOT applied, P0 fails and every scenario is skipped.
--   * An Admin profile, an Instructor profile (its checks are skipped without one), the singleton invoice_settings row
--     and the centre profile row.
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * It changes the GSTIN setting repeatedly - always to the fixture values 29ZZVER1234Z1ZR / 29ZZVER1234Z2ZQ, NULL, or
--     back to the value it found - and rolls all of it back. The real GSTIN is read once, shown in the DATA row of the
--     results, and restored (Z1) before the rollback.
--   * Disposable ZZVERIFY fixtures only (two students, one membership each). No existing membership, payment or invoice
--     is written; existing invoices are fingerprinted and compared at the end.
--   * It writes to invoice_settings (the GSTIN, and counters when it issues), so it holds that row's lock until it
--     ends: another session issuing a document at the same moment simply waits. Run it when no one is issuing documents.
--   * If a numbering sequence is not configured yet, it is configured for this run only (rolled back).
--   * Sequences leave a small gap in the YC- / MEM- numbering; no row remains.
--
-- LIMITATIONS
--   * The check CHARACTER of a GSTIN is validated by the application, not by the database, so the database accepts any
--     well-formed value (the fixtures are well formed and also have correct check characters).
--   * The CHECK on invoices.business_gstin cannot be provoked from here: an issued document is frozen, so an attempted
--     bad value is refused by the freeze trigger first. Its definition is checked in S3; the settings CHECK is exercised.
--   * Whether the GSTIN APPEARS on the page and the PDF is application code, covered by the automated tests and browser QA.
--   * Concurrency (a settings change racing an issue) cannot be tested in one transaction. The issue reads the settings
--     row it has locked (FOR UPDATE), so it sees a consistent value; that is checked in S5 as text, not as a race.
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

-- Sets the GSTIN as p_user (through the API role, so the column grant and the row policy apply); 'OK' or the SQLSTATE.
-- p_value may be NULL (clear it).
create function pg_temp.set_gstin(p_user uuid, p_value text)
returns text language plpgsql as $f$
begin
  return pg_temp.run_as(p_user, format('update public.invoice_settings set gstin = %L where singleton', p_value));
end $f$;

-- The stored GSTIN, read as the owner. PL/pgSQL on purpose: a LANGUAGE sql body is checked when the function is CREATED,
-- which would fail here (before P0 could report) on a database where 0041 is not applied yet; PL/pgSQL is checked when it runs.
create function pg_temp.gstin()
returns text language plpgsql as $f$
declare
  v_value text;
begin
  select gstin into v_value from public.invoice_settings where singleton;
  return v_value;
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
  c_regex      constant text := '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  g1           constant text := '29ZZVER1234Z1ZR';
  g2           constant text := '29ZZVER1234Z2ZQ';
  v_admin      uuid;
  v_instructor uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_err        text;
  v_m uuid;  v_m2 uuid;
  v_p1 uuid;  v_p2 uuid;  v_p3 uuid;
  v_out        text;
  v_code       text;
  v_bad        text;
  v_failed     text;
  v_orig       text;
  v_cur        text;
  v_upd0       timestamptz;
  v_upd1       timestamptz;
  v_set        public.invoice_settings%rowtype;
  v_cfg0       jsonb;
  v_nums       text;
  v_doc1       public.invoices%rowtype;
  v_doc2       public.invoices%rowtype;
  v_doc3       public.invoices%rowtype;
  v_doc4       public.invoices%rowtype;
  v_new        public.invoices%rowtype;
  v_doc1_json  jsonb;
  v_ready      boolean;
  v_inv_hash0  text;  v_inv_hash1  text;
  v_cancel_cols constant text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'];
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instructor from public.profiles where role = 'instructor' order by created_at limit 1;
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;

  -- P0. Is 0041 applied, and are its prerequisites there? -------------------------------------------------------------------
  v_ready := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_settings' and column_name = 'gstin')
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'business_gstin')
         and exists (select 1 from pg_constraint where conname = 'invoice_settings_gstin_valid')
         and exists (select 1 from pg_constraint where conname = 'invoices_business_gstin_valid');
  perform pg_temp.rec('P0 migration 0041 is applied (invoice_settings.gstin, invoices.business_gstin and their two CHECK constraints)',
    v_ready, case when v_ready then '' else 'apply 0041 first; every check below is skipped' end);
  if v_ready then
    v_ready := to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is not null
           and to_regprocedure('public.issue_payment_document(uuid, date)') is not null
           and to_regprocedure('public.correct_payment_document(uuid, text)') is not null
           and to_regprocedure('public.issue_invoice_core(uuid, date)') is not null
           and to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is not null;
    perform pg_temp.rec('P0b the earlier migrations it builds on are applied (payments, documents, corrections, the issuing functions)', v_ready, '');
  end if;

  if not v_ready then
    perform pg_temp.skip('S / B / D / Z', 'migration 0041 (or a prerequisite) is not applied');
  else
    -- ===== S. Structure =================================================================================================
    perform pg_temp.rec('S1 invoice_settings.gstin is text, nullable, with no default',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_settings' and column_name = 'gstin'
                and data_type = 'text' and is_nullable = 'YES' and column_default is null), '');
    perform pg_temp.rec('S2 invoices.business_gstin is text, nullable, with no default (documents issued before 0041 keep NULL)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'business_gstin'
                and data_type = 'text' and is_nullable = 'YES' and column_default is null), '');
    perform pg_temp.rec('S3 both CHECK constraints hold the GSTIN format (NULL or 2 digits, 5 letters, 4 digits, a letter, 1-9 or a letter, Z, a digit or a letter)',
      (select pg_get_constraintdef(oid) like '%[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]%' and pg_get_constraintdef(oid) like '%IS NULL%'
         from pg_constraint where conname = 'invoice_settings_gstin_valid' and conrelid = 'public.invoice_settings'::regclass)
      and (select pg_get_constraintdef(oid) like '%[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]%' and pg_get_constraintdef(oid) like '%IS NULL%'
         from pg_constraint where conname = 'invoices_business_gstin_valid' and conrelid = 'public.invoices'::regclass), '');
    perform pg_temp.rec('S4 an Admin (the authenticated role) may update the setting; no client may write a document''s snapshot; anon may do neither',
      has_column_privilege('authenticated', 'public.invoice_settings', 'gstin', 'update')
      and not has_column_privilege('anon', 'public.invoice_settings', 'gstin', 'update')
      and not has_column_privilege('authenticated', 'public.invoices', 'business_gstin', 'update')
      and not has_column_privilege('authenticated', 'public.invoices', 'business_gstin', 'insert')
      and not has_column_privilege('anon', 'public.invoices', 'business_gstin', 'update'), '');
    perform pg_temp.rec('S5 the guard moves updated_at on a GSTIN change, and both issuing functions copy it from the settings row they hold locked',
      pg_get_functiondef('public.invoice_settings_guard()'::regprocedure) like '%new.gstin%'
      and pg_get_functiondef('public.invoice_settings_guard()'::regprocedure) like '%old.gstin%'
      and pg_get_functiondef('public.issue_invoice_core(uuid, date)'::regprocedure) like '%business_gstin%v_settings.gstin%'
      and pg_get_functiondef('public.issue_payment_document_core(uuid, date, text, uuid)'::regprocedure) like '%business_gstin%v_settings.gstin%'
      and pg_get_functiondef('public.issue_invoice_core(uuid, date)'::regprocedure) like '%from public.invoice_settings%for update%'
      and pg_get_functiondef('public.issue_payment_document_core(uuid, date, text, uuid)'::regprocedure) like '%from public.invoice_settings%for update%', '');
    perform pg_temp.rec('S5b a payment receipt never carries a GSTIN: the payment issuing function copies it only for the invoice series',
      pg_get_functiondef('public.issue_payment_document_core(uuid, date, text, uuid)'::regprocedure) like '%case when v_series = ''invoice'' then v_settings.gstin end%', '');
    perform pg_temp.rec('S6 the issuing functions are still closed to clients',
      not has_function_privilege('authenticated', 'public.issue_invoice_core(uuid, date)', 'execute')
      and not has_function_privilege('authenticated', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'execute'), '');
    perform pg_temp.rec('S7 the existing data satisfies the format: the stored setting and every stored snapshot are NULL or well formed',
      not exists (select 1 from public.invoice_settings where gstin is not null and gstin !~ c_regex)
      and not exists (select 1 from public.invoices where business_gstin is not null and business_gstin !~ c_regex), '');
    perform pg_temp.info('DATA', format('the setting is %s; %s document(s) carry a GSTIN, %s do not (issued before it existed or without one)',
      coalesce((select '"' || gstin || '"' from public.invoice_settings where singleton), 'empty'),
      (select count(*) from public.invoices where business_gstin is not null), (select count(*) from public.invoices where business_gstin is null)));

    -- ===== Setup for the behaviour checks =================================================================================
    select * into v_set from public.invoice_settings where singleton;
    if v_admin is null then
      perform pg_temp.skip('B / D', 'no admin profile found');
    elsif v_set.singleton is null or not exists (select 1 from public.center_profile where singleton) then
      perform pg_temp.skip('B / D', 'the invoice settings row or the centre profile is missing, so no document can be issued');
    else
      v_orig := v_set.gstin;

      if v_set.starting_invoice_number is null then
        perform pg_temp.info('SETUP', 'invoice numbering was not configured; set to 990001 for this run: ' ||
          pg_temp.run_owner('update public.invoice_settings set starting_invoice_number = 990001 where singleton'));
      end if;
      if v_set.payment_receipt_starting_number is null then
        perform pg_temp.info('SETUP', 'payment receipt numbering was not configured; set to 880001 for this run: ' ||
          pg_temp.run_owner('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton'));
      end if;

      -- Everything in the settings row except the GSTIN, the clock and the counters: it must come back as it is.
      select to_jsonb(s) - array['gstin', 'updated_at', 'next_invoice_number', 'payment_receipt_next_number'] into v_cfg0
      from public.invoice_settings s where singleton;
      select updated_at into v_upd0 from public.invoice_settings where singleton;

      begin
        v_m := pg_temp.fixture('0041 A', '9000410001', 1000);
        v_m2 := pg_temp.fixture('0041 B', '9000410002', 500);
      exception when others then
        v_m := null;
        v_err := sqlstate || ' ' || sqlerrm;
      end;

      -- ===== B. The setting ================================================================================================
      v_code := pg_temp.set_gstin(v_admin, g1);
      select gstin, updated_at into v_cur, v_upd1 from public.invoice_settings where singleton;
      perform pg_temp.rec('B1 an Admin updates the GSTIN through the API role (the column grant and the row policy allow it)', v_code = 'OK' and v_cur = g1, v_code || ' -> ' || coalesce(v_cur, 'NULL'));
      if v_upd0 = now() then
        perform pg_temp.skip('B2 updated_at moves', 'updated_at was already set in this transaction (numbering was configured for this run), so a later change cannot be told apart');
      else
        perform pg_temp.rec('B2 the guard moved updated_at, so a GSTIN change counts as a configuration change', v_upd1 > v_upd0, v_upd0::text || ' -> ' || v_upd1::text);
      end if;

      v_failed := '';
      foreach v_bad in array array['29zzver1234z1zr', '29ZZVER1234Z1Z', '', '29ZZVER 234Z1ZR', '29ZZVER1234Z1AR', '29ZZVER1234Z1ZR1'] loop
        if pg_temp.set_gstin(v_admin, v_bad) <> '23514' or pg_temp.gstin() is distinct from g1 then
          v_failed := v_failed || '"' || v_bad || '" ';
        end if;
      end loop;
      perform pg_temp.rec('B3 a lower-case, short, empty, spaced, mis-shaped or too-long value is refused (23514) and the setting keeps its value',
        v_failed = '', coalesce(nullif(v_failed, ''), 'all six refused'));

      v_code := pg_temp.set_gstin(v_admin, null);
      v_cur := pg_temp.gstin();
      perform pg_temp.rec('B4 the GSTIN can be cleared (NULL means none)', v_code = 'OK' and v_cur is null, v_code);
      perform pg_temp.set_gstin(v_admin, g1);

      if v_instructor is null then
        perform pg_temp.skip('B5 instructor', 'no instructor profile found');
      else
        v_code := pg_temp.set_gstin(v_instructor, g2);
        perform pg_temp.rec('B5 an Instructor changes nothing (the admin-only row policy hides the row from the update)', pg_temp.gstin() = g1, v_code);
      end if;
      v_code := pg_temp.run_anon(format('update public.invoice_settings set gstin = %L where singleton', g2));
      perform pg_temp.rec('B6 an anonymous caller is refused (42501) and the setting is unchanged', v_code = '42501' and pg_temp.gstin() = g1, v_code);

      -- ===== D. Documents copy the setting when they are issued ==================================================================
      if v_m is null then
        perform pg_temp.skip('D', 'could not create the disposable fixtures: ' || coalesce(v_err, 'unknown'));
      else
        v_p1 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 4, '[{"method":"cash","amount":"400"}]', 'true'));
        v_p2 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 3, '[{"method":"cash","amount":"300"}]', 'false'));
        v_p3 := pg_temp.as_uuid(pg_temp.pay(v_admin, v_m, v_today - 2, '[{"method":"cash","amount":"300"}]', 'true'));
        if v_p1 is null or v_p2 is null or v_p3 is null then
          perform pg_temp.skip('D', 'the fixture payments could not be recorded');
        else
          -- The setting is g1: a TAX INVOICE copies it.
          v_out := pg_temp.issue(v_admin, v_p1);
          select * into v_doc1 from public.invoices where id = pg_temp.as_uuid(v_out);
          perform pg_temp.rec('D1 a tax invoice issued while the setting is G1 carries G1', v_doc1.id is not null and v_doc1.document_series = 'invoice' and v_doc1.business_gstin = g1, coalesce(v_out, 'NULL'));
          v_doc1_json := to_jsonb(v_doc1);

          -- The setting changes to g2. Nothing about numbering, reservations or existing documents moves.
          v_nums := pg_temp.numbers();
          v_code := pg_temp.set_gstin(v_admin, g2);
          perform pg_temp.rec('D2 changing the setting moves no counter, no reservation and no document', v_code = 'OK' and pg_temp.gstin() = g2 and pg_temp.numbers() = v_nums, v_nums || ' -> ' || pg_temp.numbers());

          -- A second TAX INVOICE issued now copies g2 ...
          v_out := pg_temp.issue(v_admin, v_p3);
          select * into v_doc4 from public.invoices where id = pg_temp.as_uuid(v_out);
          perform pg_temp.rec('D3 a tax invoice issued after the change carries G2 (new documents get the new value)', v_doc4.id is not null and v_doc4.document_series = 'invoice' and v_doc4.business_gstin = g2, coalesce(v_out, 'NULL'));

          -- ... but a PAYMENT RECEIPT issued now, with the setting set, carries none: it is not a tax document.
          v_out := pg_temp.issue(v_admin, v_p2);
          select * into v_doc2 from public.invoices where id = pg_temp.as_uuid(v_out);
          perform pg_temp.rec('D3b a payment receipt issued while the setting is G2 carries NO GSTIN', v_doc2.id is not null and v_doc2.document_series = 'payment_receipt' and v_doc2.business_gstin is null, coalesce(v_out, 'NULL'));

          -- ... and the first document is exactly as it was.
          perform pg_temp.rec('D4 the earlier document still carries G1 and is byte-for-byte unchanged: changing the setting affects new documents only',
            (select to_jsonb(i) from public.invoices i where i.id = v_doc1.id) = v_doc1_json and (select business_gstin from public.invoices where id = v_doc1.id) = g1, '');

          -- The snapshot cannot be edited by anyone.
          v_code := pg_temp.run_owner(format('update public.invoices set business_gstin = %L where id = %L', g2, v_doc1.id));
          perform pg_temp.rec('D5 the snapshot of an issued document cannot be changed, even by the owner (the freeze trigger, 55006)', v_code = '55006', v_code);
          v_code := pg_temp.run_as(v_admin, format('update public.invoices set business_gstin = %L where id = %L', g2, v_doc1.id));
          perform pg_temp.rec('D6 nor by an Admin through the API (42501)', v_code = '42501', v_code);

          -- Cancel and Reissue while the setting is empty: the original keeps its value, the replacement is a NEW document.
          perform pg_temp.set_gstin(v_admin, null);
          v_out := pg_temp.correct(v_admin, v_doc1.id, 'ZZVERIFY 0041 correction');
          select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
          perform pg_temp.rec('D7 the cancelled original keeps G1 and changes in nothing but its cancellation',
            (select business_gstin from public.invoices where id = v_doc1.id) = g1
            and (select status from public.invoices where id = v_doc1.id) = 'cancelled'
            and (select to_jsonb(i) - v_cancel_cols from public.invoices i where i.id = v_doc1.id) = (v_doc1_json - v_cancel_cols), '');
          perform pg_temp.rec('D8 the replacement is a new document and carries the GSTIN in force when it was issued (none now), with a new number and the link to the original',
            v_new.id is not null and v_new.replaces_id = v_doc1.id and v_new.business_gstin is null and v_new.invoice_number <> v_doc1.invoice_number
            and v_new.total_amount = v_doc1.total_amount, coalesce(v_out, 'NULL'));

          -- Cancel and Reissue of the payment RECEIPT, with the setting set again: its replacement carries none either.
          perform pg_temp.set_gstin(v_admin, g2);
          v_out := pg_temp.correct(v_admin, v_doc2.id, 'ZZVERIFY 0041 receipt correction');
          select * into v_new from public.invoices where id = pg_temp.as_uuid(v_out);
          perform pg_temp.rec('D8b the replacement of a payment receipt is a payment receipt and carries no GSTIN either, although the setting is G2',
            v_new.id is not null and v_new.replaces_id = v_doc2.id and v_new.document_series = 'payment_receipt' and v_new.business_gstin is null, coalesce(v_out, 'NULL'));
        end if;

        -- A MEMBERSHIP-LEVEL invoice (a Paid membership with no payments) also copies the setting.
        perform pg_temp.set_gstin(v_admin, g2);
        v_code := pg_temp.run_owner(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 3, v_m2));
        select * into v_doc3 from public.invoices where membership_id = v_m2 and payment_id is null;
        if v_doc3.id is null then
          perform pg_temp.skip('D9', 'could not issue a membership-level invoice for fixture B (' || v_code || ')');
        else
          perform pg_temp.rec('D9 a membership-level invoice issued while the setting is G2 carries G2', v_doc3.business_gstin = g2, coalesce(v_doc3.business_gstin, 'NULL'));
        end if;
      end if;

      -- ===== Z. Put the setting back and compare ===============================================================================
      v_code := pg_temp.run_owner(format('update public.invoice_settings set gstin = %L where singleton', v_orig));
      perform pg_temp.rec('Z1 the GSTIN setting is back to the value it had before this run', v_code = 'OK' and pg_temp.gstin() is not distinct from v_orig, v_code);
      perform pg_temp.rec('Z2 the rest of the settings row (document title, tax, terms, signatory, prefixes, starting numbers) is exactly as it was',
        (select to_jsonb(s) - array['gstin', 'updated_at', 'next_invoice_number', 'payment_receipt_next_number'] from public.invoice_settings s where singleton) = v_cfg0, '');
    end if;

    select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1
    from public.invoices i
    where i.membership_id not in (select m.id from public.memberships m join public.students s on s.id = m.student_id where s.full_name like 'ZZVERIFY%');
    perform pg_temp.rec('Z3 every pre-existing invoice and receipt is byte-for-byte unchanged (none was given, or lost, a GSTIN)', v_inv_hash0 = v_inv_hash1, '');
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

-- AFTER THE ROLLBACK (run separately) - nothing may remain, and the GSTIN is what it was:
--   select (select count(*) from public.students where full_name like 'ZZVERIFY%')                            as leftover_students,
--          (select count(*) from public.invoices where business_gstin in ('29ZZVER1234Z1ZR', '29ZZVER1234Z2ZQ')) as leftover_documents,
--          (select count(*) from public.invoices where cancellation_reason like 'ZZVERIFY%')                  as leftover_cancellations,
--          gstin, next_invoice_number, payment_receipt_next_number
--   from public.invoice_settings;
-- leftover_* must all be 0, gstin must be the value it had before the run (the migration's initial value
-- 29BPGPP6168E1ZH unless an Admin changed it), and both counters must equal their values before the run.
