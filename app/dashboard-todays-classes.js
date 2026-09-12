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

// Same split as app/attendance/today-sessions-list.js's own `resolveAction`
// (Phase 15 Slice 3): based on the session's persisted `status` and
// `session_date`, never `deriveDisplayStatus` — a cancelled/holiday session
// never takes attendance regardless of its clock-derived display status.
// Duplicated rather than imported: this table is the Dashboard's own
// (approved wireframes p.2, p.8), a structural sibling of Today's Sessions
// rather than a shared component — the same boundary Attendance History's
// admin/instructor list components already keep from each other.
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
 * Today's Classes (`01-product.md` §3; wireframes p.2 Instructor, p.8
 * Admin). One column set for both roles, with `showInstructor` for the one
 * approved difference: Admin's table names who teaches each class, an
 * Instructor's own table omits it (redundant when every row is already
 * theirs) — exactly the columns each role's Dashboard bullet list
 * specifies.
 *
 * `session.attendanceSummary` is attached by the caller
 * (`getAttendanceSummaries`, `lib/attendance/data.js` — the same batched,
 * one-round-trip summary Attendance's own Today's/All Sessions use, not a
 * per-row query here). ACTION always links to the existing Session Details
 * route (`/attendance/[scheduleId]/[date]`), the same "Direct access to
 * attendance" entry point Attendance itself uses — no second concept
 * invented for the Dashboard (`02-ux.md` "Avoid Duplication").
 */
export default function DashboardTodaysClasses({ sessions, showInstructor }) {
  const today = todayInCentreTimezone();

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Today's Classes">
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            {showInstructor ? <TableHead>Instructor</TableHead> : null}
            <TableHead>Student Count</TableHead>
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
                {showInstructor ? (
                  <TableCell className="text-text-secondary">{session.instructors?.full_name ?? "—"}</TableCell>
                ) : null}
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
