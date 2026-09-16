import Link from "next/link";
import { ArrowRight, BarChart3, Check, Clock, Eye, Users, X } from "lucide-react";
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

function formatDayOfWeek(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    .toUpperCase();
}

function formatDayNumber(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).getUTCDate();
}

function formatMonthYear(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
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

const CHIP_TONES = {
  info: { chip: "border-info/20 bg-info/10", icon: "bg-info text-surface" },
  success: { chip: "border-success/20 bg-success/10", icon: "bg-success text-surface" },
  danger: { chip: "border-danger/20 bg-danger/10", icon: "bg-danger text-surface" },
  purple: { chip: "border-purple-200 bg-purple-50", icon: "bg-purple-500 text-surface" },
};

function SummaryChip({ icon: Icon, label, value, tone }) {
  const palette = CHIP_TONES[tone] ?? CHIP_TONES.info;

  return (
    <div
      className={`flex min-w-[4.25rem] flex-col items-center gap-1 rounded-xl border px-2.5 py-2 text-center ${palette.chip}`}
    >
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${palette.icon}`}>
        <Icon className="size-3" aria-hidden="true" />
      </span>
      <p className="text-body leading-none font-bold text-text-primary">{value}</p>
      <p className="text-[10px] leading-[14px] font-medium text-text-secondary">{label}</p>
    </div>
  );
}

/**
 * Shared history card — a single full-width row: date block, batch/instructor
 * identity, session details, the Eligible/Present/Absent/Rate summary chips,
 * and the View Details action, all in one line on wider screens and stacked
 * on narrow ones. `variant` only toggles the admin instructor row vs
 * instructor Completed badge (wireframe column sets) — same as before,
 * carried over onto the new row layout.
 */
export default function HistorySessionCard({ session, variant = "admin" }) {
  const summary = session.attendanceSummary;
  const instructorName = session.instructors?.full_name ?? null;
  const href = `/attendance-history/${session.schedule_id}/${session.session_date}`;
  const batchCode = session.batches?.code || "—";
  const batchName = session.batches?.name ?? "—";

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:gap-5">
      <div className="flex shrink-0 flex-col items-center justify-center rounded-xl bg-background px-3 py-2 text-center sm:w-[4.5rem]">
        <p className="text-[10px] leading-[14px] font-semibold tracking-wide text-text-secondary uppercase">
          {formatDayOfWeek(session.session_date)}
        </p>
        <p className="text-page-title leading-tight font-bold text-text-primary">
          {formatDayNumber(session.session_date)}
        </p>
        <p className="text-[10px] leading-[14px] text-text-secondary whitespace-nowrap">
          {formatMonthYear(session.session_date)}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
          >
            {batchCode}
          </span>
          {variant === "admin" ? (
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand"
            >
              {instructorName ? getInitials(instructorName) : "?"}
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-body font-semibold leading-snug text-text-primary" title={batchName}>
              {batchName}
            </h3>
            {variant === "instructor" ? (
              <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="shrink-0 rounded-full px-2 py-0">
                <span className="text-[10px] leading-[14px] font-medium">{DISPLAY_STATUS_LABELS.completed}</span>
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-small text-text-secondary">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            {formatTime(session.start_time)} – {formatTime(session.end_time)}
          </p>
          {variant === "admin" ? (
            <div className="mt-1 min-w-0">
              <p className="truncate text-small font-semibold text-text-primary">{instructorName || "—"}</p>
              <p className="text-[11px] leading-[14px] text-text-secondary">Instructor</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:flex sm:shrink-0">
        <SummaryChip icon={Users} label="Eligible" value={summary?.eligibleCount ?? 0} tone="info" />
        <SummaryChip icon={Check} label="Present" value={summary?.presentCount ?? 0} tone="success" />
        <SummaryChip icon={X} label="Absent" value={summary?.absentCount ?? 0} tone="danger" />
        <SummaryChip icon={BarChart3} label="Rate" value={`${summary?.percentage ?? 0}%`} tone="purple" />
      </div>

      <Button
        size="sm"
        className="h-10 shrink-0 gap-1.5 rounded-full bg-brand px-5 text-small font-semibold text-surface shadow-sm hover:bg-brand/90"
        render={<Link href={href} />}
        nativeButton={false}
      >
        <Eye className="size-4" aria-hidden="true" />
        View Details
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </article>
  );
}
