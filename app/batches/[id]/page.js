import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Plus,
  UserRound,
  Users,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { batchToday, currentSchedulesOf, summarizeCurrentSchedules } from "@/lib/batches/summary";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { listEnrollmentsForBatch } from "@/lib/enrollments/data";
import { getBatchAttendanceReport } from "@/lib/reports/data";
import { DAY_LABELS, addDaysUTC, todayDateString } from "@/lib/schedules/validation";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import BatchHeader from "@/app/batches/[id]/batch-header";
import BatchStudentRow from "@/app/batches/[id]/batch-student-row";

const SUCCESS_MESSAGES = {
  created: "Batch created successfully.",
  updated: "Batch updated successfully.",
};

// Recent Attendance: the latest completed sessions of this batch within this window.
const RECENT_ATTENDANCE_DAYS = 90;
const RECENT_ATTENDANCE_ROWS = 5;
const STUDENT_ROWS = 5;
// Schedule preview: a batch rarely has more; beyond this the panel says how many it is not listing.
const SCHEDULE_ROWS = 10;

/**
 * The batch's most recent completed sessions, from the same
 * `getBatchAttendanceReport` the Batch Attendance report reads (present /
 * absent counts per session, historical eligibility). `null` when the report
 * data cannot be loaded, so the overview still renders and says so.
 */
async function loadRecentAttendance(batchId, today) {
  try {
    const { sessions } = await getBatchAttendanceReport({
      batchId,
      dateFrom: addDaysUTC(today, -RECENT_ATTENDANCE_DAYS),
      dateTo: today,
    });

    return [...sessions]
      .sort(
        (a, b) =>
          b.session_date.localeCompare(a.session_date) || (b.start_time ?? "").localeCompare(a.start_time ?? "")
      )
      .slice(0, RECENT_ATTENDANCE_ROWS);
  } catch {
    return null;
  }
}

/**
 * Batch Details — Overview (wireframe p17-19; `10 Batche detail.png`): the
 * shared header, four summary tiles (the schedule-derived days, time and
 * instructor, and the enrolled-student count), then two columns of panels —
 * left: Schedule and Recent Attendance; right: Students and Additional
 * Information. Students and Schedules remain their own tab routes.
 */
