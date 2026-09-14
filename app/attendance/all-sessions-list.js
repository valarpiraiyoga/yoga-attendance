import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
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

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Mirrors today-sessions-list.js's `resolveAction` exactly (see that file's
// comment for the reasoning) — kept as its own small copy rather than a
// shared import, the same local-duplication convention this file already
// follows for `formatTime`/`formatDate`.
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
 * All Sessions table (approved wireframe columns: DATE, TIME, BATCH,
 * INSTRUCTOR, ELIGIBLE STUDENTS, SESSION STATUS, ATTENDANCE, ACTION). Rows
 * are a mix of materialized `class_sessions` records and unmaterialized
 * projected occurrences (lib/class-sessions/data.js's `listSessions`) —
 * the same blend Today's Sessions shows, just across a wider date range.
 *
 * ELIGIBLE STUDENTS and ATTENDANCE both read `session.attendanceSummary`
 * (`getAttendanceSummary`, lib/attendance/data.js), attached per row by
 * app/attendance/page.js's `withAttendanceSummaries` — this component only
 * displays it, it does not resolve eligibility or attendance itself.
 * ATTENDANCE shows the saved percentage only once a session is actually
 * `completed`; every other status shows "—" (01-product.md §8 — a session
 * that has not been completed has no attendance percentage to show, not a
 * zero one).
 *
 * ACTION now varies by status (`resolveAction` above) and always links to
 * Session Details' Attendance tab (`?tab=attendance`), including the
 * "View Session" cases — see today-sessions-list.js's comment for why that
 * tab is the right destination even when attendance cannot be taken.
 */
export default function AllSessionsList({ sessions }) {
  const today = todayInCentreTimezone();

  return (
    <DataTableShell>
      <Table aria-label="All Sessions">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Eligible Students</TableHead>
            <TableHead>Session Status</TableHead>
            <TableHead>Attendance</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const displayStatus = deriveDisplayStatus(session);
            return (
              <TableRow key={`${session.schedule_id}:${session.session_date}`}>
                <TableCell className="text-text-secondary">{formatDate(session.session_date)}</TableCell>
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
                <TableCell className="text-text-secondary">
                  {session.status === "completed" ? `${session.attendanceSummary?.percentage ?? 0}%` : "—"}
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
    </DataTableShell>
  );
}
