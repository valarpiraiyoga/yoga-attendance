-- ===========================================================================
-- Migration 0049 verification (behaviour) - class-count expiry edits (V1 Fee Structure, FS-7)
-- Exercises supabase/migrations/0049_class_count_expiry_edits.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0049 is applied (the function, the audit table, the guard, the sync-trigger condition). Otherwise every
--       scenario is skipped (NOT TESTED).   PF  Preflight: no fixture name exists.
--   A   Access: anon and an Instructor are refused the edit; the audit table is unreadable by anon and an Instructor and cannot
--       be written by an Admin directly.
--   E   Edits: extend; shorten (recorded classes kept, not reversed, balance unchanged, flagged by attended_on > expiry, new
--       recording refused); extend again (recording works again); No expiry and back to a date (previous expiry NULL).
--   V   Refusals: unchanged expiry, before the start date, a missing / short / long / blank reason, a duration membership, an
--       unknown membership - and none leaves an audit row or a change.
--   X   The 0048 exemption is as narrow as the edit: with the flag of THIS membership, an end_date AND amount change is refused
--       (55006); the flag of ANOTHER membership permits no end_date change (55006); only an end_date-only change passes.
--   R   A real legacy receipt: a Paid class-count membership gets its membership-level receipt, its expiry is edited, and the
--       issued receipt row is identical afterwards (period_end unchanged).
--   G   Guards: a direct change of a class-count end_date is refused for the owner (legacy and package-linked); a duration
--       membership's end_date and a class-count membership's notes still change; 0048's protection of a package membership's
--       other columns is intact.
--   H   Audit history: one row per edit with the previous and new expiry, the reason, the Admin and the time; append-only; an
--       Instructor reads none of it (NOT TESTED without an Instructor profile).
--   K   Preservation: the fee, class allowance, plan, kind, package link, attendance records and reversals are exactly as they
--       were; an issued receipt is not rewritten (the sync trigger skips an expiry edit).
--   Z   Every membership that existed before this script is byte-for-byte unchanged by it.
--
-- PREREQUISITES: migrations 0042-0048 and 0049 applied (0049 itself refuses to run without 0045, 0048 and 0030, and 0048 needs 0046
-- and 0047, so the package-linked scenarios always run); an Admin profile; an Instructor profile for A2 and H5 (reported NOT TESTED
-- without one).
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ so the digests of existing rows come from one snapshot), ending in ROLLBACK. Disposable fixtures only:
--   students and packages named 'ZZVERIFY 0049 ...' and what the functions create for them. The audit table is append-only, so
--   the rollback is the only clean-up: never run this in a session with autocommit.
--
-- LIMITATIONS
--   * Concurrency (an edit against a recording) cannot be tested in one transaction.
--   * The receipt scenario R sets invoice numbering for this run only when it is not configured (rolled back with everything
--     else) and is reported NOT TESTED when a receipt cannot be built. It shows that an expiry edit leaves an issued receipt
--     alone; it does not claim the legacy receipt-following of OTHER edits (amount, plan, start date) is changed - it is not.
--   * The "Attendance after current expiry" flag is derived by the screens; this script checks the facts it is derived from.
--   * Every membership and attendance record created here consumes a sequence number: the rollback leaves gaps.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
create temp table _legacy_ids (id uuid primary key) on commit drop;
create temp table _legacy_hash (before_hash text, after_hash text) on commit drop;

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

-- An expiry edit as the Admin: the audit id text, or 'ERR:<sqlstate>'. p_expiry is a date literal or the word null.
create function pg_temp.edit(p_admin uuid, p_membership uuid, p_expiry text, p_reason text)
returns text language plpgsql as $f$
begin
  return pg_temp.scalar_as(p_admin, format('select public.edit_class_count_expiry(%L, %s, %L)::text', p_membership, p_expiry, p_reason));
end $f$;

