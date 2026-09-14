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
import { Button } from "@/components/ui/button";
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
 * All Sessions table — polished DataTableShell + avatar instructor row.
 * Same columns and actions as before.
 */
export default function AllSessionsList({ sessions, total }) {
  const today = todayInCentreTimezone();

  return (
    <div className="mt-6">
      <div className="mb-3">
        <p className="text-body font-medium text-text-primary">
          {total} {total === 1 ? "Session" : "Sessions"}
        </p>
        <p className="text-small text-text-secondary">Table view</p>
      </div>

      <DataTableShell tone="info">
        <Table aria-label="All Sessions">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Eligible</TableHead>
              <TableHead>Session Status</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const displayStatus = deriveDisplayStatus(session);
              const instructorName = session.instructors?.full_name ?? null;
              const actionLabel = resolveAction(session, today);

              return (
                <TableRow key={`${session.schedule_id}:${session.session_date}`}>
                  <TableCell className="px-5 py-3.5 text-text-secondary">
                    {formatDate(session.session_date)}
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-text-secondary">
                    {formatTime(session.start_time)} – {formatTime(session.end_time)}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    {session.batches ? (
                      <>
                        <p className="font-semibold text-text-primary">{session.batches.name}</p>
                        <p className="text-small text-text-secondary">{session.batches.code}</p>
                      </>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold leading-none text-brand"
                      >
                        {instructorName ? getInitials(instructorName) : "?"}
                      </span>
                      <span className="truncate text-text-secondary">{instructorName || "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-text-secondary">
                    {session.attendanceSummary?.eligibleCount ?? 0}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <Badge
                      variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                      className="rounded-full px-2 py-0"
                    >
                      <span className="text-[10px] leading-[14px] font-medium">
                        {DISPLAY_STATUS_LABELS[displayStatus]}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-text-secondary">
                    {session.status === "completed"
                      ? `${session.attendanceSummary?.percentage ?? 0}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-small"
                      render={
                        <Link
                          href={`/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`}
                        />
                      }
                      nativeButton={false}
                    >
                      {actionLabel}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableShell>
    </div>
  );
}
