-- Center Regional Settings: time zone, currency and logo.
--
-- The product started as one centre in India, so two things were fixed in the
-- code: the centre's clock (Asia/Kolkata) and its money (INR). A centre in
-- another country needs both to be its own. This migration makes them Center
-- Settings on the existing single-row `center_profile` (0018):
--
--   timezone   IANA identifier ("Asia/Kolkata", "America/New_York") - never an
--              abbreviation or offset, which cannot describe daylight saving.
--              Not null, default 'Asia/Kolkata'.
--   currency   ISO 4217 code ("INR"), never a symbol. Not null, default 'INR'.
--              It controls how amounts are DISPLAYED; no amount is ever
--              converted.
--   logo_url   already exists (0018, nullable); now written by the Center
--              Profile logo upload. The image lives in the existing
--              `profile-photos` bucket under a `center/` folder (admin-only
--              writes, 2 MB JPEG / PNG / WebP - 0019), so no new bucket or
--              storage policy is needed.
--
-- The existing centre is migrated by the column defaults alone: its row
-- becomes timezone = 'Asia/Kolkata' and currency = 'INR' - exactly what the
-- application has always assumed - and no date, attendance, schedule,
-- membership or student row is touched.
--
-- Money: `memberships.amount` has never had a currency of its own, so changing
-- the centre currency would silently re-label every past amount. Each
-- membership therefore records the currency it was priced in. Existing rows
-- become 'INR' (true: the centre has only ever charged in INR); new ones are
-- stamped with the centre's currency when they are created. Amounts are not
-- changed.
--
-- Time zone in the database: attendance eligibility, "today" in
-- save_session_attendance, and the schedule delete / correct checks read
-- "today" and a membership's cancellation day at the centre. They hard-coded
-- 'Asia/Kolkata'; they now call public.centre_timezone(), so the database and
-- the application always agree on the centre's day. Those functions (and the
-- one RLS policy) are re-created below with that single change - their logic,
-- signatures, grants and comments are untouched.

-- Settings columns --------------------------------------------------------------

alter table public.center_profile
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists currency text not null default 'INR';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'center_profile_currency_format') then
    alter table public.center_profile
      add constraint center_profile_currency_format check (currency ~ '^[A-Z]{3}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'memberships_currency_format') then
    alter table public.memberships
      add column if not exists currency text not null default 'INR';
    alter table public.memberships
      add constraint memberships_currency_format check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.center_profile.timezone is
  'The centre''s IANA time zone (e.g. Asia/Kolkata). The business timezone for every date and session the app derives; never the user''s or browser''s.';
comment on column public.center_profile.currency is
  'ISO 4217 currency code new memberships are priced in (e.g. INR). Display only - amounts are never converted.';
comment on column public.center_profile.logo_url is
  'Public URL of the centre logo in the profile-photos bucket (center/ folder). Null when none has been uploaded.';
comment on column public.memberships.currency is
  'ISO 4217 code the amount was priced in, stamped from the centre currency when the membership was created. Existing rows are INR.';

-- A time zone must be one Postgres knows, in Area/Location form (or UTC) - not
-- "IST" or "+05:30". A trigger rather than a CHECK, because it reads
-- pg_timezone_names.

create or replace function public.center_profile_validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone !~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+)+)$'
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists center_profile_timezone_valid on public.center_profile;
create trigger center_profile_timezone_valid
  before insert or update of timezone on public.center_profile
  for each row execute function public.center_profile_validate_timezone();

-- Reading the settings ------------------------------------------------------------
-- center_profile itself stays admin-only (0018). Instructors need the centre's
-- time zone (their sessions are dated by it) and the shell needs its name and
-- logo, so these two security-definer functions expose ONLY those fields - not
-- the address, phone or email - to any signed-in user.

create or replace function public.centre_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select cp.timezone from public.center_profile cp where cp.singleton), 'Asia/Kolkata');
$$;

