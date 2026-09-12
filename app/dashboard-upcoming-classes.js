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
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Upcoming Classes (`01-product.md` §3; wireframes p.2 Instructor, p.8
 * Admin) — the next few sessions after today, for both roles.
 *
 * `sessions` is a short, already-bounded slice from the existing
 * `listSessions` (`lib/class-sessions/data.js`) — the same merge of
 * materialized and projected occurrences, and the same RLS scoping, All
 * Sessions already uses; the Dashboard adds no new query or eligibility
 * logic of its own. ACTION reuses the existing Session Details route
 * (`/attendance/[scheduleId]/[date]`) rather than inventing a preview
 * concept — the same "no duplicate destinations" rule Today's Classes
 * follows.
 */
export default function DashboardUpcomingClasses({ sessions }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <Table aria-label="Upcoming Classes">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const displayStatus = deriveDisplayStatus(session);
            return (
              <TableRow key={session.id ?? `${session.schedule_id}:${session.session_date}`}>
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
                    View Details
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