export default async function BatchDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const today = todayDateString();
  const [schedules, enrollments, recentAttendance] = await Promise.all([
    listSchedulesForBatch(id),
    listEnrollmentsForBatch(id),
    loadRecentAttendance(id, today),
  ]);
  // The batch's current schedules — the same set (same definition, same centre
  // date) the Batches card and table summarise; the Schedules tab lists every row.
  const scheduleToday = batchToday();
  const currentSchedules = currentSchedulesOf(schedules, scheduleToday);
  const upcomingScheduleCount = schedules.filter(
    (schedule) => schedule.status === "active" && schedule.effective_from > scheduleToday
  ).length;
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === "active");
  const summary = summarizeCurrentSchedules(currentSchedules);
  // Display-only: how many distinct weekdays `summary.days` lists, for the Days tile's caption.
  const dayCount = summary.hasSchedule ? summary.days.split(", ").filter(Boolean).length : 0;

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <BatchHeader batch={batch} active="overview">
      <div className="flex flex-col gap-6">
        <StatTileGroup ariaLabel="Batch summary" columns={2} className="grid-cols-1 xl:grid-cols-4">
          <StatTile
            compact
            icon={CalendarDays}
            label="Days"
            value={summary.days}
            caption={dayCount > 0 ? `${dayCount} ${dayCount === 1 ? "day" : "days"}` : undefined}
            tone="brand"
          />
          <StatTile
            compact
            icon={Clock}
            label="Time"
            value={summary.time}
            caption={summary.countLabel ?? undefined}
            tone="info"
          />
          <StatTile compact icon={UserRound} label="Instructor" value={summary.instructor} tone="success" />
          <StatTile compact icon={Users} label="Students Enrolled" value={activeEnrollments.length} tone="warning" />
        </StatTileGroup>

        {message ? (
          <div
            role="status"
            className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
          >
            {message}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel>
              <PanelHeader
                icon={Calendar}
                title="Schedule"
                description="Weekly class schedule for this batch."
                className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/schedule/new?batch=${batch.id}`} />}
                      nativeButton={false}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add Schedule
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="bg-brand/10 text-brand hover:bg-brand/15"
                      render={<Link href={`/batches/${batch.id}/schedules`} />}
                      nativeButton={false}
                    >
                      View Full Schedule
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                }
              />
              {currentSchedules.length === 0 ? (
                <EmptyState
                  size="sm"
                  title={upcomingScheduleCount > 0 ? "No current schedules" : "No active schedules"}
                  description={
                    upcomingScheduleCount > 0
                      ? "Scheduled classes for this batch have not started yet. See the Schedules tab."
                      : "Add one to define when this batch takes place."
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table aria-label="Batch schedule">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Day</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Instructor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentSchedules.slice(0, SCHEDULE_ROWS).map((schedule) => (
                        <TableRow key={schedule.id}>
                          <TableCell className="font-medium text-text-primary">
                            {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-text-secondary">
                            {formatTimeRange(schedule.start_time, schedule.end_time)}
                          </TableCell>
                          <TableCell className="text-text-secondary">
                            {schedule.instructors?.full_name ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {currentSchedules.length > SCHEDULE_ROWS ? (
                <p className="text-small mt-3 text-text-secondary">
                  Showing {SCHEDULE_ROWS} of {currentSchedules.length} current schedules. View Full Schedule for all.
                </p>
              ) : null}
            </Panel>

            <Panel>
              <PanelHeader
                icon={CircleCheck}
                title="Recent Attendance"
                description="Latest attendance records for this batch."
                className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="bg-brand/10 text-brand hover:bg-brand/15"
                    render={<Link href={`/batches/${batch.id}/attendance`} />}
                    nativeButton={false}
                  >
                    View Attendance
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
              {!recentAttendance || recentAttendance.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="No recent attendance yet"
                  description={
                    recentAttendance
                      ? `No completed sessions for this batch in the last ${RECENT_ATTENDANCE_DAYS} days.`
                      : "Recent attendance is not available right now."
                  }
                />
              ) : (
                // Unboxed — no bordered wrapper — so this reads lighter than Schedule's
                // table, as a secondary, glanceable list rather than an equally-weighted panel.
                <Table aria-label="Recent attendance">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead>
                      <TableHead>Present</TableHead>
                      <TableHead>Absent</TableHead>
                      <TableHead>Instructor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentAttendance.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell className="whitespace-nowrap font-medium text-text-primary">
                          {formatDateWithWeekday(session.session_date)}
                        </TableCell>
                        <TableCell className="tabular-nums font-medium text-success">{session.presentCount}</TableCell>
                        <TableCell className="tabular-nums font-medium text-danger">{session.absentCount}</TableCell>
                        <TableCell className="text-text-secondary">{session.instructor?.full_name ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel>
              <PanelHeader
                icon={Users}
                title="Students"
                description="Students enrolled in this batch."
                className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="bg-brand/10 text-brand hover:bg-brand/15"
                    render={<Link href={`/batches/${batch.id}/students`} />}
                    nativeButton={false}
                  >
                    View All Students
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
              {activeEnrollments.length === 0 ? (
                <EmptyState size="sm" title="No students enrolled" description="No students are enrolled in this batch yet." />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {activeEnrollments.slice(0, STUDENT_ROWS).map((enrollment) => (
                    <BatchStudentRow key={enrollment.id} enrollment={enrollment} />
                  ))}
                </ul>
              )}
              {activeEnrollments.length > STUDENT_ROWS ? (
                <p className="text-small mt-3 text-text-secondary">
                  Showing {STUDENT_ROWS} of {activeEnrollments.length} enrolled students.
                </p>
              ) : null}
            </Panel>

            <Panel>
              <PanelHeader icon={FileText} title="Additional Information" className="mb-4 min-h-8" />
              <FieldRow icon={FileText} label="Description">
                <p className="text-body break-words whitespace-pre-line text-text-primary">
                  {batch.description || "—"}
                </p>
              </FieldRow>
            </Panel>
          </div>
        </div>
      </div>
    </BatchHeader>
  );
}
