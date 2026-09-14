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
 * Admin's Attendance History table (approved wireframe p.30: DATE, TIME,
 * BATCH, INSTRUCTOR, ELIGIBLE, PRESENT, ABSENT, ATTENDANCE (%), ACTION).
 *
 * Every row is already `status === "completed"` by construction —
 * `listAttendanceHistory` (lib/attendance-history/data.js) only ever
 * returns completed sessions, so unlike Today's/All Sessions this table has
 * no varying status column and no varying action label: ACTION is always
 * "View Attendance".
 *
 * `attendanceSummary` (Eligible/Present/Absent/Attendance %) is attached
 * per row by `listAttendanceHistory` itself, via the existing
 * `getAttendanceSummary` (lib/attendance/data.js) — this component only
 * displays it, it does not resolve eligibility or attendance itself.
 *
 * ACTION links to the planned Attendance Details route
 * (`/attendance-history/[scheduleId]/[date]`), addressed the same way
 * Session Details already is — by schedule and date, not a class session
 * id, since a class session has no product-facing identifier
 * (`01-product.md` §7A). That page does not exist yet (a later Phase 16
 * step); this link is wired ahead of it, matching how earlier phases have
 * always linked to a route before that route's own page existed.
 */
export default function AdminHistoryList({ sessions }) {
  return (
    <DataTableShell>
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Eligible</TableHead>
            <TableHead>Present</TableHead>
            <TableHead>Absent</TableHead>
            <TableHead>Attendance (%)</TableHead>
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
              <TableCell className="text-text-secondary">{session.instructors?.full_name ?? "—"}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.eligibleCount ?? 0}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.presentCount ?? 0}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.absentCount ?? 0}</TableCell>
              <TableCell className="text-text-secondary">{session.attendanceSummary?.percentage ?? 0}%</TableCell>
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
