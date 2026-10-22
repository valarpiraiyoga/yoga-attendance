import Link from "next/link";
import { ArrowRight, Calendar, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { TIME_RANGE_CHIPS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { cn } from "@/lib/utils";
import SchedulePlaces from "@/app/schedule/schedule-places";

/**
 * Batch Details' Overview schedule, as a week: seven weekday columns, Monday to Sunday, each with that day's class times as small
 * chips (a day with no class says "No class"). It shows the batch's CURRENT schedules only - the same set the summary cards and
 * the Batches list read (`currentSchedulesOf`). The Schedules tab still lists every schedule row with its dates and actions.
 *
 * A chip's colour groups identical time ranges (the same deterministic mapping the enrollment schedule picker uses): the same
 * time range has the same colour on every day. The time is always written out. When the batch's classes are not all taught by the
 * same person each chip carries its instructor's name (with one instructor it would only repeat itself).
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
  const slots = timeRangeSlots(schedules, TIME_RANGE_CHIPS.length);

  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={Calendar}
        tone="brand"
        title="Weekly Schedule"
        description="Classes for each day of the week."
        className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" render={<Link href={`/schedule/new?batch=${batchId}`} />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Schedule
            </Button>
            <Button size="sm" variant="secondary" render={<Link href={`/batches/${batchId}/schedules`} />} nativeButton={false}>
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
        <ul aria-label="Weekly schedule" className="grid grid-cols-[repeat(auto-fit,minmax(9.75rem,1fr))] gap-2">
          {DAYS_OF_WEEK.map((day) => {
            const daySlots = byDay.get(day) ?? [];
            const dayName = DAY_LABELS[day] ?? day;

            return (
              <li key={day} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-background/60 p-3">
                <span className="text-body font-semibold text-text-primary">
                  <span aria-hidden="true">{dayName.slice(0, 3)}</span>
                  <span className="sr-only">{dayName}</span>
                </span>
                {daySlots.length === 0 ? (
                  <span className="text-small text-text-secondary">No class</span>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {daySlots.map((schedule) => (
                      <li key={schedule.id} className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className={cn(
                            "text-small w-fit max-w-full rounded-md px-2 py-0.5 font-medium whitespace-nowrap tabular-nums",
                            TIME_RANGE_CHIPS[slots.get(timeRangeKey(schedule)) ?? 0],
                          )}
                        >
                          {formatTimeRange(schedule.start_time, schedule.end_time)}
                        </span>
                        {showInstructor && schedule.instructors?.full_name ? (
                          <span className="text-small truncate text-text-secondary">{schedule.instructors.full_name}</span>
                        ) : null}
                        {/* This class's own places (capacity belongs to each schedule, never to the batch). */}
                        <SchedulePlaces places={schedule.places} className="text-small" />
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
