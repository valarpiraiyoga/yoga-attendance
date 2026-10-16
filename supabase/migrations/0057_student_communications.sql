-- Student communication history with an optional follow-up
--
-- WHY
--   Staff keep a chronological, internal record of their communications with a student (a phone call, a WhatsApp message, an
--   in-person conversation or another channel): when it happened, the type, a subject, the discussion notes, who recorded it and,
--   optionally, a follow-up to do by a date. A pending follow-up can later be marked Completed. This is record keeping only: no
--   message is sent, nothing is integrated with WhatsApp or a phone, and nothing is scheduled or notified.
--
-- WHAT THIS MIGRATION DOES
--   1. public.student_communications - one row per communication, with its optional follow-up on the same row (a follow-up belongs
--      to exactly one communication, so the two stay linked by construction). The follow-up columns are all empty, or all set with
--      a status of 'pending' or 'completed'; completion adds when and by whom, and never changes the original follow-up date or
--      note. Staff attribution is the caller's auth.uid() plus a snapshot of their name and role, written by the functions below -
--      never a client-supplied ID.
--   2. Row-level security: direct SELECT for an Admin only. No INSERT, UPDATE or DELETE privilege is granted: every write goes
--      through the functions below. Scope for both roles is the rule migration 0052 already defines (class_count_student_visible:
--      an Admin sees every student; an active linked Instructor the students with a current active enrollment and assignment on a
--      series they teach, or attendance on a session they own). That function is not executable by `authenticated`, so an
--      Instructor reads through list_student_communications() (6), exactly as 0052 exposes class-count history.
--   3. record_student_communication(...) - creates one communication (and, when given, its pending follow-up) in one statement.
--      The date and time is the centre's local time (centre_timezone()); it cannot be in the future; a follow-up date cannot be
--      before the communication's date. Unauthorized callers and unknown students get the same 42501.
--   4. complete_student_follow_up(communication) - marks a PENDING follow-up Completed (when, by whom). It never creates a new
--      communication. The same authorization; a missing follow-up or one already completed is refused.
--   5. list_student_communications(student) - the student's history, newest first, for the same callers (else 42501).
--
-- WHAT IT DOES NOT DO
--   * It changes no existing table, policy, function or row: students, memberships, payments, invoices, attendance and schedules
--     are untouched.
--   * It does not give an Instructor access to the students table or to anything else; the application's Instructor screens do not
--     use this table yet (Student Details, where it is shown, is Admin only).
--   * Communications are never deleted or edited in V1.
--
-- ORDER OF MIGRATIONS
--   Needs 0006 (students), 0002 (is_admin), 0004 (current_instructor_id), 0024 (centre_timezone) and 0052
--   (class_count_student_visible).
--
-- RE-RUN
--   Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION, then the privileges are set
--   again.

do $$
begin
  if to_regprocedure('public.class_count_student_visible(uuid)') is null then
    raise exception '0057 needs class_count_student_visible (migration 0052).';
  end if;
  if to_regprocedure('public.centre_timezone()') is null then
    raise exception '0057 needs centre_timezone (migration 0024).';
  end if;
end $$;

-- 1. The table -----------------------------------------------------------------------------------------------------------------

create table if not exists public.student_communications (
  id                          uuid primary key default gen_random_uuid(),
  student_id                  uuid not null references public.students (id) on delete restrict,
  communicated_at             timestamptz not null,
  communication_type          text not null
                                check (communication_type in ('phone_call', 'whatsapp', 'in_person', 'other')),
  subject                     text not null check (char_length(btrim(subject)) between 1 and 150),
  notes                       text not null check (char_length(btrim(notes)) between 1 and 4000),
  recorded_by                 uuid references auth.users (id) on delete set null,
  recorded_by_name            text not null,
  recorded_by_role            text not null check (recorded_by_role in ('admin', 'instructor')),
  follow_up_date              date,
  follow_up_note              text check (follow_up_note is null or char_length(btrim(follow_up_note)) between 1 and 1000),
  follow_up_status            text check (follow_up_status in ('pending', 'completed')),
  follow_up_completed_at      timestamptz,
  follow_up_completed_by      uuid references auth.users (id) on delete set null,
  follow_up_completed_by_name text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- No follow-up at all, or a complete one: a date, a note and a status together.
  constraint student_communications_follow_up_complete check (
    (follow_up_date is null and follow_up_note is null and follow_up_status is null
       and follow_up_completed_at is null and follow_up_completed_by is null and follow_up_completed_by_name is null)
    or (follow_up_date is not null and follow_up_note is not null and follow_up_status is not null)
  ),
  -- Pending carries no completion; Completed carries when and by whom (the user may later be deleted: by_name stays).
  constraint student_communications_follow_up_completion check (
    follow_up_status is distinct from 'pending'
      or (follow_up_completed_at is null and follow_up_completed_by is null and follow_up_completed_by_name is null)
  ),
  constraint student_communications_follow_up_completed check (
    follow_up_status is distinct from 'completed'
      or (follow_up_completed_at is not null and follow_up_completed_by_name is not null)
  )
);

