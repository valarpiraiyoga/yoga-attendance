-- Instructor schedule conflicts: an instructor cannot have two classes at the same time (V1 Final Improvements, C2a)
--
-- WHY
--   01-product.md section 7 "Conflicts": two schedules conflict when they have the same instructor, the same day of the week,
--   overlapping times (back-to-back classes do not overlap) and overlapping effective periods (inclusive; no effective_until = no end).
--   Status plays no part. A save that would create a conflict is blocked with no override; shortening a period or deactivating is
--   never blocked; conflicts saved before this rule stay exactly as stored. Batch overlaps with different instructors and a student's
--   own overlapping assignments stay allowed (this migration does not look at them).
--
-- WHAT THIS MIGRATION DOES
--   One row-level AFTER INSERT OR UPDATE trigger on public.schedules, schedules_instructor_conflict_check, and its function
--   schedules_instructor_conflict_guard(). For each schedule row written:
--     1. An UPDATE that keeps the instructor, day and times and only narrows the effective period (a later or equal effective_from,
--        an earlier or equal effective_until) cannot create a conflict and is accepted at once, without a lock. This is deactivation,
--        closing a version before its successor, and any shortening - even of a schedule that already conflicts.
--     2. Otherwise it takes a transaction-level advisory lock for the instructor, then looks for ANY other schedule row (any batch, any
--        status, any series - including other versions of the same series) of the same instructor on the same day whose times overlap
--        (start < other end and other start < end) and whose inclusive effective period overlaps. If one exists it raises:
--          SQLSTATE 23P01, message 'This instructor already has a class at an overlapping time on that day.'
--          DETAIL  one JSON object:
--                  {"reason": "instructor_conflict", "conflict_schedule_id": "<uuid>", "batch_id": "<uuid>",
--                   "batch_code": "<code>", "batch_name": "<name>", "day_of_week": "<monday..sunday>",
--                   "start_time": "HH:MM", "end_time": "HH:MM", "effective_from": "YYYY-MM-DD", "effective_until": "YYYY-MM-DD" | null}
--        The DETAIL carries the conflicting row's own fields, not only its id: that row can be one inserted by the same failing
--        statement (two overlapping slots of one Add Schedule), which the error rolls back, so it could not be looked up afterwards.
--        JSON makes it unambiguous to parse whatever the batch name contains; dates are written with to_char('YYYY-MM-DD') so the
--        server's DateStyle cannot change them, and times are the first five characters of the time's text (HH:MM). The batch code
--        and name come from a LEFT JOIN (null only if the batch row cannot be read). When several rows conflict, the earliest
--        (effective_from, start_time, id) is reported.
--   Every write of the listed columns is checked except a narrowing update (1). That includes an in-place save that changes nothing
--   (for example correct_unused_schedule or save_schedule_edit called with the schedule's own values): a schedule that already
--   conflicts with another one is refused on such a save, as on any other - only shortening it, or changing it so that the overlap
--   ends, gets through (01-product.md section 7: "A later save of either schedule is checked like any other").
--   It fires on every path that writes a schedule: Add Schedule's plain insert (one statement for all its rows), save_schedule_edit
--   (in place, or close + new version), its extra days, save_unused_schedule_edit / correct_unused_schedule, and Deactivate.
--
-- WHY A TRIGGER AND NOT AN EXCLUSION CONSTRAINT
--   A constraint applies to every stored row, so it could not be added while any conflict exists, and history must not be rewritten
--   to make room. The trigger judges only the row being written. It is AFTER, not BEFORE: a row-level AFTER trigger fires once the
--   whole statement is done, when every row of that statement is visible to it, so two rows of one multi-row INSERT see each other.
--   The function is VOLATILE (the default) so each of its queries takes a fresh snapshot and sees those rows. Any raise aborts the
--   whole statement - no row of a multi-row insert survives - and, in a function, the whole call (0061 catches nothing).
--
-- CONCURRENCY (READ COMMITTED - the default, and what PostgREST uses)
--   Two transactions saving schedules for the same instructor at once cannot both pass: each takes
--   pg_advisory_xact_lock(hashtextextended('public.schedules:instructor:' || instructor_id, 0)) before its check, so the second waits
--   until the first commits or rolls back, and its check (a new statement, so a new snapshot) then sees the first one's rows.
--   The lock is held to the end of the transaction and is re-entrant within it. Different instructors do not wait for each other; a
--   hash collision between two instructors only makes them wait, never skips a check. Under REPEATABLE READ or SERIALIZABLE the
--   second transaction would keep its old snapshot after waiting, so this guarantee is for READ COMMITTED only.
--
-- LOCK ORDER
--   The advisory lock is taken after the row locks a writer already holds (0061: the schedule row FOR UPDATE, then its series row) and
--   after its own write. Nothing takes an instructor lock and then waits for a schedules or schedule_series row: the enrollment
--   functions (0060) lock series rows only and never write schedules, and a shortening update returns before locking. Every
--   application path writes schedules for ONE instructor per transaction (Add Schedule has one instructor; an edit that changes the
--   instructor only narrows the old row, which takes no lock, and locks the new instructor), so two of these locks are never taken in
--   opposite orders by the application. Hand-written SQL that writes two instructors' schedules in one transaction could deadlock;
--   PostgreSQL detects that and aborts one transaction (40P01). This is analysis, not a measurement: the two-session check is in the
--   verification script's header.
--
-- WHAT IT DOES NOT DO
--   * It changes, ends or deletes no existing row. Existing conflicts are left exactly as they are (it reports how many it sees, as a
--     NOTICE, read only); a later write of either row is checked like any other, and shortening one is always accepted.
--   * It changes no existing table, column, function, policy or grant, and adds no index (schedules_instructor_id_idx serves the check).
--   * Add Schedule is still two statements (series, then schedules). If its schedules are refused after its series were created, those
--     series stay empty and inert, as before; the application checks conflicts before creating series (C2b), so this is left to the
--     rare case where another save wins a race.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE and DROP TRIGGER IF EXISTS. Run it as one transaction.

do $$
begin
  if to_regclass('public.schedules') is null then
    raise exception '0062 needs public.schedules (0009).';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'schedules'
        and column_name in ('id', 'batch_id', 'instructor_id', 'day_of_week', 'start_time', 'end_time',
                            'effective_from', 'effective_until')) <> 8 then
    raise exception '0062 needs the schedules columns id, batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until.';
  end if;
  if to_regprocedure('pg_catalog.hashtextextended(text, bigint)') is null then
    raise exception '0062 needs hashtextextended (PostgreSQL 11 or later).';
  end if;
