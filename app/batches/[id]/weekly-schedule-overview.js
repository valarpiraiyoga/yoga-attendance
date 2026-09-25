import Link from "next/link";
import { ArrowRight, Calendar, Plus } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";

/**
 * Batch Details' Overview schedule, as a week instead of a table: one row per weekday,
 * Monday to Sunday, with that day's class times as small pills (a day with no class says so).
 * It shows the batch's CURRENT schedules only - the same set the summary cards and the Batches list
 * read (`currentSchedulesOf`) - and answers "when does this batch meet?" at a glance in a fraction of
 * the height of a table. The Schedules tab still lists every schedule row with its dates and actions.
 *
 * Each pill carries its instructor's photo when the batch's classes are not all taught by the same
 * person (with one instructor the photo would only repeat itself). Read-only apart from the two
 * links in the header.
 *
 * @param {object} props
 * @param {string} props.batchId
 * @param {object[]} props.schedules - the batch's current schedules, sorted Monday to Sunday.
 * @param {number} props.upcomingScheduleCount - active schedules that have not started yet.
 */
export default function WeeklyScheduleOverview({ batchId, schedules, upcomingScheduleCount }) {
  const byDay = new Map(DAYS_OF_WEEK.map((day) => [day, []]));
  for (const schedule of schedules) byDay.get(schedule.day_of_week)?.push(schedule);

  const instructorNames = new Set(schedules.map((schedule) => schedule.instructors?.full_name ?? ""));
  const showInstructor = instructorNames.size > 1;

  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={Calendar}
        title="Weekly Schedule"
        description="When this batch meets each week."
        className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" render={<Link href={`/schedule/new?batch=${batchId}`} />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="bg-brand/10 text-brand hover:bg-brand/15"
              render={<Link href={`/batches/${batchId}/schedules`} />}
              nativeButton={false}
            >
              View Full Schedule
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          size="compact"
          title={upcomingScheduleCount > 0 ? "No current schedules" : "No active schedules"}
          description={
            upcomingScheduleCount > 0
              ? "Scheduled classes for this batch have not started yet. See the Schedules tab."
              : "Add one to define when this batch takes place."
          }
        />
      ) : (
        <ul aria-label="Weekly schedule" className="flex flex-col divide-y divide-border">
          {DAYS_OF_WEEK.map((day) => {
            const slots = byDay.get(day) ?? [];
            const dayName = DAY_LABELS[day] ?? day;

            return (
              <li key={day} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-body font-semibold text-text-primary">
                  <span aria-hidden="true">{dayName.slice(0, 3)}</span>
                  <span className="sr-only">{dayName}</span>
                </span>
                {slots.length === 0 ? (
                  <span className="text-small text-text-secondary">No class</span>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {slots.map((schedule) => (
                      <li
                        key={schedule.id}
                        className="text-small inline-flex items-center gap-2 rounded-lg bg-brand/10 px-2.5 py-1 font-medium text-brand"
                      >
                        {showInstructor ? (
                          <Avatar
                            name={schedule.instructors?.full_name}
                            src={schedule.instructors?.photo_url}
                            size="sm"
                            className="size-5"
                          />
                        ) : null}
                        {formatTimeRange(schedule.start_time, schedule.end_time)}
                        {showInstructor && schedule.instructors?.full_name ? (
                          <span className="font-normal text-text-secondary">· {schedule.instructors.full_name}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
