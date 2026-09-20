import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { DEFAULT_HISTORY_SORT, listAttendanceHistory } from "@/lib/attendance-history/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { buildListHref } from "@/lib/url-params";
import BatchHeader from "@/app/batches/[id]/batch-header";
import AttendanceHistoryFilters from "@/app/attendance-history/attendance-history-filters";
import HistoryList from "@/app/attendance-history/history-list";

const PAGE_SIZE = 10;

// Same labels as Attendance History; every `value` is a key of `HISTORY_SORTS`.
const SORT_OPTIONS = [
  { value: "newest", label: "Date (Newest)" },
  { value: "oldest", label: "Date (Oldest)" },
];

/**
 * Batch Details → Attendance tab: Attendance History scoped to this one batch
 * (02-ux.md, Batch Details). It reuses Attendance History's data query,
 * toolbar, list and pagination as they are — the batch is fixed by the route,
 * so the Batch filter is hidden and the page never reads a `batch` param.
 * Table is the default layout (`layout=cards` optional).
 */
export default async function BatchAttendancePage({ params, searchParams }) {
  // Authorization boundary — see app/batches/layout.js.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const basePath = `/batches/${batch.id}/attendance`;
  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const attendanceStatus = ATTENDANCE_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);
  const layout = rawParams.layout === "cards" ? "cards" : "table";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort) ? rawParams.sort : DEFAULT_HISTORY_SORT;

  const [{ sessions, total }, instructorOptions] = await Promise.all([
    listAttendanceHistory({
      dateFrom,
      dateTo,
      batchId: batch.id,
      instructorId,
      q,
      attendanceStatus,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    listInstructorOptions(),
  ]);

  const isFiltered =
    Boolean(q) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(instructorId) || attendanceStatus !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <BatchHeader batch={batch} active="attendance">
      <div>
        <AttendanceHistoryFilters
          key={`${dateFrom}:${dateTo}:${instructorId}:${attendanceStatus}`}
          variant="admin"
          layout={layout}
          basePath={basePath}
          hideBatchFilter
          searchPlaceholder="Search by student name"
          defaultQuery={q}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
          defaultBatchId="all"
          defaultInstructorId={instructorId || "all"}
          defaultAttendanceStatus={attendanceStatus}
          batchOptions={[]}
          instructorOptions={instructorOptions}
        />

        {sessions.length === 0 ? (
          <EmptyState
            className="mt-6"
            description={
              isFiltered
                ? "No attendance records match your search or filters."
                : "No completed sessions have attendance recorded for this batch yet."
            }
            action={
              isFiltered ? (
                <Button variant="outline" render={<Link href={basePath} />} nativeButton={false}>
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
              variant="admin"
              layout={layout}
              sort={sort}
              sortOptions={SORT_OPTIONS}
              hideBatch
            />

            <Pagination
              className="mt-4"
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel="sessions"
              ariaLabel="Batch attendance pagination"
              getHref={(targetPage) => buildListHref(basePath, rawParams, { page: targetPage })}
            />
          </>
        )}
      </div>
    </BatchHeader>
  );
}
