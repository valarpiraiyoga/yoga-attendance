import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Calendar, ClipboardCheck, Clock, Layers, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import AttendanceDetailsRoster from "@/app/attendance-history/[scheduleId]/[date]/attendance-details-roster";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value, options = {}) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  });
}

function MetricTile({ icon: Icon, value, label, tone }) {
  const tones = {
    warning: "border-warning/20 bg-warning/10 text-warning",
    info: "border-info/20 bg-info/10 text-info",
    success: "border-success/20 bg-success/10 text-success",
    danger: "border-danger/20 bg-danger/10 text-danger",
    brand: "border-brand/20 bg-brand/10 text-brand",
  };

  return (
    <div className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 ${tones[tone] ?? tones.brand}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 shadow-xs">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
          {label}
        </p>
        <p className="truncate text-body font-semibold tracking-tight text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  const tones = {
    brand: "border-brand/20 bg-brand/10",
    success: "border-success/20 bg-success/10",
    danger: "border-danger/20 bg-danger/10",
    warning: "border-warning/20 bg-warning/10",
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

/**
 * Attendance Details — flatter page (no tabs), visual sibling of Session
 * Details hero + summary + roster. Behaviour unchanged.
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
  const batchCode = session.batches?.code || "—";
  const timeLabel = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
  const dateLabel = formatDate(session.session_date);
  const instructorName = session.instructors?.full_name ?? "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <Link
          href="/attendance-history"
          className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Attendance History
        </Link>

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface to-brand/10 shadow-xs">
          <section className="relative p-4 sm:p-5">
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-info/40 bg-info/10 text-small font-semibold text-info sm:size-[4.25rem]">
                  {batchCode}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-page-title font-semibold break-words text-brand">{batchName}</h1>
                    <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="px-1.5 py-0">
                      <span className="text-[10px] leading-[14px] font-medium">
                        {DISPLAY_STATUS_LABELS.completed}
                      </span>
                    </Badge>
                  </div>
                  <p className="text-small mt-1 text-text-secondary">
                    {dateLabel} · {timeLabel}
                  </p>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                render={<Link href={`/attendance-history/${scheduleId}/${date}/edit`} />}
                nativeButton={false}
              >
                Edit Attendance
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
            <MetricTile icon={Calendar} value={dateLabel} label="Date" tone="info" />
            <MetricTile icon={Clock} value={timeLabel} label="Time" tone="warning" />
            <MetricTile icon={UserRound} value={instructorName} label="Instructor" tone="brand" />
            <MetricTile icon={Layers} value={DISPLAY_STATUS_LABELS.completed} label="Status" tone="success" />
          </div>
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-body font-semibold text-text-primary">
          <ClipboardCheck className="size-4 text-text-secondary" aria-hidden="true" />
          Attendance Summary
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="Eligible" value={summary.eligibleCount} tone="info" />
          <SummaryTile label="Present" value={summary.presentCount} tone="success" />
          <SummaryTile label="Absent" value={summary.absentCount} tone="danger" />
          <SummaryTile label="Attendance" value={`${summary.percentage}%`} tone="brand" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="text-body font-semibold text-text-primary">Attendance Roster</h2>
        <p className="text-small mt-1 mb-4 text-text-secondary">
          Recorded attendance for this class session.
        </p>
        <AttendanceDetailsRoster students={eligibleStudents} marksByStudentId={marksByStudentId} />
      </div>
    </div>
  );
}
