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
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_HISTORY_SORT } from "@/lib/attendance-history/data";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import HistorySessionCard from "@/app/attendance-history/history-session-card";

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

function AdminTable({ sessions }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead className="text-right">Eligible</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead className="text-right">Absent</TableHead>
            <TableHead className="text-right">Attendance</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const instructorName = session.instructors?.full_name ?? null;
            const summary = session.attendanceSummary;

            return (
              <TableRow key={session.id}>
                <TableCell className="px-5 py-3.5 font-medium text-text-primary">
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
                <TableCell className="px-5 py-3.5 text-right tabular-nums text-text-secondary">
                  {summary?.eligibleCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-success">
                  {summary?.presentCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-danger">
                  {summary?.absentCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right tabular-nums font-semibold text-text-primary">
                  {summary?.percentage ?? 0}%
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-small"
                    render={
                      <Link
                        href={`/attendance-history/${session.schedule_id}/${session.session_date}`}
                      />
                    }
                    nativeButton={false}
                  >
                    View Details
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

function InstructorTable({ sessions }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Batch / Class</TableHead>
            <TableHead className="text-right">Eligible</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead className="text-right">Absent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const summary = session.attendanceSummary;

            return (
              <TableRow key={session.id}>
                <TableCell className="px-5 py-3.5 font-medium text-text-primary">
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
                <TableCell className="px-5 py-3.5 text-right tabular-nums text-text-secondary">
                  {summary?.eligibleCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-success">
                  {summary?.presentCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right tabular-nums font-medium text-danger">
                  {summary?.absentCount ?? 0}
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  <Badge
                    variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}
                    className="rounded-full px-2 py-0"
                  >
                    <span className="text-[10px] leading-[14px] font-medium">
                      {DISPLAY_STATUS_LABELS.completed}
                    </span>
                  </Badge>
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-small"
                    render={
                      <Link
                        href={`/attendance-history/${session.schedule_id}/${session.session_date}`}
                      />
                    }
                    nativeButton={false}
                  >
                    View Details
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

function HistoryCards({ sessions, variant }) {
  return (
    // Three columns at every width from `lg` up (the reference's density): the
    // date tile takes 64px of each card's header, so a fourth column at `xl`
    // would truncate most batch names.
    <CardGrid ariaLabel="Attendance History" className="xl:grid-cols-3">
      {sessions.map((session) => (
        <HistorySessionCard key={session.id} session={session} variant={variant} />
      ))}
    </CardGrid>
  );
}

/**
 * Attendance History results — TABLE is the default / primary desktop view
 * (data-review screen). Cards remain available via `layout=cards`; the
 * Cards / Table switch itself lives in `AttendanceHistoryFilters`'
 * `ViewSwitcher`, beside search and Filters.
 */
export default function HistoryList({
  sessions,
  total,
  variant = "admin",
  layout = "table",
  sort,
  sortOptions,
}) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Session" : "Sessions"}
        viewLabel={layout === "cards" ? "Card list view" : "Table view"}
        aside={
          <SortSelect
            id="history-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_HISTORY_SORT}
          />
        }
      />

      {layout === "cards" ? (
        <HistoryCards sessions={sessions} variant={variant} />
      ) : variant === "admin" ? (
        <AdminTable sessions={sessions} />
      ) : (
        <InstructorTable sessions={sessions} />
      )}
    </div>
  );
}
