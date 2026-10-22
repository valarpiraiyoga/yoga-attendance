-- ===========================================================================
-- Migration 0059 verification (behaviour) - batch capacity
-- Exercises supabase/migrations/0059_batch_capacity.sql
-- ===========================================================================
--
-- WHAT IT CHECKS
--   P0  Migration 0059 is applied (the column, its constraint, two functions, two triggers). Otherwise every scenario is skipped.
--   PF  Preflight: no fixture name exists.
--   V   Capacity values: NULL, 1 and 1000 are accepted; 0, -1 and 1001 are refused (23514, batches_capacity_valid).
--   N   NULL capacity is unlimited: a batch without a capacity takes any number of active enrollments.
--   F   A full batch refuses a new active enrollment (23514, "The batch is full") and writes nothing; below capacity it is accepted.
--   O   What occupies a place: an inactive enrollment and one that ended yesterday do not; one ending today and a future-dated one
--       do; an inactive student's active enrollment does. An inactive or already-ended enrollment can still be recorded in a full
--       batch (it takes no place).
--   R   Reactivation (inactive -> active) into a full batch is refused; deactivating an enrollment in a full batch is accepted and
--       frees the place, after which a new enrollment is accepted.
--   M   Moving an enrollment into a full batch is refused; moving one out of a full batch, or into a batch with room, is accepted.
--   X   End dates: extending a past end date to today or later, or clearing it, in a full batch is refused; ending an enrollment
--       before today in a full batch is accepted and frees the place.
--   U   Updates of an enrollment that already holds a place are never refused at capacity. A start-date-only change (U1) does
--       not fire the capacity trigger at all (the start date is not one of its columns); another future end date, clearing a
--       future end date and the same values written again (U2-U4) fire it and pass its "already holds a place" check.
--   T   One statement, several rows: an INSERT of three enrollments into a batch with two places is refused as a whole and writes
--       nothing (each row's guard sees the rows the statement wrote before it); an INSERT of two is accepted; an UPDATE moving two
--       enrollments into a batch with one free place is refused as a whole and moves neither.
--   C   Combined changes in one UPDATE: reactivating AND moving into a full batch is refused; moving an enrollment that ended
--       before today into a full batch is accepted (it takes no place); moving one AND clearing its end date into a full batch is
--       refused; reactivating AND moving into a batch with room is accepted.
--   D   Lowering the capacity: below the occupied places is refused (23514, "The capacity cannot be lowered") and leaves it as it
--       was; to exactly the occupied number, higher, or NULL is accepted; then a new enrollment is accepted after an increase.
--   A   As the Admin through RLS (a direct client write, as the app sends it): a full batch refuses the insert with the same rule.
--   Z   Every batch and enrollment that existed before this script is byte-for-byte unchanged (capacity added as NULL included).
--
-- PREREQUISITES: migration 0059 applied (it refuses to run without 0005, 0007 and centre_timezone() of 0024). Scenarios V-U and D use
-- no Admin profile: the guards are triggers and apply to every writer. Scenario A needs an Admin profile; without one it is
-- reported NOT TESTED.
--
-- SAFETY - ROLLBACK ONLY
--   One transaction (REPEATABLE READ, so the digests of existing rows come from one snapshot), ending in ROLLBACK. Disposable
--   fixtures only: students 'ZZVERIFY 0059 ...' and batches 'ZZVERIFY 0059 ...' (codes ZZV59A ...) and their enrollments. No trigger
--   is disabled. The batch rows locked by the guards are fixture rows, so the run does not hold locks on real batches.
--
-- LIMITATIONS
--   * CONCURRENCY IS NOT TESTED HERE: one transaction cannot race itself. It rests on the batch row lock described in the migration
--     (SELECT ... FOR NO KEY UPDATE in the enrollment guard; the row lock of the capacity UPDATE), and it is guaranteed under READ
--     COMMITTED only - run both sessions below at the default READ COMMITTED, never REPEATABLE READ.
--     To check it by hand, on a disposable database: create fixture students <s1>, <s2>, <s3> whose join_date is on or before the
--     centre's date, and a fixture batch <b>. <d> is the centre's date: select (now() at time zone public.centre_timezone())::date;
--     (an enrollment may not start before its student's join date - 0051 - so use <d>, not the server's current_date, which is the
--     UTC date). Then, in two sessions:
--     (a) Two enrollments into the last place - <b> with capacity 1 and no enrollment:
--       session 1: begin; insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (<s1>, <b>, <d>);
--       session 2: begin; insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (<s2>, <b>, <d>);
--                  -- waits for session 1
--       session 1: commit;
--       session 2: -- must now fail with 23514 "The batch is full (1 of 1 places taken) ..."; then rollback.
--     (b) An enrollment against a capacity change - <b> with capacity 2 and one active enrollment (of <s1>):
--       session 1: begin; insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (<s3>, <b>, <d>);
--       session 2: begin; update public.batches set capacity = 1 where id = <b>;   -- waits for session 1
--       session 1: commit;
--       session 2: -- must now fail with 23514 "The capacity cannot be lowered to 1 because 2 places are taken ..."; then rollback.
--   * "Today" is the centre's date (centre_timezone()). Running across the centre's midnight may move the X and O boundaries.
--   * The application's own handling of these errors is a later step (C4) and is not exercised here.
--
-- OUTPUT: seq / test / status / detail, plus a SUMMARY row. Statuses: PASS, FAIL, NOT TESTED.
-- ===========================================================================

begin isolation level repeatable read;

create temp table _verify_results (seq int, test text, status text, detail text) on commit drop;
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

-- One statement as the owner: 'OK', or '<sqlstate>:<message>' (to tell WHICH rule refused it). A failed statement is rolled back to
-- its own savepoint only.
create function pg_temp.msg(p_sql text)
returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

-- One statement as an authenticated user: 'OK', or '<sqlstate>:<message>'.
create function pg_temp.msg_as(p_user uuid, p_sql text)
returns text language plpgsql as $f$
declare
  v_out text := 'OK';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    v_out := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return v_out;
end $f$;

create function pg_temp.mk_student(p_name text, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.students (full_name, phone, phone_country_code, join_date, status)
  values ('ZZVERIFY 0059 ' || p_name, '9000000059', '+91', (now() at time zone public.centre_timezone())::date - 400, p_status)
  returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.mk_batch(p_name text, p_code text, p_capacity integer)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batches (name, code, capacity) values ('ZZVERIFY 0059 ' || p_name, p_code, p_capacity) returning id into v_id;
  return v_id;
end $f$;

-- An enrollment written as the owner (the guard applies to every writer). Raises when refused: use pg_temp.msg to observe a refusal.
create function pg_temp.mk_en(p_student uuid, p_batch uuid, p_start date, p_end date default null, p_status text default 'active')
returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date, status)
  values (p_student, p_batch, p_start, p_end, p_status) returning id into v_id;
  return v_id;
end $f$;

create function pg_temp.ins_sql(p_student uuid, p_batch uuid, p_start date, p_end date default null, p_status text default 'active')
returns text language sql as $f$
  select format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date, effective_end_date, status) values (%L, %L, %L, %L, %L)',
                p_student, p_batch, p_start, p_end, p_status)
