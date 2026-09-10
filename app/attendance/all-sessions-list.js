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
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";

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
 * All Sessions table (approved wireframe columns: DATE, TIME, BATCH,
 * INSTRUCTOR, ELIGIBLE STUDENTS, SESSION STATUS, ATTENDANCE, ACTION). Rows
 * are a mix of materialized `class_sessions` records and unmaterialized
 * projected occurrences (lib/class-sessions/data.js's `listSessions`) —
 * the same blend Today's Sessions shows, just across a wider date range.
 * ACTION is always a plain link to `/attendance/[scheduleId]/[date]`,
 * which resolves either kind of occurrence without ever writing anything
 * (`getSessionOccurrence`).
 *
 * ELIGIBLE STUDENTS and ATTENDANCE are both honest Phase 15 placeholders,
 * not fabricated data — see today-sessions-list.js's comment for why.
 */
export default function AllSessionsList({ sessions }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
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
                <TableCell className="text-text-secondary">Available in Phase 15</TableCell>
                <TableCell>
                  <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>
                    {DISPLAY_STATUS_LABELS[displayStatus]}
                  </Badge>
                </TableCell>
                <TableCell className="text-text-secondary">Available in Phase 15</TableCell>
                <TableCell>
                  <Link
                    href={`/attendance/${session.schedule_id}/${session.session_date}`}
                    className="text-body font-medium text-brand hover:underline"
                  >
                    View Session
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
