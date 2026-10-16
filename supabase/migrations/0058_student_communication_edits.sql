-- Edit Communication for the student communication history
--
-- WHY
--   Staff need to correct a communication they recorded (a wrong time, type, subject or note) and to change or drop a follow-up
--   that is still pending. Migration 0057 made the table write-only through functions and deliberately granted no UPDATE, so an
--   edit needs its own function. The original record must stay identifiable as the original: same id, same recorder, same
--   recorded time; and a follow-up that has been COMPLETED is part of the record of what was done and must not be rewritten.
--
-- WHAT THIS MIGRATION DOES
--   1. Three columns on public.student_communications: edited_at, edited_by (auth.uid()) and edited_by_name (a snapshot), set by
--      the edit function only - all NULL until the first edit, and set together.
--   2. update_student_communication(...) - edits one communication in place, under a row lock:
--        * The same authorization as 0057 (an Admin, or an active linked Instructor for a student authorized by the 0052 rule); a
--          caller who is not staff, an unknown communication and one outside the caller's scope get the same 42501.
--        * The same validation as record_student_communication: the date and time is the centre's local time and not in the
--          future; the type is one of the four; subject and notes required with the same limits; a follow-up needs a date and a
--          note and its date cannot be before the communication's date.
--        * No follow-up yet: one can be added (Pending). A PENDING follow-up: its date and note can be changed, or it can be
--          removed. A COMPLETED follow-up: kept exactly as it is - it cannot be removed (55000) and its date and note cannot be
--          changed (55000); its status, completion time and completion staff are never touched by an edit.
--        * id, student_id, recorded_by, recorded_by_name, recorded_by_role and created_at are never changed.
--        * An edit that changes nothing writes nothing (no edit stamp).
--
-- WHAT IT DOES NOT DO
--   * It changes no other table, and no existing function, policy or grant: record_student_communication,
--     complete_student_follow_up, list_student_communications (it returns the new columns with the rest of the row) and the
--     Admin-only SELECT policy stay as 0057 created them. There is still no direct INSERT, UPDATE or DELETE privilege.
--   * It keeps no history of earlier values (only who edited last, and when). Communications are still never deleted.
--   * It changes no row.
--
-- ORDER OF MIGRATIONS
--   Needs 0057 (the table, student_communication_actor) and 0052 (class_count_student_visible).
--
-- RE-RUN
--   Idempotent: ADD COLUMN IF NOT EXISTS, the constraint is dropped and re-added, CREATE OR REPLACE FUNCTION, then the privileges
--   are set again.

do $$
begin
  if to_regclass('public.student_communications') is null
     or to_regprocedure('public.student_communication_actor()') is null then
    raise exception '0058 needs migration 0057 (student_communications).';
  end if;
  if to_regprocedure('public.class_count_student_visible(uuid)') is null then
    raise exception '0058 needs class_count_student_visible (migration 0052).';
  end if;
end $$;

-- 1. Who edited, and when ------------------------------------------------------------------------------------------------------

alter table public.student_communications
  add column if not exists edited_at      timestamptz,
  add column if not exists edited_by      uuid references auth.users (id) on delete set null,
  add column if not exists edited_by_name text;

alter table public.student_communications drop constraint if exists student_communications_edit_stamp;
alter table public.student_communications
  add constraint student_communications_edit_stamp check (
    (edited_at is null and edited_by is null and edited_by_name is null)
    or (edited_at is not null and edited_by_name is not null)
  );

comment on table public.student_communications is
  'Internal history of staff communications with a student, each with an optional follow-up (pending or completed). Written only by record_student_communication(), complete_student_follow_up() and update_student_communication(); never deleted in V1.';
comment on column public.student_communications.edited_at is
  'When the communication was last edited (update_student_communication); NULL if it never was. The recorder and created_at never change.';
comment on column public.student_communications.edited_by is
  'auth.uid() of the staff member who last edited it - set by update_student_communication(), never supplied by the client.';

-- 2. Edit a communication ------------------------------------------------------------------------------------------------------

