import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listSessionsForDate, listSessions } from "@/lib/class-sessions/data";
import { todayInCentreTimezone, DISPLAY_STATUSES } from "@/lib/class-sessions/validation";
import { getAttendanceSummaries } from "@/lib/attendance/data";
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
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function attendanceHref(searchParams, overrides) {
  return buildListHref("/attendance", searchParams, overrides);
}

/**
 * Attaches each session's attendance summary as `attendanceSummary`, so
 * Today's/All Sessions can show a real Eligible Students count (both lists)
 * and Attendance percentage (All Sessions, completed sessions only) instead
 * of the prior "Available in Phase 15" placeholder.
 *
 * Performance Slice 2: this used to call `getAttendanceSummary` once per
 * row (two Supabase round trips each — twenty for a ten-row page). It now
 * calls the batched `getAttendanceSummaries` (lib/attendance/data.js) ONCE
 * for the whole list, backed by the set-based
 * `session_attendance_summaries` RPC (0017_session_attendance_summaries.sql).
 * The result is index-aligned with `sessions` by that function itself, so
 * this just zips it back on.
 *
 * `session.id` is `null` for a projected occurrence — `getAttendanceSummaries`
 * handles that the same way `getAttendanceSummary` always did.
 *
 * An entry is `null` for a session the caller may not access. That is
 * reachable for an instructor in one specific, legitimate case: an admin
 * used Flow 06 to reassign a single session to someone else. The
 * materialized row then belongs to the other instructor and is invisible
 * here, so this occurrence is re-projected from the schedule (still
 * theirs) — but `can_access_session` correctly answers "no" for it. Where
 * the old per-row path caught the 42501 that `resolve_eligible_students`
 * raised for exactly this case, the RPC now reports it directly as
 * `eligibility_source = 'forbidden'` with null counts, so no try/catch is
 * needed here to produce the same `attendanceSummary: null` outcome. A
 * genuine failure (not a single unowned row) now throws, same as any other
 * data call on this page, rather than being swallowed per-row.
 */
async function withAttendanceSummaries(sessions) {
  const summaries = await getAttendanceSummaries(sessions);

  return sessions.map((session, index) => ({ ...session, attendanceSummary: summaries[index] }));
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
  //
  // Admin or instructor (Phase 15 Instructor Access). Role decides only
  // whether the area opens; RLS decides what either list actually
  // contains, so no row filtering is repeated here.
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  const rawParams = await searchParams;
  const today = todayInCentreTimezone();

  if (rawParams.view !== "all") {
    const sessions = await withAttendanceSummaries(await listSessionsForDate(today));

    return (
      <>
        <PageHeader
          title="Attendance"
          description="View today's class sessions."
          icon={<ClipboardCheck className="size-6" />}
          actions={
            <p className="rounded-lg border border-border bg-surface px-3 py-2 text-small font-medium text-text-primary shadow-xs">
              {formatHeadingDate(today)}
            </p>
          }
        />

        <AttendanceViewToggle active="today" />

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
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

  const [{ sessions: rawSessions, total }, batchOptions, instructorOptions] = await Promise.all([
    listSessions({ q, dateFrom, dateTo, batchId, instructorId, status, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
    listInstructorOptions(),
  ]);
  const sessions = await withAttendanceSummaries(rawSessions);

  const isFiltered =
    Boolean(q) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Attendance"
        description="View and manage class sessions and attendance."
        icon={<ClipboardCheck className="size-6" />}
      />

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
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
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
          <AllSessionsList sessions={sessions} total={total} />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-text-secondary">
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

              <span className="text-small px-1 text-text-secondary">
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
