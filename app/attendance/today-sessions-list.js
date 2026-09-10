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

/**
 * Today's Sessions table (approved wireframe columns: TIME, BATCH,
 * INSTRUCTOR, ELIGIBLE STUDENTS, STATUS, ACTION). ELIGIBLE STUDENTS is an
 * honest Phase 15 placeholder, not a fabricated count (this task's explicit
 * requirement) — computing real eligibility depends on enrollment and
 * membership rules this slice must not touch.
 *
 * ACTION is uniformly "View Session" for every row regardless of status —
 * the wireframe's per-status actions (View Attendance / Take Attendance)
 * are Phase 15 features this slice does not implement, so rather than
 * showing an action that does nothing, every row gets the one action
 * Phase 14 actually supports (Session Details' Overview). Same reduction
 * app/schedule/[id]/schedule-details-tabs.js already applied to Upcoming
 * Sessions for the same reason.
 *
 * "View Session" is always a plain link, never an action that writes
 * anything: Session Details is addressed by `(schedule_id, session_date)`
 * (`/attendance/[scheduleId]/[date]`), which a projected occurrence already
 * has without needing a `class_sessions` row — see
 * lib/class-sessions/data.js's `getSessionOccurrence`. Viewing a session
 * never materializes it (01-product.md §7A).
 */
export default function TodaySessionsList({ sessions }) {
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
                <TableCell className="text-text-secondary">Available in Phase 15</TableCell>
                <TableCell>
                  <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>
                    {DISPLAY_STATUS_LABELS[displayStatus]}
                  </Badge>
                </TableCell>
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
