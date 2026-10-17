import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { monthLabel, monthOf, shiftMonth } from "@/lib/students/attendance-calendar";
import { cn } from "@/lib/utils";
import AttendanceStrip, { DayMarker } from "@/app/students/[id]/attendance-strip";
import RecentAttendanceTable from "@/app/students/[id]/recent-attendance-table";

export const CLASS_COUNT_TAB = "class-count";

const LEGEND = [
  { status: "present", label: "Present" },
  { status: "absent", label: "Absent" },
  { status: "not_enrolled", label: "Not Enrolled" },
  { status: "no_record", label: "No record" },
];

/**
 * Student Details → Recent Attendance: one tab per batch the student is or was enrolled in, the month with previous / next
 * navigation (never past the current month), the day strip with each day's recorded state, the legend and View All (Attendance
 * History for that batch, month and student). Tabs and months are links (`?attendanceBatch=…&attendanceMonth=…`), so the server
 * reads the month's attendance and the page's other panels are unaffected. When the student has class-count attendance a
 * "Class count" tab shows those records, as before - they belong to a membership, not a batch, so they have no calendar.
 *
 * `strip` is null when the month could not be loaded: the panel says so, and never invents a state.
 */
export default function AttendanceCalendar({ studentId, studentName, batches, selected, month, today, strip, classCount }) {
  const base = `/students/${studentId}`;
  const href = (params) => `${base}?${new URLSearchParams(params).toString()}`;
  const isClassCount = selected === CLASS_COUNT_TAB;
  const currentMonth = monthOf(today);
  const tabParams = (tab) => ({ attendanceBatch: tab, attendanceMonth: month });
  const historyParams = new URLSearchParams({ month, q: studentName });
  if (!isClassCount && selected) historyParams.set("batch", selected);

  const showClassCountTab = classCount && (classCount.items.length > 0 || classCount.unavailable);
  const hasTabs = batches.length > 0 || showClassCountTab;

  return (
    <Panel>
      <PanelHeader
        icon={CalendarDays}
        tone="brand"
        title="Recent Attendance"
        action={
          hasTabs ? (
            <Button variant="secondary" size="sm" render={<Link href={`/attendance-history?${historyParams.toString()}`} />} nativeButton={false}>
              View All
            </Button>
          ) : null
        }
      />

      {!hasTabs ? (
        <EmptyState size="compact" title="No recent attendance yet" description="Attendance appears here once the student is enrolled and classes are marked." />
      ) : (
        <>
          <nav aria-label="Attendance by batch" className="-mx-1 overflow-x-auto px-1">
            <ul className="flex min-w-max gap-5 border-b border-border">
              {batches.map((batch) => (
                <TabLink key={batch.id} href={href(tabParams(batch.id))} active={selected === batch.id}>
                  {batch.name}
                </TabLink>
              ))}
              {showClassCountTab ? (
                <TabLink href={href(tabParams(CLASS_COUNT_TAB))} active={isClassCount}>
                  Class count
                </TabLink>
              ) : null}
            </ul>
          </nav>

          {isClassCount ? (
            <div className="mt-4">
              {classCount.unavailable ? (
                <EmptyState size="compact" title="Class-count attendance is not available right now" description="Try refreshing the page." />
              ) : (
                <RecentAttendanceTable items={classCount.items} />
              )}
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <MonthLink href={href({ attendanceBatch: selected, attendanceMonth: shiftMonth(month, -1) })} label="Previous month">
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </MonthLink>
                  <p className="text-body w-36 text-center font-semibold text-text-primary" aria-live="polite">
                    {monthLabel(month)}
                  </p>
                  {month < currentMonth ? (
                    <MonthLink href={href({ attendanceBatch: selected, attendanceMonth: shiftMonth(month, 1) })} label="Next month">
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </MonthLink>
                  ) : (
                    <span aria-hidden="true" className="flex size-8 items-center justify-center text-text-secondary/40">
                      <ChevronRight className="size-4" />
                    </span>
                  )}
                </div>
                <ul aria-label="Legend" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:justify-end">
                  {LEGEND.map((item) => (
                    <li key={item.status} className="text-small inline-flex items-center gap-1.5 text-text-secondary">
                      <DayMarker status={item.status} size="sm" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3">
                {strip === null ? (
                  <EmptyState size="compact" title="Attendance is not available right now" description="Try refreshing the page." />
                ) : strip.length === 0 ? (
                  <EmptyState
                    size="compact"
                    title={`No class dates in ${monthLabel(month)}`}
                    description="There are no scheduled classes for this batch in this month."
                  />
                ) : (
                  <AttendanceStrip
                    key={`${selected}:${month}`}
                    days={strip}
                    today={today}
                    batchName={batches.find((batch) => batch.id === selected)?.name}
                    label={`${batches.find((batch) => batch.id === selected)?.name ?? "Batch"} attendance, ${monthLabel(month)}`}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

function TabLink({ href, active, children }) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        aria-current={active ? "page" : undefined}
        className={cn(
          "-mb-px inline-flex border-b-2 pb-2 text-body font-medium whitespace-nowrap transition-colors",
          active ? "border-brand text-brand" : "border-transparent text-text-secondary hover:text-text-primary"
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function MonthLink({ href, label, children }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
