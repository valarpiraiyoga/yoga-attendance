-- ===========================================================================
-- Migration 0044 verification (behaviour) - Class-count documents and history integrity
-- Exercises supabase/migrations/0044_class_count_documents_and_guard.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0044 is applied (the three document functions carry the class_count wording, and the guard trigger
--       exists) on top of 0042 and 0043. If not, every other check is skipped (NOT TESTED) after one clear failure.
--   P1  Preflight: none of the seven phone numbers this run gives its fixture students (9000440001 to 9000440007) already
--       belongs to a student. If one does, P1 FAILS, every scenario is skipped (NOT TESTED), and nothing is created or
--       changed - the existing student is never touched, and the cleanup query after the run could not tell it from a
--       fixture.
--   W   Document wording: a payment document for a class-count membership reads "Class Count Membership" with plan
--       class_count - with no expiry (period end NULL) and with a fixed validity (period end kept); a duration plan
--       still reads as before ("Monthly Membership", "Custom duration Membership"); Cancel and Reissue keeps the wording
--       on the replacement; a membership-level receipt for a class-count membership has the wording and keeps it when
--       the membership is edited (the sync function).
--   G   History integrity: once classes are recorded, the membership's type and student cannot be changed (55006), and its
--       class total cannot go below the classes recorded, or to NULL (23514); raising it, setting it to exactly the classes
--       recorded, and editing dates, amount and notes stay allowed; with no classes recorded the total can still be lowered;
--       none of the refused edits changes a row.
--   Z   Every pre-existing membership, invoice, class-count attendance row and payment is byte-for-byte unchanged by this
--       script. "Pre-existing" means EVERYTHING that existed before the run: its fingerprints are taken before any fixture is
--       created and cover every row; afterwards only the run's own fixtures, tracked by id, are left out of the comparison.
--
-- PREREQUISITES
--   * Migrations up to and including 0044 applied (0042 and 0043 in particular). If 0044 is NOT applied, P0 fails and
--     every scenario is skipped.
--   * An Admin profile, the singleton invoice_settings row and the centre profile row. If invoice numbering is not
--     configured yet it is configured for this run only (rolled back).
--
-- SAFETY - ROLLBACK ONLY
--   * One transaction, ending in ROLLBACK. Run the whole file in one go (`rollback;` first if a transaction is open).
--   * Disposable ZZVERIFY fixtures only: students, their memberships, payments, documents and recorded classes. No existing
--     row is written; existing rows are read only to be fingerprinted. The ids of the students and memberships the run
--     creates are recorded as it creates them (a temporary table); the payments, documents and recorded classes are the
--     rows attached to those memberships, and nothing else is excluded from the "unchanged" checks.
--   * It writes to invoice_settings (counters), so it holds that row's lock until it ends: another session issuing a
--     document at the same moment simply waits. Run it when no one is issuing documents.
--   * Sequences leave a small gap in the YC- / MEM- / document numbering; no row remains.
--
-- LIMITATIONS
--   * Concurrency (an edit racing the recording of a class) is not tested in one transaction.
--   * W5 builds the legacy shape "a membership-level receipt for a membership with no payments" as the owner, since no
--     application path creates it any more; if that cannot be built it is reported NOT TESTED with the reason.
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

-- The exact ids of the fixtures this run creates (students and memberships). Everything else the run writes hangs off a
-- fixture membership, so these ids are all it takes to tell the run's rows from the rows that existed before it.
create temp table _fixture_ids (
  tbl text not null,
  id  uuid not null
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

-- Run one statement as the owning role; return 'OK' or '<sqlstate> <message>'.
create function pg_temp.run_owner(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $f$;

-- A returned id as uuid, or NULL when the call returned 'ERR:<sqlstate>' (so a failure is reported, never raised).
create function pg_temp.as_uuid(p_text text)
returns uuid language plpgsql as $f$
begin
  return p_text::uuid;
exception when others then
  return null;
end $f$;

-- A disposable student (ZZVERIFY); returns its id.
create function pg_temp.student(p_label text, p_phone text)
returns uuid language plpgsql as $f$
declare
  v_today date := (now() at time zone public.centre_timezone())::date;
  v_id    uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY ' || p_label, p_phone, '+91', v_today - 400, 'active')
  returning id into v_id;
  return v_id;
end $f$;

-- Inserts one Pending membership of 1000 as the owner; returns its id. A class-count membership has plan class_count.
create function pg_temp.mem(
  p_student uuid, p_kind text, p_plan text, p_start date, p_end date, p_total integer)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.memberships (student_id, kind, plan, start_date, end_date, total_classes, amount, payment_status, currency)
  values (p_student, p_kind, p_plan, p_start, p_end, p_total, 1000, 'pending', 'INR')
  returning id into v_id;
  return v_id;
end $f$;

-- Records a payment of the whole amount as p_admin (a payment receipt: no tax invoice); returns the payment id or 'ERR:<sqlstate>'.
create function pg_temp.pay(p_admin uuid, p_membership uuid, p_date date)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format(
    'select public.record_membership_payment(%L::uuid, %L::date, %L::jsonb, false)::text',
    p_membership, p_date, '[{"method":"cash","amount":"1000"}]'));
end $f$;

-- Issues a payment's document as p_admin; returns the document id or 'ERR:<sqlstate>'.
create function pg_temp.issue(p_admin uuid, p_payment uuid)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format('select public.issue_payment_document(%L::uuid)::text', p_payment));
end $f$;

