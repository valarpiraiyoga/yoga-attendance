import { notFound } from "next/navigation";
import { CalendarDays, CircleCheck, CircleX, ClipboardCheck, Clock, Layers, Percent, UserRound, Users } from "lucide-react";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import Container from "@/components/layout/Container";
import FieldRow from "@/components/layout/FieldRow";
import PageHeader from "@/components/layout/PageHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import EditAttendanceForm from "@/app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form";

function FieldValue({ children }) {
  return <p className="text-body font-medium break-words text-text-primary">{children}</p>;
}

/**
 * Edit Attendance — same data/workflow. Presentation follows the finalized
 * detail-page system (as Attendance Details does): back link and title, the
 * saved-summary `StatTile`s, a Session Details panel of `FieldRow`s, and the
 * Attendance panel that hosts the roster form.
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

  const summary = computeAttendanceSummary(eligibleStudents.length, marks);
  const batchCode = session.batches?.code || null;
  const batchName = session.batches?.name ?? "Session";

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/attendance-history/${scheduleId}/${date}`, label: "Back to Attendance Details" }}
        title="Edit Attendance"
        description="Correct attendance for this class session."
      />
      <Container className="flex flex-col gap-6">

      <div className="flex flex-col gap-3">
        <StatTileGroup ariaLabel="Saved attendance summary">
          <StatTile icon={Users} label="Eligible" value={summary.eligibleCount} tone="brand" />
          <StatTile icon={CircleCheck} label="Present" value={summary.presentCount} tone="success" />
          <StatTile icon={CircleX} label="Absent" value={summary.absentCount} tone="danger" />
          <StatTile icon={Percent} label="Attendance" value={`${summary.percentage}%`} tone="info" />
        </StatTileGroup>
        <p className="text-small text-text-secondary">
          This is the currently saved summary. Updated totals appear on Review Changes.
        </p>
      </div>

      <Panel>
        <PanelHeader icon={Layers} title="Session Details" className="mb-4 min-h-8" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <FieldRow icon={Layers} label="Batch">
            <FieldValue>{batchName}</FieldValue>
            {batchCode ? <p className="text-small text-text-secondary">Code: {batchCode}</p> : null}
          </FieldRow>
          <FieldRow icon={UserRound} label="Instructor">
            <FieldValue>{session.instructors?.full_name ?? "—"}</FieldValue>
          </FieldRow>
          <FieldRow icon={CalendarDays} label="Date">
            <FieldValue>{formatDateWithWeekday(session.session_date)}</FieldValue>
          </FieldRow>
          <FieldRow icon={Clock} label="Time">
            <FieldValue>{formatTimeRange(session.start_time, session.end_time)}</FieldValue>
          </FieldRow>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          icon={ClipboardCheck}
          title="Attendance"
          description="Change attendance for eligible students."
          className="mb-4 min-h-8"
        />
        <EditAttendanceForm scheduleId={scheduleId} date={date} students={eligibleStudents} initialMarks={marks} />
      </Panel>
      </Container>
    </>
  );
}
