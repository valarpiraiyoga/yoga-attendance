import Link from "next/link";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listAttendanceHistory } from "@/lib/attendance-history/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { buildListHref } from "@/lib/url-params";
import { Button } from "@/components/ui/button";
import AttendanceHistoryFilters from "@/app/attendance-history/attendance-history-filters";
import AdminHistoryList from "@/app/attendance-history/admin-history-list";
import InstructorHistoryList from "@/app/attendance-history/instructor-history-list";

const PAGE_SIZE = 10;

function attendanceHistoryHref(searchParams, overrides) {
  return buildListHref("/attendance-history", searchParams, overrides);
}

/**
 * Attendance History (Phase 16; `04-development-plan.md` "Phase 16 —
 * Attendance History"; approved wireframe p.6 Instructor, p.30 Admin).
 *
 * One page serves both roles — there is no separate `/attendance-history`
 * route per role, the same shape `/attendance` already uses. Which filters
 * are shown, which table columns render, and which options lists are
 * fetched all branch on `user.role` here; **which rows exist at all** never
 * does — `listAttendanceHistory` (lib/attendance-history/data.js) runs
 * under the caller's own RLS-bound session, and RLS alone (from
 * `0014_instructor_attendance_access.sql`) decides whether an instructor's
 * query returns their own sessions or nothing. No `instructorId` is ever
 * passed for an instructor caller — there is no Instructor filter for that
 * role, and passing one would be a redundant, weaker echo of what RLS
 * already guarantees.
 *
 * Every listed session is already `status === "completed"` (the data
 * layer's own scope: History reviews recorded attendance, so a still-
 * projected or a cancelled/holiday session has nothing to show here) —
 * this page never merges in projected occurrences the way Today's/All
 * Sessions does.
 *
 * Student and Batch Details' own "View Full Attendance History"/entry-point
 * links are a later step (approved decisions 3–4 in the Phase 16 plan
 * still apply — this same list, filtered by `studentId`/`batchId` — but
 * nothing links into it that way yet); this page only wires the `batch`
 * query param a user picks from the filter bar itself.
 */
export default async function AttendanceHistoryPage({ searchParams }) {
  // Authorization boundary. app/attendance-history/layout.js also calls
  // requireRole, but a layout does not re-run on client-side navigation
  // between sibling pages — see app/settings/layout.js for the full
  // explanation.
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const isAdmin = user.role === ROLES.ADMIN;

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = isAdmin && typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const attendanceStatus = ATTENDANCE_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const [{ sessions, total }, batchOptions, instructorOptions] = await Promise.all([
    listAttendanceHistory({
      dateFrom,
      dateTo,
      batchId,
      instructorId,
      q,
      attendanceStatus,
      page,
      pageSize: PAGE_SIZE,
    }),
    listBatchOptions(),
    isAdmin ? listInstructorOptions() : Promise.resolve([]),
  ]);

  const isFiltered =
    Boolean(q) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(batchId) || Boolean(instructorId) || attendanceStatus !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Attendance History" description="Review recorded attendance for past class sessions." />

      <AttendanceHistoryFilters
        key={`${q}:${dateFrom}:${dateTo}:${batchId}:${instructorId}:${attendanceStatus}`}
        variant={isAdmin ? "admin" : "instructor"}
        defaultQuery={q}
        defaultDateFrom={dateFrom}
        defaultDateTo={dateTo}
        defaultBatchId={batchId || "all"}
        defaultInstructorId={instructorId || "all"}
        defaultAttendanceStatus={attendanceStatus}
        batchOptions={batchOptions}
        instructorOptions={instructorOptions}
      />

      {sessions.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No attendance records match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/attendance-history" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <p className="text-body max-w-sm text-text-secondary">
              No completed sessions have attendance recorded yet.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6">
            {isAdmin ? <AdminHistoryList sessions={sessions} /> : <InstructorHistoryList sessions={sessions} />}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} attendance records
            </p>

            <nav aria-label="Attendance History pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={attendanceHistoryHref(rawParams, { page: page - 1 })} />}
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
                  render={<Link href={attendanceHistoryHref(rawParams, { page: page + 1 })} />}
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
