import Link from "next/link";
import {
  Clock,
  Eye,
  Layers,
  LayoutGrid,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataTableShell from "@/components/ui/data-table-shell";
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
 * Cards / Table toggle — same `?layout=table` URL convention and visual
 * treatment as `app/attendance/all-sessions-list.js`'s own layout toggle, so
 * both Attendance list screens behave identically.
 */
function LayoutToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="Today's Sessions layouts"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {LAYOUTS.map((layout) => {
        const Icon = layout.icon;
        const href = buildListHref("/attendance", searchParams, {
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

/** Today's Sessions — Batches-style card grid (white cards in DataTableShell) for fast scanning. */
function SessionCards({ sessions, today }) {
  return (
    <DataTableShell tone="info">
      <div
        className="grid grid-cols-1 items-stretch gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4"
        aria-label="Today's Sessions"
      >
        {sessions.map((session) => {
          const displayStatus = deriveDisplayStatus(session);
          const actionLabel = resolveAction(session, today);
          const instructorName = session.instructors?.full_name ?? null;
          const eligibleCount = session.attendanceSummary?.eligibleCount ?? 0;
          const batchCode = session.batches?.code || "—";
          const batchName = session.batches?.name ?? "—";
          const timeLabel = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
          const href = `/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`;

          return (
            <article
              key={session.id ?? `${session.schedule_id}:${session.session_date}`}
              className="group flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none"
            >
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-small font-semibold text-brand transition-colors duration-200 group-hover:bg-brand/25"
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

                <span className="inline-flex min-w-0 items-center gap-2" title={timeLabel}>
                  <Clock className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">{timeLabel}</span>
                </span>

                <span
                  className="inline-flex min-w-0 items-center gap-2"
                  title={`Eligible: ${eligibleCount}`}
                >
                  <Users className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    Eligible:{" "}
                    <span className="font-semibold text-text-primary">{eligibleCount}</span>
                  </span>
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
              </div>

              <div className="mt-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full rounded-full border-border/80 bg-surface text-small font-semibold text-text-primary shadow-xs transition-colors duration-200 group-hover:border-brand group-hover:bg-brand group-hover:text-surface group-hover:shadow-sm hover:border-brand hover:bg-brand hover:text-surface focus-visible:border-brand focus-visible:bg-brand focus-visible:text-surface"
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

/**
 * Today's Sessions table view — same column set as
 * `app/attendance/all-sessions-list.js`'s `SessionTable`, minus Date: every
 * row is already today, so repeating it on every row would add no
 * information.
 */
function SessionTable({ sessions, today }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Today's Sessions">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
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
            const attendanceLabel =
              session.status === "completed" ? `${session.attendanceSummary?.percentage ?? 0}%` : "—";

            return (
              <TableRow key={session.id ?? `${session.schedule_id}:${session.session_date}`}>
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
                <TableCell className="px-5 py-3.5 text-text-secondary">{attendanceLabel}</TableCell>
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
 * Today's Sessions — Cards / Table toggle, matching All Sessions' own
 * `?layout=table` URL-driven convention (`app/attendance/all-sessions-list.js`).
 * Same data and actions in both.
 */
export default function TodaySessionsList({ sessions, layout = "cards", searchParams }) {
  const today = todayInCentreTimezone();

  return (
    <div className="mt-2">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {sessions.length} {sessions.length === 1 ? "Session" : "Sessions"} today
          </p>
          <p className="text-small text-text-secondary">Tap a session to take or view attendance</p>
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
