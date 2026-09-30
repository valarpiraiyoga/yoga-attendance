import { notFound } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import SessionHeader from "@/app/attendance/[scheduleId]/[date]/session-header";
import EditAttendanceForm from "@/app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form";

/**
 * Edit Attendance — same data and workflow (Review Changes before saving), laid
 * out like Take Attendance: the compact page strip, the same one-line session
 * summary (`session-header.js`, no overflow menu here), then the roster form with
 * its progress bar and Cancel / Review Changes.
 */
export default async function EditAttendancePage({ params }) {
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

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/attendance-history/${scheduleId}/${date}`, label: "Back to Attendance Details" }}
        title="Edit Attendance"
        description="Correct attendance for this class session."
      />

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

        <EditAttendanceForm scheduleId={scheduleId} date={date} students={eligibleStudents} initialMarks={marks} />
      </div>
    </>
  );
}
