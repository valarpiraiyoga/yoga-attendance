import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import ReviewAttendanceChanges from "@/app/attendance-history/[scheduleId]/[date]/review/review-attendance-changes";

/**
 * Review Attendance Changes (Phase 16; approved wireframe p.33), addressed
 * by `(scheduleId, date)` — same reasoning as Attendance Details and Edit
 * Attendance.
 *
 * This page is deliberately thin: it does exactly what Edit Attendance and
 * Attendance Details already do — `requireRole`, resolve the session
 * through `getSessionOccurrence` (404 unless it exists and is
 * `completed`), then fetch the eligible roster and the session's actual
 * saved marks. Nothing here reads `sessionStorage` — that can only happen
 * in the browser, so it is `ReviewAttendanceChanges`' job (a client
 * component) to read the Edit Attendance page's draft, not this Server
 * Component's. Everything this page fetches is the **authoritative,
 * server-verified** state; the draft the client holds is handed down only
 * as `originalMarks` for it to compare *against*, never as something this
 * page trusts blindly. See that component's own comment for the full
 * handoff design and why `sessionStorage` is retained, not replaced, once
 * consumed this way.
 *
 * Authorization is identical to Attendance Details and Edit Attendance —
 * `getSessionOccurrence` under RLS
 * (`class_sessions_select_instructor`/`schedules_select_instructor`,
 * `0014_instructor_attendance_access.sql`); another instructor's session
 * 404s here exactly as it already does on those two pages. No
 * `can_access_session` check is duplicated in JavaScript, and this page
 * never uses the service-role client.
 */
export default async function ReviewAttendanceChangesPage({ params }) {
  // Authorization boundary — see app/attendance-history/layout.js for why
  // this must be repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session || session.status !== "completed") {
    notFound();
  }

  const [eligibleStudents, originalMarks] = await Promise.all([
    listEligibleStudents(session.batch_id, session.schedule_id, session.session_date),
    getAttendanceForSession(session.id),
  ]);

  const originalSummary = computeAttendanceSummary(eligibleStudents.length, originalMarks);

  return (
    <ReviewAttendanceChanges
      scheduleId={scheduleId}
      date={date}
      session={session}
      eligibleStudents={eligibleStudents}
      originalMarks={originalMarks}
      originalSummary={originalSummary}
    />
  );
}
