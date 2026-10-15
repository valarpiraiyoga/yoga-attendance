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
  QUICK_DATE_COUNT,
  getHistoryDateNavigation,
  listAttendanceHistory,
} from "@/lib/attendance-history/data";
import { isValidMonth, monthOf, monthRange } from "@/lib/attendance-history/calendar";
import { groupSessionsByDate, isValidDateString } from "@/lib/attendance-history/grouping";
import { listBatchOptions } from "@/lib/batches/data";
import {
  listClassCountAttendanceDates,
  listClassCountAttendanceDatesScoped,
  listClassCountAttendanceRange,
  listClassCountAttendanceRangeScoped,
} from "@/lib/class-count-attendance/data";
import { mergeHistoryGroups, mergeNavigationDays, showClassCountInHistory } from "@/lib/class-count-attendance/attendance-rows";
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
 *
 * Class-count attendance: its records are a separate section within each date group, and a date that has only class-count records
 * is a group too and is marked on the calendar and in Quick dates. An Admin reads them directly (the tables are Admin-only under
 * RLS); an Instructor reads them ONLY through the scoped database functions of migration 0052 (the `...Scoped` reads), which return
 * just the records of students that instructor is authorized for, with a Reversed status but no reversal reason, and no Membership link. They are kept apart from `sessions` and `total`, so no session count, Present / Absent total or percentage
 * includes them. A batch, instructor or Present / Absent filter hides them (they have none of those); the search matches the
 * student name or the membership code. Each class-count read is independent: if it fails, the sessions still show.
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

  const canSeeClassCount = isAdmin || user.role === ROLES.INSTRUCTOR;
  const showClassCount = showClassCountInHistory({ isAdmin, isInstructor: !isAdmin, batchId, instructorId, attendanceStatus });
  const readRange = isAdmin ? listClassCountAttendanceRange : listClassCountAttendanceRangeScoped;
  const readDates = isAdmin ? listClassCountAttendanceDates : listClassCountAttendanceDatesScoped;
  const settle = (promise) => promise.then((value) => ({ ok: true, value }), () => ({ ok: false }));
  const { from: monthFrom, to: monthTo } = monthRange(month);

  const [{ sessions, total }, navigation, batchOptions, instructorOptions, classCountResult, classCountMonth, classCountRecent] = await Promise.all([
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
    showClassCount ? settle(readRange({ dateFrom: rangeFrom, dateTo: rangeTo, q })) : null,
    canSeeClassCount ? settle(readDates({ dateFrom: monthFrom, dateTo: monthTo })) : null,
    canSeeClassCount ? settle(readDates()) : null,
  ]);

  const classCountRecords = classCountResult?.ok ? classCountResult.value.records : [];
  const classCountTotal = classCountResult?.ok ? classCountResult.value.total : 0;
  const classCountFailed = Boolean(classCountResult) && !classCountResult.ok;
  // Calendar days and Quick dates: sessions as before, plus (Admin or Instructor, each within their own access) the dates that hold class-count records - in a separate
  // `classCount` number, so a session count never includes one. A failed class-count read just leaves them out.
  const monthDays = canSeeClassCount ? mergeNavigationDays(navigation.monthDays, classCountMonth?.ok ? classCountMonth.value : []) : navigation.monthDays;
  const quickDates = canSeeClassCount
    ? mergeNavigationDays(navigation.quickDates, classCountRecent?.ok ? classCountRecent.value : []).slice(0, QUICK_DATE_COUNT)
    : navigation.quickDates;

  const groups = mergeHistoryGroups(groupSessionsByDate(sessions), classCountRecords);
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
            monthDays={monthDays}
            quickDates={quickDates}
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

            {classCountFailed ? (
              <p role="status" className="mt-4 text-small text-text-secondary">
                Class count attendance could not be loaded. Session attendance is shown below.
              </p>
            ) : null}
            {canSeeClassCount && !showClassCount ? (
              <p className="mt-4 text-small text-text-secondary">
                Class count attendance is hidden while a batch, instructor or Present / Absent filter is on.
              </p>
            ) : null}

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
                  {classCountTotal > classCountRecords.length ? (
                    <p className="mt-2 text-small text-text-secondary">
                      Showing the most recent {classCountRecords.length} of {classCountTotal} class count records. Narrow the date range to see the rest.
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