comment on table public.student_communications is
  'Internal history of staff communications with a student, each with an optional follow-up (pending or completed). Written only by record_student_communication() and complete_student_follow_up(); never edited or deleted in V1.';
comment on column public.student_communications.communicated_at is
  'When the communication happened (entered as the centre''s local date and time; stored as a timestamp).';
comment on column public.student_communications.recorded_by is
  'auth.uid() of the staff member who recorded it - set by record_student_communication(), never supplied by the client.';
comment on column public.student_communications.recorded_by_name is
  'Snapshot of the recorder''s name when the record was made (an Admin''s profile name, or the Instructor''s name).';
comment on column public.student_communications.follow_up_status is
  'NULL when the communication has no follow-up; otherwise pending or completed. Completing never changes follow_up_date or follow_up_note.';

create index if not exists student_communications_student_time_idx
  on public.student_communications (student_id, communicated_at desc, created_at desc);

-- 2. Privileges and row-level security ------------------------------------------------------------------------------------------

alter table public.student_communications enable row level security;

revoke all on public.student_communications from public, anon, authenticated;
grant select on public.student_communications to authenticated;

-- Direct reads are Admin only. class_count_student_visible is not executable by `authenticated` (0052 revokes it), so an
-- Instructor's scoped read goes through list_student_communications() below, as 0052 does for class-count history.
drop policy if exists "student_communications_select_admin" on public.student_communications;
create policy "student_communications_select_admin"
  on public.student_communications
  for select
  to authenticated
  using (public.is_admin());

-- 3. Who is calling: the staff attribution written onto a record ---------------------------------------------------------------

