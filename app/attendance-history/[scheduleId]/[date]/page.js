import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Hash,
  Pencil,
  Percent,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import AttendanceDetailsRoster from "@/app/attendance-history/[scheduleId]/[date]/attendance-details-roster";

function FieldValue({ children, className }) {
  return <p className={className ?? "text-body font-medium break-words text-text-primary"}>{children}</p>;
}

/** One count in the Student Attendance header: icon, label and number. */
function SummaryCount({ icon: Icon, label, value, valueClassName }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className={`text-body font-semibold ${valueClassName}`}>{value}</dd>
    </div>
  );
}

/**
 * Attendance Details — one flat page (no tabs; the approved IA has a single
 * section): the finalized detail header (batch identity, session facts, Edit
 * Attendance), the four attendance StatTiles and the Student Attendance roster
 * (whose header carries the Present / Absent / Unmarked counts). Behaviour is unchanged — same queries,
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
  const batchCode = session.batches?.code || null;
  const editHref = `/attendance-history/${scheduleId}/${date}/edit`;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance-history"
        className="text-body inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance History
      </Link>

      <EntityDetailHeader
        className="mb-0"
        avatar={<Avatar name={batchName} shape="square" size="lg" />}
        title={batchName}
        status={
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}>{DISPLAY_STATUS_LABELS.completed}</Badge>
        }
        subMeta={
          batchCode ? (
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Batch Code: {batchCode}
            </span>
          ) : null
        }
        actions={
          <Button variant="outline" render={<Link href={editHref} />} nativeButton={false}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit Attendance
          </Button>
        }
        highlight={
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <FieldRow icon={CalendarDays} label="Date">
              <FieldValue>{formatDateWithWeekday(session.session_date)}</FieldValue>
            </FieldRow>
            <FieldRow icon={Clock} label="Time">
              <FieldValue>{formatTimeRange(session.start_time, session.end_time)}</FieldValue>
            </FieldRow>
            <FieldRow icon={UserRound} label="Instructor">
              <FieldValue>{session.instructors?.full_name ?? "—"}</FieldValue>
            </FieldRow>
            <FieldRow icon={Users} label="Eligible Students">
              <FieldValue>{eligibleStudents.length}</FieldValue>
            </FieldRow>
          </div>
        }
      />

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <StatTileGroup ariaLabel="Attendance summary">
        <StatTile icon={Users} label="Eligible" value={summary.eligibleCount} tone="brand" />
        <StatTile icon={CircleCheck} label="Present" value={summary.presentCount} tone="success" />
        <StatTile icon={CircleX} label="Absent" value={summary.absentCount} tone="danger" />
        <StatTile icon={Percent} label="Attendance" value={`${summary.percentage}%`} tone="info" />
      </StatTileGroup>

      <Panel>
        <PanelHeader
          icon={Users}
          title="Student Attendance"
          description="Recorded attendance for this class session."
          className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
          action={
            <dl aria-label="Attendance summary counts" className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <SummaryCount icon={CircleCheck} label="Present" value={summary.presentCount} valueClassName="text-success" />
              <SummaryCount icon={CircleX} label="Absent" value={summary.absentCount} valueClassName="text-danger" />
              <SummaryCount icon={CircleMinus} label="Unmarked" value={summary.unmarkedCount} valueClassName="text-text-primary" />
            </dl>
          }
        />
        <AttendanceDetailsRoster students={eligibleStudents} marksByStudentId={marksByStudentId} editHref={editHref} />
      </Panel>
    </div>
  );
}
