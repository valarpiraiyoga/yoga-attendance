import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { deriveDisplayStatus } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession, getAttendanceSummary } from "@/lib/attendance/data";
import SessionHeader from "@/app/attendance/[scheduleId]/[date]/session-header";
import SessionOverview from "@/app/attendance/[scheduleId]/[date]/session-overview";
import EligibleStudentsList from "@/app/attendance/[scheduleId]/[date]/eligible-students-list";
import AttendancePanel from "@/app/attendance/[scheduleId]/[date]/attendance-panel";

const SUCCESS_MESSAGES = {
  updated: "Session updated successfully.",
  unchanged: "No changes were made.",
};

/**
 * Session Details (approved wireframe: Overview / Eligible Students /
 * Attendance), addressed by `(scheduleId, date)` rather than a
 * `class_sessions` id — a class session has no product-facing identifier
 * (01-product.md §7A), and a projected occurrence has no `id` at all, so
 * this is the only address that works for both a materialized and an
 * unmaterialized occurrence (approved Phase 14 decision).
 *
 * All three tabs share one header (`session-header.js`) and the finalized
 * panels; the Attendance tab is the focused Take / View Attendance view. Data
 * fetching and `?tab=` routing are unchanged.
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

  const displayStatus = deriveDisplayStatus(session);
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;
  const activeTab =
    rawParams?.tab === "eligible" ? "eligible" : rawParams?.tab === "attendance" ? "attendance" : "overview";

  const eligibleStudents =
    activeTab === "eligible" || activeTab === "attendance"
      ? await listEligibleStudents(session.batch_id, session.schedule_id, session.session_date)
      : [];

  const initialAttendanceMarks =
    activeTab === "attendance" && session.id ? await getAttendanceForSession(session.id) : [];

  const attendanceSummary =
    activeTab === "overview"
      ? await getAttendanceSummary(session.id, session.batch_id, session.schedule_id, session.session_date)
      : null;

  const eligibleCount = activeTab === "overview" ? (attendanceSummary?.eligibleCount ?? 0) : eligibleStudents.length;

  return (
    <div className="flex flex-col gap-6">
      <SessionHeader
        session={session}
        displayStatus={displayStatus}
        scheduleId={scheduleId}
        date={date}
        activeTab={activeTab}
        eligibleCount={eligibleCount}
        isAdmin={isAdmin}
        canEdit={displayStatus === "upcoming"}
        canMarkException={session.status === "scheduled"}
      />

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <SessionOverview
          session={session}
          displayStatus={displayStatus}
          scheduleId={scheduleId}
          date={date}
          attendanceSummary={attendanceSummary}
        />
      ) : null}

      {activeTab === "eligible" ? <EligibleStudentsList students={eligibleStudents} batch={session.batches} /> : null}

      {activeTab === "attendance" ? (
        <AttendancePanel
          session={session}
          scheduleId={scheduleId}
          date={date}
          eligibleStudents={eligibleStudents}
          initialMarks={initialAttendanceMarks}
        />
      ) : null}
    </div>
  );
}
