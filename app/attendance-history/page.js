import Link from "next/link";
import { History } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_HISTORY_SORT,
  HISTORY_RANGE_LIMIT,
  getHistoryDateNavigation,
  listAttendanceHistory,
} from "@/lib/attendance-history/data";
import { isValidMonth, monthOf, monthRange } from "@/lib/attendance-history/calendar";
import { groupSessionsByDate, isValidDateString } from "@/lib/attendance-history/grouping";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { getCentreToday } from "@/lib/center-profile/settings";
import AttendanceHistoryFilters from "@/app/attendance-history/attendance-history-filters";
import DateNavigator from "@/components/layout/DateNavigator";
import HistoryDateRange from "@/app/attendance-history/history-date-range";
import HistoryTimeline from "@/app/attendance-history/history-timeline";

const BASE_PATH = "/attendance-history";

/**
 * Attendance History (Phase 16; approved wireframe p.6 Instructor, p.30 Admin,
 * finalized in `docs/ui-reference/02/attendance history.png`).
 *
 * One page for admin and instructor — the toolbar and table columns branch on
 * role; row visibility stays RLS-only via `listAttendanceHistory`. The results
 * are the completed sessions of a date range, grouped by date into a timeline
 * of accordions, beside a month calendar and Quick dates for jumping between
 * dates. Default view: Table from `lg` up, Cards below; an explicit
 * `?layout=cards|table` is always respected.
 *
 * URL state: `from` / `to` (range; default is the displayed month), `month`
 * (calendar month; default is the centre's current month, or the range's first
 * month), `date` (the group that opens; default is the newest date shown),
 * plus the toolbar's `q`, `batch`, `instructor`, `status`, `layout`. "Today",
 * and so the default month, is the centre-timezone date (01-product.md §7A).
 */
export default async function AttendanceHistoryPage({ searchParams }) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const isAdmin = user.role === ROLES.ADMIN;
  const variant = isAdmin ? "admin" : "instructor";

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = isAdmin && typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const attendanceStatus = ATTENDANCE_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  // "" = no explicit choice: Table from `lg` up, Cards below (resolved in CSS).
  const layout = rawParams.layout === "cards" || rawParams.layout === "table" ? rawParams.layout : "";

  // Range and calendar month. The range always exists (it defaults to the
  // month on the calendar), so the header control never shows an empty range.
  const requestedFrom = isValidDateString(rawParams.from) ? rawParams.from : "";
  const requestedTo = isValidDateString(rawParams.to) ? rawParams.to : "";
  const month = isValidMonth(rawParams.month)
    ? rawParams.month
    : monthOf(requestedFrom || requestedTo || (await getCentreToday()));
  const defaultRange = monthRange(month);
  let rangeFrom = requestedFrom || defaultRange.from;
  let rangeTo = requestedTo || defaultRange.to;
  if (rangeFrom > rangeTo) [rangeFrom, rangeTo] = [rangeTo, rangeFrom];

  const [{ sessions, total }, navigation, batchOptions, instructorOptions] = await Promise.all([
    listAttendanceHistory({
      dateFrom: rangeFrom,
      dateTo: rangeTo,
      batchId,
      instructorId,
      q,
      attendanceStatus,
      sort: DEFAULT_HISTORY_SORT,
      page: 1,
      pageSize: HISTORY_RANGE_LIMIT,
    }),
    getHistoryDateNavigation(month),
    listBatchOptions(),
    isAdmin ? listInstructorOptions() : Promise.resolve([]),
  ]);

  const groups = groupSessionsByDate(sessions);
  const requestedDate = isValidDateString(rawParams.date) ? rawParams.date : "";
  const selectedDate = groups.some((group) => group.date === requestedDate) ? requestedDate : (groups[0]?.date ?? "");

  const isFiltered = Boolean(q) || Boolean(batchId) || Boolean(instructorId) || attendanceStatus !== "all";

  return (
    <>
      <PageHeader
        compact
        title="Attendance History"
        description="View past class sessions and attendance records."
        icon={<History className="size-6" />}
        actions={<HistoryDateRange from={rangeFrom} to={rangeTo} />}
        mobileActions={<HistoryDateRange from={rangeFrom} to={rangeTo} compact className="min-w-0" />}
      />

      <Container>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
          <DateNavigator
            basePath={BASE_PATH}
            currentParams={rawParams}
            month={month}
            monthDays={navigation.monthDays}
            quickDates={navigation.quickDates}
            selectedDate={selectedDate}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
          />

          <div className="min-w-0">
            <AttendanceHistoryFilters
              key={`${batchId}:${instructorId}:${attendanceStatus}`}
              variant={variant}
              layout={layout}
              showDateFilters={false}
            responsiveLayoutDefault
              toolbarClassName="border-0 bg-transparent p-0 shadow-none"
              searchPlaceholder="Search by student name, batch or instructor…"
              defaultQuery={q}
              defaultDateFrom=""
              defaultDateTo=""
              defaultBatchId={batchId || "all"}
              defaultInstructorId={instructorId || "all"}
              defaultAttendanceStatus={attendanceStatus}
              batchOptions={batchOptions}
              instructorOptions={instructorOptions}
            />

            <div className="mt-5">
              {groups.length === 0 ? (
                <EmptyState
                  description={
                    isFiltered
                      ? "No attendance records match your search or filters in this date range."
                      : "No completed sessions with attendance recorded in this date range."
                  }
                  action={
                    isFiltered ? (
                      <Button variant="outline" render={<Link href={BASE_PATH} />} nativeButton={false}>
                        Clear Filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <HistoryTimeline groups={groups} selectedDate={selectedDate} layout={layout} variant={variant} />
                  {total > sessions.length ? (
                    <p className="mt-4 text-small text-text-secondary">
                      Showing the most recent {sessions.length} of {total} sessions. Narrow the date range to see the rest.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
