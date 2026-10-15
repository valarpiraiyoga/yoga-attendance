-- ===========================================================================
-- Migration 0055 verification (behaviour) - Cancel Document and Correct & Reissue for payment documents
-- Exercises supabase/migrations/0055_payment_document_cancel_and_correction.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0055 is applied (the two new functions and the two cores). If not, every scenario is skipped (NOT TESTED).
--   PF  Preflight: no student already has a fixture name (ZZVERIFY 0055 ...).
--   A   Authorization: anon refused; an Instructor refused (NOT TESTED without one); the cores and direct table writes refused for
--       an Admin; the audit table unreadable to an Instructor.
--   C   Cancel Document: reason required (blank, spaces, 501 characters refused); the document is cancelled with its reason, who and when,
--       and keeps its number and every detail; NO replacement is created; the payment, its methods and the membership are unchanged;
--       a second cancel is refused; the payment STAYS LOCKED (edit_payment / edit_payment_amount refused); a later issue gets a NEW
--       number and the cancelled number stays reserved; a cancelled document cannot be corrected; a membership-level document is refused.
--   R   Correct & Reissue (details only): customer and business overrides, the invoice date, the same series, a new number, the link
--       (replaces_id), the original unchanged except its cancellation fields, the student record and the centre profile untouched,
--       the payment and membership untouched, no audit row for a payment that did not change; a later correction without overrides
--       re-reads the CURRENT student and centre values (a correction is not carried forward unless it is sent again).
--   B   The membership balance rule, on the example membership payable 20000, other payments 12000, available 8000: a corrected payment
--       of 6000 and exactly 8000 are accepted (the corrected payment's own previous amount is NOT counted twice); 8000.01, 8500, two
--       methods adding to 8500, 0, a negative amount and three decimals are refused (22023) with nothing changed; the payment status
--       follows (partially paid <-> paid), the membership payment date follows, the other payment and its document are untouched.
--   M   Method allocation: methods replaced, positions and references kept, the audit row holds the previous and new allocation, the
--       reason and the cancelled document.
--   T   Tax: the replacement's tax is recomputed from the corrected amount with the issue formula and the current rate; a payment
--       receipt carries none.
--   X   Atomicity: a bad GSTIN, an unknown or non-text or over-long override, a blank name, a date before the payment date or in the
--       future, a reviewed total or tax that differs, a blank or over-long reason and an invalid method are each refused with NOTHING
--       changed - including a valid payment change sent together with an invalid override.
--   Y   Retry: correcting an already-corrected document is refused (55006), leaves exactly one replacement and one issued document.
--   S   Series: a payment receipt is replaced by a payment receipt (its own sequence, no tax, no GSTIN override).
--   F   Carry-forward: a replacement carries the ORIGINAL's plan, description, period, service details and tracked marker through BOTH
--       workflows (Correct & Reissue, and the older Correct Document), even after the membership's plan and end date changed and the
--       enrollment that produced the service details was deactivated; an original that has no service details and is untracked (a
--       document issued before they existed) is replaced by one that is also untracked with none, although the live enrollment WOULD
--       produce details; a FIRST document for the same membership is still built from the current membership.
--   Z   Everything that existed before this script (documents, payments, methods, payment edits, memberships) is unchanged.
--
-- PREREQUISITES: migrations 0034-0044, 0048-0050 and 0055 applied; an Admin profile (an Instructor profile for the denial checks) and
-- the centre profile. If numbering is not configured it is set inside the transaction only.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction ending in ROLLBACK. It creates its OWN disposable fixtures (students named 'ZZVERIFY 0055 ...', their memberships,
--   payments and documents), changes the tax settings inside the transaction, and touches no real record. The pre-existing documents,
--   payments, methods, payment edits and memberships are fingerprinted first and compared at the end (Z1).
--   ONE SIDE EFFECT ROLLBACK CANNOT UNDO: student and membership codes (YC- / MEM-) come from sequences, so each run leaves a small gap
--   in them. No row remains. The document-number sequences are columns of invoice_settings and ARE rolled back.
--   Run the whole file in one go. If the editor reports an open transaction, issue `rollback;` first.
--
-- LIMITATIONS
--   * Concurrency (two corrections, or a correction and a new payment, at once) cannot be staged in one transaction. The locks
--     (membership row, settings row, document row, in that order) are checked in the SQL text by the unit tests, not here.
--   * The deferred checks of 0034 fire at COMMIT, which this script never reaches; the balance rule and the totals are checked
--     explicitly here, and the function's own checks (which run inside it) are what the refusals below exercise.
--
-- AFTER THE ROLLBACK (run separately): nothing may remain - see the query at the bottom.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED, INFO.
-- ===========================================================================

begin;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _pre_ids (tbl text, id uuid) on commit drop;

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

-- One statement as the owner: 'OK' or the SQLSTATE.
create function pg_temp.code(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

-- One scalar query as an authenticated user: its text, or 'ERR:<sqlstate>'.
create function pg_temp.scalar_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

-- One statement as an authenticated user: 'OK' or the SQLSTATE.
create function pg_temp.as_user(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create function pg_temp.as_anon(p_sql text)
returns text language plpgsql as $f$
declare
  v_code text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    v_code := sqlstate;
  end;
  execute 'reset role';
  return v_code;
end $f$;

create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- Cancel Document as a user: the document id text, or 'ERR:<sqlstate>'.
create function pg_temp.canc(p_user uuid, p_doc uuid, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format('select public.cancel_payment_document(%L::uuid, %L)::text', p_doc, p_reason));
end $f$;

-- Correct & Reissue as a user: the replacement id text, or 'ERR:<sqlstate>'. NULL arguments are real NULLs.
create function pg_temp.corr(p_user uuid, p_doc uuid, p_reason text, p_date text, p_methods text, p_over text, p_total text, p_tax text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_user, format(
    'select public.correct_and_reissue_payment_document(%L::uuid, %L, %L::date, %L::jsonb, %L::jsonb, %L::numeric, %L::numeric)::text',
    p_doc, p_reason, p_date, p_methods, p_over, p_total, p_tax));
end $f$;

-- Records a payment as the Admin: the payment id text, or 'ERR:<sqlstate>'.
create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date, p_methods text, p_tax text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, %s::boolean)::text',
    p_membership, p_date, p_methods, p_tax));
end $f$;

-- Issues a payment's document as the Admin: the document id text, or 'ERR:<sqlstate>'.
create function pg_temp.issue(p_admin uuid, p_payment uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format('select public.issue_payment_document(%L::uuid)::text', p_payment));
end $f$;

-- The ISSUED document of a payment, if any.
create function pg_temp.cur_doc(p_payment uuid)
returns uuid language sql as $f$
  select i.id from public.invoices i where i.payment_id = p_payment and i.status = 'issued'
$f$;

