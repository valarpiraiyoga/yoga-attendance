import Link from "next/link";
import { Clock, Eye, Layers, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataTableShell from "@/components/ui/data-table-shell";
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
 * Today's Sessions — Batches-style card grid (white cards in DataTableShell)
 * for fast scanning. Same data/actions as before; presentation only.
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

      <DataTableShell tone="info">
        <div
          className="grid grid-cols-1 items-stretch gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4"
          aria-label="Today's Sessions"
        >
          {sessions.map((session) => {
            const displayStatus = deriveDisplayStatus(session);
            const actionLabel = resolveAction(session, today);
            const instructorName = session.instructors?.full_name ?? null;
            const eligibleCount = session.attendanceSummary?.eligibleCount ?? 0;
            const batchCode = session.batches?.code || "—";
            const batchName = session.batches?.name ?? "—";
            const timeLabel = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
            const href = `/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`;

            return (
              <article
                key={session.id ?? `${session.schedule_id}:${session.session_date}`}
                className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
                  >
                    {batchCode}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <h3
                          className="truncate text-body font-semibold leading-snug text-text-primary"
                          title={batchName}
                        >
                          {batchName}
                        </h3>
                        <Badge
                          variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                          className="mt-1 rounded-full px-2 py-0"
                        >
                          <span className="text-[10px] leading-[14px] font-medium">
                            {DISPLAY_STATUS_LABELS[displayStatus]}
                          </span>
                        </Badge>
                      </div>

                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                        aria-label={actionLabel}
                        render={<Link href={href} />}
                        nativeButton={false}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 text-small text-text-secondary">
                  <span className="inline-flex min-w-0 items-center gap-2" title={`Code: ${batchCode}`}>
                    <Layers className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      Code: <span className="font-semibold text-text-primary">{batchCode}</span>
                    </span>
                  </span>

                  <span className="inline-flex min-w-0 items-center gap-2" title={timeLabel}>
                    <Clock className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span className="min-w-0 truncate">{timeLabel}</span>
                  </span>

                  <span className="inline-flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold leading-none text-brand"
                    >
                      {instructorName ? getInitials(instructorName) : "?"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-text-primary">
                        {instructorName || "—"}
                      </span>
                      <span className="block text-small text-text-secondary">Instructor</span>
                    </span>
                  </span>

                  <span
                    className="inline-flex min-w-0 items-center gap-2"
                    title={`Eligible: ${eligibleCount}`}
                  >
                    <Users className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      Eligible:{" "}
                      <span className="font-semibold text-text-primary">{eligibleCount}</span>
                    </span>
                  </span>
                </div>

                <div className="mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 w-full rounded-full border-border/80 bg-surface text-small font-semibold text-text-primary shadow-xs hover:bg-background hover:text-text-primary"
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
      </DataTableShell>
    </div>
  );
}