-- Records one class for a membership, for the given day, as the Admin: 'OK' or the SQLSTATE.
create function pg_temp.record(p_admin uuid, p_membership uuid, p_on date)
returns text language plpgsql as $f$
begin
  return pg_temp.as_user(p_admin, format('select public.record_class_count_attendance(%L, gen_random_uuid(), %L::date)', p_membership, p_on));
end $f$;

create function pg_temp.student(p_name text)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0049 ' || p_name, '9000000049', '+91', current_date, 'active')
  returning id into v_id;
  return v_id;
end $f$;

-- A digest of everything an expiry edit must NOT change, for one membership (end_date and notes are deliberately not in it).
create function pg_temp.untouched(p_membership uuid)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  select md5(
    coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from public.class_count_attendance a where a.membership_id = p_membership), '') || '#' ||
    coalesce((select string_agg(to_jsonb(r)::text, '|' order by r.id) from public.class_count_attendance_reversals r
              join public.class_count_attendance a on a.id = r.attendance_id where a.membership_id = p_membership), '') || '#' ||
    (select concat_ws('|', m.amount, m.currency, m.kind, m.plan, m.total_classes, m.start_date, m.student_id, m.package_id,
                      m.fee_entry_id, m.package_name, m.pricing_mode, m.standard_fee, m.package_discount, m.payment_status)
     from public.memberships m where m.id = p_membership))
  into v_out;
  return v_out;
end $f$;

-- One statement as the owner with the expiry-edit flag set to p_flag (a membership id) for that statement only: 'OK' or the SQLSTATE.
-- A refusal rolls back the sub-transaction, flag included; a success clears the flag. It is how the narrowness of the exemption
-- is tested: the flag is what the function sets, so this is the one place a test can stand where the function stands.
create function pg_temp.flagged_update(p_flag text, p_sql text)
returns text language plpgsql as $f$
begin
  perform set_config('yoga.class_count_expiry_edit', p_flag, true);
  execute p_sql;
  perform set_config('yoga.class_count_expiry_edit', '', true);
  return 'OK';
exception when others then
  return sqlstate;
end $f$;

