import Link from "next/link";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import StripScroller from "@/app/batches/[id]/strip-scroller";
import { buildBatchAttendanceStrip, selectedDateOf } from "@/lib/batches/attendance-strip";
import { monthLabel, monthOf, shiftMonth } from "@/lib/students/attendance-calendar";
import { cn } from "@/lib/utils";

function MonthLink({ href, label, children }) {
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className="inline-flex size-8 items-center justify-center rounded-input border border-border text-text-secondary opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className="inline-flex size-8 items-center justify-center rounded-input border border-border bg-surface text-text-primary hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

function Legend() {
  return (
    <ul aria-label="Legend" className="text-small flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Present
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
        Absent
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-neutral" />
        No Class
      </li>
    </ul>
  );
}

/**
 * Batch Details → Attendance: one compact card per day of the month in a single horizontal, scrollable row - weekday, date, then
 * the Present count (green) and the Absent count (red) of this batch's completed sessions that day (summed when there are several).
 * A day with no scheduled class says "No Class" instead of zeros; a scheduled day with no completed session says "No record". The
 * month is in the URL (`?attendanceMonth=`), so the previous / next buttons are links. Each card opens this batch's Attendance tab
 * for that date. `sessions` is null when the month could not be loaded: the card says so and invents no counts.
 */
export default function BatchAttendanceStrip({ batchId, month, today, sessions, schedules }) {
  const currentMonth = monthOf(today);
  const href = (target) => `/batches/${batchId}?attendanceMonth=${target}`;
  const days = sessions ? buildBatchAttendanceStrip({ month, today, sessions, schedules }) : [];
  const selected = selectedDateOf(days, today);

  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={CalendarDays}
        tone="brand"
        title="Attendance"
        description="Attendance for this batch."
        className="mb-4"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <MonthLink href={href(shiftMonth(month, -1))} label="Previous month">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </MonthLink>
              <span aria-live="polite" className="text-body min-w-32 text-center font-semibold text-text-primary">
                {monthLabel(month)}
              </span>
              <MonthLink href={month < currentMonth ? href(shiftMonth(month, 1)) : null} label="Next month">
                <ChevronRight className="size-4" aria-hidden="true" />
              </MonthLink>
            </div>
            <Legend />
            <Button variant="secondary" size="sm" render={<Link href={`/batches/${batchId}/attendance`} />} nativeButton={false}>
              <BarChart3 className="size-4" aria-hidden="true" />
              View All Attendance
            </Button>
          </div>
        }
      />

      {!sessions ? (
        <EmptyState size="compact" title="Attendance is not available right now" description="The month could not be loaded. Try again." />
      ) : days.length === 0 ? (
        <EmptyState size="compact" title="No days to show" description="This month has not started yet." />
      ) : (
        <StripScroller label={`Attendance for ${monthLabel(month)}`}>
          {days.map((day) => {
            const isSelected = day.date === selected;
            const label = `${day.weekday} ${day.day}: ${
              day.kind === "recorded" ? `${day.present} present, ${day.absent} absent` : day.kind === "no_record" ? "scheduled, no attendance recorded" : "no class"
            }`;
            return (
              <Link
                key={day.date}
                role="listitem"
                href={`/batches/${batchId}/attendance?from=${day.date}&to=${day.date}`}
                aria-label={label}
                aria-current={isSelected ? "date" : undefined}
                data-selected={isSelected ? "true" : undefined}
                className={cn(
                  "flex h-24 w-14 shrink-0 flex-col items-center justify-between rounded-card border py-2 text-center focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  isSelected ? "border-2 border-brand bg-brand/5" : "border-border bg-surface hover:bg-background",
                  day.kind === "no_class" && !isSelected && "bg-background/60",
                )}
              >
                <span className="text-small text-text-secondary">{day.weekday}</span>
                <span className="text-body font-semibold text-text-primary">{day.day}</span>
                {day.kind === "recorded" ? (
                  <span className="flex flex-col text-body leading-5 font-semibold tabular-nums">
                    <span className="text-success">{day.present}</span>
                    <span className="text-danger">{day.absent}</span>
                  </span>
                ) : (
                  <span className="text-small leading-4 text-text-secondary">{day.kind === "no_record" ? "No record" : "No Class"}</span>
                )}
              </Link>
            );
          })}
        </StripScroller>
      )}
    </Panel>
  );
}