create or replace function public.student_communication_actor()
returns table (user_id uuid, actor_name text, actor_role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_instructor uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  if public.is_admin() then
    return query
      select auth.uid(), coalesce(nullif(btrim(p.full_name), ''), 'Admin'), 'admin'::text
      from public.profiles p
      where p.id = auth.uid();
    return;
  end if;

  v_instructor := public.current_instructor_id();
  if v_instructor is not null then
    return query
      select auth.uid(), coalesce(nullif(btrim(i.full_name), ''), 'Instructor'), 'instructor'::text
      from public.instructors i
      where i.id = v_instructor;
  end if;
end;
$$;

comment on function public.student_communication_actor() is
  'The calling staff member (Admin, or an active linked Instructor): auth.uid(), a display name and the role. No row for anyone else.';

revoke execute on function public.student_communication_actor() from public, anon, authenticated;

-- 4. Record a communication -------------------------------------------------------------------------------------------------------

create or replace function public.record_student_communication(
  p_student_id      uuid,
  p_communicated_at timestamp,
  p_type            text,
  p_subject         text,
  p_notes           text,
  p_follow_up_date  date default null,
  p_follow_up_note  text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_name   text;
  v_role   text;
  v_tz     text := public.centre_timezone();
  v_at     timestamptz;
  v_has_fu boolean;
  v_id     uuid;
begin
  -- Authorization first, and the same refusal for an unknown student, so a caller learns nothing about students outside their scope.
  -- The actor is read into scalars: for a caller who is not staff the function returns no row and all three stay NULL.
  select a.user_id, a.actor_name, a.actor_role into v_user, v_name, v_role from public.student_communication_actor() a;
  if v_user is null
     or p_student_id is null
     or not exists (select 1 from public.students s where s.id = p_student_id)
     or not public.class_count_student_visible(p_student_id) then
    raise exception 'You are not allowed to record a communication for this student.' using errcode = '42501';
  end if;

  if p_communicated_at is null then
    raise exception 'Enter the date and time of the communication.' using errcode = '22023';
  end if;
  v_at := p_communicated_at at time zone v_tz;
  -- A small allowance for clock differences; a communication that has not happened yet cannot be recorded.
  if v_at > now() + interval '5 minutes' then
    raise exception 'The communication date and time cannot be in the future.' using errcode = '22023';
  end if;

  if p_type is null or p_type not in ('phone_call', 'whatsapp', 'in_person', 'other') then
    raise exception 'Choose the communication type.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 then
    raise exception 'Enter a subject.' using errcode = '22023';
  end if;
  if char_length(btrim(p_subject)) > 150 then
    raise exception 'The subject can be at most 150 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Enter the communication notes.' using errcode = '22023';
  end if;
  if char_length(btrim(p_notes)) > 4000 then
    raise exception 'The notes can be at most 4000 characters.' using errcode = '22023';
  end if;

  v_has_fu := p_follow_up_date is not null or nullif(btrim(coalesce(p_follow_up_note, '')), '') is not null;
  if v_has_fu then
    if p_follow_up_date is null then
      raise exception 'Enter the follow-up date.' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(p_follow_up_note, ''))) = 0 then
      raise exception 'Enter the follow-up note.' using errcode = '22023';
    end if;
    if char_length(btrim(p_follow_up_note)) > 1000 then
      raise exception 'The follow-up note can be at most 1000 characters.' using errcode = '22023';
    end if;
    if p_follow_up_date < (v_at at time zone v_tz)::date then
      raise exception 'The follow-up date cannot be before the communication date.' using errcode = '22023';
    end if;
  end if;

  insert into public.student_communications (
    student_id, communicated_at, communication_type, subject, notes,
    recorded_by, recorded_by_name, recorded_by_role,
    follow_up_date, follow_up_note, follow_up_status
  )
  values (
    p_student_id, v_at, p_type, btrim(p_subject), btrim(p_notes),
    v_user, v_name, v_role,
    case when v_has_fu then p_follow_up_date end,
    case when v_has_fu then btrim(p_follow_up_note) end,
    case when v_has_fu then 'pending' end
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_student_communication(uuid, timestamp, text, text, text, date, text) is
  'Records one communication with a student (Admin, or an Instructor for an authorized student), with an optional pending follow-up. The date and time is the centre''s local time; recorded_by is auth.uid().';

revoke execute on function public.record_student_communication(uuid, timestamp, text, text, text, date, text) from public, anon;
grant execute on function public.record_student_communication(uuid, timestamp, text, text, text, date, text) to authenticated;

-- 5. Complete a follow-up ---------------------------------------------------------------------------------------------------------

create or replace function public.complete_student_follow_up(p_communication_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_name text;
  v_row  public.student_communications%rowtype;
begin
  -- The actor is read into scalars: for a caller who is not staff the function returns no row and both stay NULL. Such a caller is
  -- refused before any row is read or locked.
  select a.user_id, a.actor_name into v_user, v_name from public.student_communication_actor() a;
  if v_user is null then
    raise exception 'You are not allowed to update this follow-up.' using errcode = '42501';
  end if;

  select * into v_row from public.student_communications c where c.id = p_communication_id for update;

  if not found or not public.class_count_student_visible(v_row.student_id) then
    raise exception 'You are not allowed to update this follow-up.' using errcode = '42501';
  end if;

  if v_row.follow_up_status is null then
    raise exception 'This communication has no follow-up.' using errcode = '22023';
  end if;
  if v_row.follow_up_status = 'completed' then
    raise exception 'This follow-up is already completed.' using errcode = '55000';
  end if;

  -- Only the status and the completion columns change: the follow-up date and note are kept exactly as recorded.
  update public.student_communications
  set follow_up_status = 'completed',
      follow_up_completed_at = now(),
      follow_up_completed_by = v_user,
      follow_up_completed_by_name = v_name,
      updated_at = now()
  where id = p_communication_id;
end;
$$;

comment on function public.complete_student_follow_up(uuid) is
  'Marks a pending follow-up Completed (Admin, or an Instructor for an authorized student). Keeps the follow-up date and note; records when and by whom; creates no new communication.';

revoke execute on function public.complete_student_follow_up(uuid) from public, anon;
grant execute on function public.complete_student_follow_up(uuid) to authenticated;

-- 6. Read a student's history -------------------------------------------------------------------------------------------------------

create or replace function public.list_student_communications(p_student_id uuid)
returns setof public.student_communications
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or p_student_id is null
     or not exists (select 1 from public.students s where s.id = p_student_id)
     or not public.class_count_student_visible(p_student_id) then
    raise exception 'You are not allowed to view communications for this student.' using errcode = '42501';
  end if;

  -- Newest first; created_at and id break ties so the order is stable.
  return query
    select c.*
    from public.student_communications c
    where c.student_id = p_student_id
    order by c.communicated_at desc, c.created_at desc, c.id desc;
end;
$$;

comment on function public.list_student_communications(uuid) is
  'A student''s communications, newest first (Admin, or an Instructor for an authorized student; otherwise 42501).';

revoke execute on function public.list_student_communications(uuid) from public, anon;
grant execute on function public.list_student_communications(uuid) to authenticated;
