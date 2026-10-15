-- Service details of a NEW document: the classes at the start date, else at the date of issue (V1 Tax Adjustment follow-up)
--
-- WHY
--   A document carries a snapshot of the classes the student attends (migration 0033), taken when it is first issued. The helper
--   public.membership_service_details(membership) looked for the student's enrollments only on the membership's START date. A
--   membership that starts later than an enrollment's end date - a renewal or a future-start membership - found none, so its first
--   document was issued with an empty snapshot and showed only "Monthly Membership" and the dates, although the student is enrolled
--   and attending today. Every correction then (rightly, since 0055) carried that empty snapshot forward.
--
-- WHAT THIS MIGRATION DOES
--   Re-creates public.membership_service_details(uuid) - and only it - so that:
--     1. it looks at the membership's start date exactly as before; if that finds any batch, that is the answer, unchanged;
--     2. only when it finds none, it looks again at the centre's date today (the date of issue), and returns what applies then;
--     3. if neither date finds a batch it returns NULL, and the document keeps the generic membership description and period.
--   The query is 0033's, unchanged, asked for a date. The output shape is unchanged (version, as_of, batches[batch_id, name, code,
--   slots[day_of_week, start_time, end_time]]); "as_of" now says WHICH date was used. Batches and slots keep their order and are never
--   duplicated: one schedule version per assigned series, batches ordered by name, code and id. Security is unchanged (SECURITY
--   DEFINER, empty search_path, callable by no client role).
--
-- WHAT IT DOES NOT DO
--   * It changes no document: no issued or cancelled invoice or receipt is read, rewritten or backfilled. A document that already
--     has an empty snapshot keeps it.
--   * It does not touch correction. A replacement copies the ORIGINAL's snapshot (0055) and never calls this function, so a
--     correction can never refresh historical service details from current enrollment data.
--   * It changes no table, column, trigger, policy or grant, and nothing about amounts, tax, numbering, membership validity,
--     attendance eligibility or payment status.
--
-- RERUN
--   Idempotent: CREATE OR REPLACE. Run it as one transaction.
--
-- RE-RUNNING OTHER MIGRATIONS
--   0033 defines this function with the start-date-only lookup. If 0033 is ever re-run AFTER 0056, re-apply 0056.

do $$
begin
  if to_regprocedure('public.membership_service_details(uuid)') is null then
    raise exception '0056 needs migration 0033 (public.membership_service_details) applied first.';
  end if;
  if to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)') is null then
    raise exception '0056 needs migration 0055 applied first: its replacement documents carry the original snapshot forward and never call this function.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null then
    raise exception '0056 needs public.centre_timezone() (migration 0024).';
  end if;
end
$$;


create or replace function public.membership_service_details(p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_start   date;
  v_today   date;
  v_dates   date[];
  v_as_of   date;
  v_batches jsonb;
begin
  select m.student_id, m.start_date into v_student, v_start
  from public.memberships m
  where m.id = p_membership_id;

  if not found then
    return null;
  end if;

  -- 0056: the classes in force at the membership's START date; and ONLY when none apply there, the classes in force at the centre's
  -- date today (the date of issue). The first date that finds a batch decides; the second is never consulted otherwise. The query is
  -- 0033's, unchanged, with the date it is asked for.
  v_today := (now() at time zone public.centre_timezone())::date;
  v_dates := case when v_today is distinct from v_start then array[v_start, v_today] else array[v_start] end;

  foreach v_as_of in array v_dates loop
    with enrolled as (
      select be.id as enrollment_id, be.batch_id
      from public.batch_enrollments be
      where be.student_id = v_student
        and be.status = 'active'
        and be.effective_start_date <= v_as_of
        and (be.effective_end_date is null or be.effective_end_date >= v_as_of)
    ),
    slots as (
      -- One version per assigned series: the one in force at D (latest first if several overlap).
      select distinct on (e.batch_id, es.schedule_series_id)
        e.batch_id, sc.day_of_week, sc.start_time, sc.end_time
      from enrolled e
      join public.enrollment_schedules es
        on es.batch_enrollment_id = e.enrollment_id
       and es.effective_start_date <= v_as_of
       and (es.effective_end_date is null or es.effective_end_date >= v_as_of)
      join public.schedules sc
        on sc.series_id = es.schedule_series_id
       and sc.batch_id = e.batch_id
       and sc.effective_from <= v_as_of
       and (sc.effective_until is null or sc.effective_until >= v_as_of)
      order by e.batch_id, es.schedule_series_id, sc.effective_from desc, sc.created_at desc, sc.id desc
    )
    select jsonb_agg(
             jsonb_build_object(
               'batch_id', b.id,
               'name', b.name,
               'code', b.code,
               'slots', coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'day_of_week', s.day_of_week,
                            'start_time', to_char(s.start_time, 'HH24:MI'),
                            'end_time', to_char(s.end_time, 'HH24:MI')
                          )
                          order by
                            case s.day_of_week
                              when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
                              when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6
                              when 'sunday' then 7 else 8
                            end,
                            s.start_time, s.end_time
                        )
                 from slots s
                 where s.batch_id = b.id
               ), '[]'::jsonb)
             )
             order by b.name, b.code, b.id
           )
      into v_batches
    from public.batches b
    where b.id in (select batch_id from enrolled);

    if v_batches is not null then
      return jsonb_build_object('version', 1, 'as_of', to_char(v_as_of, 'YYYY-MM-DD'), 'batches', v_batches);
    end if;
  end loop;

  return null;
end;
$$;


comment on function public.membership_service_details(uuid) is
  'The batches and weekly slots in force at a membership''s start date or, when none apply then, at the date of issue, as structured JSON ("as_of" says which), or NULL when neither finds one. Internal: used when a FIRST document is issued; callable by no client role. A replacement document never calls it.';

revoke execute on function public.membership_service_details(uuid) from public, anon, authenticated;