-- A digest of a document without the named columns.
create function pg_temp.inv_hash(p_id uuid, p_drop text[])
returns text language sql as $f$
  select md5((to_jsonb(i) - p_drop)::text) from public.invoices i where i.id = p_id
$f$;

-- A digest of a payment and its methods.
create function pg_temp.pay_hash(p_payment uuid)
returns text language sql as $f$
  select md5(coalesce((select to_jsonb(p)::text from public.membership_payments p where p.id = p_payment), '')
          || coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.position) from public.membership_payment_methods m where m.payment_id = p_payment), ''))
$f$;

-- A digest of a membership without the named columns.
create function pg_temp.mem_hash(p_id uuid, p_drop text[])
returns text language sql as $f$
  select md5((to_jsonb(m) - p_drop)::text) from public.memberships m where m.id = p_id
$f$;

-- A digest of every document, payment, method, payment edit and membership that existed BEFORE this script created anything
-- (their ids are recorded in _pre_ids first), so the fixtures never count.
create function pg_temp.world()
returns text language sql as $f$
  select md5(
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.invoices t where t.id in (select id from _pre_ids where tbl = 'invoices')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.membership_payments t where t.id in (select id from _pre_ids where tbl = 'payments')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.membership_payment_methods t where t.id in (select id from _pre_ids where tbl = 'methods')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.membership_payment_edits t where t.id in (select id from _pre_ids where tbl = 'edits')), '') || '#' ||
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from public.memberships t where t.id in (select id from _pre_ids where tbl = 'memberships')), ''))
$f$;

