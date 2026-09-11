import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

// The Take Attendance / View Attendance / View Session split (Phase 15
// Slice 3; approved wireframe: TIME, BATCH, INSTRUCTOR, ELIGIBLE STUDENTS,
// STATUS, ACTION). Based on the session's own persisted `status` and
// `session_date`, not `deriveDisplayStatus` — a cancelled/holiday session
// never takes attendance regardless of how its clock-derived display status
// would read, and "future" here means date-only (AttendancePanel's own
// blocked-future rule), not time-of-day.
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
 * Today's Sessions table (approved wireframe columns: TIME, BATCH,
 * INSTRUCTOR, ELIGIBLE STUDENTS, STATUS, ACTION). ELIGIBLE STUDENTS reads
 * `session.attendanceSummary.eligibleCount` — attached by
 * app/attendance/page.js's `withAttendanceSummaries`, which calls the
 * existing `getAttendanceSummary` (lib/attendance/data.js) per row; this
 * component only displays it, it does not resolve eligibility itself.
 *
 * ACTION now varies by status (`resolveAction` above) and always links to
 * Session Details' Attendance tab (`?tab=attendance`) — including the
 * "View Session" cases (cancelled/holiday, future-dated), since that tab
 * already renders the matching explanatory blocked state
 * (attendance-panel.js) rather than requiring a separate Overview link.
 * The link itself is always a plain navigation, never an action that
 * writes anything: Session Details is addressed by `(schedule_id,
 * session_date)` (`/attendance/[scheduleId]/[date]`), which a projected
 * occurrence already has without needing a `class_sessions` row — see
 * lib/class-sessions/data.js's `getSessionOccurrence`. Viewing a session
 * never materializes it (01-product.md §7A).
 */
export default function TodaySessionsList({ sessions }) {
  const today = todayInCentreTimezone();

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Today's Sessions">
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Eligible Students</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const displayStatus = deriveDisplayStatus(session);
            return (
              <TableRow key={session.id ?? `${session.schedule_id}:${session.session_date}`}>
                <TableCell className="text-text-secondary">
                  {formatTime(session.start_time)} – {formatTime(session.end_time)}
                </TableCell>
                <TableCell>
                  {session.batches ? (
                    <>
                      <p className="font-medium text-text-primary">{session.batches.name}</p>
                      <p className="text-small text-text-secondary">{session.batches.code}</p>
                    </>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </TableCell>
                <TableCell className="text-text-secondary">{session.instructors?.full_name ?? "—"}</TableCell>
                <TableCell className="text-text-secondary">{session.attendanceSummary?.eligibleCount ?? 0}</TableCell>
                <TableCell>
                  <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>
                    {DISPLAY_STATUS_LABELS[displayStatus]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`}
                    className="text-body font-medium text-brand hover:underline"
                  >
                    {resolveAction(session, today)}
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
