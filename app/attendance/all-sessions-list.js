import Link from "next/link";
import {
  CalendarDays,
  Clock,
  Eye,
  Layers,
  LayoutGrid,
  Percent,
  Table2,
  Users,
} from "lucide-react";
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
import { buildListHref } from "@/lib/url-params";
import {
  deriveDisplayStatus,
  todayInCentreTimezone,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";

const LAYOUTS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

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

function LayoutToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="All Sessions layouts"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {LAYOUTS.map((layout) => {
        const Icon = layout.icon;
        const href = buildListHref("/attendance", searchParams, {
          view: "all",
          layout: layout.key === "cards" ? "" : layout.key,
        });

        return (
          <Link
            key={layout.key}
            href={href}
            role="tab"
            aria-selected={active === layout.key}
            className={
              active === layout.key
                ? "inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-small font-semibold text-text-primary shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small text-text-secondary hover:text-text-primary"
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {layout.label}
          </Link>
        );
      })}
    </div>
  );
}

function SessionCards({ sessions, today }) {
  return (
    <DataTableShell tone="info">
      <div
        className="grid grid-cols-1 items-stretch gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4"
        aria-label="All Sessions"
      >
        {sessions.map((session) => {
          const displayStatus = deriveDisplayStatus(session);
          const actionLabel = resolveAction(session, today);
          const instructorName = session.instructors?.full_name ?? null;
          const eligibleCount = session.attendanceSummary?.eligibleCount ?? 0;
          const attendanceLabel =
            session.status === "completed"
              ? `${session.attendanceSummary?.percentage ?? 0}%`
              : "—";
          const batchCode = session.batches?.code || "—";
          const batchName = session.batches?.name ?? "—";
          const timeLabel = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
          const dateLabel = formatDate(session.session_date);
          const href = `/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`;

          return (
            <article
              key={`${session.schedule_id}:${session.session_date}`}
              className="flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand"
                >
                  {batchCode}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      <h3
                        className="truncate text-body font-semibold leading-snug text-text-primary"
                        title={batchName}
                      >
                        {batchName}
                      </h3>
                      <Badge
                        variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}
                        className="mt-1 rounded-full px-2 py-0"
                      >
                        <span className="text-[10px] leading-[14px] font-medium">
                          {DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      </Badge>
                    </div>

                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                      aria-label={actionLabel}
                      render={<Link href={href} />}
                      nativeButton={false}
                    >
                      <Eye className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-small text-text-secondary">
                <span className="inline-flex min-w-0 items-center gap-2" title={`Code: ${batchCode}`}>
                  <Layers className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    Code: <span className="font-semibold text-text-primary">{batchCode}</span>
                  </span>
                </span>

                <span className="inline-flex min-w-0 items-center gap-2" title={dateLabel}>
                  <CalendarDays className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">{dateLabel}</span>
                </span>

                <span className="inline-flex min-w-0 items-center gap-2" title={timeLabel}>
                  <Clock className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">{timeLabel}</span>
                </span>

                <span className="inline-flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold leading-none text-brand"
                  >
                    {instructorName ? getInitials(instructorName) : "?"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text-primary">
                      {instructorName || "—"}
                    </span>
                    <span className="block text-small text-text-secondary">Instructor</span>
                  </span>
                </span>

                <span
                  className="inline-flex min-w-0 items-center gap-2"
                  title={`Eligible: ${eligibleCount}`}
                >
                  <Users className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    Eligible: <span className="font-semibold text-text-primary">{eligibleCount}</span>
                  </span>
                </span>

                <span
                  className="inline-flex min-w-0 items-center gap-2"
                  title={`Attendance: ${attendanceLabel}`}
                >
                  <Percent className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    Attendance:{" "}
                    <span className="font-semibold text-text-primary">{attendanceLabel}</span>
                  </span>
                </span>
              </div>

              <div className="mt-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full rounded-full border-border/80 bg-surface text-small font-semibold text-text-primary shadow-xs hover:bg-background hover:text-text-primary"
                  render={<Link href={href} />}
                  nativeButton={false}
                >
                  {actionLabel}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </DataTableShell>
  );
}

function SessionTable({ sessions, today }) {
  return (
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
  );
}

/**
 * All Sessions — Cards / Table toggle. Layout is URL-driven (`layout=table`
 * or default cards) and keeps `view=all`. Same data and actions in both.
 */
export default function AllSessionsList({
  sessions,
  total,
  layout = "cards",
  searchParams,
}) {
  const today = todayInCentreTimezone();

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {total} {total === 1 ? "Session" : "Sessions"}
          </p>
          <p className="text-small text-text-secondary">
            {layout === "table" ? "Table view" : "Card list view"}
          </p>
        </div>
        <LayoutToggle active={layout} searchParams={searchParams} />
      </div>

      {layout === "table" ? (
        <SessionTable sessions={sessions} today={today} />
      ) : (
        <SessionCards sessions={sessions} today={today} />
      )}
    </div>
  );
}
