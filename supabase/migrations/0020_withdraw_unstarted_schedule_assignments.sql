-- Withdraw a schedule assignment that has not started yet.
--
-- Bug this fixes: removing a schedule from an enrollment (Edit Batch
-- Enrollment → uncheck → Confirm) closes its assignment "the day before the
-- change" (01-product.md §4 "Schedule Assignment Effective Dates"). An
-- assignment that starts ON or AFTER the change date (for example one
-- created today for an enrollment that starts today, or one added earlier
-- with a future start) has no earlier day to close it on:
-- `enrollment_schedules_end_after_start` forbids an end before its own start.
-- The application therefore clamped the end date to the start date, which
-- left a one-day assignment that still applied on the very day the schedule
-- was meant to stop — the schedule stayed listed on Student Details and the
-- student stayed eligible for it.
--
-- An assignment that starts on or after the change date has no past to
-- preserve (the "close, never rewrite" rule exists so past eligibility stays
-- reconstructable — this one has none), so the correct outcome is to withdraw
-- it. Nothing references enrollment_schedules by foreign key, so removing
-- such a row cannot orphan anything.
--
-- The delete privilege is deliberately narrow: admin only, and ONLY for a row
-- whose start date is today or later in the centre's timezone. A row that
-- has already covered a past day can never be deleted, so historical
-- eligibility remains protected at the database level, not just in the app.
--
-- Additive; 0013_schedule_assignment.sql is not edited.

grant delete on public.enrollment_schedules to authenticated;

drop policy if exists "enrollment_schedules_delete_unstarted_admin" on public.enrollment_schedules;
create policy "enrollment_schedules_delete_unstarted_admin"
  on public.enrollment_schedules
  for delete
  using (
    public.is_admin()
    and effective_start_date >= (timezone('Asia/Kolkata', now()))::date
  );