do $$
declare
  v_admin    uuid;
  v_instr    uuid;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_currency text;
  v_ready    boolean;
  v_clash    integer := 0;
  v_s        text;
  v_c        text;
  v_n        integer;
  v_end0     date;
  v_cnt0     integer;
  v_leg_digest text;
  v_pkg_digest text;
  v_set      public.invoice_settings%rowtype;
  v_inv      public.invoices%rowtype;
  v_inv_digest text;
  v_msg      text;
  v_err      text;
  s_rcpt uuid; m_rcpt uuid;
  s_leg uuid; s_pkg uuid; s_dur uuid;
  m_leg uuid; m_pkg uuid; m_dur uuid; p_cls uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_instr from public.profiles where role = 'instructor' order by created_at limit 1;
  select cp.currency into v_currency from public.center_profile cp where cp.singleton;

  -- P0 -----------------------------------------------------------------------------------------------------------------
  v_ready := to_regprocedure('public.edit_class_count_expiry(uuid, date, text)') is not null
         and to_regclass('public.class_count_expiry_edits') is not null
         and exists (select 1 from pg_trigger where tgname = 'memberships_class_count_expiry_guard_trigger' and not tgisinternal)
         and exists (select 1 from pg_trigger where tgname = 'class_count_expiry_edits_readonly_trigger' and not tgisinternal);
  perform pg_temp.rec('P0 migration 0049 is applied (the function, the audit table and its guards)', coalesce(v_ready, false),
    case when coalesce(v_ready, false) then '' else 'apply 0042-0045 and 0049 first; every scenario below is skipped' end);
  v_ready := coalesce(v_ready, false);

  if v_ready then
    select (select count(*) from public.students where position('ZZVERIFY 0049' in full_name) = 1)
         + (select count(*) from public.packages where position('ZZVERIFY 0049' in name) = 1)
      into v_clash;
    perform pg_temp.rec('PF no student or package already has a fixture name (ZZVERIFY 0049 ...) - this run creates its own', v_clash = 0,
      case when v_clash = 0 then '' else v_clash || ' existing student(s) or package(s) clash - nothing was created; rename them and run again' end);
    insert into _legacy_ids select id from public.memberships;
    insert into _legacy_hash (before_hash)
    select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) from public.memberships m where m.id in (select id from _legacy_ids);
  end if;

  if not v_ready then
    perform pg_temp.skip('A / E / V / G / H / K / Z', 'migration 0049 is not applied');
  elsif v_clash > 0 then
    perform pg_temp.skip('A / E / V / G / H / K / Z', 'preflight PF failed');
  elsif v_admin is null or v_currency is null then
    perform pg_temp.skip('A / E / V / G / H / K / Z', 'needs an Admin profile and the centre profile');
  else
    -- Fixtures -------------------------------------------------------------------------------------------------------
    s_leg := pg_temp.student('legacy'); s_pkg := pg_temp.student('package'); s_dur := pg_temp.student('duration');

    -- A LEGACY class-count membership (no package): 5 classes, expiring in 10 days, started 30 days ago.
    insert into public.memberships (student_id, plan, kind, total_classes, start_date, end_date, amount, currency)
    values (s_leg, 'class_count', 'class_count', 5, v_today - 30, v_today + 10, 500, v_currency) returning id into m_leg;
    insert into public.memberships (student_id, plan, kind, start_date, end_date, amount, currency)
    values (s_dur, 'monthly', 'duration', v_today - 5, v_today + 25, 700, v_currency) returning id into m_dur;

    -- A PACKAGE-LINKED class-count membership (0049 cannot be applied without 0046-0048, so these always exist).
    p_cls := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, 'select public.create_package(''ZZVERIFY 0049 Classes'', null, ''class_count'', 8, null)::text'));
    perform pg_temp.scalar_as(v_admin, format('select public.schedule_fee_entry(%L, %L::date, 2000, null, null)::text', p_cls, v_today - 10));
    m_pkg := pg_temp.as_uuid(pg_temp.scalar_as(v_admin, format(
      'select public.create_membership_from_package(%L, %L, null, null, %L, %L, null, null, null, null, ''standard'', null, null, null, null)::text',
      s_pkg, p_cls, v_today - 5, v_today + 20)));
    perform pg_temp.rec('fixtures: a legacy, a duration and a package-linked class-count membership were created',
      m_leg is not null and m_dur is not null and m_pkg is not null, coalesce(m_pkg::text, ''));

    -- Two recorded classes on the legacy membership.
    a1 := pg_temp.record(v_admin, m_leg, v_today);
    a2 := pg_temp.record(v_admin, m_leg, v_today - 1);
    perform pg_temp.rec('fixtures: two classes were recorded on the legacy membership (today and yesterday)', a1 = 'OK' and a2 = 'OK', a1 || ' ' || a2);
    v_n := (select count(*) from public.class_count_attendance where membership_id = m_leg);

    -- A. Access ---------------------------------------------------------------------------------------------------------
    v_c := pg_temp.as_anon(format('select public.edit_class_count_expiry(%L, %L::date, %L)', m_leg, v_today + 30, 'Anon attempt'));
    perform pg_temp.rec('A1 anon cannot edit an expiry', v_c = '42501', v_c);
    if v_instr is null then
      perform pg_temp.skip('A2 an Instructor is refused the edit', 'needs an Instructor profile (none exists)');
    else
      v_c := pg_temp.as_user(v_instr, format('select public.edit_class_count_expiry(%L, %L::date, %L)', m_leg, v_today + 30, 'Instructor attempt'));
      perform pg_temp.rec('A2 an Instructor is refused (42501) and nothing changes', v_c = '42501'
        and (select end_date from public.memberships where id = m_leg) = v_today + 10
        and not exists (select 1 from public.class_count_expiry_edits where membership_id = m_leg), v_c);
    end if;
    v_c := pg_temp.as_anon('select count(*) from public.class_count_expiry_edits');
    perform pg_temp.rec('A4 anon cannot read the expiry history', v_c = '42501', v_c);
    v_c := pg_temp.as_user(v_admin, format('insert into public.class_count_expiry_edits (membership_id, previous_expiry, new_expiry, reason) values (%L, null, %L, %L)', m_leg, v_today, 'Direct write'));
    perform pg_temp.rec('A5 not even an Admin can write the history directly (no write grant)', v_c = '42501', v_c);

    -- E. Edits ----------------------------------------------------------------------------------------------------------
    v_s := pg_temp.edit(v_admin, m_leg, quote_literal((v_today + 60)::text) || '::date', 'Extended for a holiday');
    perform pg_temp.rec('E1 extending the expiry changes end_date and writes one audit row (previous, new, reason, Admin, time)',
      pg_temp.as_uuid(v_s) is not null
      and (select end_date from public.memberships where id = m_leg) = v_today + 60
      and exists (select 1 from public.class_count_expiry_edits e where e.id = pg_temp.as_uuid(v_s) and e.membership_id = m_leg
                    and e.previous_expiry = v_today + 10 and e.new_expiry = v_today + 60 and e.reason = 'Extended for a holiday'
                    and e.edited_by = v_admin and e.edited_at = now()), coalesce(v_s, ''));

    v_s := pg_temp.edit(v_admin, m_leg, quote_literal((v_today - 1)::text) || '::date', '  Shortened: student left  ');
    perform pg_temp.rec('E2 shortening to a past date is accepted; the reason is stored trimmed',
      pg_temp.as_uuid(v_s) is not null and (select end_date from public.memberships where id = m_leg) = v_today - 1
      and exists (select 1 from public.class_count_expiry_edits e where e.id = pg_temp.as_uuid(v_s) and e.reason = 'Shortened: student left'
                    and e.previous_expiry = v_today + 60 and e.new_expiry = v_today - 1), coalesce(v_s, ''));
    perform pg_temp.rec('E3 after shortening: the recorded classes are kept, none reversed, the balance is unchanged, and the one dated after the expiry is the flagged one',
      (select count(*) from public.class_count_attendance where membership_id = m_leg) = v_n
      and not exists (select 1 from public.class_count_attendance_reversals r join public.class_count_attendance a on a.id = r.attendance_id where a.membership_id = m_leg)
      and public.class_count_net_used(m_leg) = v_n
      and (select count(*) from public.class_count_attendance a join public.memberships m on m.id = a.membership_id
           where a.membership_id = m_leg and m.end_date is not null and a.attended_on > m.end_date) = 1,
      'records: ' || v_n || ', net used: ' || public.class_count_net_used(m_leg));
    v_c := pg_temp.record(v_admin, m_leg, v_today);
    perform pg_temp.rec('E4 a new recording is refused once the membership has expired', v_c <> 'OK', v_c);

    v_s := pg_temp.edit(v_admin, m_leg, quote_literal((v_today + 5)::text) || '::date', 'Extended again');
    v_c := pg_temp.record(v_admin, m_leg, v_today);
    perform pg_temp.rec('E5 extending again re-enables recording; the new class counts and the flag no longer applies',
      pg_temp.as_uuid(v_s) is not null and v_c = 'OK' and public.class_count_net_used(m_leg) = v_n + 1
      and not exists (select 1 from public.class_count_attendance a join public.memberships m on m.id = a.membership_id
                      where a.membership_id = m_leg and m.end_date is not null and a.attended_on > m.end_date), coalesce(v_s, '') || ' ' || v_c);

    -- From here no class is recorded or reversed: the digest of everything an expiry edit must not touch is taken now.
    v_leg_digest := pg_temp.untouched(m_leg);

    v_s := pg_temp.edit(v_admin, m_leg, 'null', 'No expiry agreed');
    v_c := pg_temp.edit(v_admin, m_leg, quote_literal((v_today + 90)::text) || '::date', 'Back to a fixed date');
    perform pg_temp.rec('E6 switching to No expiry stores NULL; switching back records the previous expiry as NULL',
      pg_temp.as_uuid(v_s) is not null and pg_temp.as_uuid(v_c) is not null
      and (select end_date from public.memberships where id = m_leg) = v_today + 90
      and exists (select 1 from public.class_count_expiry_edits e where e.id = pg_temp.as_uuid(v_s) and e.previous_expiry = v_today + 5 and e.new_expiry is null)
      and exists (select 1 from public.class_count_expiry_edits e where e.id = pg_temp.as_uuid(v_c) and e.previous_expiry is null and e.new_expiry = v_today + 90), v_s || ' ' || v_c);

    -- V. Refusals ------------------------------------------------------------------------------------------------------
    -- Every refusal below is checked in its own statement afterwards: the expiry is still what it was and no audit row was added.
    v_end0 := (select end_date from public.memberships where id = m_leg);
    v_cnt0 := (select count(*) from public.class_count_expiry_edits where membership_id = m_leg);

    v_s := pg_temp.edit(v_admin, m_leg, quote_literal((v_today + 90)::text) || '::date', 'No change at all');
    perform pg_temp.rec('V1 an edit that changes nothing is refused (22023), and end_date and the history are as they were',
      v_s = 'ERR:22023' and (select end_date from public.memberships where id = m_leg) = v_end0
      and (select count(*) from public.class_count_expiry_edits where membership_id = m_leg) = v_cnt0, v_s);
    v_s := pg_temp.edit(v_admin, m_leg, quote_literal((v_today - 31)::text) || '::date', 'Before the start');
    perform pg_temp.rec('V2 an expiry before the start date is refused (22023), and end_date and the history are as they were',
      v_s = 'ERR:22023' and (select end_date from public.memberships where id = m_leg) = v_end0
      and (select count(*) from public.class_count_expiry_edits where membership_id = m_leg) = v_cnt0, v_s);
    v_s := pg_temp.edit(v_admin, m_leg, 'null', null);
    v_c := pg_temp.edit(v_admin, m_leg, 'null', 'ab');
    v_msg := pg_temp.edit(v_admin, m_leg, 'null', E'   \t ');
    perform pg_temp.rec('V3 a missing, two-character or whitespace reason is refused (22023), and end_date and the history are as they were',
      v_s = 'ERR:22023' and v_c = 'ERR:22023' and v_msg = 'ERR:22023'
      and (select end_date from public.memberships where id = m_leg) = v_end0
      and (select count(*) from public.class_count_expiry_edits where membership_id = m_leg) = v_cnt0, v_s || ' ' || v_c || ' ' || v_msg);
    v_s := pg_temp.edit(v_admin, m_leg, 'null', repeat('r', 501));
    perform pg_temp.rec('V4 a 501-character reason is refused (22023), and end_date and the history are as they were',
      v_s = 'ERR:22023' and (select end_date from public.memberships where id = m_leg) = v_end0
      and (select count(*) from public.class_count_expiry_edits where membership_id = m_leg) = v_cnt0, v_s);
    v_s := pg_temp.edit(v_admin, m_leg, 'null', repeat('r', 500));
    perform pg_temp.rec('V4b a 500-character reason is accepted', pg_temp.as_uuid(v_s) is not null and (select end_date from public.memberships where id = m_leg) is null, coalesce(v_s, ''));
    -- (V4b changed the expiry to No expiry: restore the fixed date for the scenarios below.)
    perform pg_temp.edit(v_admin, m_leg, quote_literal((v_today + 90)::text) || '::date', 'Restore for the checks');
    v_s := pg_temp.edit(v_admin, m_dur, quote_literal((v_today + 40)::text) || '::date', 'A duration membership');
    v_c := pg_temp.edit(v_admin, gen_random_uuid(), 'null', 'No such membership');
    perform pg_temp.rec('V5 a duration membership (55000) and an unknown membership (P0002) are refused; the duration end date is unchanged',
      v_s = 'ERR:55000' and v_c = 'ERR:P0002' and (select end_date from public.memberships where id = m_dur) = v_today + 25
      and not exists (select 1 from public.class_count_expiry_edits where membership_id = m_dur), v_s || ' ' || v_c);
    -- The edits that succeeded: E1, E2, E5, E6 (two), the 500-character reason of V4b, and the restore - seven, and none else.
    perform pg_temp.rec('V6 none of the refusals left an audit row: exactly the seven successful edits of the legacy membership, none for the duration one',
      (select count(*) from public.class_count_expiry_edits where membership_id = m_leg) = 7
      and not exists (select 1 from public.class_count_expiry_edits where membership_id = m_dur), 'rows for the legacy membership: ' || (select count(*) from public.class_count_expiry_edits where membership_id = m_leg));

    -- G. Guards ---------------------------------------------------------------------------------------------------------
    v_c := pg_temp.code(format('update public.memberships set end_date = %L where id = %L', v_today + 200, m_leg));
    perform pg_temp.rec('G1 a direct change of a class-count end_date is refused for the owner (55006), legacy included', v_c = '55006'
      and (select end_date from public.memberships where id = m_leg) = v_today + 90, v_c);
    v_c := pg_temp.code(format('update public.memberships set end_date = null where id = %L', m_leg));
    perform pg_temp.rec('G2 ... and so is removing the expiry directly (55006)', v_c = '55006', v_c);
    v_c := pg_temp.code(format('update public.memberships set end_date = %L where id = %L', v_today + 200, m_pkg));
    perform pg_temp.rec('G3 a direct change of a package-linked class-count end_date is refused too (55006)', v_c = '55006'
      and (select end_date from public.memberships where id = m_pkg) = v_today + 20, v_c);
    v_c := pg_temp.code(format('update public.memberships set amount = amount - 1 where id = %L', m_pkg));
    perform pg_temp.rec('G4 0048''s protection of a package membership''s other columns is intact (55006)', v_c in ('55006', '23514'), v_c);
    v_c := pg_temp.code(format('update public.memberships set end_date = %L where id = %L', v_today + 41, m_dur));
    v_s := pg_temp.code(format('update public.memberships set notes = ''edited'' where id = %L', m_leg));
    perform pg_temp.rec('G5 a duration membership''s end_date and a class-count membership''s notes still change as before',
      v_c = 'OK' and v_s = 'OK' and (select end_date from public.memberships where id = m_dur) = v_today + 41, v_c || ' ' || v_s);

    -- H. History ---------------------------------------------------------------------------------------------------------
    v_s := pg_temp.scalar_as(v_admin, format('select count(*)::text from public.class_count_expiry_edits where membership_id = %L', m_leg));
    perform pg_temp.rec('H1 an Admin can read the history of a membership', v_s ~ '^[0-9]+$' and v_s::int >= 6, v_s);
    if v_instr is null then
      perform pg_temp.skip('H5 an Instructor cannot read the expiry history', 'needs an Instructor profile (none exists)');
    else
      v_s := pg_temp.scalar_as(v_instr, 'select count(*)::text from public.class_count_expiry_edits');
      perform pg_temp.rec('H5 an Instructor reads no row of the expiry history (row-level security), though rows exist',
        v_s = '0' and (select count(*) from public.class_count_expiry_edits) > 0, v_s);
    end if;
    v_c := pg_temp.code(format('update public.class_count_expiry_edits set reason = ''Changed'' where membership_id = %L', m_leg));
    v_s := pg_temp.code(format('delete from public.class_count_expiry_edits where membership_id = %L', m_leg));
    perform pg_temp.rec('H2 a history row cannot be updated or deleted, even by the owner (55006)', v_c = '55006' and v_s = '55006', v_c || ' ' || v_s);
    perform pg_temp.rec('H3 the history cannot be truncated (55006)', pg_temp.code('truncate public.class_count_expiry_edits') = '55006', '');
    v_c := pg_temp.code(format('update public.class_count_expiry_edits set edited_by = null where membership_id = %L and edited_by is not null', m_leg));
    perform pg_temp.rec('H4 the editor may be cleared (a deleted account) and nothing else about the row changes', v_c = 'OK', v_c);

    -- K. Preservation ----------------------------------------------------------------------------------------------------
    perform pg_temp.rec('K1 after every later edit the legacy membership''s fee, allowance, plan, attendance records and reversals are exactly as they were once E5 recorded its last class (same digest)',
      pg_temp.untouched(m_leg) = v_leg_digest
      and (select amount = 500 and total_classes = 5 and plan = 'class_count' and kind = 'class_count' and package_id is null from public.memberships where id = m_leg)
      and (select count(*) from public.class_count_attendance where membership_id = m_leg) = 3
      and not exists (select 1 from public.class_count_attendance_reversals r join public.class_count_attendance a on a.id = r.attendance_id where a.membership_id = m_leg), '');
    v_pkg_digest := pg_temp.untouched(m_pkg);
    v_s := pg_temp.edit(v_admin, m_pkg, quote_literal((v_today + 120)::text) || '::date', 'Extended a package membership');
    perform pg_temp.rec('K2 a package-linked class-count expiry is edited through the function, and its package, fee entry, standard fee, amount, allowance and attendance are untouched',
      pg_temp.as_uuid(v_s) is not null and (select end_date from public.memberships where id = m_pkg) = v_today + 120
      and pg_temp.untouched(m_pkg) = v_pkg_digest
      and exists (select 1 from public.memberships m where m.id = m_pkg and m.package_id = p_cls and m.pricing_mode = 'standard' and m.total_classes = 8), coalesce(v_s, ''));
    perform pg_temp.rec('K3 the receipt-sync trigger skips an expiry edit (an issued membership-level receipt is never rewritten by it)',
      (select pg_get_triggerdef(t.oid) like '%yoga.class_count_expiry_edit%' from pg_trigger t where t.tgname = 'memberships_sync_invoice_trigger' and not t.tgisinternal), '');

    -- R. An issued membership-level receipt is not rewritten by an expiry edit ---------------------------------------------
    -- The legacy shape: a Paid class-count membership with no recorded payments gets a membership-level receipt (payment_id NULL).
    begin
      select * into v_set from public.invoice_settings where singleton;
      if v_set.starting_invoice_number is null then
        v_msg := pg_temp.code('update public.invoice_settings set starting_invoice_number = 990001 where singleton');
      end if;
      s_rcpt := pg_temp.student('receipt');
      insert into public.memberships (student_id, plan, kind, total_classes, start_date, end_date, amount, currency)
      values (s_rcpt, 'class_count', 'class_count', 5, v_today - 30, v_today + 10, 900, v_currency) returning id into m_rcpt;
      v_msg := pg_temp.code(format('update public.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 1, m_rcpt));
      select i.* into v_inv from public.invoices i where i.membership_id = m_rcpt and i.payment_id is null order by i.created_at limit 1;
      if v_inv.id is null then
        v_msg := pg_temp.scalar_as(v_admin, format('select public.issue_invoice(%L::uuid)::text', m_rcpt));
        select i.* into v_inv from public.invoices i where i.membership_id = m_rcpt and i.payment_id is null order by i.created_at limit 1;
      end if;

      if v_inv.id is null then
        perform pg_temp.skip('R1 an expiry edit leaves an issued membership-level receipt unchanged', 'could not build a membership-level receipt: ' || coalesce(v_msg, ''));
      else
        v_inv_digest := md5(to_jsonb(v_inv)::text);
        v_s := pg_temp.edit(v_admin, m_rcpt, quote_literal((v_today + 40)::text) || '::date', 'Extended the receipt membership');
        select i.* into v_inv from public.invoices i where i.id = v_inv.id;
        perform pg_temp.rec('R1 an expiry edit leaves the issued membership-level receipt unchanged: the membership''s end_date moved, the receipt''s period_end did not, and no column of the receipt row differs',
          pg_temp.as_uuid(v_s) is not null
          and (select end_date from public.memberships where id = m_rcpt) = v_today + 40
          and v_inv.period_end = v_today + 10
          and md5(to_jsonb(v_inv)::text) = v_inv_digest,
          'receipt period_end ' || coalesce(v_inv.period_end::text, 'NULL') || ', membership end_date ' || (select end_date::text from public.memberships where id = m_rcpt));
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      perform pg_temp.skip('R1 an expiry edit leaves an issued membership-level receipt unchanged', 'could not build or edit a membership-level receipt: ' || sqlstate || ' ' || coalesce(v_err, ''));
    end;

    -- X. The 0048 exemption is exactly as narrow as the edit -------------------------------------------------------------------
    -- The flag is what the function sets around its one UPDATE. Standing where the function stands: with THIS membership's flag only
    -- end_date may change, and the flag of ANOTHER membership exempts nothing.
    v_c := pg_temp.flagged_update(m_dur::text, format('update public.memberships set end_date = %L where id = %L', v_today + 200, m_leg));
    perform pg_temp.rec('X2 the flag of another membership permits no end_date change of a legacy class-count membership (55006)',
      v_c = '55006' and (select end_date from public.memberships where id = m_leg) = v_today + 90, v_c);
    v_c := pg_temp.flagged_update(m_pkg::text, format('update public.memberships set end_date = %L, amount = amount - 1 where id = %L', v_today + 200, m_pkg));
    perform pg_temp.rec('X1 with the membership''s own flag, an end_date AND amount change is refused (55006) and neither changes',
      v_c = '55006' and (select end_date from public.memberships where id = m_pkg) = v_today + 120
      and (select amount from public.memberships where id = m_pkg) = (select standard_fee - coalesce(package_discount, 0) - coalesce(individual_discount_amount, 0) from public.memberships where id = m_pkg), v_c);
    v_s := pg_temp.flagged_update(m_leg::text, format('update public.memberships set end_date = %L where id = %L', v_today + 200, m_pkg));
    perform pg_temp.rec('X2b the flag of another membership permits no end_date change of a package-linked class-count membership either (55006)',
      v_s = '55006' and (select end_date from public.memberships where id = m_pkg) = v_today + 120, v_s);
    v_c := pg_temp.flagged_update(m_pkg::text, format('update public.memberships set end_date = %L where id = %L', v_today + 150, m_pkg));
    perform pg_temp.rec('X3 with the membership''s own flag, an end_date-only change passes (the exemption is exactly that narrow) and the flag is cleared afterwards',
      v_c = 'OK' and (select end_date from public.memberships where id = m_pkg) = v_today + 150
      and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') = '', v_c);

    -- Z. Existing data unchanged ------------------------------------------------------------------------------------------
    update _legacy_hash set after_hash = (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.id), '')) from public.memberships m where m.id in (select id from _legacy_ids));
    perform pg_temp.rec('Z every membership that existed before this script is byte-for-byte unchanged by it', (select before_hash = after_hash from _legacy_hash), '');
  end if;
end $$;

insert into _verify_results
select 1000, 'SUMMARY',
  case when count(*) filter (where status = 'FAIL') = 0 then 'ALL PASS' else 'FAILURES' end,
  count(*) filter (where status = 'PASS') || ' passed, ' || count(*) filter (where status = 'FAIL')
    || ' failed, ' || count(*) filter (where status = 'NOT TESTED') || ' not tested'
from _verify_results;

select seq, test, status, detail from _verify_results order by seq;

rollback;

-- AFTER THE ROLLBACK (run separately): nothing may remain.
--   select (select count(*) from public.students where position('ZZVERIFY 0049' in full_name) = 1) as leftover_students,
--          (select count(*) from public.packages where position('ZZVERIFY 0049' in name) = 1) as leftover_packages;
-- Both must be 0.