create or replace function public.update_student_communication(
  p_communication_id uuid,
  p_communicated_at  timestamp,
  p_type             text,
  p_subject          text,
  p_notes            text,
  p_follow_up        boolean,
  p_follow_up_date   date default null,
  p_follow_up_note   text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_name   text;
  v_row    public.student_communications%rowtype;
  v_tz     text := public.centre_timezone();
  v_at     timestamptz;
  v_note   text := nullif(btrim(coalesce(p_follow_up_note, '')), '');
  v_date   date;
  v_status text;
begin
  -- Authorization first. A caller who is not staff is refused before any row is read or locked; an unknown communication and one
  -- outside the caller's scope get the same refusal, so nothing is learned about either.
  select a.user_id, a.actor_name into v_user, v_name from public.student_communication_actor() a;
  if v_user is null then
    raise exception 'You are not allowed to edit this communication.' using errcode = '42501';
  end if;

  -- The lock serialises an edit with a concurrent completion: whichever comes second sees the other's result.
  select * into v_row from public.student_communications c where c.id = p_communication_id for update;
  if not found or not public.class_count_student_visible(v_row.student_id) then
    raise exception 'You are not allowed to edit this communication.' using errcode = '42501';
  end if;

  -- The same rules as record_student_communication.
  if p_communicated_at is null then
    raise exception 'Enter the date and time of the communication.' using errcode = '22023';
  end if;
  v_at := p_communicated_at at time zone v_tz;
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

  -- The follow-up. A completed one is part of the record of what was done: it stays exactly as it is.
  if v_row.follow_up_status = 'completed' then
    if not coalesce(p_follow_up, false) then
      raise exception 'A completed follow-up cannot be removed: it records what was done.' using errcode = '55000';
    end if;
    if p_follow_up_date is distinct from v_row.follow_up_date or v_note is distinct from v_row.follow_up_note then
      raise exception 'A completed follow-up cannot be changed: it records what was done.' using errcode = '55000';
    end if;
    v_date := v_row.follow_up_date;
    v_note := v_row.follow_up_note;
    v_status := 'completed';
  elsif coalesce(p_follow_up, false) then
    -- None yet (added as Pending), or a pending one (its date and note may change; it stays Pending).
    if p_follow_up_date is null then
      raise exception 'Enter the follow-up date.' using errcode = '22023';
    end if;
    if v_note is null then
      raise exception 'Enter the follow-up note.' using errcode = '22023';
    end if;
    if char_length(v_note) > 1000 then
      raise exception 'The follow-up note can be at most 1000 characters.' using errcode = '22023';
    end if;
    v_date := p_follow_up_date;
    v_status := 'pending';
  else
    -- No follow-up, or a pending one removed.
    v_date := null;
    v_note := null;
    v_status := null;
  end if;

  if v_date is not null and v_date < (v_at at time zone v_tz)::date then
    raise exception 'The follow-up date cannot be before the communication date.' using errcode = '22023';
  end if;

  -- Nothing changed: nothing is written, and the record is not marked edited.
  if v_row.communicated_at = v_at
     and v_row.communication_type = p_type
     and v_row.subject = btrim(p_subject)
     and v_row.notes = btrim(p_notes)
     and v_row.follow_up_date is not distinct from v_date
     and v_row.follow_up_note is not distinct from v_note
     and v_row.follow_up_status is not distinct from v_status then
    return;
  end if;

  -- id, student_id, the recorder, created_at and the completion columns are not in this list: an edit never changes them.
  update public.student_communications
  set communicated_at    = v_at,
      communication_type = p_type,
      subject            = btrim(p_subject),
      notes              = btrim(p_notes),
      follow_up_date     = v_date,
      follow_up_note     = v_note,
      follow_up_status   = v_status,
      edited_at          = now(),
      edited_by          = v_user,
      edited_by_name     = v_name,
      updated_at         = now()
  where id = p_communication_id;
end;
$$;

comment on function public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text) is
  'Edits one communication (Admin, or an Instructor for an authorized student): its time, type, subject, notes and a pending or new follow-up. A completed follow-up cannot be changed or removed. Never changes the recorder, created_at or completion details; stamps edited_at/edited_by from auth.uid().';

revoke execute on function public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text) from public, anon;
grant execute on function public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text) to authenticated;