create or replace function public.center_settings()
returns table (name text, logo_url text, timezone text, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.name, cp.logo_url, cp.timezone, cp.currency
  from public.center_profile cp
  where cp.singleton;
$$;

comment on function public.centre_timezone() is
  'The centre''s IANA time zone (Center Settings). Used wherever the database needs the centre''s day.';
comment on function public.center_settings() is
  'The centre''s name, logo, time zone and currency - the non-sensitive Center Settings any signed-in user may read.';

revoke execute on function public.centre_timezone() from public, anon;
revoke execute on function public.center_settings() from public, anon;
grant execute on function public.centre_timezone() to authenticated;
grant execute on function public.center_settings() to authenticated;

-- Functions and policy that used the fixed zone ---------------------------------------
-- Re-created from their latest definitions (0015, 0021, 0020) with
-- 'Asia/Kolkata' replaced by public.centre_timezone(). Nothing else changes.

create or replace function public.resolve_eligible_students(
  p_batch_id uuid,
  p_schedule_id uuid,
  p_session_date date
)
returns table (
  student_id uuid,
  full_name text,
  phone text,
  student_code text,
  membership_start_date date,
  membership_end_date date
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_series_id uuid;
  v_class_session_id uuid;
  v_snapshot_at timestamptz;
begin
  if not (public.is_admin() or public.can_access_session(p_schedule_id, p_session_date)) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Phase 16A: a frozen set wins over any live recomputation. Looked up by
  -- (schedule_id, session_date) — the same pair class_sessions_schedule_date_unique
  -- already treats as this table's natural key, and the only address a
  -- projected occurrence would have.
  select cs.id, cs.eligibility_snapshot_at
    into v_class_session_id, v_snapshot_at
  from public.class_sessions cs
  where cs.schedule_id = p_schedule_id
    and cs.session_date = p_session_date;

  if v_snapshot_at is not null then
    return query
    select
      e.student_id,
      s.full_name,
      s.phone,
      s.student_code,
      e.membership_start_date,
      e.membership_end_date
    from public.class_session_eligible_students e
    join public.students s on s.id = e.student_id
    where e.class_session_id = v_class_session_id;

    return;
  end if;

  -- No snapshot: unchanged live resolution (0014 body, carried over).
  select series_id into v_series_id
  from public.schedules
  where id = p_schedule_id;

  if v_series_id is null then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  return query
  select distinct on (be.student_id)
    be.student_id,
    s.full_name,
    s.phone,
    s.student_code,
    m.start_date as membership_start_date,
    m.end_date as membership_end_date
  from public.batch_enrollments be
  join public.students s on s.id = be.student_id
  join public.memberships m on m.student_id = be.student_id
  where be.batch_id = p_batch_id
    -- D2: enrollment must be active and cover the session date.
    and be.status = 'active'
    and be.effective_start_date <= p_session_date
    and (be.effective_end_date is null or be.effective_end_date >= p_session_date)
    -- D1: inactive students are excluded from new eligibility. Reads the
    -- student's *current* status — students has no status-history model,
    -- unlike enrollment/membership, which are both date-ranged.
    and s.status = 'active'
    -- Phase 15A: the enrollment must carry a schedule assignment on this
    -- session's own schedule series, covering the session date. Being
    -- enrolled in the batch is not sufficient on its own.
    and exists (
      select 1
      from public.enrollment_schedules es
      where es.batch_enrollment_id = be.id
        and es.schedule_series_id = v_series_id
        and es.effective_start_date <= p_session_date
        and (es.effective_end_date is null or es.effective_end_date >= p_session_date)
    )
    -- D3: a membership covers the session date if it was not yet cancelled
    -- as of that date. Cancelling a membership today must not retroactively
    -- invalidate eligibility for an earlier session date — only dates
    -- on/after the cancellation are excluded.
    and m.start_date <= p_session_date
    and m.end_date >= p_session_date
    and (m.cancelled_at is null or p_session_date < (m.cancelled_at at time zone public.centre_timezone())::date)
  -- Tie-break (unchanged from 0012): prefer a membership not cancelled as of
  -- the session date, then the most recently started.
  order by be.student_id, (m.cancelled_at is null) desc, m.start_date desc;
end;
$$;

create or replace function public.save_session_attendance(
  p_class_session_id uuid,
  p_marks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session          public.class_sessions%rowtype;
  v_instructor_id    uuid;
  v_is_admin         boolean;
  v_today            date;
  v_mark             jsonb;
  v_student_id       uuid;
  v_status           text;
  v_eligible_ids     uuid[];
  v_submitted_ids    uuid[];
  v_invalid_ids      uuid[];
  v_marked_count     integer := 0;
begin
  v_is_admin := public.is_admin();
  v_instructor_id := public.current_instructor_id();

  -- Rejected before anything is read: not an admin, and not a linked,
  -- active instructor. A deactivated or unlinked instructor stops here.
  if not v_is_admin and v_instructor_id is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 1. The session must exist. `for update` holds the row lock for the
  -- rest of this transaction, so a concurrent call against the same
  -- session (another save, or Flow 07's markSessionException) cannot
  -- interleave with this one — which is also what makes the snapshot
  -- write below safe against a double first-save.
  select *
  into v_session
  from public.class_sessions
  where id = p_class_session_id
  for update;

  if not found then
    raise exception 'Class session not found.' using errcode = 'P0002';
  end if;

  -- 1b. Snapshot ownership (approved decision Q2): an instructor may only
  -- save attendance for a session whose own instructor_id is theirs. An
  -- admin skips this entirely.
  if not v_is_admin and v_session.instructor_id <> v_instructor_id then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- 2. Cancelled/Holiday sessions do not take attendance (01-product.md §8
  -- "Cancelled / Holiday").
  if v_session.status in ('cancelled', 'holiday') then
    raise exception 'Cancelled or Holiday sessions do not take attendance.' using errcode = '22023';
  end if;

  -- 3. Future sessions are rejected (approved decision D5), evaluated
  -- against the centre timezone, matching every other centre timezone-derived
  -- check in this product (01-product.md §7A "Centre Timezone").
  v_today := (now() at time zone public.centre_timezone())::date;
  if v_session.session_date > v_today then
    raise exception 'Attendance cannot be taken for a future session.' using errcode = '22023';
  end if;

  -- 3b. Phase 16A: freeze the eligible set on the save that first completes
  -- this session. Zero eligible students inserts zero rows and still stamps
  -- the marker — an empty snapshot is a real answer, distinct from having
  -- no snapshot at all.
  if v_session.eligibility_snapshot_at is null and v_session.status <> 'completed' then
    insert into public.class_session_eligible_students (
      class_session_id, student_id, membership_start_date, membership_end_date, provenance
    )
    select
      p_class_session_id,
      r.student_id,
      r.membership_start_date,
      r.membership_end_date,
      'save'
    from public.resolve_eligible_students(v_session.batch_id, v_session.schedule_id, v_session.session_date) r
    on conflict (class_session_id, student_id) do nothing;

    update public.class_sessions
    set eligibility_snapshot_at = now()
    where id = p_class_session_id
      and eligibility_snapshot_at is null;
  end if;

  -- 4. Resolve eligible students for this session's own batch, schedule
  -- and date — schedule-scoped (Phase 15A), using the session's snapshot
  -- batch_id and schedule_id (authoritative per §7A), never the schedule's
  -- current batch. As of Phase 16A this returns the frozen set whenever one
  -- exists — including the one just written above — so a correction is
  -- validated against the session's own history rather than against who
  -- happens to be enrolled today. auth.uid() is a request GUC, not a role,
  -- so the nested call still authorizes the original caller.
  select coalesce(array_agg(student_id), '{}')
  into v_eligible_ids
  from public.resolve_eligible_students(v_session.batch_id, v_session.schedule_id, v_session.session_date);

  select coalesce(array_agg((mark->>'student_id')::uuid), '{}')
  into v_submitted_ids
  from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) as mark;

  -- 5. Every submitted student must be eligible. Rejecting the whole call
  -- rather than silently dropping the ineligible ones — a caller that
  -- submitted a mark for the wrong student has a bug worth surfacing, not
  -- papering over.
  select array_agg(sid)
  into v_invalid_ids
  from unnest(v_submitted_ids) as sid
  where sid <> all (v_eligible_ids);

  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'One or more students are not eligible for this session.' using errcode = '22023';
  end if;

  -- 6. Upsert Present/Absent for exactly the submitted students.
  -- 8. A student with no entry in p_marks gets no row — unmarked is
  -- represented by absence, never by a stored value.
  -- 9. Never deletes: an existing row for a student not resubmitted this
  -- time is left exactly as it was.
  for v_mark in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    v_student_id := (v_mark->>'student_id')::uuid;
    v_status := v_mark->>'status';

    if v_status not in ('present', 'absent') then
      raise exception 'Invalid attendance status: %', v_status using errcode = '22023';
    end if;

    insert into public.attendance (class_session_id, student_id, status)
    values (p_class_session_id, v_student_id, v_status)
    on conflict (class_session_id, student_id)
    do update set status = excluded.status, updated_at = now();

    v_marked_count := v_marked_count + 1;
  end loop;

  -- 7. Saving completes the session — unconditionally, even with zero or
  -- partial marks (approved decision D10).
  update public.class_sessions
  set status = 'completed'
  where id = p_class_session_id;

  -- 10.
  return jsonb_build_object(
    'success', true,
    'class_session_id', p_class_session_id,
    'eligible_count', coalesce(array_length(v_eligible_ids, 1), 0),
    'marked_count', v_marked_count
  );
end;
$$;

create or replace function public.schedule_usage(
  p_schedule_id uuid,
  p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule            public.schedules%rowtype;
  v_today               date;
  v_session_count       integer;
  v_past_session_count  integer;
  v_version_count       integer;
  v_started             integer;
  v_unstarted           integer;
  v_students            integer;
  v_elapsed             integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_schedule
  from public.schedules
  where id = p_schedule_id;

  if not found then
    raise exception 'Schedule not found.' using errcode = 'P0002';
  end if;

  v_today := coalesce(p_today, (now() at time zone public.centre_timezone())::date);

  select count(*) into v_version_count
  from public.schedules
  where series_id = v_schedule.series_id;

  -- Any version of the series, though a single-version series is the only
  -- one that can ever be deleted.
  select count(*), count(*) filter (where cs.session_date < v_today)
  into v_session_count, v_past_session_count
  from public.class_sessions cs
  join public.schedules s on s.id = cs.schedule_id
  where s.series_id = v_schedule.series_id;

  select
    count(*) filter (where es.effective_start_date <  v_today),
    count(*) filter (where es.effective_start_date >= v_today),
    count(distinct be.student_id) filter (where es.effective_start_date >= v_today)
  into v_started, v_unstarted, v_students
  from public.enrollment_schedules es
  join public.batch_enrollments be on be.id = es.batch_enrollment_id
  where es.schedule_series_id = v_schedule.series_id;

  -- timestamp (not timestamptz) so extract(dow) does not depend on the
  -- session time zone. An empty range (effective_from after yesterday)
  -- simply yields zero rows.
  select count(*) into v_elapsed
  from generate_series(
         v_schedule.effective_from::timestamp,
         least(coalesce(v_schedule.effective_until, v_today - 1), v_today - 1)::timestamp,
         interval '1 day'
       ) as g(d)
  where (array['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
          [extract(dow from g.d)::int + 1] = v_schedule.day_of_week;

  return jsonb_build_object(
    'schedule_id', v_schedule.id,
    'series_id', v_schedule.series_id,
    'batch_id', v_schedule.batch_id,
    'day_of_week', v_schedule.day_of_week,
    'start_time', v_schedule.start_time,
    'end_time', v_schedule.end_time,
    'session_count', v_session_count,
    'version_count', v_version_count,
    'started_assignment_count', v_started,
    'unstarted_assignment_count', v_unstarted,
    'affected_student_count', v_students,
    'unrecorded_past_occurrence_count', greatest(v_elapsed - v_past_session_count, 0),
    'today', v_today
  );
end;
$$;

create or replace function public.delete_unused_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule   public.schedules%rowtype;
  v_today      date;
  v_usage      jsonb;
  v_withdrawn  integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Lock the schedule, then its series (always in this order). From here to
  -- commit no session, version or assignment can be added to either.
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

  v_today := (now() at time zone public.centre_timezone())::date;

  -- Re-check under the locks. Reasons are reported in DETAIL so the
  -- application can say which condition failed.
  v_usage := public.schedule_usage(p_schedule_id, v_today);

  if (v_usage ->> 'session_count')::int > 0 then
    raise exception 'This schedule has session history and cannot be deleted.'
      using errcode = '22023', detail = 'sessions';
  end if;

  if (v_usage ->> 'version_count')::int > 1 then
    raise exception 'This schedule has earlier versions and cannot be deleted.'
      using errcode = '22023', detail = 'versions';
  end if;

  if (v_usage ->> 'started_assignment_count')::int > 0 then
    raise exception 'Students have already been assigned to this schedule, so it cannot be deleted.'
      using errcode = '22023', detail = 'started_assignments';
  end if;

  -- Only assignments that have not started — the same predicate as
  -- enrollment_schedules_delete_unstarted_admin (0020). By the check above
  -- every remaining assignment is one of these.
  delete from public.enrollment_schedules
  where schedule_series_id = v_schedule.series_id
    and effective_start_date >= v_today;
  get diagnostics v_withdrawn = row_count;

  delete from public.schedules
  where id = p_schedule_id;

  -- The series is deleted only when nothing is left on it (it was the only
  -- version, so nothing is) — restrict foreign keys would refuse otherwise.
  delete from public.schedule_series ss
  where ss.id = v_schedule.series_id
    and not exists (select 1 from public.schedules s where s.series_id = ss.id);

  return jsonb_build_object(
    'success', true,
    'batch_id', v_schedule.batch_id,
    'withdrawn_assignments', v_withdrawn
  );
end;
$$;

create or replace function public.correct_unused_schedule(
  p_schedule_id     uuid,
  p_day_of_week     text,
  p_instructor_id   uuid,
  p_start_time      time,
  p_end_time        time,
  p_effective_from  date,
  p_effective_until date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule  public.schedules%rowtype;
  v_today     date;
  v_usage     jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

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

  v_today := (now() at time zone public.centre_timezone())::date;
  v_usage := public.schedule_usage(p_schedule_id, v_today);

  if (v_usage ->> 'session_count')::int > 0 then
    raise exception 'This schedule has session history and cannot be edited directly.'
      using errcode = '22023', detail = 'sessions';
  end if;

  if (v_usage ->> 'version_count')::int > 1 then
    raise exception 'This schedule has earlier versions and cannot be edited directly.'
      using errcode = '22023', detail = 'versions';
  end if;

  if (v_usage ->> 'started_assignment_count')::int > 0 then
    raise exception 'Students have already been assigned to this schedule, so it cannot be edited directly.'
      using errcode = '22023', detail = 'started_assignments';
  end if;

  -- Column CHECKs still apply: valid weekday, end after start, until not
  -- before from. Status is untouched (Deactivate is its own action).
  update public.schedules
  set day_of_week     = p_day_of_week,
      instructor_id   = p_instructor_id,
      start_time      = p_start_time,
      end_time        = p_end_time,
      effective_from  = p_effective_from,
      effective_until = p_effective_until,
      updated_at      = now()
  where id = p_schedule_id;

  return jsonb_build_object(
    'success', true,
    'id', v_schedule.id,
    'batch_id', v_schedule.batch_id
  );
end;
$$;

-- 0020: withdrawing a not-yet-started schedule assignment - "today" at the centre.

drop policy if exists "enrollment_schedules_delete_unstarted_admin" on public.enrollment_schedules;
create policy "enrollment_schedules_delete_unstarted_admin"
  on public.enrollment_schedules
  for delete
  using (
    public.is_admin()
    and effective_start_date >= (timezone(public.centre_timezone(), now()))::date
  );
