import Link from "next/link";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listSessionsForDate, listSessions } from "@/lib/class-sessions/data";
import { todayInCentreTimezone, DISPLAY_STATUSES } from "@/lib/class-sessions/validation";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { buildListHref } from "@/lib/url-params";
import { Button } from "@/components/ui/button";
import AttendanceViewToggle from "@/app/attendance/attendance-view-toggle";
import AttendanceFilters from "@/app/attendance/attendance-filters";
import TodaySessionsList from "@/app/attendance/today-sessions-list";
import AllSessionsList from "@/app/attendance/all-sessions-list";

const PAGE_SIZE = 10;

function formatHeadingDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function attendanceHref(searchParams, overrides) {
  return buildListHref("/attendance", searchParams, overrides);
}

/**
 * Attendance (docs/02-ux.md's approved IA: Today's Sessions ← Default, All
 * Sessions, Session Details). Today's Sessions is the bare `/attendance`
 * route; `?view=all` switches to All Sessions — same URL-addressable
 * toggle pattern as /schedule (app/schedule/page.js).
 *
 * Both views list materialized and projected occurrences together
 * (approved Phase 14 decision) — neither `listSessionsForDate` nor
 * `listSessions` writes anything, so `class_sessions` can be, and often
 * will be, empty while these screens still show a full day or date range
 * of sessions.
 */
export default async function AttendancePage({ searchParams }) {
  // Authorization boundary. app/attendance/layout.js also calls
  // requireRole, but a layout does not re-run on client-side navigation
  // between sibling pages — see app/settings/layout.js for the full
  // explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const today = todayInCentreTimezone();

  if (rawParams.view !== "all") {
    const sessions = await listSessionsForDate(today);

    return (
      <>
        <PageHeader
          title="Attendance"
          description="View today's class sessions."
          actions={<p className="text-body font-medium text-text-primary">{formatHeadingDate(today)}</p>}
        />

        <AttendanceViewToggle active="today" />

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="text-body max-w-sm text-text-secondary">
              No class sessions are scheduled for today.
            </p>
          </div>
        ) : (
          <TodaySessionsList sessions={sessions} />
        )}
      </>
    );
  }

  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const status = DISPLAY_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const [{ sessions, total }, batchOptions, instructorOptions] = await Promise.all([
    listSessions({ q, dateFrom, dateTo, batchId, instructorId, status, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
    listInstructorOptions(),
  ]);

  const isFiltered =
    Boolean(q) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Attendance" description="View and manage class sessions and attendance." />

      <AttendanceViewToggle active="all" />

      <AttendanceFilters
        key={`${q}:${dateFrom}:${dateTo}:${batchId}:${instructorId}:${status}`}
        defaultQuery={q}
        defaultDateFrom={dateFrom}
        defaultDateTo={dateTo}
        defaultBatchId={batchId || "all"}
        defaultInstructorId={instructorId || "all"}
        defaultStatus={status}
        batchOptions={batchOptions}
        instructorOptions={instructorOptions}
      />

      {sessions.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No sessions match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/attendance?view=all" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <p className="text-body max-w-sm text-text-secondary">
              No class sessions fall in this date range.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6">
            <AllSessionsList sessions={sessions} />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} sessions
            </p>

            <nav aria-label="All Sessions pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={attendanceHref(rawParams, { page: page - 1 })} />}
                  nativeButton={false}
                >
                  Previous
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              )}

              <span className="text-body px-1 text-text-secondary">
                Page {page} of {totalPages}
              </span>

              {page < totalPages ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={attendanceHref(rawParams, { page: page + 1 })} />}
                  nativeButton={false}
                >
                  Next
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              )}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