-- Cancels a document and issues its replacement as p_admin; returns the replacement's id or 'ERR:<sqlstate>'.
create function pg_temp.correct(p_admin uuid, p_document uuid, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.query_as(p_admin, format('select public.correct_payment_document(%L::uuid, %L)::text', p_document, p_reason));
end $f$;

-- What a document says of its membership: description | plan | period start | period end ('NULL' when none).
create function pg_temp.line(p_document uuid)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  select concat_ws('|', description, plan, period_start::text, coalesce(period_end::text, 'NULL'))
  into v_out from public.invoices where id = p_document;
  return v_out;
end $f$;

-- Records a class against a membership as p_admin; returns the classes remaining or 'ERR:<sqlstate>'.
create function pg_temp.record_class(p_admin uuid, p_membership uuid)
returns text language plpgsql as $f$
declare
  v_json text;
begin
  v_json := pg_temp.query_as(p_admin, format('select public.record_class_count_attendance(%L::uuid, gen_random_uuid())::text', p_membership));
  if v_json like 'ERR:%' then
    return v_json;
  end if;
  return (v_json::jsonb) ->> 'classes_remaining';
end $f$;

-- A fingerprint of one membership's row.
create function pg_temp.row_hash(p_membership uuid)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  select md5(to_jsonb(m)::text) into v_out from public.memberships m where m.id = p_membership;
  return v_out;
end $f$;

-- Rows of recorded classes for a membership.
create function pg_temp.used(p_membership uuid)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.class_count_attendance where membership_id = p_membership;
  return v_count;
end $f$;

do $$
declare
  v_admin      uuid;
  v_today      date := (now() at time zone public.centre_timezone())::date;
  v_ready      boolean;
  v_set        public.invoice_settings%rowtype;
  v_clash      integer := 0;
  v_clash_list text;
  v_err        text;
  v_msg        text;
  v_out        text;
  v_sa uuid; v_sb uuid; v_sc uuid; v_sd uuid; v_se uuid; v_sf uuid; v_sg uuid;
  v_ma uuid; v_mb uuid; v_mc uuid; v_md uuid; v_me uuid; v_mf uuid; v_mg uuid;
  v_pa uuid; v_pb uuid; v_pc uuid; v_pd uuid;
  v_da uuid; v_db uuid; v_dc uuid; v_dd uuid; v_dr uuid;
  v_hash       text;
  v_mem        record;
  v_inv        record;
  v_mem_hash0  text;  v_mem_hash1  text;
  v_inv_hash0  text;  v_inv_hash1  text;
  v_cca_hash0  text;  v_cca_hash1  text;
  v_pay_hash0  text;  v_pay_hash1  text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  -- P0. Is 0044 applied? ---------------------------------------------------------------------------------------------------
  v_ready := to_regclass('public.class_count_attendance') is not null
         and (select count(*) = 3 from pg_proc
              where oid in (to_regprocedure('public.issue_invoice_core(uuid, date)'),
                            to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)'),
                            to_regprocedure('public.sync_invoice_from_membership(uuid)'))
                and prosrc like '%when ''class_count'' then ''Class Count''%')
         and (select count(*) = 1 from pg_trigger
              where tgrelid = 'public.memberships'::regclass and not tgisinternal
                and tgname = 'memberships_class_count_history_guard_trigger');
  perform pg_temp.rec('P0 migration 0044 is applied (the class_count wording in issue_invoice_core, issue_payment_document_core and sync_invoice_from_membership, and the memberships history guard) on top of 0042 and 0043',
    coalesce(v_ready, false), case when coalesce(v_ready, false) then '' else 'apply 0042, 0043 and 0044 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  -- P1. Preflight: the fixture phone numbers must be free. Read-only, and before anything is created or configured. -------------
  select count(*), string_agg(phone, ', ' order by phone) into v_clash, v_clash_list
  from public.students
  where phone in ('9000440001', '9000440002', '9000440003', '9000440004', '9000440005', '9000440006', '9000440007');
  if v_ready then
    perform pg_temp.rec('P1 none of the fixture phone numbers 9000440001 to 9000440007 already belongs to a student (this run creates seven students with them)',
      v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing student(s) already have: ' || v_clash_list
        || ' - nothing was created or changed; remove the clash (or choose other phone numbers in this script and its cleanup query) and run again' end);
  end if;

  -- Fingerprints of everything that already exists (compared at the very end).
  -- Taken before the run creates anything, so they cover every existing row - none is excluded by name or by owner.
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash0 from public.memberships m;
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash0 from public.invoices i;
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash0 from public.membership_payments p;
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash0 from public.class_count_attendance c;
  end if;

  -- Numbering for this run only (rolled back): only where a sequence is not configured yet.
  select * into v_set from public.invoice_settings where singleton;
  -- The numbering counters as they are BEFORE the run (and before any numbering is configured for it): the cleanup query
  -- after the rollback compares the live counters with these two values.
  perform pg_temp.info('COUNTERS BEFORE THE RUN',
    'next_invoice_number=' || coalesce(v_set.next_invoice_number::text, 'NULL')
    || ', payment_receipt_next_number=' || coalesce(v_set.payment_receipt_next_number::text, 'NULL')
    || ' - use these two values in the cleanup query after the rollback');
  if v_ready and v_clash = 0 and v_set.starting_invoice_number is null then
    perform pg_temp.info('SETUP', 'invoice numbering was not configured; set to 990001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set starting_invoice_number = 990001 where singleton'));
  end if;
  if v_ready and v_clash = 0 and v_set.payment_receipt_starting_number is null then
    perform pg_temp.info('SETUP', 'payment receipt numbering was not configured; set to 880001 for this run: ' ||
      pg_temp.run_owner('update public.invoice_settings set payment_receipt_starting_number = 880001 where singleton'));
  end if;

  if not v_ready then
    perform pg_temp.skip('W / G', 'migration 0044 (or 0042 / 0043) is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('W / G', 'preflight P1 failed: a fixture phone number already belongs to an existing student, so no fixture was created');
  elsif v_admin is null then
    perform pg_temp.skip('W / G', 'needs an Admin profile');
  elsif not exists (select 1 from public.center_profile where singleton) or v_set.singleton is null then
    perform pg_temp.skip('W / G', 'the centre profile or the invoice settings row is missing, so no document can be issued');
  else
    -- Fixtures ------------------------------------------------------------------------------------------------------------------
    v_sa := pg_temp.student('0044 A class-count no expiry', '9000440001');
    v_sb := pg_temp.student('0044 B class-count fixed validity', '9000440002');
    v_sc := pg_temp.student('0044 C monthly', '9000440003');
    v_sd := pg_temp.student('0044 D custom', '9000440004');
    v_se := pg_temp.student('0044 E class-count receipt', '9000440005');
    v_sf := pg_temp.student('0044 F guard with classes', '9000440006');
    v_sg := pg_temp.student('0044 G guard without classes', '9000440007');

    v_ma := pg_temp.mem(v_sa, 'class_count', 'class_count', v_today - 5, null, 10);
    v_mb := pg_temp.mem(v_sb, 'class_count', 'class_count', v_today - 5, v_today + 25, 8);
    v_mc := pg_temp.mem(v_sc, 'duration', 'monthly', v_today - 5, v_today + 24, null);
    v_md := pg_temp.mem(v_sd, 'duration', 'custom', v_today - 5, v_today + 24, null);
    v_me := pg_temp.mem(v_se, 'class_count', 'class_count', v_today - 5, null, 10);
    v_mf := pg_temp.mem(v_sf, 'class_count', 'class_count', v_today - 5, v_today + 25, 5);
    v_mg := pg_temp.mem(v_sg, 'class_count', 'class_count', v_today - 5, v_today + 25, 5);

    -- The exact fixtures of this run. Their payments, documents and recorded classes all hang off these memberships.
    insert into _fixture_ids (tbl, id) select 'students', x from unnest(array[v_sa, v_sb, v_sc, v_sd, v_se, v_sf, v_sg]) as x;
    insert into _fixture_ids (tbl, id) select 'memberships', x from unnest(array[v_ma, v_mb, v_mc, v_md, v_me, v_mf, v_mg]) as x;

    -- W. Document wording ---------------------------------------------------------------------------------------------------------
    v_pa := pg_temp.as_uuid(pg_temp.pay(v_admin, v_ma, v_today - 1));
    v_pb := pg_temp.as_uuid(pg_temp.pay(v_admin, v_mb, v_today - 1));
    v_pc := pg_temp.as_uuid(pg_temp.pay(v_admin, v_mc, v_today - 1));
    v_pd := pg_temp.as_uuid(pg_temp.pay(v_admin, v_md, v_today - 1));
    v_da := pg_temp.as_uuid(pg_temp.issue(v_admin, v_pa));
    v_db := pg_temp.as_uuid(pg_temp.issue(v_admin, v_pb));
    v_dc := pg_temp.as_uuid(pg_temp.issue(v_admin, v_pc));
    v_dd := pg_temp.as_uuid(pg_temp.issue(v_admin, v_pd));

    perform pg_temp.rec('W0 setup: four payments were recorded and four documents issued (class-count with no expiry, class-count with a fixed validity, monthly, custom)',
      v_da is not null and v_db is not null and v_dc is not null and v_dd is not null,
      concat_ws(' / ', v_pa, v_pb, v_pc, v_pd));

    perform pg_temp.rec('W1 a class-count membership with no expiry: the document reads "Class Count Membership", plan class_count, its start, and NO end',
      pg_temp.line(v_da) = 'Class Count Membership|class_count|' || (v_today - 5)::text || '|NULL', coalesce(pg_temp.line(v_da), 'NULL'));
    perform pg_temp.rec('W2 a class-count membership with a fixed validity: the same wording, with its end date kept',
      pg_temp.line(v_db) = 'Class Count Membership|class_count|' || (v_today - 5)::text || '|' || (v_today + 25)::text, coalesce(pg_temp.line(v_db), 'NULL'));
    perform pg_temp.rec('W3 a monthly membership still reads "Monthly Membership"',
      pg_temp.line(v_dc) = 'Monthly Membership|monthly|' || (v_today - 5)::text || '|' || (v_today + 24)::text, coalesce(pg_temp.line(v_dc), 'NULL'));
    perform pg_temp.rec('W4 a custom-duration membership still reads "Custom duration Membership"',
      pg_temp.line(v_dd) = 'Custom duration Membership|custom|' || (v_today - 5)::text || '|' || (v_today + 24)::text, coalesce(pg_temp.line(v_dd), 'NULL'));

    v_dr := pg_temp.as_uuid(pg_temp.correct(v_admin, v_da, 'ZZVERIFY correction'));
    perform pg_temp.rec('W5 Cancel and Reissue keeps the wording on the replacement, and the original is cancelled and unchanged',
      v_dr is not null and pg_temp.line(v_dr) = 'Class Count Membership|class_count|' || (v_today - 5)::text || '|NULL'
      and pg_temp.line(v_da) = 'Class Count Membership|class_count|' || (v_today - 5)::text || '|NULL'
      and (select status from public.invoices where id = v_da) = 'cancelled', coalesce(pg_temp.line(v_dr), 'NULL'));

    -- W6. A membership-level receipt follows its membership (the legacy shape: Paid, no payments).
    begin
      v_msg := pg_temp.run_owner(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 1, v_me));
      select i.* into v_inv from public.invoices i where i.membership_id = v_me and i.payment_id is null order by i.created_at limit 1;
      if v_inv.id is null then
        v_out := pg_temp.query_as(v_admin, format('select public.issue_invoice(%L::uuid)::text', v_me));
        select i.* into v_inv from public.invoices i where i.membership_id = v_me and i.payment_id is null order by i.created_at limit 1;
      end if;
      if v_inv.id is null then
        perform pg_temp.skip('W6 / W7', 'could not build a membership-level receipt for a class-count membership: ' || coalesce(v_msg, '') || ' ' || coalesce(v_out, ''));
      else
        perform pg_temp.rec('W6 a membership-level receipt for a class-count membership reads "Class Count Membership" with no end',
          pg_temp.line(v_inv.id) = 'Class Count Membership|class_count|' || (v_today - 5)::text || '|NULL', coalesce(pg_temp.line(v_inv.id), 'NULL'));
        v_msg := pg_temp.run_owner(format('update public.memberships set amount = 1200 where id = %L', v_me));
        select i.* into v_inv from public.invoices i where i.id = v_inv.id;
        perform pg_temp.rec('W7 editing the membership (amount) makes its receipt follow it: the new total, and the wording is kept',
          v_msg = 'OK' and v_inv.total_amount = 1200 and v_inv.description = 'Class Count Membership' and v_inv.plan = 'class_count' and v_inv.period_end is null,
          concat_ws(' | ', v_msg, v_inv.total_amount, v_inv.description));
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      perform pg_temp.skip('W6 / W7', 'could not build or edit a membership-level receipt: ' || sqlstate || ' ' || coalesce(v_err, ''));
    end;

    -- G. History integrity -----------------------------------------------------------------------------------------------------------
    v_out := pg_temp.record_class(v_admin, v_mf);
    v_out := pg_temp.record_class(v_admin, v_mf);
    v_out := pg_temp.record_class(v_admin, v_mf);
    perform pg_temp.rec('G0 setup: 3 of the 5 classes of membership F are recorded', pg_temp.used(v_mf) = 3 and v_out = '2', coalesce(v_out, 'NULL'));

    v_hash := pg_temp.row_hash(v_mf);
    v_msg := pg_temp.run_owner(format('update public.memberships set kind = ''duration'' where id = %L', v_mf));
    perform pg_temp.rec('G1 the type of a membership with recorded classes cannot be changed (55006), and the row is unchanged',
      v_msg like '55006 The type of a membership with recorded classes cannot be changed.%' and pg_temp.row_hash(v_mf) = v_hash, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set student_id = %L where id = %L', v_sg, v_mf));
    perform pg_temp.rec('G2 the student of a membership with recorded classes cannot be changed (55006), and the row is unchanged',
      v_msg like '55006 The student of a membership with recorded classes cannot be changed.%' and pg_temp.row_hash(v_mf) = v_hash, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 2 where id = %L', v_mf));
    perform pg_temp.rec('G3 the class total cannot go below the 3 classes recorded (23514), and the row is unchanged',
      v_msg like '23514 The class total cannot be less than the classes already recorded.%' and pg_temp.row_hash(v_mf) = v_hash, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = null where id = %L', v_mf));
    -- The table's own CHECK (memberships_total_classes_by_kind) also raises 23514 for a NULL total on a class-count membership,
    -- so the SQLSTATE alone would pass without the guard. The guard is a BEFORE trigger and fires first: only its message
    -- proves it did.
    perform pg_temp.rec('G4 the class total cannot be removed (23514), refused by the history guard before the table CHECK, and the row is unchanged',
      v_msg like '23514 The class total cannot be less than the classes already recorded.%' and pg_temp.row_hash(v_mf) = v_hash, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 3 where id = %L', v_mf));
    select * into v_mem from public.memberships where id = v_mf;
    perform pg_temp.rec('G5 the class total can be set to exactly the classes recorded (3): nothing remains',
      v_msg = 'OK' and v_mem.total_classes = 3, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 12 where id = %L', v_mf));
    select * into v_mem from public.memberships where id = v_mf;
    perform pg_temp.rec('G6 the class total can be raised (12)', v_msg = 'OK' and v_mem.total_classes = 12, v_msg);
    v_msg := pg_temp.run_owner(format('update public.memberships set start_date = %L, end_date = %L, amount = 1500, notes = ''ZZVERIFY edit'' where id = %L', v_today - 6, v_today + 40, v_mf));
    select * into v_mem from public.memberships where id = v_mf;
    perform pg_temp.rec('G7 dates, amount and notes can still be edited with classes recorded',
      v_msg = 'OK' and v_mem.start_date = v_today - 6 and v_mem.end_date = v_today + 40 and v_mem.amount = 1500 and v_mem.notes = 'ZZVERIFY edit', v_msg);
    perform pg_temp.rec('G8 none of the refused edits touched the recorded classes', pg_temp.used(v_mf) = 3, '');

    v_msg := pg_temp.run_owner(format('update public.memberships set total_classes = 2 where id = %L', v_mg));
    select * into v_mem from public.memberships where id = v_mg;
    perform pg_temp.rec('G9 with NO classes recorded the class total can still be lowered (5 to 2)', v_msg = 'OK' and v_mem.total_classes = 2, v_msg);

    -- A duration membership is not affected at all.
    v_msg := pg_temp.run_owner(format('update public.memberships set end_date = %L, notes = ''ZZVERIFY duration edit'' where id = %L', v_today + 30, v_mc));
    perform pg_temp.rec('G10 a duration membership is edited as before', v_msg = 'OK', v_msg);
  end if;

  -- Z. Nothing real was touched ----------------------------------------------------------------------------------------------------
  -- Every row except those attached to a fixture membership THIS RUN created (tracked by id above). A row that appeared,
  -- vanished or changed anywhere else makes the fingerprint differ.
  select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) into v_mem_hash1
  from public.memberships m
  where m.id not in (select id from _fixture_ids where tbl = 'memberships');
  select md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) into v_inv_hash1
  from public.invoices i
  where i.membership_id not in (select id from _fixture_ids where tbl = 'memberships');
  select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) into v_pay_hash1
  from public.membership_payments p
  where p.membership_id not in (select id from _fixture_ids where tbl = 'memberships');
  if v_ready then
    select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) into v_cca_hash1
    from public.class_count_attendance c
    where c.membership_id not in (select id from _fixture_ids where tbl = 'memberships');
  end if;

  perform pg_temp.rec('Z1 every pre-existing membership is unchanged by this script (only its own fixtures excluded, by id)', v_mem_hash0 = v_mem_hash1, '');
  perform pg_temp.rec('Z2 every pre-existing invoice and receipt is byte-for-byte unchanged', v_inv_hash0 = v_inv_hash1, '');
  perform pg_temp.rec('Z3 every pre-existing payment is byte-for-byte unchanged', v_pay_hash0 = v_pay_hash1, '');
  if v_ready then
    perform pg_temp.rec('Z4 every pre-existing class-count attendance row is byte-for-byte unchanged', v_cca_hash0 = v_cca_hash1, '');
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

-- AFTER THE ROLLBACK (run separately, as its own statement - never inside the verification transaction).
-- Nothing of the run may remain, and both numbering counters must be back to the values the run printed in its
-- 'COUNTERS BEFORE THE RUN' row. Put those two values in the first line (write NULL where it printed NULL):
--
--   with before_run (next_invoice_number, payment_receipt_next_number) as (values (NULL::bigint, NULL::bigint)),
--   -- This run's seven fixture students, found by the exact phone numbers it gave them (not by name) ...
--   fixture_students as (
--     select id from public.students
--     where phone in ('9000440001', '9000440002', '9000440003', '9000440004', '9000440005', '9000440006', '9000440007')
--   ),
--   -- ... and their memberships; every payment, document, cancellation and recorded class is reached through these.
--   fixture_memberships as (
--     select m.id from public.memberships m join fixture_students s on s.id = m.student_id
--   )
--   select
--     (select count(*) from fixture_students)                                                                         as leftover_students,
--     (select count(*) from fixture_memberships)                                                                      as leftover_memberships,
--     (select count(*) from public.membership_payments p
--       join fixture_memberships fm on fm.id = p.membership_id)                                                       as leftover_payments,
--     (select count(*) from public.invoices i
--       join fixture_memberships fm on fm.id = i.membership_id)                                                       as leftover_documents,
--     (select count(*) from public.invoices i
--       join fixture_memberships fm on fm.id = i.membership_id
--       where i.status = 'cancelled')                                                                                 as leftover_cancellations,
--     (select count(*) from public.class_count_attendance c
--       join fixture_memberships fm on fm.id = c.membership_id
--       join fixture_students fs on fs.id = c.student_id)                                                             as leftover_class_count_rows,
--     cs.next_invoice_number, cs.payment_receipt_next_number,
--     (cs.next_invoice_number is not distinct from b.next_invoice_number)                                             as invoice_counter_back,
--     (cs.payment_receipt_next_number is not distinct from b.payment_receipt_next_number)                             as receipt_counter_back
--   from public.invoice_settings cs cross join before_run b where cs.singleton;
--
-- Every leftover_* must be 0, and both *_counter_back must be true. (If a student at the centre already has one of those
-- seven phone numbers, leftover_students would not be 0 before any run: check that first.)
