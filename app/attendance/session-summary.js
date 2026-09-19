import {
  deriveDisplayStatus,
  DISPLAY_STATUS_BADGE_VARIANTS,
  DISPLAY_STATUS_LABELS,
} from "@/lib/class-sessions/validation";
import { formatDate, formatTimeRange } from "@/lib/format";

/**
 * Everything the Attendance session card and table row both show, derived
 * once from a session occurrence (with its `attendanceSummary`) so the two
 * layouts can never disagree. Presentation only — no data is read here.
 *
 * `actionLabel` is the session's primary action: Cancelled / Holiday
 * sessions have no attendance, a completed one is viewed, and a session
 * that has started (or is today's and not yet started) is taken.
 */
export function summarizeSession(session, today) {
  const displayStatus = deriveDisplayStatus(session);
  const isCompleted = session.status === "completed";

  let actionLabel = "View Session";
  if (session.status === "completed") actionLabel = "View Attendance";
  else if (session.status !== "cancelled" && session.status !== "holiday" && session.session_date <= today) {
    actionLabel = "Take Attendance";
  }

  const eligibleCount = session.attendanceSummary?.eligibleCount ?? 0;
  const basePath = `/attendance/${session.schedule_id}/${session.session_date}`;

  return {
    key: session.id ?? `${session.schedule_id}:${session.session_date}`,
    batchName: session.batches?.name ?? "—",
    batchCode: session.batches?.code ?? null,
    instructor: session.instructors?.full_name ?? "—",
    dateLabel: formatDate(session.session_date),
    timeLabel: formatTimeRange(session.start_time, session.end_time),
    status: { label: DISPLAY_STATUS_LABELS[displayStatus], variant: DISPLAY_STATUS_BADGE_VARIANTS[displayStatus] },
    eligibleCount,
    eligibleLabel: `${eligibleCount} eligible ${eligibleCount === 1 ? "student" : "students"}`,
    attendanceLabel: isCompleted ? `${session.attendanceSummary?.percentage ?? 0}%` : null,
    actionLabel,
    actionHref: `${basePath}?tab=attendance`,
    detailsHref: basePath,
  };
}
