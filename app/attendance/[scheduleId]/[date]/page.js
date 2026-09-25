import { notFound } from "next/navigation";
import FlashToast from "@/components/ui/flash-toast";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { deriveDisplayStatus, todayInCentreTimezone } from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import SessionHeader from "@/app/attendance/[scheduleId]/[date]/session-header";
import AttendancePanel from "@/app/attendance/[scheduleId]/[date]/attendance-panel";

const SUCCESS_MESSAGES = {
  updated: "Session updated successfully.",
  unchanged: "No changes were made.",
};

/**
 * Take Attendance: one focused screen for a session, addressed by
 * `(scheduleId, date)` rather than a `class_sessions` id - a class session has no
 * product-facing identifier (01-product.md §7A), and a projected occurrence has no
 * `id` at all, so this is the only address that works for both a materialized and an
 * unmaterialized occurrence (approved Phase 14 decision).
 *
 * The compact page strip, a one-line session summary (`session-header.js`), and the
 * attendance list (`attendance-panel.js`). There are no tabs and no summary tiles: the
 * eligible students are the list itself, and the progress line above it carries the
 * counts.
 */
export default async function SessionDetailsPage({ params, searchParams }) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const isAdmin = user.role === ROLES.ADMIN;

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session) {
    notFound();
  }

  const timeZone = await getCenterTimezone();
  const displayStatus = deriveDisplayStatus(session, new Date(), timeZone);
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const eligibleStudents = await listEligibleStudents(session.batch_id, session.schedule_id, session.session_date);
  const initialAttendanceMarks = session.id ? await getAttendanceForSession(session.id) : [];
  const isCompleted = session.status === "completed";

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/attendance", label: "Back to Attendance" }}
        title={isCompleted ? "Session Attendance" : "Take Attendance"}
        description={
          isCompleted ? "Review or edit the saved attendance." : "Mark each eligible student Present or Absent."
        }
      />
      <FlashToast message={message} />

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <SessionHeader
          session={session}
          displayStatus={displayStatus}
          scheduleId={scheduleId}
          date={date}
          isAdmin={isAdmin}
          canEdit={displayStatus === "upcoming"}
          canMarkException={session.status === "scheduled"}
        />

        <AttendancePanel
          session={session}
          scheduleId={scheduleId}
          date={date}
          eligibleStudents={eligibleStudents}
          initialMarks={initialAttendanceMarks}
          today={todayInCentreTimezone(new Date(), timeZone)}
        />
      </div>
    </>
  );
}
