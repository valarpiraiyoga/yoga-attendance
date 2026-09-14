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
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Instructor's Attendance History table (approved wireframe p.6: DATE,
 * TIME, BATCH/CLASS, ELIGIBLE STUDENTS, PRESENT, ABSENT, STATUS, ACTION —
 * a different column set from Admin's table, notably a STATUS badge
 * instead of an Attendance % column, matching the wireframe exactly).
 *
 * Rows already come pre-scoped to sessions this instructor is authorized
 * to access — `listAttendanceHistory` (lib/attendance-history/data.js)
 * runs under the caller's own RLS-bound session, and
 * `class_sessions_select_instructor`/`attendance_select_instructor`
 * (`0014_instructor_attendance_access.sql`) already restrict the rows to
 * their own before this component ever sees them. No ownership check is
 * repeated here.
 *
 * STATUS is always "Completed" (`DISPLAY_STATUS_LABELS.completed`) — every
 * row is a completed session by construction, same as Admin's table; shown
 * as a badge here because the wireframe shows one, reusing the same
 * label/variant map Session Details and the session lists already use
 * rather than hardcoding a second "Completed" string and color.
 *
 * ACTION links to the planned Attendance Details route, same as Admin's
 * table — see admin-history-list.js's comment for why that address form is
 * used and why the route can be linked before its own page exists.
 */
export default function InstructorHistoryList({ sessions }) {
  return (
    <DataTableShell>
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch / Class</TableHead>
            <TableHead>Eligible Students</TableHead>
            <TableHead>Present</TableHead>
            <TableHead>Absent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
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
              <TableCell className="text-text-secondary">{session.attendanceSummary?.eligibleCount ?? 0}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.presentCount ?? 0}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.absentCount ?? 0}</TableCell>
              <TableCell>
                <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}>{DISPLAY_STATUS_LABELS.completed}</Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/attendance-history/${session.schedule_id}/${session.session_date}`}
                  className="text-body font-medium text-brand hover:underline"
                >
                  View Attendance
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
