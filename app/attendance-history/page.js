import Link from "next/link";
import { History } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { DEFAULT_HISTORY_SORT, listAttendanceHistory } from "@/lib/attendance-history/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { buildListHref } from "@/lib/url-params";
import { Button } from "@/components/ui/button";
import AttendanceHistoryFilters from "@/app/attendance-history/attendance-history-filters";
import HistoryList from "@/app/attendance-history/history-list";

const PAGE_SIZE = 10;

// Labels for the "Sort by" control. Every `value` must be a key of
// `HISTORY_SORTS` (lib/attendance-history/data.js), which owns the direction.
const SORT_OPTIONS = [
  { value: "newest", label: "Date (Newest)" },
  { value: "oldest", label: "Date (Oldest)" },
];

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
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort) ? rawParams.sort : DEFAULT_HISTORY_SORT;

  const [{ sessions, total }, batchOptions, instructorOptions] = await Promise.all([
    listAttendanceHistory({
      dateFrom,
      dateTo,
      batchId,
      instructorId,
      q,
      attendanceStatus,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    listBatchOptions(),
    isAdmin ? listInstructorOptions() : Promise.resolve([]),
  ]);

  const isFiltered =
    Boolean(q) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(batchId) || Boolean(instructorId) || attendanceStatus !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Attendance History"
        description="View past class sessions and attendance records."
        icon={<History className="size-6" />}
      />

      <AttendanceHistoryFilters
        key={`${q}:${dateFrom}:${dateTo}:${batchId}:${instructorId}:${attendanceStatus}`}
        variant={isAdmin ? "admin" : "instructor"}
        layout={layout}
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
        <EmptyState
          className="mt-6"
          description={
            isFiltered
              ? "No attendance records match your search or filters."
              : "No completed sessions have attendance recorded yet."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/attendance-history" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <HistoryList
            sessions={sessions}
            total={total}
            variant={isAdmin ? "admin" : "instructor"}
            layout={layout}
            sort={sort}
            sortOptions={SORT_OPTIONS}
          />

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="sessions"
            ariaLabel="Attendance History pagination"
            getHref={(targetPage) => buildListHref("/attendance-history", rawParams, { page: targetPage })}
          />
        </>
      )}
    </>
  );
}
