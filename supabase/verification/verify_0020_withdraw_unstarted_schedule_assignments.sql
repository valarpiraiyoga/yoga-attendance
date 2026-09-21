-- ===========================================================================
-- Migration 0020 structural verification
-- Verifies supabase/migrations/0020_withdraw_unstarted_schedule_assignments.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0020. STRICTLY READ-ONLY: one
-- SELECT over system catalogs. Statuses: PASS, FAIL.
-- ===========================================================================

begin transaction read only;

select seq, check_name, status
from (
  select 1 as seq, 'authenticated has DELETE on enrollment_schedules' as check_name,
         case when has_table_privilege('authenticated', 'public.enrollment_schedules', 'DELETE')
              then 'PASS' else 'FAIL' end as status

  union all
  select 2, 'anon has no DELETE on enrollment_schedules',
         case when not has_table_privilege('anon', 'public.enrollment_schedules', 'DELETE')
              then 'PASS' else 'FAIL' end

  union all
  select 3, 'exactly one delete policy, admin-only and limited to unstarted assignments',
         case when (
           select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'enrollment_schedules' and cmd = 'DELETE'
             and policyname = 'enrollment_schedules_delete_unstarted_admin'
             and qual like '%is_admin()%' and qual like '%effective_start_date%'
         ) = 1
           and (
             select count(*) from pg_policies
             where schemaname = 'public' and tablename = 'enrollment_schedules' and cmd = 'DELETE'
           ) = 1
         then 'PASS' else 'FAIL' end
) checks
order by seq;

rollback;

-- ---------------------------------------------------------------------------
-- Optional diagnostic (read-only) for the bug this migration fixes: schedule
-- assignments that were "closed" on their own start date, i.e. still one-day
-- assignments left behind by the old clamp. Review before deciding anything;
-- this file changes nothing.
--
--   select es.id, es.batch_enrollment_id, es.schedule_series_id,
--          es.effective_start_date, es.effective_end_date
--   from public.enrollment_schedules es
--   where es.effective_end_date = es.effective_start_date;
-- ---------------------------------------------------------------------------
