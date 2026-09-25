import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, CircleCheck, Clock, Users, UserRound } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import FlashToast from "@/components/ui/flash-toast";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { batchToday, currentSchedulesOf, summarizeCurrentSchedules } from "@/lib/batches/summary";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { listEnrollmentsForBatch } from "@/lib/enrollments/data";
import { attachInstructorPhotos, getBatchAttendanceReport } from "@/lib/reports/data";
import { InstructorCell } from "@/components/ui/session-cells";
import { addDaysUTC } from "@/lib/schedules/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { formatDateWithWeekday } from "@/lib/format";
import BatchHeader from "@/app/batches/[id]/batch-header";
import BatchStudentRow from "@/app/batches/[id]/batch-student-row";
import WeeklyScheduleOverview from "@/app/batches/[id]/weekly-schedule-overview";

const SUCCESS_MESSAGES = {
  created: "Batch created successfully.",
  updated: "Batch updated successfully.",
};

// Recent Attendance: the latest completed sessions of this batch within this window.
const RECENT_ATTENDANCE_DAYS = 90;
const RECENT_ATTENDANCE_ROWS = 5;
const STUDENT_ROWS = 5;

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

    return await attachInstructorPhotos(
      [...sessions]
        .sort(
          (a, b) =>
            b.session_date.localeCompare(a.session_date) || (b.start_time ?? "").localeCompare(a.start_time ?? "")
        )
        .slice(0, RECENT_ATTENDANCE_ROWS)
    );
  } catch {
    return null;
  }
}

/**
 * Batch Details - Overview (wireframe p17-19; `10 Batche detail.png`): the shared header and
 * its tabs, then four short summary cards (students, weekly classes, time, instructor), then the
 * working content: the Weekly Schedule (a Monday-to-Sunday week, not a table) beside the Students,
 * and the Recent Attendance across the bottom. Students, Schedules and Attendance remain their own
 * tab routes. The batch's description is in the header, so there is no separate Additional
 * Information panel to repeat it.
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

  // The centre's own day (Center Settings) - one "today" for the recent
  // attendance window and for which schedules are current.
  const today = batchToday(new Date(), await getCenterTimezone());
  const [schedules, enrollments, recentAttendance] = await Promise.all([
    listSchedulesForBatch(id),
    listEnrollmentsForBatch(id),
    loadRecentAttendance(id, today),
  ]);
  // The batch's current schedules — the same set (same definition, same centre
  // date) the Batches card and table summarise; the Schedules tab lists every row.
  const currentSchedules = currentSchedulesOf(schedules, today);
  const upcomingScheduleCount = schedules.filter(
    (schedule) => schedule.status === "active" && schedule.effective_from > today
  ).length;
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === "active");
  const summary = summarizeCurrentSchedules(currentSchedules);
  // Display-only: how many distinct weekdays `summary.days` lists, for the Weekly Classes caption.
  const dayCount = summary.hasSchedule ? summary.days.split(", ").filter(Boolean).length : 0;

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <BatchHeader batch={batch} active="overview">
      <div className="flex flex-col gap-6">
        {/* The save confirmation is a toast overlay, not a banner, so it takes no layout space. */}
        <FlashToast message={message} />

        {/* Short values only, so no card wraps and stretches its icon box; the day-by-day detail is the
            Weekly Schedule below. */}
        <StatTileGroup ariaLabel="Batch summary" columns={2} className="grid-cols-1 xl:grid-cols-4">
          <StatTile
            compact
            icon={Users}
            label="Students Enrolled"
            value={activeEnrollments.length}
            caption="Active enrollments"
            tone="warning"
          />
          <StatTile
            compact
            icon={CalendarDays}
            label="Weekly Classes"
            value={currentSchedules.length}
            caption={dayCount > 0 ? `Across ${dayCount} ${dayCount === 1 ? "day" : "days"}` : "No current schedule"}
            tone="brand"
          />
          <StatTile compact icon={Clock} label="Time" value={summary.time} tone="info" />
          <StatTile compact icon={UserRound} label="Instructor" value={summary.instructor} tone="success" />
        </StatTileGroup>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
          <WeeklyScheduleOverview
            batchId={batch.id}
            schedules={currentSchedules}
            upcomingScheduleCount={upcomingScheduleCount}
          />

          <Panel className="min-w-0">
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
              <EmptyState size="compact" title="No students enrolled" description="No students are enrolled in this batch yet." />
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
        </div>

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
              size="compact"
              title="No recent attendance yet"
              description={
                recentAttendance
                  ? `No completed sessions for this batch in the last ${RECENT_ATTENDANCE_DAYS} days.`
                  : "Recent attendance is not available right now."
              }
            />
          ) : (
            // The same attendance table Student Details uses: unboxed, Date first, the
            // result as status badges, Instructor dropped on a phone. Here a row is a
            // session, so the badges carry its Present / Absent counts.
            <Table aria-label="Recent attendance">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Attendance</TableHead>
                  <TableHead className="hidden sm:table-cell">Instructor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAttendance.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="whitespace-nowrap font-medium text-text-primary">
                      {formatDateWithWeekday(session.session_date)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">
                        <Badge variant="success">{session.presentCount} Present</Badge>
                        <Badge variant="danger">{session.absentCount} Absent</Badge>
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <InstructorCell name={session.instructor?.full_name} photoUrl={session.instructor?.photo_url} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </BatchHeader>
  );
}
