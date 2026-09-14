import Link from "next/link";
import { ArrowLeft, Calendar, Clock, Layers, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";
import MarkSession from "@/app/attendance/[scheduleId]/[date]/mark-session";

function MetricTile({ icon: Icon, value, label, tone }) {
  const tones = {
    warning: "border-warning/20 bg-warning/10 text-warning",
    info: "border-info/20 bg-info/10 text-info",
    success: "border-success/20 bg-success/10 text-success",
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

/**
 * Session Details hero + KPI strip — sibling of Schedule/Batch detail heroes.
 * Folder tabs live in session-details-tabs.js.
 */
export default function SessionHeader({
  session,
  displayStatus,
  scheduleId,
  date,
  isAdmin,
  canEdit,
  canMarkException,
}) {
  const batchName = session.batches?.name ?? "Session";
  const batchCode = session.batches?.code || "—";
  const timeLabel = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
  const instructorName = session.instructors?.full_name ?? "—";
  const dateLabel = formatDate(session.session_date);

  return (
    <div className="mb-6 flex flex-col gap-4">
      <Link
        href="/attendance"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-brand/10 via-surface to-info/10 shadow-xs">
        <section className="relative p-4 sm:p-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -right-6 size-32 rounded-full border border-brand/20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-8 right-12 size-16 rounded-full border border-info/20"
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-brand/40 bg-brand/10 text-small font-semibold text-brand sm:size-[4.25rem]">
                {batchCode}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-page-title font-semibold break-words text-brand">{batchName}</h1>
                  <Badge
                    variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                    className="px-1.5 py-0"
                  >
                    <span className="text-[10px] leading-[14px] font-medium">
                      {DISPLAY_STATUS_LABELS[displayStatus]}
                    </span>
                  </Badge>
                </div>
                <p className="text-small mt-1 text-text-secondary">
                  {dateLabel} · {timeLabel}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {isAdmin && canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-brand/30 bg-surface/80 text-brand hover:bg-brand/5 hover:text-brand"
                  render={<Link href={`/attendance/${scheduleId}/${date}/edit`} />}
                  nativeButton={false}
                >
                  Edit This Session
                </Button>
              ) : null}
              {isAdmin && canMarkException ? <MarkSession scheduleId={scheduleId} date={date} /> : null}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 border-t border-border/50 bg-surface/50 px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3 lg:grid-cols-4">
          <MetricTile
            icon={Layers}
            value={DISPLAY_STATUS_LABELS[displayStatus]}
            label="Status"
            tone="brand"
          />
          <MetricTile icon={Calendar} value={dateLabel} label="Date" tone="info" />
          <MetricTile icon={Clock} value={timeLabel} label="Time" tone="warning" />
          <MetricTile icon={UserRound} value={instructorName} label="Instructor" tone="success" />
        </div>
      </div>
    </div>
  );
}
