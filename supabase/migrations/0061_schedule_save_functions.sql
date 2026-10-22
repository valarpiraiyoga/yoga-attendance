-- Atomic Edit Schedule saves: one transaction for the capacity, the schedule change and every "Also creates" day
--
-- WHY
--   Saving an Edit Schedule was a sequence of separate calls from the application - set the series capacity, update the schedule or
--   close it and insert a new version, then create a series and a schedule for each extra day - and PostgREST cannot group calls into
--   a transaction. A failure between two calls left a partial save: a capacity changed under a failure message (the application's
--   put-it-back was best effort), an old version closed with no successor (its revert's result was never checked), extra days missing,
--   or a resubmission that closed and versioned the schedule twice. These two functions make each save all-or-nothing: any failure
--   rolls back every write of the call, so "it failed" always means "nothing was saved" and a retry is safe.
--
-- WHAT THIS MIGRATION DOES
--   1. save_schedule_edit(...)  - Edit Schedule, including "Also creates". Admin only. In one transaction it:
--        - locks the schedule and its series, and refuses an effective date in the past (22023, the application's own message);
--        - sets the series capacity ONLY when p_set_capacity is true (true with a NULL capacity is an explicit "unlimited"; false
--          leaves the stored capacity alone whatever p_capacity holds). 0060's guard refuses a value below the places taken (23514);
--        - updates the schedule in place when the effective date is on or before the current version's own start, otherwise closes
--          the current version the day before and inserts the new version on the SAME series - exactly the application's rule
--          (01-product.md section 7, "Future Changes");
--        - creates, for every extra weekday, a new series that starts with the capacity being saved (or, when none was supplied, the
--          series' stored capacity) and a new schedule with this edit's instructor, times and dates.
--      Returns {id, ids, added}: the saved schedule's id, the ids whose pages to refresh, and the number of extra days created.
--   2. save_unused_schedule_edit(...) - Direct Edit of an unused schedule. Admin only. The same capacity and extra-day handling around
--      the EXISTING correct_unused_schedule (0021/0024), called inside the same transaction, so its checks and its errors (22023
--      with a reason in DETAIL, P0002) are unchanged and a refusal rolls the capacity and the extras back with it.
--      Returns {id, batch_id, added}.
--   3. Two internal helpers - schedule_series_apply_capacity and schedule_add_extra_days - shared by both, not callable by clients.
--
-- WHAT IT DOES NOT DO
--   * It changes no existing row, function, trigger, policy or grant. 0060 and correct_unused_schedule are used, not edited.
--   * It adds no table or column. Capacity rules (1-1000 or unlimited, never below the places taken) are 0060's, enforced by its CHECK
--     and guard whichever way the capacity is written. Enrollment functions and capacity are untouched.
--   * Add Schedule is not changed (its series and schedule inserts stay two statements; a failure between them leaves only empty,
--     inert series).
--   * Validation that belongs to the form (an instructor chosen, valid times, until not before from) stays in the application and in
--     the tables' CHECK constraints; the not-in-the-past rule is repeated here because it protects history.
--
-- LOCK ORDER (READ COMMITTED - the default, and what PostgREST uses)
--   Each function takes the schedule row first (FOR UPDATE), then its series row. That is the order correct_unused_schedule and
--   delete_unused_schedule (0021/0024) already use, so the three never wait on each other in opposite orders.
--     * save_schedule_edit locks the series FOR NO KEY UPDATE: it changes only the capacity, never a key, and this is the level the
--       enrollment functions of 0060 take (in series id order). Two of them on one series therefore serialise, so a capacity change and
--       an enrollment cannot interleave, and the capacity guard counts the places taken after any earlier enrollment has committed.
--       Foreign-key checks (FOR KEY SHARE) of other writers do not conflict with it.
--     * save_unused_schedule_edit locks the series FOR UPDATE, as correct_unused_schedule does, so that delegating to it needs no lock
--       upgrade: it already holds what that function asks for. This is stronger than NO KEY UPDATE: while it holds the series, an
--       enrollment function waits (its assignment insert needs a KEY SHARE on the series).
--     * The enrollment functions never lock a schedules row and take only series rows, so no path holds a series row while waiting for
--       a schedules row that an edit holds; the lock graph has no cycle. Extra-day series and schedules are new rows no other
--       transaction can reach before commit. Nothing fires on writes to schedules, and the only trigger on schedule_series is 0060's
--       capacity guard, which reads occupancy without taking locks.
--     * Two edits of ONE schedule serialise on its schedule row. Edits of different schedules take different rows and do not wait.
--   This is analysis, not a measurement: the two-session check is in the verification script's header.
--
-- RE-RUN
--   Idempotent: CREATE OR REPLACE throughout. Run it as one transaction.

do $$
begin
  if to_regprocedure('public.correct_unused_schedule(uuid, text, uuid, time without time zone, time without time zone, date, date)') is null then
    raise exception '0061 needs public.correct_unused_schedule (0021/0024).';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'schedule_series' and column_name = 'capacity') then
    raise exception '0061 needs schedule_series.capacity (0060).';
  end if;
  if to_regprocedure('public.centre_timezone()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '0061 needs public.centre_timezone() (0024) and public.is_admin().';
  end if;
end
$$;


-- 1. Internal helpers --------------------------------------------------------------------------------------------------------------

-- Sets a series' capacity when p_set is true and returns the capacity new schedules on extra days should start with: the capacity
-- just set (NULL = unlimited), or - when none was supplied - the stored one. The write fires 0060's capacity guard.
create or replace function public.schedule_series_apply_capacity(p_series_id uuid, p_set boolean, p_capacity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
begin
  if coalesce(p_set, false) then
    update public.schedule_series
    set capacity = p_capacity
    where id = p_series_id
      and capacity is distinct from p_capacity;
    return p_capacity;
  end if;

  select ss.capacity into v_capacity from public.schedule_series ss where ss.id = p_series_id;
  return v_capacity;
end;
$$;

comment on function public.schedule_series_apply_capacity(uuid, boolean, integer) is
  'Sets a schedule series'' capacity only when p_set is true (NULL = unlimited) and returns the capacity new schedules on extra days start with. Internal to save_schedule_edit / save_unused_schedule_edit (0061).';

revoke execute on function public.schedule_series_apply_capacity(uuid, boolean, integer) from public, anon, authenticated;

-- Creates, for each extra weekday, a new series (starting with p_capacity) and a new schedule on it. A repeated day is created once; the
-- schedule's own day, an empty day or an invalid weekday is refused, which rolls the whole save back.
create or replace function public.schedule_add_extra_days(
  p_batch_id        uuid,
  p_instructor_id   uuid,
  p_start_time      time,
  p_end_time        time,
  p_effective_from  date,
  p_effective_until date,
  p_capacity        integer,
  p_own_day         text,
  p_days            text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day    text;
  v_done   text[] := '{}';
  v_series uuid;
  v_added  integer := 0;
begin
  foreach v_day in array coalesce(p_days, '{}'::text[]) loop
    if v_day is null or btrim(v_day) = '' then
      raise exception 'Select valid days of the week.' using errcode = '22023';
    end if;
    if v_day = p_own_day then
      raise exception 'An extra day cannot be this schedule''s own day.' using errcode = '22023';
    end if;

    continue when v_day = any(v_done);
    v_done := v_done || v_day;

    insert into public.schedule_series (batch_id, capacity)
    values (p_batch_id, p_capacity)
    returning id into v_series;

    insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, series_id)
    values (p_batch_id, p_instructor_id, v_day, p_start_time, p_end_time, p_effective_from, p_effective_until, v_series);

    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

comment on function public.schedule_add_extra_days(uuid, uuid, time, time, date, date, integer, text, text[]) is
  'Creates a new schedule series (with the given capacity) and schedule for each extra weekday of an Edit Schedule save. Internal to save_schedule_edit / save_unused_schedule_edit (0061).';

revoke execute on function public.schedule_add_extra_days(uuid, uuid, time, time, date, date, integer, text, text[]) from public, anon, authenticated;


-- 2. Edit Schedule (versioned or in place) -------------------------------------------------------------------------------------------

create or replace function public.save_schedule_edit(
  p_schedule_id     uuid,
  p_instructor_id   uuid,
  p_start_time      time,
  p_end_time        time,
  p_effective_from  date,
  p_effective_until date,
  p_set_capacity    boolean,
  p_capacity        integer,
  p_extra_days      text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_inherit  integer;
  v_saved    uuid;
  v_ids      jsonb;
  v_added    integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Schedule row first, then its series: the order correct_unused_schedule uses. NO KEY UPDATE on the series: only the capacity changes.
  select * into v_schedule
  from public.schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.schedule_series
  where id = v_schedule.series_id
  for no key update;

  if p_effective_from is null then
    raise exception 'Effective from is required.' using errcode = '22023';
  end if;
  -- A change can never be back-dated: it would rewrite what was scheduled on a day that has passed (01-product.md section 12).
  if p_effective_from < v_today then
    raise exception 'Effective from cannot be in the past.' using errcode = '22023';
  end if;

  -- The capacity applies at once and is not versioned. 0060's guard refuses a value below the places taken, which rolls everything back.
  v_inherit := public.schedule_series_apply_capacity(v_schedule.series_id, p_set_capacity, p_capacity);

  if p_effective_from <= v_schedule.effective_from then
    -- No live period exists yet under the current version: update it in place rather than version it into an invalid closed row.
    update public.schedules
    set instructor_id   = p_instructor_id,
        start_time      = p_start_time,
        end_time        = p_end_time,
        effective_from  = p_effective_from,
        effective_until = p_effective_until,
        updated_at      = now()
    where id = p_schedule_id;

    v_saved := p_schedule_id;
    v_ids := jsonb_build_array(p_schedule_id);
  else
    -- Close the current version the day before the change, then continue the SAME series with the new version (a new series would
    -- detach every student assignment and every past class session from it).
    update public.schedules
    set effective_until = p_effective_from - 1,
        updated_at      = now()
    where id = p_schedule_id;

    insert into public.schedules (batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, series_id)
    values (v_schedule.batch_id, p_instructor_id, v_schedule.day_of_week, p_start_time, p_end_time, p_effective_from, p_effective_until, v_schedule.series_id)
    returning id into v_saved;

    v_ids := jsonb_build_array(p_schedule_id, v_saved);
  end if;

  v_added := public.schedule_add_extra_days(
    v_schedule.batch_id, p_instructor_id, p_start_time, p_end_time, p_effective_from, p_effective_until,
    v_inherit, v_schedule.day_of_week, p_extra_days
  );

  return jsonb_build_object('id', v_saved, 'ids', v_ids, 'added', v_added);
end;
$$;

comment on function public.save_schedule_edit(uuid, uuid, time, time, date, date, boolean, integer, text[]) is
  'Admin only. Saves an Edit Schedule in one transaction: the series capacity (only when p_set_capacity), the in-place update or the close-and-new-version of the schedule, and a new series and schedule for every extra day (starting with the capacity being saved). Any failure writes nothing. Returns {id, ids, added} (0061).';

revoke execute on function public.save_schedule_edit(uuid, uuid, time, time, date, date, boolean, integer, text[]) from public, anon;
grant execute on function public.save_schedule_edit(uuid, uuid, time, time, date, date, boolean, integer, text[]) to authenticated;


-- 3. Direct Edit of an unused schedule -----------------------------------------------------------------------------------------------

create or replace function public.save_unused_schedule_edit(
  p_schedule_id     uuid,
  p_day_of_week     text,
  p_instructor_id   uuid,
  p_start_time      time,
  p_end_time        time,
  p_effective_from  date,
  p_effective_until date,
  p_set_capacity    boolean,
  p_capacity        integer,
  p_extra_days      text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_inherit  integer;
  v_added    integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- The same two locks, in the same order and at the same level, that correct_unused_schedule takes: delegating to it re-acquires what
  -- is already held, so there is no lock upgrade to wait on.
  select * into v_schedule
  from public.schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.schedule_series
  where id = v_schedule.series_id
  for update;

  v_inherit := public.schedule_series_apply_capacity(v_schedule.series_id, p_set_capacity, p_capacity);

  -- The existing correction: it re-checks "unused" under its locks and raises 22023 (reason in DETAIL) if the schedule has gained
  -- history. Because it runs in this transaction, that refusal also rolls the capacity back.
  perform public.correct_unused_schedule(
    p_schedule_id, p_day_of_week, p_instructor_id, p_start_time, p_end_time, p_effective_from, p_effective_until
  );

  v_added := public.schedule_add_extra_days(
    v_schedule.batch_id, p_instructor_id, p_start_time, p_end_time, p_effective_from, p_effective_until,
    v_inherit, p_day_of_week, p_extra_days
  );

  return jsonb_build_object('id', p_schedule_id, 'batch_id', v_schedule.batch_id, 'added', v_added);
end;
$$;

comment on function public.save_unused_schedule_edit(uuid, text, uuid, time, time, date, date, boolean, integer, text[]) is
  'Admin only. Saves a Direct Edit of an unused schedule in one transaction: the series capacity (only when p_set_capacity), the existing correct_unused_schedule, and a new series and schedule for every extra day (starting with the capacity being saved). A refusal by correct_unused_schedule (22023, P0002) or any other failure writes nothing. Returns {id, batch_id, added} (0061).';

revoke execute on function public.save_unused_schedule_edit(uuid, text, uuid, time, time, date, date, boolean, integer, text[]) from public, anon;
grant execute on function public.save_unused_schedule_edit(uuid, text, uuid, time, time, date, date, boolean, integer, text[]) to authenticated;
