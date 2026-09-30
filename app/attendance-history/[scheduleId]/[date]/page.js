import { notFound } from "next/navigation";
import FlashToast from "@/components/ui/flash-toast";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import SessionHeader from "@/app/attendance/[scheduleId]/[date]/session-header";
import AttendanceDetailsRoster from "@/app/attendance-history/[scheduleId]/[date]/attendance-details-roster";

/**
 * Attendance Details — laid out like Take Attendance: the compact page strip, the
 * same one-line session summary (`session-header.js`, no overflow menu here), then
 * the recorded roster and its progress bar with Edit Attendance
 * (`attendance-details-roster.js`). Behaviour is unchanged — same queries,
 * calculations, routes and permissions.
 */
export default async function AttendanceDetailsPage({ params, searchParams }) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session || session.status !== "completed") {
    notFound();
  }

  const [eligibleStudents, marks] = await Promise.all([
    listEligibleStudents(session.batch_id, session.schedule_id, session.session_date),
    getAttendanceForSession(session.id),
  ]);

  const marksByStudentId = Object.fromEntries(marks.map((mark) => [mark.student_id, mark.status]));
  const summary = computeAttendanceSummary(eligibleStudents.length, marks);

  const rawParams = await searchParams;
  const changeCount = Number(rawParams?.changes);
  const message =
    rawParams?.success === "updated"
      ? `Attendance updated successfully.${
          Number.isInteger(changeCount) && changeCount > 0
            ? ` ${changeCount} attendance change${changeCount === 1 ? "" : "s"} saved.`
            : ""
        }`
      : null;

  const batchName = session.batches?.name ?? "Session";

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/attendance-history", label: "Back to Attendance History" }}
        title="Attendance Details"
        description={`Recorded attendance for ${batchName}.`}
      />
      <FlashToast message={message} />

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <SessionHeader
          session={session}
          displayStatus="completed"
          scheduleId={scheduleId}
          date={date}
          isAdmin={false}
          canEdit={false}
          canMarkException={false}
        />

        <AttendanceDetailsRoster
          students={eligibleStudents}
          marksByStudentId={marksByStudentId}
          summary={summary}
          editHref={`/attendance-history/${scheduleId}/${date}/edit`}
        />
      </div>
    </>
  );
}
