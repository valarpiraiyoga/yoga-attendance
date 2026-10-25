import Link from "next/link";
import { Calendar, ChevronRight, Plus } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate, formatTimeRange } from "@/lib/format";
import { DAY_LABELS, DAYS_OF_WEEK, addDaysUTC } from "@/lib/schedules/validation";
import { TIME_RANGE_CHIPS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { cn } from "@/lib/utils";
import SchedulePlaces from "@/app/schedule/schedule-places";

/**
 * The date of each weekday in the week that contains `today` (the centre's own day, from the page): Monday first. Display only - the classes
 * shown are the batch's current schedules, by weekday, exactly as before.
 */
function weekDates(today) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return DAYS_OF_WEEK.map((day, index) => [day, addDaysUTC(today, index - weekday)]);
}

/**
 * One day's classes grouped by time range (schedules are one per instructor): `[{ key, start, end, schedules }]`, in the order given
 * (earliest first within the day), so a slot taught by two instructors is ONE block listing both.
 */
function slotsOfDay(daySchedules) {
  const groups = new Map();
  for (const schedule of daySchedules) {
    const key = timeRangeKey(schedule);
    const group = groups.get(key) ?? { key, start: schedule.start_time, end: schedule.end_time, schedules: [] };
    group.schedules.push(schedule);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Batch Details' Overview schedule, as a week: seven weekday cards, Monday to Sunday, each with the day and its date and that day's class
 * time slots as soft tinted blocks - the time, then each instructor (photo and name) stacked, and the class's places. A day with no class is
 * a centred "No class" state. It shows the batch's CURRENT schedules only - the same set the summary cards and the Batches list read
 * (`currentSchedulesOf`). The Schedules tab still lists every schedule row with its dates and actions.
 *
 * A block's colour groups identical time ranges (the same deterministic mapping the enrollment schedule picker uses): the same time range
 * has the same colour on every day. The time is always written out.
 *
 * @param {object} props
 * @param {string} props.batchId
 * @param {object[]} props.schedules - the batch's current schedules, sorted Monday to Sunday.
 * @param {number} props.upcomingScheduleCount - active schedules that have not started yet.
 * @param {string} props.today - the centre's date, "YYYY-MM-DD" (for the dates under the day names).
 */
export default function WeeklyScheduleOverview({ batchId, schedules, upcomingScheduleCount, today }) {
  const byDay = new Map(DAYS_OF_WEEK.map((day) => [day, []]));
  for (const schedule of schedules) byDay.get(schedule.day_of_week)?.push(schedule);

  const slots = timeRangeSlots(schedules, TIME_RANGE_CHIPS.length);
  const dates = new Map(today ? weekDates(today) : []);

  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={Calendar}
        tone="brand"
        title="Weekly Schedule"
        description="Classes for each day of the week with time and instructor."
        className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" render={<Link href={`/schedule/new?batch=${batchId}`} />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Schedule
            </Button>
            <Button size="sm" variant="secondary" render={<Link href={`/batches/${batchId}/schedules`} />} nativeButton={false}>
              <ChevronRight className="size-4" aria-hidden="true" />
              View Full Schedule
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
            const daySlots = slotsOfDay(byDay.get(day) ?? []);
            const dayName = DAY_LABELS[day] ?? day;
            const date = dates.get(day);

            return (
              <li key={day} className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
                {/* The day's header band: the day name and its date. */}
                <div className="border-b border-border bg-brand/5 px-3 py-2">
                  <p className="text-body font-semibold text-text-primary">
                    <span aria-hidden="true">{dayName.slice(0, 3)}</span>
                    <span className="sr-only">{dayName}</span>
                  </p>
                  {date ? <p className="text-small text-text-secondary">{formatDate(date)}</p> : null}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                {daySlots.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1 px-1 py-6 text-center">
                    <Calendar className="size-8 text-text-secondary/60" aria-hidden="true" />
                    <p className="text-body font-semibold text-text-primary">No class</p>
                    <p className="text-small text-text-secondary">No scheduled classes for this day.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {daySlots.map((slot) => (
                      <li
                        key={slot.key}
                        className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg p-2.5", TIME_RANGE_CHIPS[slots.get(slot.key) ?? 0])}
                      >
                        <span className="text-small font-semibold whitespace-nowrap tabular-nums">{formatTimeRange(slot.start, slot.end)}</span>
                        <ul className="flex flex-col gap-1.5 text-text-primary">
                          {slot.schedules.map((schedule) => (
                            <li key={schedule.id} className="flex min-w-0 items-center gap-2">
                              {schedule.instructors?.full_name ? (
                                <>
                                  <Avatar name={schedule.instructors.full_name} src={schedule.instructors.photo_url} size="md" className="shrink-0" />
                                  <span className="min-w-0">
                                    <span className="text-small block truncate font-medium">{schedule.instructors.full_name}</span>
                                    {/* This class's own places (capacity belongs to each schedule, never to the batch). */}
                                    <SchedulePlaces places={schedule.places} className="text-small" />
                                  </span>
                                </>
                              ) : (
                                <span className="min-w-0">
                                  <span className="text-small block text-text-secondary">No instructor</span>
                                  <SchedulePlaces places={schedule.places} className="text-small" />
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
