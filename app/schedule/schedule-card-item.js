import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DAY_LABELS } from "@/lib/schedules/validation";

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
 * Schedule card — batch/status first, then day/time, instructor, effective
 * dates. View remains the only list action (Edit/Deactivate live on Details).
 */
export default function ScheduleCardItem({ schedule }) {
  const isActive = schedule.status === "active";
  const batchName = schedule.batches?.name ?? null;
  const batchCode = schedule.batches?.code ?? null;
  const instructorName = schedule.instructors?.full_name ?? null;
  const dayLabel = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-info/10 via-surface/80 to-brand/10 p-3.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info/15 text-small font-semibold text-info"
        >
          {batchCode || "—"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold leading-snug text-text-primary">
            {batchName || "—"}
          </h3>
          <p className="text-small mt-0.5 truncate text-text-secondary">
            {batchCode ? `Code: ${batchCode}` : "No batch"}
          </p>
        </div>
        <Badge variant={isActive ? "success" : "danger"} className="shrink-0 rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            {isActive ? "Active" : "Inactive"}
          </span>
        </Badge>
      </div>

      <div className="grid grid-cols-2 border-y border-border/50 py-2.5">
        <div className="min-w-0 pr-2">
          <p className="truncate text-body font-semibold leading-snug text-text-primary">{dayLabel}</p>
          <p className="text-small mt-0.5 text-text-secondary">Day</p>
        </div>
        <div className="min-w-0 border-l border-border/50 pl-3">
          <p className="truncate text-body font-semibold leading-snug text-text-primary">
            {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
          </p>
          <p className="text-small mt-0.5 text-text-secondary">Time</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-border/60 text-[10px] font-semibold text-text-secondary"
        >
          {instructorName ? getInitials(instructorName) : "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{instructorName || "—"}</p>
          <p className="text-small truncate text-text-secondary">Instructor</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-secondary">
        <span>
          From{" "}
          <span className="font-medium text-text-primary">{formatDate(schedule.effective_from)}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Until{" "}
          <span className="font-medium text-text-primary">
            {schedule.effective_until ? formatDate(schedule.effective_until) : "—"}
          </span>
        </span>
      </div>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
          render={<Link href={`/schedule/${schedule.id}`} />}
          nativeButton={false}
        >
          View Schedule
        </Button>
      </div>
    </article>
  );
}