do $$
declare
  v_admin    uuid;
  v_instr    uuid;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_currency text;
  v_ready    boolean;
  v_clash    integer := 0;
  v_world0   text;
  v_world1   text;
  v_r        text;
  v_s        text;
  v_c        text;
  v_n        integer;
  v_n2       integer;
  v_next     bigint;
  v_name0    text;
  v_cname0   text;
  v_h0       text;
  v_h1       text;
  v_h2       text;
  v_h3       text;
  v_h4       text;
  v_edits0   integer;
  v_inv0     integer;
  sa uuid; sb uuid; sc uuid; sd uuid;
  ma uuid; mb uuid; mc uuid; md uuid;
  pa1 uuid; pa2 uuid; pb1 uuid; pc1 uuid;
  da1 uuid; da2 uuid; db1 uuid; dc1 uuid; dc2 uuid; dm uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; rb uuid;
  f_instr uuid; f_batch uuid; f_series uuid; f_enr1 uuid; f_enr2 uuid; f_ok boolean := false; f_err text;
  se uuid; sf uuid; mf uuid; mg uuid; pf1 uuid; pf2 uuid; pg1 uuid; df1 uuid; df2 uuid; dg1 uuid; rf1 uuid; rf2 uuid; rg1 uuid;
  v_inv      public.invoices%rowtype;
  v_orig     public.invoices%rowtype;
  v_pay      public.membership_payments%rowtype;
  v_mem      public.memberships%rowtype;
  v_edit     public.membership_payment_edits%rowtype;
  v_ok       boolean;
  v_over1    constant text := '{"customer_name":"ZZVERIFY Corrected Name","customer_phone":"9111111111","customer_email":"corrected@example.com","business_name":"Corrected Studio","business_address":"1 Correction Road","business_gstin":"29ABCDE1234F1Z5"}';
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr from public.profiles where role = 'instructor' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;

  -- P0 -------------------------------------------------------------------------------------------------------------------
  v_ready := to_regprocedure('public.cancel_payment_document(uuid, text)') is not null
         and to_regprocedure('public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)') is not null
         and to_regprocedure('public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)') is not null
         and to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)') is not null;
  perform pg_temp.rec('P0 migration 0055 is applied (cancel, correct-and-reissue and the two cores)', coalesce(v_ready, false),
    case when coalesce(v_ready, false) then '' else 'apply 0055 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if v_ready then
    select count(*) into v_clash from public.students where position('ZZVERIFY 0055' in full_name) = 1;
    perform pg_temp.rec('PF no student already has a fixture name (ZZVERIFY 0055 ...)', v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing student(s) clash - nothing was created' end);
    insert into _pre_ids select 'invoices', id from public.invoices;
    insert into _pre_ids select 'payments', id from public.membership_payments;
    insert into _pre_ids select 'methods', id from public.membership_payment_methods;
    insert into _pre_ids select 'edits', id from public.membership_payment_edits;
    insert into _pre_ids select 'memberships', id from public.memberships;
    v_world0 := pg_temp.world();
    perform pg_temp.info('SETUP', format('documents=%s payments=%s payment edits=%s reserved invoice numbers=%s reserved receipt numbers=%s',
      (select count(*) from public.invoices), (select count(*) from public.membership_payments),
      (select count(*) from public.membership_payment_edits), (select count(*) from public.invoice_number_reservations),
      (select count(*) from public.payment_receipt_number_reservations)));
  end if;

  if not v_ready then
    perform pg_temp.skip('A / C / R / B / M / T / X / Y / S / Z', 'migration 0055 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('A / C / R / B / M / T / X / Y / S / Z', 'preflight PF failed');
  elsif v_admin is null or v_currency is null then
    perform pg_temp.skip('A / C / R / B / M / T / X / Y / S / Z', 'needs an Admin profile and the centre profile');
  else
    -- Settings (inside this transaction only): numbering, and tax at 18 percent.
    if (select starting_invoice_number from public.invoice_settings where singleton) is null then
      perform pg_temp.code('update public.invoice_settings set starting_invoice_number = 990001 where singleton');
    end if;
    if (select payment_receipt_starting_number from public.invoice_settings where singleton) is null then
      perform pg_temp.code('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton');
    end if;
    perform pg_temp.code($q$update public.invoice_settings set tax_enabled = true, tax_name = 'GST', tax_rate = 18 where singleton$q$);
    select name into v_cname0 from public.center_profile where singleton;

    -- Fixtures ----------------------------------------------------------------------------------------------------------
    insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 A', '9000000055', '+91', v_today - 400, 'active') returning id into sa;
    insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 B', '9000000056', '+91', v_today - 400, 'active') returning id into sb;
    insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 C', '9000000057', '+91', v_today - 400, 'active') returning id into sc;
    insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 D', '9000000058', '+91', v_today - 400, 'active') returning id into sd;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (sa, 'monthly', v_today - 30, v_today + 60, 20000, 'pending', v_currency) returning id into ma;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (sb, 'monthly', v_today - 30, v_today + 60, 10000, 'pending', v_currency) returning id into mb;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (sc, 'monthly', v_today - 30, v_today + 60, 6000, 'pending', v_currency) returning id into mc;
    insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (sd, 'monthly', v_today - 30, v_today + 60, 1000, 'pending', v_currency) returning id into md;

    -- MA: payable 20000. PA1 12000 (other payment) and PA2 5000 (the one to correct), both with a tax invoice.
    pa1 := pg_temp.as_uuid(pg_temp.pay(v_admin, ma, v_today - 10, '[{"method":"cash","amount":"12000"}]', 'true'));
    pa2 := pg_temp.as_uuid(pg_temp.pay(v_admin, ma, v_today - 8, '[{"method":"upi","amount":"5000"}]', 'true'));
    da1 := pg_temp.as_uuid(pg_temp.issue(v_admin, pa1));
    da2 := pg_temp.as_uuid(pg_temp.issue(v_admin, pa2));
    -- MB: payable 10000, a payment receipt of 4000.
    pb1 := pg_temp.as_uuid(pg_temp.pay(v_admin, mb, v_today - 5, '[{"method":"cash","amount":"4000"}]', 'false'));
    db1 := pg_temp.as_uuid(pg_temp.issue(v_admin, pb1));
    -- MC: payable 6000, a tax invoice of 6000.
    pc1 := pg_temp.as_uuid(pg_temp.pay(v_admin, mc, v_today - 4, '[{"method":"card","amount":"6000"}]', 'true'));
    dc1 := pg_temp.as_uuid(pg_temp.issue(v_admin, pc1));
    -- MD: marked Paid with no payments - the legacy membership-level receipt.
    v_c := pg_temp.as_user(v_admin, format('update public.memberships set payment_status = ''paid'' where id = %L', md));
    select id into dm from public.invoices where membership_id = md and payment_id is null;

    perform pg_temp.rec('FX fixtures: three payment documents on MA / MB / MC, a payment receipt, and a membership-level receipt on MD',
      pa1 is not null and pa2 is not null and da1 is not null and da2 is not null and pb1 is not null and db1 is not null
      and pc1 is not null and dc1 is not null and dm is not null
      and (select payment_status from public.memberships where id = ma) = 'partially_paid'
      and (select document_series from public.invoices where id = da2) = 'invoice'
      and (select document_series from public.invoices where id = db1) = 'payment_receipt'
      and (select total_amount from public.invoices where id = da2) = 5000,
      'v_c=' || v_c);

    -- A. Authorization -----------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_anon(format('select public.cancel_payment_document(%L, ''x'')', da2));
    v_s := pg_temp.as_anon(format('select public.correct_and_reissue_payment_document(%L, ''x'')', da2));
    perform pg_temp.rec('A1 anon cannot cancel or correct a document (42501)', v_c = '42501' and v_s = '42501', v_c || ' ' || v_s);
    v_c := pg_temp.as_user(v_admin, format('select public.edit_payment_core(%L, %L, ''[{"method":"cash","amount":"1"}]''::jsonb, true, ''x'', %L)', pa2, v_today - 8, da2));
    v_s := pg_temp.as_user(v_admin, format('select public.issue_payment_document_core(%L, null, ''invoice'', null, null::jsonb)', pa2));
    perform pg_temp.rec('A2 the cores are callable by no client role, not even an Admin (42501)', v_c = '42501' and v_s = '42501', v_c || ' ' || v_s);
    v_c := pg_temp.as_user(v_admin, format('update public.invoices set status = ''cancelled'' where id = %L', da2));
    v_s := pg_temp.as_user(v_admin, format('update public.membership_payments set amount = 1 where id = %L', pa2));
    perform pg_temp.rec('A3 no client role can write documents or payments directly (42501)', v_c = '42501' and v_s = '42501', v_c || ' ' || v_s);
    if v_instr is null then
      perform pg_temp.skip('A4 an Instructor is refused', 'needs an Instructor profile (none exists)');
    else
      v_c := pg_temp.canc(v_instr, da2, 'x');
      v_s := pg_temp.corr(v_instr, da2, 'x', null, null, null, null, null);
      perform pg_temp.rec('A4 an Instructor cannot cancel or correct a document (42501); nothing changes',
        v_c = 'ERR:42501' and v_s = 'ERR:42501' and (select status from public.invoices where id = da2) = 'issued', v_c || ' ' || v_s);
    end if;

    -- C. Cancel Document (MC / PC1 / DC1) ------------------------------------------------------------------------------------
    select * into v_orig from public.invoices where id = dc1;
    v_h0 := pg_temp.inv_hash(dc1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
    v_h1 := pg_temp.pay_hash(pc1);
    v_h2 := pg_temp.mem_hash(mc, array[]::text[]);
    select count(*) into v_inv0 from public.invoices;
    v_r := pg_temp.canc(v_admin, dc1, 'Issued in the wrong name');
    select * into v_inv from public.invoices where id = dc1;
    perform pg_temp.rec('C1 cancelling returns the document, marks it cancelled with the reason, who and when, and keeps its number and date',
      pg_temp.as_uuid(v_r) = dc1 and v_inv.status = 'cancelled' and v_inv.cancellation_reason = 'Issued in the wrong name'
      and v_inv.cancelled_by = v_admin and v_inv.cancelled_at is not null
      and v_inv.invoice_number = v_orig.invoice_number and v_inv.invoice_date = v_orig.invoice_date, v_r);
    perform pg_temp.rec('C2 every other detail of the cancelled document is unchanged',
      pg_temp.inv_hash(dc1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h0, '');
    perform pg_temp.rec('C3 no replacement is created, and no document appears',
      not exists (select 1 from public.invoices where replaces_id = dc1) and (select count(*) from public.invoices) = v_inv0
      and pg_temp.cur_doc(pc1) is null, '');
    perform pg_temp.rec('C4 the payment, its methods and the membership are unchanged',
      pg_temp.pay_hash(pc1) = v_h1 and pg_temp.mem_hash(mc, array[]::text[]) = v_h2, '');
    v_c := pg_temp.canc(v_admin, dc1, 'Again');
    perform pg_temp.rec('C5 a document that is already cancelled cannot be cancelled again (55006)', v_c = 'ERR:55006', v_c);
    v_c := pg_temp.canc(v_admin, db1, '   ');
    v_s := pg_temp.canc(v_admin, db1, '');
    v_r := pg_temp.canc(v_admin, db1, repeat('x', 501));
    perform pg_temp.rec('C6 a blank, empty or 501-character reason is refused (22023) and the document stays issued',
      v_c = 'ERR:22023' and v_s = 'ERR:22023' and v_r = 'ERR:22023' and (select status from public.invoices where id = db1) = 'issued', v_c || ' ' || v_s || ' ' || v_r);
    v_c := pg_temp.scalar_as(v_admin, format('select public.edit_payment(%L::uuid, %L::date, %L::jsonb)::text', pc1, v_today - 4, '[{"method":"card","amount":"5000"}]'));
    perform pg_temp.rec('C7 the payment stays LOCKED after a cancellation: edit_payment is refused (55006)', v_c = 'ERR:55006' and pg_temp.pay_hash(pc1) = v_h1, v_c);
    v_c := pg_temp.canc(v_admin, gen_random_uuid(), 'x');
    v_s := pg_temp.canc(v_admin, dm, 'x');
    v_r := pg_temp.corr(v_admin, dm, 'x', null, null, null, null, null);
    perform pg_temp.rec('C8 an unknown document is P0002; a legacy membership-level receipt is refused by both functions (55000)',
      v_c = 'ERR:P0002' and v_s = 'ERR:55000' and v_r = 'ERR:55000' and (select status from public.invoices where id = dm) = 'issued', v_c || ' ' || v_s || ' ' || v_r);
    v_r := pg_temp.corr(v_admin, dc1, 'Correct it', null, null, null, null, null);
    perform pg_temp.rec('C9 a cancelled document cannot be corrected (55006)', v_r = 'ERR:55006' and not exists (select 1 from public.invoices where replaces_id = dc1), v_r);
    -- A later document gets a NEW number; the cancelled number stays reserved.
    dc2 := pg_temp.as_uuid(pg_temp.issue(v_admin, pc1));
    select * into v_inv from public.invoices where id = dc2;
    perform pg_temp.rec('C10 a later issue for that payment gets a NEW number in the payment''s series, is not linked to the cancelled one, and the old number stays reserved',
      dc2 is not null and v_inv.status = 'issued' and v_inv.invoice_number <> v_orig.invoice_number and v_inv.document_series = v_orig.document_series
      and v_inv.replaces_id is null and v_inv.total_amount = 6000
      and exists (select 1 from public.invoice_number_reservations r where r.invoice_number = v_orig.invoice_number and r.invoice_id = dc1)
      and (select status from public.invoices where id = dc1) = 'cancelled', coalesce(v_inv.invoice_number::text, ''));

    -- R. Correct & Reissue: details only (MA / PA2 / DA2) ---------------------------------------------------------------------
    select * into v_orig from public.invoices where id = da2;
    select full_name into v_name0 from public.students where id = sa;
    v_h0 := pg_temp.inv_hash(da2, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
    v_h1 := pg_temp.pay_hash(pa2);
    v_h2 := pg_temp.mem_hash(ma, array[]::text[]);
    v_h3 := pg_temp.inv_hash(da1, array[]::text[]);
    select count(*) into v_edits0 from public.membership_payment_edits;
    select count(*) into v_inv0 from public.invoices;
    select coalesce(next_invoice_number, starting_invoice_number) into v_next from public.invoice_settings where singleton;
    v_r := pg_temp.corr(v_admin, da2, 'Customer details were wrong', (v_today - 3)::text, null, v_over1, '5000', '762.71');
    r1 := pg_temp.as_uuid(v_r);
    select * into v_inv from public.invoices where id = r1;
    perform pg_temp.rec('R1 the replacement is issued in the SAME series with a NEW number, linked to the original, dated as chosen',
      r1 is not null and v_inv.status = 'issued' and v_inv.replaces_id = da2 and v_inv.document_series = v_orig.document_series
      and v_inv.invoice_number <> v_orig.invoice_number and v_inv.invoice_number >= v_next and v_inv.invoice_date = v_today - 3
      and v_inv.payment_date = v_orig.payment_date and v_inv.payment_id = pa2 and v_inv.membership_id = ma, v_r);
    perform pg_temp.rec('R2 the replacement carries the corrected customer and business details (and the customer code of the original)',
      v_inv.customer_name = 'ZZVERIFY Corrected Name' and v_inv.customer_phone = '9111111111' and v_inv.customer_email = 'corrected@example.com'
      and v_inv.customer_code = v_orig.customer_code and v_inv.customer_phone_country_code = v_orig.customer_phone_country_code
      and v_inv.business_name = 'Corrected Studio' and v_inv.business_address = '1 Correction Road' and v_inv.business_gstin = '29ABCDE1234F1Z5', '');
    perform pg_temp.rec('R3 the amount and tax are those of the payment under the issue formula: 5000.00 = 4237.29 + 762.71 at 18',
      v_inv.total_amount = 5000 and v_inv.tax_amount = 762.71 and v_inv.taxable_amount = 4237.29 and v_inv.tax_rate = 18 and v_inv.tax_enabled, '');
    select * into v_orig from public.invoices where id = da2;
    perform pg_temp.rec('R4 the original is cancelled with the correction reason and is unchanged except its cancellation fields',
      v_orig.status = 'cancelled' and v_orig.cancellation_reason = 'Customer details were wrong' and v_orig.cancelled_by = v_admin
      and pg_temp.inv_hash(da2, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h0, '');
    perform pg_temp.rec('R5 the student record and the centre profile are NOT changed by a customer / business correction',
      (select full_name from public.students where id = sa) = v_name0 and (select name from public.center_profile where singleton) = v_cname0, '');
    perform pg_temp.rec('R6 the payment, the membership and the other payment with its document are untouched; no payment edit is recorded for a details-only correction',
      pg_temp.pay_hash(pa2) = v_h1 and pg_temp.mem_hash(ma, array[]::text[]) = v_h2 and pg_temp.inv_hash(da1, array[]::text[]) = v_h3
      and (select count(*) from public.membership_payment_edits) = v_edits0, '');
    perform pg_temp.rec('R7 exactly one replacement and one issued document: the history is the replaces_id link',
      (select count(*) from public.invoices where replaces_id = da2) = 1 and (select count(*) from public.invoices where payment_id = pa2 and status = 'issued') = 1
      and (select count(*) from public.invoices) = v_inv0 + 1
      and exists (select 1 from public.invoice_number_reservations r where r.invoice_number = v_orig.invoice_number and r.invoice_id = da2)
      and exists (select 1 from public.invoice_number_reservations r where r.invoice_number = v_inv.invoice_number and r.invoice_id = r1), '');

    -- A correction without overrides and without a date: the date is kept, and the CURRENT student / centre values are used.
    v_r := pg_temp.corr(v_admin, r1, 'Back to the record', null, null, null, null, null);
    r2 := pg_temp.as_uuid(v_r);
    select * into v_inv from public.invoices where id = r2;
    perform pg_temp.rec('R8 with no date given the original date is kept; with no overrides the replacement re-reads the CURRENT student and centre values',
      r2 is not null and v_inv.invoice_date = v_today - 3 and v_inv.customer_name = v_name0 and v_inv.business_name = v_cname0
      and v_inv.replaces_id = r1 and v_inv.total_amount = 5000, v_r);

    -- B. The balance rule (payable 20000, other payments 12000, available 8000) and method / amount changes ----------------------
    -- Refusals first, from the current document r2 (amount 5000).
    select count(*) into v_edits0 from public.membership_payment_edits;
    select count(*) into v_inv0 from public.invoices;
    v_h0 := pg_temp.inv_hash(r2, array[]::text[]);
    v_h1 := pg_temp.pay_hash(pa2);
    v_h2 := pg_temp.mem_hash(ma, array[]::text[]);
    select coalesce(next_invoice_number, starting_invoice_number) into v_next from public.invoice_settings where singleton;
    v_c := pg_temp.corr(v_admin, r2, 'Too much', null, '[{"method":"upi","amount":"8000.01"}]', null, null, null);
    v_s := pg_temp.corr(v_admin, r2, 'Too much', null, '[{"method":"upi","amount":"8500"}]', null, null, null);
    v_r := pg_temp.corr(v_admin, r2, 'Too much', null, '[{"method":"upi","amount":"4000"},{"method":"cash","amount":"4500"}]', null, null, null);
    perform pg_temp.rec('B1 a corrected payment above the available balance is refused (22023): 8000.01, 8500, and two methods adding to 8500',
      v_c = 'ERR:22023' and v_s = 'ERR:22023' and v_r = 'ERR:22023', v_c || ' ' || v_s || ' ' || v_r);
    v_c := pg_temp.corr(v_admin, r2, 'Zero', null, '[{"method":"upi","amount":"0"}]', null, null, null);
    v_s := pg_temp.corr(v_admin, r2, 'Negative', null, '[{"method":"upi","amount":"-1"}]', null, null, null);
    v_r := pg_temp.corr(v_admin, r2, 'Decimals', null, '[{"method":"upi","amount":"100.005"}]', null, null, null);
    perform pg_temp.rec('B2 a zero, a negative and a three-decimal amount are refused (22023), and so is an empty or invalid method list',
      v_c = 'ERR:22023' and v_s = 'ERR:22023' and v_r = 'ERR:22023'
      and pg_temp.corr(v_admin, r2, 'None', null, '[]', null, null, null) = 'ERR:22023'
      and pg_temp.corr(v_admin, r2, 'Cheque', null, '[{"method":"cheque","amount":"100"}]', null, null, null) = 'ERR:22023', v_c || ' ' || v_s || ' ' || v_r);
    perform pg_temp.rec('B3 every refusal left NOTHING changed: the document is still issued and unchanged, no replacement, the payment, the membership, the audit and the numbering are as before',
      (select status from public.invoices where id = r2) = 'issued' and pg_temp.inv_hash(r2, array[]::text[]) = v_h0
      and (select count(*) from public.invoices) = v_inv0 and pg_temp.pay_hash(pa2) = v_h1 and pg_temp.mem_hash(ma, array[]::text[]) = v_h2
      and (select count(*) from public.membership_payment_edits) = v_edits0
      and (select coalesce(next_invoice_number, starting_invoice_number) from public.invoice_settings where singleton) = v_next, '');
    v_h4 := pg_temp.mem_hash(ma, array['payment_status', 'payment_date', 'updated_at']);

    -- 6000: allowed (partially paid: 12000 + 6000 < 20000).
    v_r := pg_temp.corr(v_admin, r2, 'Amount was entered wrongly', null, '[{"method":"upi","amount":"6000"}]', null, '6000', '915.25');
    r3 := pg_temp.as_uuid(v_r);
    select * into v_inv from public.invoices where id = r3;
    select * into v_pay from public.membership_payments where id = pa2;
    select * into v_mem from public.memberships where id = ma;
    perform pg_temp.rec('B4 a corrected payment of 6000 (available 8000) is accepted: the payment and its single method read 6000, the payment date is unchanged',
      r3 is not null and v_pay.amount = 6000 and v_pay.payment_date = v_today - 8
      and (select count(*) = 1 and bool_and(amount = 6000 and method = 'upi') from public.membership_payment_methods where payment_id = pa2), v_r);
    perform pg_temp.rec('B5 the replacement shows the corrected amount and the recomputed tax: 6000.00 = 5084.75 + 915.25; the original (5000) stays cancelled',
      v_inv.total_amount = 6000 and v_inv.tax_amount = 915.25 and v_inv.taxable_amount = 5084.75 and v_inv.replaces_id = r2
      and (select status from public.invoices where id = r2) = 'cancelled', '');
    perform pg_temp.rec('B6 the membership payment status follows its payments: still partially paid, no payment date, price / terms / validity unchanged',
      v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null and v_mem.amount = 20000
      and pg_temp.mem_hash(ma, array['payment_status', 'payment_date', 'updated_at']) = v_h4, '');
    select * into v_edit from public.membership_payment_edits where payment_id = pa2 and corrected_document_id = r2;
    perform pg_temp.rec('B7 the audit row keeps the PREVIOUS amount and allocation, the new ones, the reason, the dates and the document that was cancelled',
      v_edit.previous_amount = 5000 and v_edit.new_amount = 6000 and v_edit.correction_reason = 'Amount was entered wrongly'
      and v_edit.corrected_document_id = r2 and v_edit.previous_payment_date = v_today - 8 and v_edit.new_payment_date = v_today - 8
      and v_edit.previous_allocations -> 0 ->> 'method' = 'upi' and (v_edit.previous_allocations -> 0 ->> 'amount')::numeric = 5000
      and (v_edit.new_allocations -> 0 ->> 'amount')::numeric = 6000 and v_edit.edited_by = v_admin, '');
    perform pg_temp.rec('B8 the OTHER payment and its document are untouched by the correction',
      (select amount from public.membership_payments where id = pa1) = 12000 and pg_temp.inv_hash(da1, array[]::text[]) = v_h3
      and (select status from public.invoices where id = da1) = 'issued', '');

    -- 8000: exactly the available balance (the corrected payment's own previous amount is NOT counted twice).
    v_r := pg_temp.corr(v_admin, r3, 'Final amount', null, '[{"method":"upi","amount":"8000"}]', null, '8000', '1220.34');
    r4 := pg_temp.as_uuid(v_r);
    select * into v_mem from public.memberships where id = ma;
    select * into v_inv from public.invoices where id = r4;
    perform pg_temp.rec('B9 a corrected payment of exactly 8000 settles the balance and is accepted: the membership becomes Paid with the latest payment date',
      r4 is not null and v_mem.payment_status = 'paid' and v_mem.payment_date = v_today - 8
      and (select amount from public.membership_payments where id = pa2) = 8000
      and v_inv.total_amount = 8000 and v_inv.tax_amount = 1220.34 and v_inv.taxable_amount = 6779.66, v_r);
    -- Over by one cent from the Paid state, and the status goes back when the amount is lowered.
    v_c := pg_temp.corr(v_admin, r4, 'One cent over', null, '[{"method":"upi","amount":"8000.01"}]', null, null, null);
    perform pg_temp.rec('B10 one cent above the available balance is still refused once the membership is Paid, and nothing changes',
      v_c = 'ERR:22023' and (select status from public.invoices where id = r4) = 'issued' and (select payment_status from public.memberships where id = ma) = 'paid', v_c);
    v_r := pg_temp.corr(v_admin, r4, 'Lower again', null, '[{"method":"upi","amount":"7000"}]', null, null, null);
    r5 := pg_temp.as_uuid(v_r);
    select * into v_mem from public.memberships where id = ma;
    perform pg_temp.rec('B11 lowering the payment returns the membership to Partially Paid and clears its payment date (no refund is recorded anywhere)',
      r5 is not null and v_mem.payment_status = 'partially_paid' and v_mem.payment_date is null and (select amount from public.membership_payments where id = pa2) = 7000
      and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('refunds', 'credit_notes')), v_r);

    -- M. Method allocation with the same total ---------------------------------------------------------------------------------
    v_r := pg_temp.corr(v_admin, r5, 'Split between two methods', null,
      '[{"method":"cash","amount":"2500","notes":"Counter"},{"method":"upi","amount":"4500","reference_id":"REF-0055"}]', null, '7000', null);
    r6 := pg_temp.as_uuid(v_r);
    select * into v_edit from public.membership_payment_edits where payment_id = pa2 and corrected_document_id = r5;
    perform pg_temp.rec('M1 the methods are replaced with their positions, references and notes, and the total is their sum (7000)',
      r6 is not null and (select amount from public.membership_payments where id = pa2) = 7000
      and (select count(*) = 2 from public.membership_payment_methods where payment_id = pa2)
      and exists (select 1 from public.membership_payment_methods where payment_id = pa2 and position = 1 and method = 'cash' and amount = 2500 and notes = 'Counter')
      and exists (select 1 from public.membership_payment_methods where payment_id = pa2 and position = 2 and method = 'upi' and amount = 4500 and reference_id = 'REF-0055'), v_r);
    perform pg_temp.rec('M2 the audit row holds the single previous method and the two new ones, with the reason and the cancelled document',
      v_edit.previous_amount = 7000 and v_edit.new_amount = 7000 and jsonb_array_length(v_edit.previous_allocations) = 1
      and jsonb_array_length(v_edit.new_allocations) = 2 and v_edit.corrected_document_id = r5 and v_edit.correction_reason = 'Split between two methods', '');
    if v_instr is null then
      perform pg_temp.skip('A5 an Instructor reads no payment edit (RLS)', 'needs an Instructor profile (none exists)');
    else
      v_s := pg_temp.scalar_as(v_instr, 'select count(*)::text from public.membership_payment_edits');
      v_c := pg_temp.scalar_as(v_admin, 'select count(*)::text from public.membership_payment_edits');
      perform pg_temp.rec('A5 an Instructor reads no payment edit (RLS) while the Admin reads them', v_s = '0' and v_c::int >= 3, 'instructor ' || v_s || ', admin ' || v_c);
    end if;

    -- X. Atomicity: each refusal changes nothing, including a valid payment change sent with an invalid override --------------
    select count(*) into v_edits0 from public.membership_payment_edits;
    select count(*) into v_inv0 from public.invoices;
    v_h0 := pg_temp.inv_hash(r6, array[]::text[]);
    v_h1 := pg_temp.pay_hash(pa2);
    v_h2 := pg_temp.mem_hash(ma, array[]::text[]);
    select coalesce(next_invoice_number, starting_invoice_number) into v_next from public.invoice_settings where singleton;
    v_n := 0;
    v_s := '';
    -- (override, date, methods, reason, total, tax) - each must be refused with the SQLSTATE shown
    v_c := pg_temp.corr(v_admin, r6, 'Bad GSTIN', null, null, '{"business_gstin":"BADGSTIN"}', null, null);
    v_s := v_s || v_c || ' ';
    v_ok := v_c = 'ERR:23514';
    v_c := pg_temp.corr(v_admin, r6, 'Unknown key', null, null, '{"customer_code":"X"}', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Not text', null, null, '{"customer_name":5}', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Not an object', null, null, '[1]', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Too long', null, null, format('{"customer_name":"%s"}', repeat('x', 501)), null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Blank name', null, null, '{"customer_name":"  "}', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Blank business', null, null, '{"business_name":""}', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Before the payment', (v_today - 9)::text, null, null, null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'In the future', (v_today + 1)::text, null, null, null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, 'Not the reviewed total', null, null, null, '7001', null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:55006';
    v_c := pg_temp.corr(v_admin, r6, 'Not the reviewed tax', null, null, null, null, '1.00');
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:55006';
    v_c := pg_temp.corr(v_admin, r6, '   ', null, null, null, null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    v_c := pg_temp.corr(v_admin, r6, repeat('x', 501), null, null, null, null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:22023';
    -- A VALID payment change (7000 -> 7500) sent with an invalid override: the payment change must roll back with the rest.
    v_c := pg_temp.corr(v_admin, r6, 'Valid amount, bad GSTIN', null, '[{"method":"cash","amount":"7500"}]', '{"business_gstin":"BADGSTIN"}', null, null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:23514';
    -- A VALID payment change with a reviewed total that does not match.
    v_c := pg_temp.corr(v_admin, r6, 'Valid amount, wrong review', null, '[{"method":"cash","amount":"7500"}]', null, '7000', null);
    v_s := v_s || v_c || ' '; v_ok := v_ok and v_c = 'ERR:55006';
    perform pg_temp.rec('X1 each invalid correction is refused with its SQLSTATE (bad GSTIN 23514; unknown / non-text / non-object / over-long / blank values, bad dates, blank or long reasons 22023; a reviewed total or tax that differs 55006)',
      v_ok, v_s);
    perform pg_temp.rec('X2 after all of them NOTHING changed: the document is issued and identical, no replacement, the payment (7000, two methods) and the membership are as before, no audit row, the numbering counter did not move',
      (select status from public.invoices where id = r6) = 'issued' and pg_temp.inv_hash(r6, array[]::text[]) = v_h0
      and (select count(*) from public.invoices) = v_inv0 and pg_temp.pay_hash(pa2) = v_h1 and pg_temp.mem_hash(ma, array[]::text[]) = v_h2
      and (select count(*) from public.membership_payment_edits) = v_edits0
      and (select coalesce(next_invoice_number, starting_invoice_number) from public.invoice_settings where singleton) = v_next, '');

    -- Y. Retry --------------------------------------------------------------------------------------------------------------------
    v_c := pg_temp.corr(v_admin, da2, 'Retry of an old correction', null, null, null, null, null);
    v_s := pg_temp.corr(v_admin, r5, 'Retry of a later one', null, null, null, null, null);
    perform pg_temp.rec('Y1 correcting a document that has already been corrected is refused (55006) and creates no second replacement',
      v_c = 'ERR:55006' and v_s = 'ERR:55006'
      and (select count(*) from public.invoices where replaces_id = da2) = 1 and (select count(*) from public.invoices where replaces_id = r5) = 1
      and (select count(*) from public.invoices) = v_inv0, v_c || ' ' || v_s);
    perform pg_temp.rec('Y2 the payment has exactly ONE issued document, and every earlier document of its chain is cancelled and keeps its reserved number',
      (select count(*) from public.invoices where payment_id = pa2 and status = 'issued') = 1
      and (select count(*) from public.invoices where payment_id = pa2) = 7
      and not exists (
        select 1 from public.invoices i
        where i.payment_id = pa2 and not exists (select 1 from public.invoice_number_reservations r where r.invoice_number = i.invoice_number and r.invoice_id = i.id))
      and (select count(distinct invoice_number) = 7 from public.invoices where payment_id = pa2), '');

    -- S. Series: a payment receipt stays a payment receipt (MB / PB1 / DB1) ----------------------------------------------------------------
    select * into v_orig from public.invoices where id = db1;
    select coalesce(payment_receipt_next_number, payment_receipt_starting_number) into v_next from public.invoice_settings where singleton;
    v_c := pg_temp.corr(v_admin, db1, 'GSTIN on a receipt', null, null, '{"business_gstin":"29ABCDE1234F1Z5"}', null, null);
    perform pg_temp.rec('S1 a GSTIN cannot be put on a payment receipt (22023), and nothing changes', v_c = 'ERR:22023' and (select status from public.invoices where id = db1) = 'issued', v_c);
    v_r := pg_temp.corr(v_admin, db1, 'Wrong amount and name', null, '[{"method":"cash","amount":"5000"}]', '{"customer_name":"ZZVERIFY Receipt Name"}', '5000', null);
    rb := pg_temp.as_uuid(v_r);
    select * into v_inv from public.invoices where id = rb;
    perform pg_temp.rec('S2 the replacement of a payment receipt is a payment receipt from its own sequence, with no tax, linked to the original',
      rb is not null and v_inv.document_series = 'payment_receipt' and v_inv.replaces_id = db1 and v_inv.invoice_number >= v_next
      and v_inv.invoice_number <> v_orig.invoice_number and not v_inv.tax_enabled and v_inv.tax_amount is null and v_inv.taxable_amount is null
      and v_inv.total_amount = 5000 and v_inv.customer_name = 'ZZVERIFY Receipt Name' and v_inv.business_gstin is null
      and v_inv.document_title = 'payment_receipt', v_r);
    v_c := pg_temp.corr(v_admin, rb, 'Over', null, '[{"method":"cash","amount":"10000.01"}]', null, null, null);
    v_r := pg_temp.corr(v_admin, rb, 'Settle', null, '[{"method":"cash","amount":"10000"}]', null, '10000', null);
    perform pg_temp.rec('S3 on MB (payable 10000, no other payment) 10000.01 is refused and exactly 10000 is accepted, which makes it Paid',
      v_c = 'ERR:22023' and pg_temp.as_uuid(v_r) is not null and (select payment_status from public.memberships where id = mb) = 'paid', v_c || ' ' || v_r);

    -- F. Carry-forward of the membership-derived snapshot ----------------------------------------------------------------------------
    -- Fixtures: one batch with a Monday 08:15-09:15 schedule, two students enrolled in it from before their membership starts, and
    -- a membership each. A guarded block: if the fixtures cannot be built (a schema difference), F is reported NOT TESTED.
    begin
      insert into public.instructors (full_name) values ('ZZVERIFY 0055 Instructor') returning id into f_instr;
      insert into public.batches (name, code) values ('ZZVERIFY 0055 Alpha', 'ZZ55A') returning id into f_batch;
      insert into public.schedule_series (batch_id) values (f_batch) returning id into f_series;
      insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id)
      values (f_batch, f_instr, 'monday', '08:15', '09:15', v_today - 900, null, 'active', f_series);
      insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 E', '9000000059', '+91', v_today - 400, 'active') returning id into se;
      insert into public.students (full_name, phone, phone_country_code, join_date, status) values ('ZZVERIFY 0055 F', '9000000060', '+91', v_today - 400, 'active') returning id into sf;
      insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (se, 'monthly', v_today - 30, v_today + 60, 4000, 'pending', v_currency) returning id into mf;
      insert into public.memberships (student_id, plan, start_date, end_date, amount, payment_status, currency) values (sf, 'monthly', v_today - 30, v_today + 60, 4000, 'pending', v_currency) returning id into mg;
      insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date) values (se, f_batch, v_today - 60, null) returning id into f_enr1;
      insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date) values (sf, f_batch, v_today - 60, null) returning id into f_enr2;
      insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date) values (f_enr1, f_series, v_today - 60, null);
      insert into public.enrollment_schedules (batch_enrollment_id, schedule_series_id, effective_start_date, effective_end_date) values (f_enr2, f_series, v_today - 60, null);
      f_ok := true;
    exception when others then
      f_ok := false;
      f_err := sqlstate || ' ' || sqlerrm;
    end;

    if not f_ok then
      perform pg_temp.skip('F0-F8 carry-forward', 'the fixtures could not be built: ' || coalesce(f_err, 'unknown'));
    else
      pf1 := pg_temp.as_uuid(pg_temp.pay(v_admin, mf, v_today - 5, '[{"method":"cash","amount":"1500"}]', 'true'));
      pg1 := pg_temp.as_uuid(pg_temp.pay(v_admin, mg, v_today - 5, '[{"method":"cash","amount":"1500"}]', 'true'));
      df1 := pg_temp.as_uuid(pg_temp.issue(v_admin, pf1));
      dg1 := pg_temp.as_uuid(pg_temp.issue(v_admin, pg1));
      perform pg_temp.rec('F0 two first documents are built from the membership: tracked, with the batch and its Monday slot as service details, Monthly Membership',
        df1 is not null and dg1 is not null
        and (select service_details_tracked and service_details -> 'batches' -> 0 ->> 'name' = 'ZZVERIFY 0055 Alpha'
                    and service_details -> 'batches' -> 0 -> 'slots' -> 0 ->> 'day_of_week' = 'monday'
                    and plan = 'monthly' and description = 'Monthly Membership' from public.invoices where id = df1)
        and (select service_details_tracked and service_details is not null from public.invoices where id = dg1), '');

      -- Simulate a document issued before service details existed: untracked, none. (The freeze trigger is switched off for these
      -- two statements only, inside this transaction.)
      v_c := pg_temp.code('alter table public.invoices disable trigger invoices_freeze_snapshot_trigger');
      v_s := pg_temp.code(format('update public.invoices set service_details = null, service_details_tracked = false where id = %L', dg1));
      v_r := pg_temp.code('alter table public.invoices enable trigger invoices_freeze_snapshot_trigger');
      perform pg_temp.rec('F1 setup: the second original now reads as a document issued before service details existed (untracked, none)',
        v_c = 'OK' and v_s = 'OK' and v_r = 'OK'
        and (select not service_details_tracked and service_details is null from public.invoices where id = dg1), v_c || ' ' || v_s || ' ' || v_r);

      -- The membership changes AFTER the originals were issued, and the first student's enrollment is deactivated.
      v_c := pg_temp.as_user(v_admin, format('update public.memberships set plan = ''quarterly'', end_date = %L where id in (%L, %L)', v_today + 120, mf, mg));
      v_s := pg_temp.code(format('update public.batch_enrollments set status = ''inactive'' where id = %L', f_enr1));
      perform pg_temp.rec('F2 setup: both memberships are now Quarterly with a later end date; the live read would now give the first student NO details and the second one details',
        v_c = 'OK' and (select plan = 'quarterly' and end_date = v_today + 120 from public.memberships where id = mf)
        and public.membership_service_details(mg) is not null
        and (v_s <> 'OK' or public.membership_service_details(mf) is null), v_c || ' ' || v_s);

      -- 1. Correct & Reissue, a tracked original with service details.
      select * into v_orig from public.invoices where id = df1;
      v_h0 := pg_temp.inv_hash(df1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
      v_r := pg_temp.corr(v_admin, df1, 'Fix the customer name', null, null, '{"customer_name":"ZZVERIFY Carry"}', null, null);
      rf1 := pg_temp.as_uuid(v_r);
      select * into v_inv from public.invoices where id = rf1;
      perform pg_temp.rec('F3 Correct & Reissue carries forward the original''s plan, description, period, service details and tracked marker (Monthly, the original dates, the stored batch and slot) although the membership is now Quarterly',
        rf1 is not null and v_inv.plan = 'monthly' and v_inv.description = 'Monthly Membership'
        and v_inv.period_start = v_orig.period_start and v_inv.period_end = v_orig.period_end and v_inv.period_end = v_today + 60
        and v_inv.service_details is not distinct from v_orig.service_details and v_inv.service_details is not null
        and v_inv.service_details_tracked = v_orig.service_details_tracked and v_inv.service_details_tracked, v_r);
      perform pg_temp.rec('F4 the replacement still carries the approved correction and the original is unchanged except its cancellation fields',
        v_inv.customer_name = 'ZZVERIFY Carry' and v_inv.replaces_id = df1
        and pg_temp.inv_hash(df1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h0
        and (select status from public.invoices where id = df1) = 'cancelled', '');

      -- 2. The older Correct Document workflow (0037) carries the same snapshot, on the replacement of a replacement.
      v_r := pg_temp.scalar_as(v_admin, format('select public.correct_payment_document(%L::uuid, %L)::text', rf1, 'Reissue unchanged'));
      rf2 := pg_temp.as_uuid(v_r);
      select * into v_inv from public.invoices where id = rf2;
      perform pg_temp.rec('F5 Correct Document (correct_payment_document) carries the same snapshot forward on the next replacement, and re-reads nothing from the membership',
        rf2 is not null and v_inv.replaces_id = rf1 and v_inv.plan = 'monthly' and v_inv.description = 'Monthly Membership'
        and v_inv.period_start = v_orig.period_start and v_inv.period_end = v_orig.period_end
        and v_inv.service_details is not distinct from v_orig.service_details and v_inv.service_details_tracked, v_r);

      -- 3. An untracked original with no service details stays untracked with none, although the live enrollment would give some.
      select * into v_orig from public.invoices where id = dg1;
      v_h1 := pg_temp.inv_hash(dg1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']);
      v_r := pg_temp.corr(v_admin, dg1, 'Fix the customer name', null, null, '{"customer_name":"ZZVERIFY Carry Two"}', null, null);
      rg1 := pg_temp.as_uuid(v_r);
      select * into v_inv from public.invoices where id = rg1;
      perform pg_temp.rec('F6 an UNTRACKED original with no service details is replaced by an untracked document with none - nothing is invented from the live enrollment - and keeps its Monthly plan and original dates',
        rg1 is not null and v_inv.service_details is null and not v_inv.service_details_tracked
        and v_inv.plan = 'monthly' and v_inv.description = 'Monthly Membership'
        and v_inv.period_start = v_orig.period_start and v_inv.period_end = v_orig.period_end and v_inv.period_end = v_today + 60
        and public.membership_service_details(mg) is not null, v_r);
      perform pg_temp.rec('F7 that original is unchanged except its cancellation fields, and the replacement is linked to it',
        pg_temp.inv_hash(dg1, array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at']) = v_h1
        and v_inv.replaces_id = dg1, '');

      -- 4. A FIRST document for the changed membership is still built from the current membership.
      pf2 := pg_temp.as_uuid(pg_temp.pay(v_admin, mf, v_today - 2, '[{"method":"cash","amount":"1000"}]', 'true'));
      df2 := pg_temp.as_uuid(pg_temp.issue(v_admin, pf2));
      select * into v_inv from public.invoices where id = df2;
      perform pg_temp.rec('F8 a FIRST document for the changed membership reads the CURRENT membership: Quarterly, the new end date, tracked',
        df2 is not null and v_inv.replaces_id is null and v_inv.plan = 'quarterly' and v_inv.description = 'Quarterly Membership'
        and v_inv.period_end = v_today + 120 and v_inv.service_details_tracked, coalesce(v_inv.plan, ''));
    end if;

    -- Z. Everything that existed before is unchanged ---------------------------------------------------------------------------------
    v_world1 := pg_temp.world();
    perform pg_temp.rec('Z1 every document, payment, method, payment edit and membership that existed before this script is byte-for-byte unchanged',
      v_world0 = v_world1, '');
  end if;
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 and count(*) filter (where status = 'NOT TESTED') = 0 then 'ALL PASS'
       when count(*) filter (where status = 'FAIL') = 0 then 'INCOMPLETE' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- ===========================================================================
-- AFTER THE ROLLBACK - confirm nothing persisted
-- ===========================================================================
-- Run separately, AFTER the block above. Deliberately commented out: as a live statement it would become the editor's last result set
-- and hide the grid.
--
--   select
--     (select count(*) from public.invoices)                                   as documents,
--     (select count(*) from public.membership_payments)                        as payments,
--     (select count(*) from public.membership_payment_edits)                   as payment_edits,
--     (select count(*) from public.invoice_number_reservations)                as reserved_invoice_numbers,
--     (select count(*) from public.payment_receipt_number_reservations)        as reserved_receipt_numbers,
--     (select count(*) from public.students where position('ZZVERIFY 0055' in full_name) = 1) as leftover_fixture_students,
--     (select count(*) from public.memberships m join public.students s on s.id = m.student_id
--        where position('ZZVERIFY 0055' in s.full_name) = 1)                  as leftover_fixture_memberships,
--     (select next_invoice_number from public.invoice_settings)                as next_invoice_number,
--     (select payment_receipt_next_number from public.invoice_settings)        as payment_receipt_next_number,
--     (select tax_rate from public.invoice_settings)                           as setting_tax_rate;
--
-- Compare the first five counts with the SETUP row above: they must be equal. Both leftover_fixture_* counts must be 0, and the three
-- settings must be what they were before the run. (The YC- / MEM- sequences will have moved on: see the header.)
-- ===========================================================================
