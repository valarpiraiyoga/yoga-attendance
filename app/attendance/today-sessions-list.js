import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deriveDisplayStatus,
  todayInCentreTimezone,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
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

function resolveAction(session, today) {
  if (session.status === "cancelled" || session.status === "holiday") {
    return "View Session";
  }
  if (session.status === "completed") {
    return "View Attendance";
  }
  return session.session_date <= today ? "Take Attendance" : "View Session";
}

/**
 * Today's Sessions — card grid for fast scanning (time, batch, instructor,
 * eligible count, status, primary action). Same data/actions as before;
 * presentation only.
 */
export default function TodaySessionsList({ sessions }) {
  const today = todayInCentreTimezone();

  return (
    <div className="mt-2">
      <div className="mb-3">
        <p className="text-body font-medium text-text-primary">
          {sessions.length} {sessions.length === 1 ? "Session" : "Sessions"} today
        </p>
        <p className="text-small text-text-secondary">Tap a session to take or view attendance</p>
      </div>

      <div
        className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Today's Sessions"
      >
        {sessions.map((session) => {
          const displayStatus = deriveDisplayStatus(session);
          const actionLabel = resolveAction(session, today);
          const instructorName = session.instructors?.full_name ?? null;
          const eligibleCount = session.attendanceSummary?.eligibleCount ?? 0;
          const href = `/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`;

          return (
            <article
              key={session.id ?? `${session.schedule_id}:${session.session_date}`}
              className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-brand/10 via-surface/80 to-info/10 p-3.5 shadow-sm backdrop-blur-sm"
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
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
                <Badge
                  variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                  className="shrink-0 rounded-full px-2 py-0"
                >
                  <span className="text-[10px] leading-[14px] font-medium">
                    {DISPLAY_STATUS_LABELS[displayStatus]}
                  </span>
                </Badge>
              </div>

              <div className="flex min-w-0 items-center gap-2.5 border-y border-border/50 py-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-border/60 text-[10px] font-semibold text-text-secondary"
                >
                  {instructorName ? getInitials(instructorName) : "?"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-text-primary">
                    {instructorName || "—"}
                  </p>
                  <p className="text-small text-text-secondary">Instructor</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-secondary">
                <span>
                  Eligible{" "}
                  <span className="font-medium text-text-primary">{eligibleCount}</span>
                </span>
              </div>

              <div className="mt-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
                  render={<Link href={href} />}
                  nativeButton={false}
                >
                  {actionLabel}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
