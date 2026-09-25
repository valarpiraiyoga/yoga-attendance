import { CalendarDays, Info, RefreshCw } from "lucide-react";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";

/**
 * The Recurring Pattern card, as a picture: a Monday-to-Sunday strip with the day this schedule
 * occurs on filled in the brand colour, the plain sentence under it ("Every Sunday, 6:00 AM -
 * 7:00 AM"), and the two things worth knowing about a recurring pattern (it applies to future
 * sessions within its effective period; changes never touch past sessions or attendance).
 *
 * Read-only. The frequency, duration and effective period are the summary cards above it, so
 * they are not repeated here.
 */
export default function SchedulePatternCard({ schedule }) {
  const dayLabel = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const timeLabel = formatTimeRange(schedule.start_time, schedule.end_time);

  return (
    <Panel className="min-w-0">
      <PanelHeader icon={RefreshCw} title="Recurring Pattern" className="mb-4 min-h-8" />

      <ol aria-label="Days of the week; this schedule occurs on the filled one" className="grid grid-cols-7 gap-1.5">
        {DAYS_OF_WEEK.map((day) => {
          const occurs = day === schedule.day_of_week;

          return (
            <li
              key={day}
              aria-current={occurs ? "true" : undefined}
              className={cn(
                "flex h-11 items-center justify-center rounded-lg border text-small font-semibold",
                occurs ? "border-brand bg-brand text-surface" : "border-border bg-background text-text-secondary"
              )}
            >
              <span aria-hidden="true">{(DAY_LABELS[day] ?? day).slice(0, 3)}</span>
              <span className="sr-only">
                {DAY_LABELS[day] ?? day}
                {occurs ? " (this schedule)" : ""}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-body mt-4 flex items-start gap-2 font-medium text-text-primary">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span>
          Every {dayLabel}, {timeLabel}
        </span>
      </p>

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-small flex items-start gap-2 text-text-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This recurring schedule applies to future sessions within its effective period.
        </p>
        <p className="text-small flex items-start gap-2 text-text-secondary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Changes to it affect future sessions only; past sessions and attendance remain unchanged.
        </p>
      </div>
    </Panel>
  );
}
