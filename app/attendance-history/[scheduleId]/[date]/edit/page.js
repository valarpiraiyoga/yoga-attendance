import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, ClipboardCheck, Clock, Layers, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import EditAttendanceForm from "@/app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function SummaryTile({ label, value, tone }) {
  const tones = {
    brand: "border-brand/20 bg-brand/10",
    success: "border-success/20 bg-success/10",
    danger: "border-danger/20 bg-danger/10",
    info: "border-info/20 bg-info/10",
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tones[tone] ?? tones.brand}`}>
      <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-body font-semibold tracking-tight text-text-primary">{value}</p>
    </div>
  );
}

function FieldRow({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <p className="text-small text-text-secondary">{label}</p>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Edit Attendance — same data/workflow; presentation aligned with Attendance
 * marking and Attendance Details.
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
  const batchCode = session.batches?.code || "—";
  const batchName = session.batches?.name ?? "Session";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/attendance-history/${scheduleId}/${date}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance Details
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-page-title font-semibold text-text-primary">Edit Attendance</h1>
        <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="px-1.5 py-0">
          <span className="text-[10px] leading-[14px] font-medium">{DISPLAY_STATUS_LABELS.completed}</span>
        </Badge>
      </div>
      <p className="text-small -mt-2 text-text-secondary">Correct attendance for this class session.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border/70 bg-surface p-4 shadow-xs sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-body font-semibold text-text-primary">
            <Layers className="size-4 text-text-secondary" aria-hidden="true" />
            Session Details
          </h2>
          <div className="overflow-hidden rounded-xl border border-info/20 bg-info/5">
            <div className="flex items-start gap-3 bg-info/10 px-3.5 py-3.5">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/15 text-small font-semibold text-info"
              >
                {batchCode}
              </span>
              <div className="min-w-0">
                <p className="text-body font-semibold text-text-primary">{batchName}</p>
                <p className="text-small mt-1 text-text-secondary">Code: {batchCode}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-info/15 px-3.5 py-3">
              <FieldRow icon={UserRound} label="Instructor">
                <p className="truncate text-body font-semibold text-text-primary">
                  {session.instructors?.full_name ?? "—"}
                </p>
              </FieldRow>
              <FieldRow icon={Calendar} label="Date">
                <p className="truncate text-body font-semibold text-text-primary">
                  {formatDate(session.session_date)}
                </p>
              </FieldRow>
              <FieldRow icon={Clock} label="Time">
                <p className="truncate text-body font-semibold text-text-primary">
                  {formatTime(session.start_time)} – {formatTime(session.end_time)}
                </p>
              </FieldRow>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-surface p-4 shadow-xs sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-body font-semibold text-text-primary">
            <ClipboardCheck className="size-4 text-text-secondary" aria-hidden="true" />
            Saved Summary
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <SummaryTile label="Eligible" value={summary.eligibleCount} tone="info" />
            <SummaryTile label="Present" value={summary.presentCount} tone="success" />
            <SummaryTile label="Absent" value={summary.absentCount} tone="danger" />
            <SummaryTile label="Attendance" value={`${summary.percentage}%`} tone="brand" />
          </div>
          <p className="text-small mt-3 text-text-secondary">
            This is the currently saved summary. Updated totals appear on Review Changes.
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-border/70 bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="text-body font-semibold text-text-primary">Attendance</h2>
        <p className="text-small mt-1 mb-4 text-text-secondary">Change attendance for eligible students.</p>
        <EditAttendanceForm scheduleId={scheduleId} date={date} students={eligibleStudents} initialMarks={marks} />
      </section>
    </div>
  );
}
