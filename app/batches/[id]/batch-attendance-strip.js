import Link from "next/link";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import MatrixScroller from "@/app/batches/[id]/matrix-scroller";
import { buildAttendanceMatrix } from "@/lib/batches/attendance-matrix";
import { formatTimeRange } from "@/lib/format";
import { TIME_RANGE_CHIPS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { monthLabel, monthOf, shiftMonth } from "@/lib/students/attendance-calendar";
import { cn } from "@/lib/utils";

function MonthLink({ href, label, children }) {
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className="inline-flex size-9 items-center justify-center rounded-button border border-border bg-surface text-text-secondary opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className="inline-flex size-9 items-center justify-center rounded-button border border-border bg-surface text-text-primary hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

function Legend() {
  return (
    <ul aria-label="Legend" className="text-small flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-success" />
        Present
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-danger" />
        Absent
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-neutral" />
        No Class
      </li>
    </ul>
  );
}

const WEEKEND = new Set(["Sat", "Sun"]);
// The sticky header cells must be OPAQUE (the brand tint mixed into the surface, not a see-through tint) or the day columns scrolling beneath show through them.
const SOLID_TINT = "bg-[color-mix(in_srgb,var(--brand)_5%,var(--surface))]";
const DAY_COLUMN = "min-w-[4.5rem] px-2 text-center";

/**
 * Batch Details → Attendance Summary: the Present and Absent counts per SESSION for the month - a row per time slot and instructor, a column per
 * day (`buildAttendanceMatrix`, the strip's own facts regrouped). The Time column is one tinted block per slot (the time and "N instructors")
 * spanning its instructor rows; a cell is "present / absent" in green and red, "—" when that instructor has no class that day, and "N/R" when
 * a class was scheduled but nothing was recorded (never shown as zeros). Today's column is highlighted and scrolled into view; the table scrolls
 * sideways inside its own box. Each recorded cell opens this batch's Attendance tab for that date. The month is in the URL (`?attendanceMonth=`),
 * so the previous / next buttons are links. `sessions` is null when the month could not be loaded: the section says so and invents no counts.
 */
export default function BatchAttendanceStrip({ batchId, month, today, sessions, schedules }) {
  const currentMonth = monthOf(today);
  const href = (target) => `/batches/${batchId}?attendanceMonth=${target}`;
  const { days, slots } = sessions ? buildAttendanceMatrix({ month, today, sessions, schedules }) : { days: [], slots: [] };
  const tones = timeRangeSlots(schedules ?? [], TIME_RANGE_CHIPS.length);

  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={CalendarDays}
        tone="brand"
        title="Attendance Summary"
        description="Present and absent count by instructor for each session."
        className="mb-4 flex-col items-start xl:flex-row xl:items-center"
        action={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <MonthLink href={href(shiftMonth(month, -1))} label="Previous month">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </MonthLink>
              <span aria-live="polite" className="text-body flex h-9 min-w-36 items-center justify-center rounded-button border border-border bg-surface px-3 font-semibold text-text-primary">
                {monthLabel(month)}
              </span>
              <MonthLink href={month < currentMonth ? href(shiftMonth(month, 1)) : null} label="Next month">
                <ChevronRight className="size-4" aria-hidden="true" />
              </MonthLink>
            </div>
            <Legend />
            <Button variant="secondary" size="sm" render={<Link href={`/batches/${batchId}/attendance`} />} nativeButton={false}>
              <BarChart3 className="size-4" aria-hidden="true" />
              View Details
            </Button>
          </div>
        }
      />

      {!sessions ? (
        <EmptyState size="compact" title="Attendance is not available right now" description="The month could not be loaded. Try again." className="items-center py-4 text-center" />
      ) : days.length === 0 ? (
        <EmptyState size="compact" title="No days to show" description="This month has not started yet." className="items-center py-4 text-center" />
      ) : slots.length === 0 ? (
        <EmptyState size="compact" title="No classes this month" description="No sessions were scheduled or recorded for this batch this month." className="items-center py-4 text-center" />
      ) : (
        <MatrixScroller label={`Attendance for ${monthLabel(month)}`}>
          {/* Fixed widths (a colgroup, table-layout: fixed): the sticky Time and Instructor columns are exactly 11rem and 12rem wide (the table's minimum width is their sum plus the days, so it scrolls rather than squeezes), so the Instructor column
              sticks right where it sits in the flow and never overlaps a day. */}
          <table className="w-full table-fixed border-separate border-spacing-0 text-left" style={{ minWidth: `calc(23rem + ${days.length} * 4.5rem)` }}>
            <colgroup>
              <col className="w-44" />
              <col className="w-48" />
              {days.map((day) => (
                <col key={day.date} className="w-[4.5rem]" />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-brand/5">
                <th scope="col" className={cn("sticky left-0 z-20 w-44 border-b border-border px-4 py-2 text-small font-medium text-text-secondary", SOLID_TINT)}>Time</th>
                <th scope="col" className={cn("sticky left-44 z-20 w-48 border-b border-r border-border px-4 py-2 text-small font-medium text-text-secondary", SOLID_TINT)}>Instructor</th>
                {days.map((day) => {
                  const isToday = day.date === today;
                  return (
                    <th
                      key={day.date}
                      scope="col"
                      data-selected={isToday ? "true" : undefined}
                      aria-current={isToday ? "date" : undefined}
                      className={cn("border-b border-border py-1.5 text-small font-medium", DAY_COLUMN, isToday ? "border-x-2 border-t-2 border-brand bg-brand/10 text-brand" : "text-text-secondary")}
                    >
                      <span className="block">{day.weekday}</span>
                      <span className="text-body block font-semibold text-text-primary">{day.day}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {slots.map((slot) => (
              <tbody key={slot.key} className="[&>tr:last-child>td]:border-b-2">
                {slot.rows.map((row, rowIndex) => (
                  <tr key={row.key}>
                    {rowIndex === 0 ? (
                      <td rowSpan={slot.rows.length} className="sticky left-0 z-10 w-44 border-b-2 border-border bg-surface p-1.5 align-middle">
                        <div className={cn("flex h-full min-h-14 flex-col items-center justify-center rounded-lg px-3 py-2 text-center", TIME_RANGE_CHIPS[tones.get(timeRangeKey({ start_time: slot.startTime, end_time: slot.endTime })) ?? 0])}>
                          <span className="text-small font-semibold whitespace-nowrap tabular-nums">{formatTimeRange(slot.startTime, slot.endTime)}</span>
                          <span className="text-small opacity-80">{slot.instructorCount === 1 ? "1 instructor" : slot.instructorCount === 0 ? "No instructor" : `${slot.instructorCount} instructors`}</span>
                        </div>
                      </td>
                    ) : null}
                    <td className="sticky left-44 z-10 w-48 border-b border-r border-border bg-surface px-4 py-2">
                      {row.instructor ? (
                        <span className="flex items-center gap-2.5">
                          <Avatar name={row.instructor.full_name} src={row.instructor.photo_url} size="md" className="shrink-0" />
                          <span className="text-body font-medium whitespace-nowrap text-text-primary">{row.instructor.full_name}</span>
                        </span>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    {row.cells.map((cell, index) => {
                      const day = days[index];
                      const isToday = cell.date === today;
                      const weekend = WEEKEND.has(day.weekday);
                      const label = `${day.weekday} ${day.day}: ${
                        cell.kind === "recorded" ? `${cell.present} present, ${cell.absent} absent` : cell.kind === "no_record" ? "scheduled, no attendance recorded" : "no class"
                      }`;
                      return (
                        <td
                          key={cell.date}
                          className={cn("border-b border-border text-center tabular-nums", DAY_COLUMN, weekend && "bg-brand/5", isToday && "border-x-2 border-x-brand bg-brand/5")}
                        >
                          {cell.kind === "recorded" ? (
                            <Link
                              href={`/batches/${batchId}/attendance?from=${cell.date}&to=${cell.date}`}
                              aria-label={label}
                              className="text-body block rounded-sm py-2 font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                            >
                              <span className="text-success">{cell.present}</span>
                              <span className="text-text-secondary"> / </span>
                              <span className="text-danger">{cell.absent}</span>
                            </Link>
                          ) : (
                            <span className="text-small block py-2 text-text-secondary" title={label}>
                              <span aria-hidden="true">{cell.kind === "no_record" ? "N/R" : "—"}</span>
                              <span className="sr-only">{label}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </MatrixScroller>
      )}
    </Panel>
  );
}