$f$;

-- Places occupied in a batch now, by the migration's own definition.
create function pg_temp.occupied(p_batch uuid)
returns integer language sql as $f$
  select count(*)::integer from public.batch_enrollments be
  where be.batch_id = p_batch and be.status = 'active'
    and (be.effective_end_date is null or be.effective_end_date >= (now() at time zone public.centre_timezone())::date)
$f$;

-- Existing data, digested at the start (the same snapshot, because the transaction is REPEATABLE READ).
insert into _legacy_hash (before_hash)
select md5(
  coalesce((select string_agg(to_jsonb(b)::text, '|' order by b.id) from public.batches b), '') ||
  coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be), ''));

do $$
declare
  v_applied boolean;
  v_today   date := (now() at time zone public.centre_timezone())::date;
  v_admin   uuid;
  v_c       text;
  b         uuid;
  b2        uuid;
  b3        uuid;
  s1        uuid;
  s2        uuid;
  s3        uuid;
  s4        uuid;
  e1        uuid;
  e2        uuid;
  e3        uuid;
  v_before  text;
begin
  -- P0. The migration is applied -------------------------------------------------------------------------------------------
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'batches' and column_name = 'capacity')
     and exists (select 1 from pg_constraint where conname = 'batches_capacity_valid' and conrelid = 'public.batches'::regclass)
     and (select count(*) from pg_trigger where not tgisinternal and tgname in (
            'batch_enrollments_capacity_guard_trigger', 'batches_capacity_guard_trigger')) = 2
     and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'batch_enrollments_capacity_guard', 'batches_capacity_guard')) = 2
  into v_applied;
  perform pg_temp.rec('P0 migration 0059 is applied (column, constraint, two functions, two triggers)', v_applied, '');

  if not v_applied then
    perform pg_temp.skip('all scenarios', 'Migration 0059 is not applied.');
    return;
  end if;

  if exists (select 1 from public.students where position('ZZVERIFY 0059' in full_name) = 1)
     or exists (select 1 from public.batches where position('ZZVERIFY 0059' in name) = 1 or lower(code) like 'zzv59%') then
    perform pg_temp.rec('PF preflight: no fixture name exists', false, 'A ZZVERIFY 0059 row already exists - clean up first.');
    return;
  end if;
  perform pg_temp.rec('PF preflight: no fixture name exists', true, '');

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  s1 := pg_temp.mk_student('One');
  s2 := pg_temp.mk_student('Two');
  s3 := pg_temp.mk_student('Three');
  s4 := pg_temp.mk_student('Four');

  -- V. Capacity values -------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Values', 'ZZV59V', null);
  perform pg_temp.rec('V1 a new batch without a capacity has NULL (unlimited)', (select capacity from public.batches where id = b) is null, '');
  v_c := pg_temp.msg(format('update public.batches set capacity = 1 where id = %L', b));
  perform pg_temp.rec('V2 capacity 1 is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = 1000 where id = %L', b));
  perform pg_temp.rec('V3 capacity 1000 is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = 0 where id = %L', b));
  perform pg_temp.rec('V4 capacity 0 is refused (23514, batches_capacity_valid)', v_c like '23514:%batches_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = -1 where id = %L', b));
  perform pg_temp.rec('V5 capacity -1 is refused (23514, batches_capacity_valid)', v_c like '23514:%batches_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = 1001 where id = %L', b));
  perform pg_temp.rec('V6 capacity 1001 is refused (23514, batches_capacity_valid)', v_c like '23514:%batches_capacity_valid%', v_c);
  v_c := pg_temp.msg($q$insert into public.batches (name, code, capacity) values ('ZZVERIFY 0059 Zero', 'ZZV59Z', 0)$q$);
  perform pg_temp.rec('V7 a new batch with capacity 0 is refused (23514, batches_capacity_valid)', v_c like '23514:%batches_capacity_valid%', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = null where id = %L', b));
  perform pg_temp.rec('V8 capacity can be cleared to NULL', v_c = 'OK' and (select capacity from public.batches where id = b) is null, v_c);

  -- N. NULL is unlimited -------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Unlimited', 'ZZV59N', null);
  perform pg_temp.mk_en(s1, b, v_today);
  perform pg_temp.mk_en(s2, b, v_today);
  v_c := pg_temp.msg(pg_temp.ins_sql(s3, b, v_today));
  perform pg_temp.rec('N1 a batch with NULL capacity takes a third active enrollment', v_c = 'OK' and pg_temp.occupied(b) = 3, v_c);

  -- F. A full batch refuses a new place ---------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Full', 'ZZV59F', 2);
  v_c := pg_temp.msg(pg_temp.ins_sql(s1, b, v_today));
  perform pg_temp.rec('F1 below capacity (0 of 2) a new active enrollment is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(s2, b, v_today));
  perform pg_temp.rec('F2 the last place (1 of 2) is accepted', v_c = 'OK' and pg_temp.occupied(b) = 2, v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(s3, b, v_today));
  perform pg_temp.rec('F3 a full batch (2 of 2) refuses a new active enrollment (23514, "The batch is full (2 of 2 places taken)") and writes nothing',
    v_c like '23514:The batch is full (2 of 2 places taken)%'
    and not exists (select 1 from public.batch_enrollments where batch_id = b and student_id = s3), v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(s3, b, v_today + 30));
  perform pg_temp.rec('F4 a future-dated enrollment into a full batch is refused too (it would reserve a place)',
    v_c like '23514:The batch is full%', v_c);

  -- O. What occupies a place -------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Occupancy', 'ZZV59O', 2);
  perform pg_temp.mk_en(s1, b, v_today - 60, null, 'inactive');
  perform pg_temp.mk_en(s2, b, v_today - 60, v_today - 1);
  perform pg_temp.rec('O1 an inactive enrollment and one that ended yesterday occupy no place', pg_temp.occupied(b) = 0, pg_temp.occupied(b)::text);
  perform pg_temp.mk_en(s3, b, v_today - 60, v_today);
  perform pg_temp.mk_en(s4, b, v_today + 10);
  perform pg_temp.rec('O2 one ending today and a future-dated one each occupy a place (2 of 2)', pg_temp.occupied(b) = 2, pg_temp.occupied(b)::text);
  v_c := pg_temp.msg(pg_temp.ins_sql(pg_temp.mk_student('O Extra'), b, v_today));
  perform pg_temp.rec('O3 so the batch is full: a new active enrollment is refused', v_c like '23514:The batch is full (2 of 2 places taken)%', v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(pg_temp.mk_student('O Inactive record'), b, v_today - 90, null, 'inactive'));
  perform pg_temp.rec('O4 an INACTIVE enrollment can still be recorded in the full batch (it takes no place)', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(pg_temp.mk_student('O Past record'), b, v_today - 90, v_today - 10));
  perform pg_temp.rec('O5 an enrollment that ended before today can still be recorded in the full batch (it takes no place)', v_c = 'OK', v_c);

  b2 := pg_temp.mk_batch('Inactive student', 'ZZV59S', 1);
  perform pg_temp.mk_en(pg_temp.mk_student('S Inactive', 'inactive'), b2, v_today - 30);
  v_c := pg_temp.msg(pg_temp.ins_sql(s1, b2, v_today));
  perform pg_temp.rec('O6 an INACTIVE student''s active enrollment still occupies its place (1 of 1: a new enrollment is refused)',
    v_c like '23514:The batch is full (1 of 1 places taken)%', v_c);

  -- R. Reactivation and deactivation ------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Reactivate', 'ZZV59R', 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 30, null, 'inactive');
  e2 := pg_temp.mk_en(s2, b, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'' where id = %L', e1));
  perform pg_temp.rec('R1 reactivating an enrollment into a full batch (1 of 1) is refused and it stays inactive',
    v_c like '23514:The batch is full (1 of 1 places taken)%' and (select status from public.batch_enrollments where id = e1) = 'inactive', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''inactive'' where id = %L', e2));
  perform pg_temp.rec('R2 deactivating an enrollment in a full batch is accepted and frees the place', v_c = 'OK' and pg_temp.occupied(b) = 0, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'' where id = %L', e1));
  perform pg_temp.rec('R3 the freed place can then be taken (the reactivation is accepted)', v_c = 'OK' and pg_temp.occupied(b) = 1, v_c);

  -- M. Moving between batches -------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Move full', 'ZZV59M', 1);
  b2 := pg_temp.mk_batch('Move room', 'ZZV59K', 5);
  perform pg_temp.mk_en(s1, b, v_today - 30);
  e1 := pg_temp.mk_en(s2, b2, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = %L where id = %L', b, e1));
  perform pg_temp.rec('M1 moving an enrollment into a full batch is refused and it stays where it was',
    v_c like '23514:The batch is full (1 of 1 places taken)%' and (select batch_id from public.batch_enrollments where id = e1) = b2, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = %L where id = %L', b2, (select id from public.batch_enrollments where batch_id = b and student_id = s1)));
  perform pg_temp.rec('M2 moving an enrollment OUT of a full batch, into a batch with room, is accepted', v_c = 'OK' and pg_temp.occupied(b) = 0 and pg_temp.occupied(b2) = 2, v_c);

  -- X. End dates ---------------------------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('End dates', 'ZZV59X', 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 90, v_today - 5);
  e2 := pg_temp.mk_en(s2, b, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today, e1));
  perform pg_temp.rec('X1 extending a past end date to today in a full batch is refused and the end date is unchanged',
    v_c like '23514:The batch is full%' and (select effective_end_date from public.batch_enrollments where id = e1) = v_today - 5, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = null where id = %L', e1));
  perform pg_temp.rec('X2 clearing a past end date in a full batch is refused', v_c like '23514:The batch is full%', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today - 2, e1));
  perform pg_temp.rec('X3 moving a past end date to another past date is accepted (it takes no place)', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today - 1, e2));
  perform pg_temp.rec('X4 ending an enrollment yesterday in a full batch is accepted and frees the place', v_c = 'OK' and pg_temp.occupied(b) = 0, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = null where id = %L', e1));
  perform pg_temp.rec('X5 the freed place can then be taken (clearing the end date is accepted)', v_c = 'OK' and pg_temp.occupied(b) = 1, v_c);

  -- U. Updates that keep the place ---------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Keep', 'ZZV59U', 1);
  e1 := pg_temp.mk_en(s1, b, v_today - 30, v_today + 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_start_date = %L where id = %L', v_today - 20, e1));
  perform pg_temp.rec('U1 at capacity, a start-date-only change is accepted (the capacity trigger does not fire for it: the start date is not one of its columns)', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = %L where id = %L', v_today + 60, e1));
  perform pg_temp.rec('U2 at capacity, another future end date is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set effective_end_date = null where id = %L', e1));
  perform pg_temp.rec('U3 at capacity, clearing a future end date is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = batch_id, status = status, effective_end_date = effective_end_date where id = %L', e1));
  perform pg_temp.rec('U4 at capacity, writing the same batch, status and end date again (as the edit form does) is accepted', v_c = 'OK', v_c);

  -- T. One statement, several rows -------------------------------------------------------------------------------------------
  -- A row-level BEFORE trigger sees the rows the same statement processed before it, so the statement fails as a whole.
  b := pg_temp.mk_batch('Multi insert', 'ZZV59T', 2);
  v_c := pg_temp.msg(format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
    s1, b, v_today, s2, b, v_today, s3, b, v_today));
  perform pg_temp.rec('T1 one INSERT of three enrollments into a batch with two places is refused as a whole (23514, "The batch is full (2 of 2 places taken)") and writes none of them',
    v_c like '23514:The batch is full (2 of 2 places taken)%'
    and not exists (select 1 from public.batch_enrollments where batch_id = b), v_c);
  v_c := pg_temp.msg(format('insert into public.batch_enrollments (student_id, batch_id, effective_start_date) values (%L, %L, %L), (%L, %L, %L)',
    s1, b, v_today, s2, b, v_today));
  perform pg_temp.rec('T2 one INSERT of two enrollments into a batch with two places is accepted', v_c = 'OK' and pg_temp.occupied(b) = 2, v_c);

  b := pg_temp.mk_batch('Multi move target', 'ZZV59W', 2);
  b2 := pg_temp.mk_batch('Multi move source', 'ZZV59H', null);
  perform pg_temp.mk_en(s1, b, v_today - 30);
  perform pg_temp.mk_en(s2, b2, v_today - 30);
  perform pg_temp.mk_en(s3, b2, v_today - 30);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = %L where batch_id = %L', b, b2));
  perform pg_temp.rec('T3 one UPDATE moving two enrollments into a batch with one free place (1 of 2) is refused as a whole and moves neither',
    v_c like '23514:The batch is full (2 of 2 places taken)%' and pg_temp.occupied(b) = 1 and pg_temp.occupied(b2) = 2, v_c);

  -- C. Combined changes in one UPDATE ------------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Combined full', 'ZZV59C', 1);
  b2 := pg_temp.mk_batch('Combined source', 'ZZV59B', null);
  b3 := pg_temp.mk_batch('Combined room', 'ZZV59E', 5);
  perform pg_temp.mk_en(s1, b, v_today - 30);
  e1 := pg_temp.mk_en(s2, b2, v_today - 30, null, 'inactive');
  e2 := pg_temp.mk_en(s3, b2, v_today - 90, v_today - 1);
  e3 := pg_temp.mk_en(s4, b2, v_today - 90, v_today - 1);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'', batch_id = %L where id = %L', b, e1));
  perform pg_temp.rec('C1 reactivating AND moving an enrollment into a full batch in one UPDATE is refused; it stays inactive where it was',
    v_c like '23514:The batch is full (1 of 1 places taken)%'
    and (select status from public.batch_enrollments where id = e1) = 'inactive'
    and (select batch_id from public.batch_enrollments where id = e1) = b2, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = %L where id = %L', b, e2));
  perform pg_temp.rec('C2 moving an enrollment that ended yesterday into a full batch is accepted (it takes no place)',
    v_c = 'OK' and (select batch_id from public.batch_enrollments where id = e2) = b and pg_temp.occupied(b) = 1, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set batch_id = %L, effective_end_date = null where id = %L', b, e3));
  perform pg_temp.rec('C3 moving an ended enrollment AND clearing its end date into a full batch in one UPDATE is refused; it stays ended where it was',
    v_c like '23514:The batch is full (1 of 1 places taken)%'
    and (select batch_id from public.batch_enrollments where id = e3) = b2
    and (select effective_end_date from public.batch_enrollments where id = e3) = v_today - 1, v_c);
  v_c := pg_temp.msg(format('update public.batch_enrollments set status = ''active'', batch_id = %L where id = %L', b3, e1));
  perform pg_temp.rec('C4 reactivating AND moving an enrollment into a batch with room in one UPDATE is accepted',
    v_c = 'OK' and pg_temp.occupied(b3) = 1, v_c);

  -- D. Lowering and raising the capacity ---------------------------------------------------------------------------------------
  b := pg_temp.mk_batch('Decrease', 'ZZV59D', 5);
  perform pg_temp.mk_en(s1, b, v_today - 30);
  perform pg_temp.mk_en(s2, b, v_today - 30);
  perform pg_temp.mk_en(s3, b, v_today + 3);
  perform pg_temp.mk_en(s4, b, v_today - 60, v_today - 1);
  v_c := pg_temp.msg(format('update public.batches set capacity = 2 where id = %L', b));
  perform pg_temp.rec('D1 lowering the capacity to 2 with 3 places taken is refused (23514, "The capacity cannot be lowered to 2 because 3 places are taken") and it stays 5',
    v_c like '23514:The capacity cannot be lowered to 2 because 3 places are taken%' and (select capacity from public.batches where id = b) = 5, v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = 3 where id = %L', b));
  perform pg_temp.rec('D2 lowering it to exactly the places taken (3; the ended enrollment does not count) is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(pg_temp.mk_student('D Extra'), b, v_today));
  perform pg_temp.rec('D3 the batch is now full: a new enrollment is refused', v_c like '23514:The batch is full (3 of 3 places taken)%', v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = 4 where id = %L', b));
  perform pg_temp.rec('D4 raising the capacity of a full batch is accepted', v_c = 'OK', v_c);
  v_c := pg_temp.msg(pg_temp.ins_sql(pg_temp.mk_student('D After increase'), b, v_today));
  perform pg_temp.rec('D5 after the increase a new enrollment is accepted', v_c = 'OK' and pg_temp.occupied(b) = 4, v_c);
  v_c := pg_temp.msg(format('update public.batches set capacity = null where id = %L', b));
  perform pg_temp.rec('D6 clearing the capacity of a full batch (unlimited) is accepted', v_c = 'OK', v_c);
  v_before := (select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be where be.batch_id = b);
  v_c := pg_temp.msg(format('update public.batches set capacity = 1 where id = %L', b));
  perform pg_temp.rec('D7 a refused decrease changes no enrollment (none removed, deactivated or ended)',
    v_c like '23514:The capacity cannot be lowered%'
    and v_before = (select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be where be.batch_id = b), v_c);
  v_c := pg_temp.msg(format('update public.batches set name = name || '' (renamed)'' where id = %L', b));
  perform pg_temp.rec('D8 an edit of a batch that does not touch the capacity is never checked', v_c = 'OK', v_c);

  -- A. As the Admin, through RLS ------------------------------------------------------------------------------------------------
  if v_admin is null then
    perform pg_temp.skip('A1 an Admin''s direct insert into a full batch is refused', 'needs an Admin profile');
  else
    b := pg_temp.mk_batch('Admin', 'ZZV59A', 1);
    perform pg_temp.mk_en(s1, b, v_today);
    v_c := pg_temp.msg_as(v_admin, pg_temp.ins_sql(s2, b, v_today));
    perform pg_temp.rec('A1 an Admin''s direct insert (as the app sends it, through RLS) into a full batch is refused by the same rule',
      v_c like '23514:The batch is full (1 of 1 places taken)%', v_c);
    v_c := pg_temp.msg_as(v_admin, format('update public.batches set capacity = 2 where id = %L', b));
    perform pg_temp.rec('A2 the Admin can raise the capacity', v_c = 'OK', v_c);
    v_c := pg_temp.msg_as(v_admin, pg_temp.ins_sql(s2, b, v_today));
    perform pg_temp.rec('A3 and then enroll another student', v_c = 'OK', v_c);
  end if;

  -- Z. Existing data unchanged ---------------------------------------------------------------------------------------------------
  -- Fixture rows are excluded by name: only what existed before this script is compared.
  update _legacy_hash set after_hash = (select md5(
    coalesce((select string_agg(to_jsonb(bb)::text, '|' order by bb.id) from public.batches bb where position('ZZVERIFY 0059' in bb.name) <> 1), '') ||
    coalesce((select string_agg(to_jsonb(be)::text, '|' order by be.id) from public.batch_enrollments be
              where be.batch_id in (select id from public.batches where position('ZZVERIFY 0059' in name) <> 1)), '')));
  perform pg_temp.rec('Z every batch and enrollment that existed before this script is byte-for-byte unchanged by it',
    (select before_hash = after_hash from _legacy_hash), '');
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
--   select (select count(*) from public.students where position('ZZVERIFY 0059' in full_name) = 1) as leftover_students,
--          (select count(*) from public.batches where position('ZZVERIFY 0059' in name) = 1) as leftover_batches;
-- Both must be 0.
