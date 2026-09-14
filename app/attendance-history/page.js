import Link from "next/link";
import { History } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listAttendanceHistory } from "@/lib/attendance-history/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { buildListHref } from "@/lib/url-params";
import { Button } from "@/components/ui/button";
import AttendanceHistoryFilters from "@/app/attendance-history/attendance-history-filters";
import HistoryList from "@/app/attendance-history/history-list";

const PAGE_SIZE = 10;

function attendanceHistoryHref(searchParams, overrides) {
  return buildListHref("/attendance-history", searchParams, overrides);
}

/**
 * Attendance History (Phase 16; approved wireframe p.6 Instructor, p.30 Admin).
 * One page for admin and instructor — filters/table columns branch on role;
 * row visibility stays RLS-only via listAttendanceHistory. Table is the
 * default layout (`layout=cards` optional).
 */
export default async function AttendanceHistoryPage({ searchParams }) {
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
  const layout = rawParams.layout === "cards" ? "cards" : "table";

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
      <PageHeader
        title="Attendance History"
        description="Review recorded attendance for past class sessions."
        icon={<History className="size-6" />}
      />

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
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
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
          <HistoryList
            sessions={sessions}
            total={total}
            variant={isAdmin ? "admin" : "instructor"}
            layout={layout}
            searchParams={rawParams}
          />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-text-secondary">
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

              <span className="text-small px-1 text-text-secondary">
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
