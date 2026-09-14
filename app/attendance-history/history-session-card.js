import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";

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
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Shared history card — date first, then batch/session, instructor+time,
 * attendance summary chips, View action. `variant` only toggles the
 * admin instructor row vs instructor Completed badge (wireframe column sets).
 */
export default function HistorySessionCard({ session, variant = "admin" }) {
  const summary = session.attendanceSummary;
  const instructorName = session.instructors?.full_name ?? null;
  const href = `/attendance-history/${session.schedule_id}/${session.session_date}`;

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface/80 to-brand/10 p-3.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-wide text-text-secondary uppercase">Date</p>
          <p className="text-body font-semibold text-text-primary">{formatDate(session.session_date)}</p>
        </div>
        {variant === "instructor" ? (
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="shrink-0 rounded-full px-2 py-0">
            <span className="text-[10px] leading-[14px] font-medium">{DISPLAY_STATUS_LABELS.completed}</span>
          </Badge>
        ) : null}
      </div>

      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info/15 text-small font-semibold text-info"
        >
          {session.batches?.code || "—"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold leading-snug text-text-primary">
            {session.batches?.name ?? "—"}
          </h3>
          <p className="text-small mt-0.5 text-text-secondary">
            {formatTime(session.start_time)} – {formatTime(session.end_time)}
          </p>
        </div>
      </div>

      {variant === "admin" ? (
        <div className="flex min-w-0 items-center gap-2.5 border-y border-border/50 py-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand"
          >
            {instructorName ? getInitials(instructorName) : "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-body font-semibold text-text-primary">{instructorName || "—"}</p>
            <p className="text-small text-text-secondary">Instructor</p>
          </div>
        </div>
      ) : null}

      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${variant === "instructor" ? "border-t border-border/50 pt-2.5" : ""}`}>
        <SummaryChip label="Eligible" value={summary?.eligibleCount ?? 0} tone="info" />
        <SummaryChip label="Present" value={summary?.presentCount ?? 0} tone="success" />
        <SummaryChip label="Absent" value={summary?.absentCount ?? 0} tone="danger" />
        <SummaryChip label="Rate" value={`${summary?.percentage ?? 0}%`} tone="brand" />
      </div>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
          render={<Link href={href} />}
          nativeButton={false}
        >
          View Details
        </Button>
      </div>
    </article>
  );
}

function SummaryChip({ label, value, tone }) {
  const tones = {
    info: "border-info/20 bg-info/10",
    success: "border-success/20 bg-success/10",
    danger: "border-danger/20 bg-danger/10",
    brand: "border-brand/20 bg-brand/10",
  };

  return (
    <div className={`rounded-lg border px-2 py-1.5 ${tones[tone] ?? tones.brand}`}>
      <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
        {label}
      </p>
      <p className="text-small font-semibold text-text-primary">{value}</p>
    </div>
  );
}
