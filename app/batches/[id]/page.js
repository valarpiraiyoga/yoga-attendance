import { notFound } from "next/navigation";
import { CalendarDays, Clock, Users, UserRound } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import FlashToast from "@/components/ui/flash-toast";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { batchToday, currentSchedulesOf, summarizeCurrentSchedules } from "@/lib/batches/summary";
import { countActiveEnrollments } from "@/lib/batches/active-students";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { isScheduleAssignmentActive, listEnrollmentsForBatch, listScheduleAssignmentsForEnrollments } from "@/lib/enrollments/data";
import { getBatchAttendanceReport } from "@/lib/reports/data";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { monthBounds, parseCalendarMonth } from "@/lib/students/attendance-calendar";
import BatchHeader from "@/app/batches/[id]/batch-header";
import BatchStudentsSection from "@/app/batches/[id]/batch-students-section";
import BatchAttendanceStrip from "@/app/batches/[id]/batch-attendance-strip";
import WeeklyScheduleOverview from "@/app/batches/[id]/weekly-schedule-overview";

const SUCCESS_MESSAGES = {
  created: "Batch created successfully.",
  updated: "Batch updated successfully.",
};

/**
 * The batch's completed sessions in a month, from the same `getBatchAttendanceReport` the Batch Attendance report reads (present /
 * absent counts per session, historical eligibility). `null` when the report data cannot be loaded, so the overview still renders and
 * the attendance strip says so.
 */
async function loadMonthSessions(batchId, month) {
  try {
    const { from, to } = monthBounds(month);
    const { sessions } = await getBatchAttendanceReport({ batchId, dateFrom: from, dateTo: to });
    return sessions;
  } catch {
    return null;
  }
}

/**
 * Batch Details - Overview (wireframe p17-19; `10 Batche detail.png`): the shared header and
 * its tabs, then four short summary cards (students, weekly classes, time, instructor), then the
 * working content: the Weekly Schedule (seven weekday columns), the Students (one table, collapsible), and the
 * Attendance strip (a card per day of the month) across the bottom. Students, Schedules and Attendance remain their own
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
  const rawParams = await searchParams;
  const month = parseCalendarMonth(rawParams?.attendanceMonth, today);
  const [schedules, enrollments, monthSessions] = await Promise.all([
    listSchedulesForBatch(id),
    listEnrollmentsForBatch(id),
    loadMonthSessions(id, month),
  ]);
  // The enrollments' CURRENT schedule assignments (one read for the whole batch), for the Students section's grouping by session. If they cannot
  // be read the section still lists every student, just without sessions.
  const assignments = await listScheduleAssignmentsForEnrollments(enrollments.map((enrollment) => enrollment.id))
    .then((rows) => rows.filter((assignment) => isScheduleAssignmentActive(assignment, today)))
    .catch(() => null);
  // The batch's current schedules — the same set (same definition, same centre
  // date) the Batches card and table summarise; the Schedules tab lists every row.
  const currentSchedules = currentSchedulesOf(schedules, today);
  const upcomingScheduleCount = schedules.filter(
    (schedule) => schedule.status === "active" && schedule.effective_from > today
  ).length;
  // One count for the summary card and the Students heading (01-product.md §6 "Active Students").
  const activeStudentCount = countActiveEnrollments(enrollments);
  const summary = summarizeCurrentSchedules(currentSchedules);
  // Display-only: how many distinct weekdays `summary.days` lists, for the Weekly Classes caption.
  const instructors = new Map(currentSchedules.filter((schedule) => schedule.instructors).map((schedule) => [schedule.instructors.id, schedule.instructors]));
  const soleInstructor = instructors.size === 1 ? [...instructors.values()][0] : null;
  const dayCount = summary.hasSchedule ? summary.days.split(", ").filter(Boolean).length : 0;

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
            label="Active Students"
            value={activeStudentCount}
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
          <StatTile
            compact
            icon={UserRound}
            label="Instructor"
            value={
              soleInstructor ? (
                <span className="flex items-center gap-2">
                  <Avatar name={soleInstructor.full_name} src={soleInstructor.photo_url} size="sm" />
                  <span>{soleInstructor.full_name}</span>
                </span>
              ) : (
                summary.instructor
              )
            }
            tone="success"
          />
        </StatTileGroup>

        <WeeklyScheduleOverview batchId={batch.id} schedules={currentSchedules} upcomingScheduleCount={upcomingScheduleCount} today={today} />

        <BatchStudentsSection
          enrollments={enrollments}
          activeCount={activeStudentCount}
          assignments={assignments}
          schedules={currentSchedules}
        />

        <BatchAttendanceStrip batchId={batch.id} month={month} today={today} sessions={monthSessions} schedules={schedules} />
      </div>
    </BatchHeader>
  );
}