end
$$;


-- 1. The guard --------------------------------------------------------------------------------------------------------------------

create or replace function public.schedules_instructor_conflict_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_other record;
begin
  -- 1. Narrowing only: same instructor, day and times, and an effective period inside the old one. It cannot create a conflict, so
  --    it is accepted before any lock - deactivation, closing a version, and shortening a schedule that already conflicts.
  if tg_op = 'UPDATE'
     and new.instructor_id = old.instructor_id
     and new.day_of_week   = old.day_of_week
     and new.start_time    = old.start_time
     and new.end_time      = old.end_time
     and new.effective_from >= old.effective_from
     and (old.effective_until is null
          or (new.effective_until is not null and new.effective_until <= old.effective_until)) then
    return null;
  end if;

  -- 2. One check at a time per instructor, to the end of the transaction (see CONCURRENCY in the header).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.schedules:instructor:' || new.instructor_id::text, 0)
  );

  -- 3. Any other row: any batch, any status, any series (other versions of this one included). Back-to-back is not an overlap.
  select s.id, s.batch_id, s.day_of_week, s.start_time, s.end_time, s.effective_from, s.effective_until,
         b.code as batch_code, b.name as batch_name
  into v_other
  from public.schedules s
  left join public.batches b on b.id = s.batch_id
  where s.id <> new.id
    and s.instructor_id = new.instructor_id
    and s.day_of_week   = new.day_of_week
    and s.start_time    < new.end_time
    and new.start_time  < s.end_time
    and pg_catalog.daterange(s.effective_from, s.effective_until, '[]')
        operator(pg_catalog.&&) pg_catalog.daterange(new.effective_from, new.effective_until, '[]')
  order by s.effective_from, s.start_time, s.id
  limit 1;

  if found then
    raise exception 'This instructor already has a class at an overlapping time on that day.'
      using errcode = '23P01',
            detail  = pg_catalog.jsonb_build_object(
              'reason',               'instructor_conflict',
              'conflict_schedule_id', v_other.id,
              'batch_id',             v_other.batch_id,
              'batch_code',           v_other.batch_code,
              'batch_name',           v_other.batch_name,
              'day_of_week',          v_other.day_of_week,
              'start_time',           pg_catalog.substr(v_other.start_time::text, 1, 5),
              'end_time',             pg_catalog.substr(v_other.end_time::text, 1, 5),
              'effective_from',       pg_catalog.to_char(v_other.effective_from, 'YYYY-MM-DD'),
              'effective_until',      pg_catalog.to_char(v_other.effective_until, 'YYYY-MM-DD')
            )::text;
  end if;

  return null;
end;
$$;

comment on function public.schedules_instructor_conflict_guard() is
  'Trigger function: refuses (23P01, the conflicting row''s fields as a JSON object in DETAIL) a schedule row that gives its instructor two classes on the same day with overlapping times during overlapping effective periods. Narrowing updates are accepted without a check. Serialised per instructor by a transaction advisory lock (READ COMMITTED). Existing rows are never changed (0062).';

revoke execute on function public.schedules_instructor_conflict_guard() from public, anon, authenticated;

drop trigger if exists schedules_instructor_conflict_check on public.schedules;
create trigger schedules_instructor_conflict_check
  after insert or update of instructor_id, day_of_week, start_time, end_time, effective_from, effective_until on public.schedules
  for each row
  execute function public.schedules_instructor_conflict_guard();


-- 2. Existing conflicts: reported, never changed ----------------------------------------------------------------------------------

do $$
declare
  v_pairs integer;
begin
  select count(*) into v_pairs
  from public.schedules a
  join public.schedules b
    on  a.id < b.id
    and a.instructor_id = b.instructor_id
    and a.day_of_week   = b.day_of_week
    and a.start_time    < b.end_time
    and b.start_time    < a.end_time
    and pg_catalog.daterange(a.effective_from, a.effective_until, '[]')
        operator(pg_catalog.&&) pg_catalog.daterange(b.effective_from, b.effective_until, '[]');

  if v_pairs > 0 then
    raise notice '0062: % existing conflicting schedule pair(s) were left unchanged. Review them separately (C1 query).', v_pairs;
  end if;
end
$$;
