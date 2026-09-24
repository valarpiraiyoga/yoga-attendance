import Link from "next/link";
import { CalendarDays, CircleCheck, ClipboardCheck, Users, UserRoundX } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import Container from "@/components/layout/Container";
import DateNavigator from "@/components/layout/DateNavigator";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { KpiStrip, KpiToggle } from "@/components/ui/kpi-visibility";
import {
  DEFAULT_SESSION_SORT,
  filterSessions,
  getSessionDateNavigation,
  listSessionsForDate,
  listSessions,
  sortSessions,
} from "@/lib/class-sessions/data";
import { isValidMonth, monthOf, monthRange } from "@/lib/attendance-history/calendar";
import { groupSessionsByDate, isValidDateString } from "@/lib/attendance-history/grouping";
import { todayInCentreTimezone, DISPLAY_STATUSES } from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { getAttendanceSummaries } from "@/lib/attendance/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { formatShare } from "@/lib/format";
import SortSelect from "@/components/ui/sort-select";
import { buildListHref } from "@/lib/url-params";
import { Button } from "@/components/ui/button";
import AttendanceViewToggle from "@/app/attendance/attendance-view-toggle";
import AttendanceFilters from "@/app/attendance/attendance-filters";
import SessionList from "@/app/attendance/session-list";
import SessionTimeline from "@/app/attendance/session-timeline";
import { SessionDateJump, TodayDateChip } from "@/app/attendance/attendance-date-controls";

const PAGE_SIZE = 10;

// All Sessions shows a whole date range at once, grouped by date (no
// pagination), so it asks for one page this large; a month of classes is far
// below it.
const ALL_SESSIONS_LIMIT = 500;

// Labels for the "Sort by" control. Every `value` must be a key of
// `SESSION_SORTS` (lib/class-sessions/data.js), which owns the direction.
// Today's Sessions shares one date, so its sort reads as a sort by time.
const TODAY_SORT_OPTIONS = [
  { value: "earliest", label: "Time (Earliest)" },
  { value: "latest", label: "Time (Latest)" },
];
const ALL_SORT_OPTIONS = [
  { value: "earliest", label: "Date (Earliest)" },
  { value: "latest", label: "Date (Latest)" },
];

/**
 * Sums each already-fetched session's attendance summary
 * (`withAttendanceSummaries`, `lib/attendance/data.js`) into the Today's
 * Sessions page-level totals shown by the KPI strip. No new query:
 * every count here is a presentation-only aggregation of numbers each
 * session row already carries and already displays individually.
 */
function summarizeTodaysSessions(sessions) {
  return sessions.reduce(
    (totals, session) => ({
      eligible: totals.eligible + (session.attendanceSummary?.eligibleCount ?? 0),
      present: totals.present + (session.attendanceSummary?.presentCount ?? 0),
      absent: totals.absent + (session.attendanceSummary?.absentCount ?? 0),
    }),
    { eligible: 0, present: 0, absent: 0 }
  );
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
 * switch pattern as /schedule (app/schedule/page.js), with Cards/Table on
 * the separate `layout` param.
 *
 * Both views list materialized and projected occurrences together
 * (approved Phase 14 decision) — neither `listSessionsForDate` nor
 * `listSessions` writes anything, so `class_sessions` can be, and often
 * will be, empty while these screens still show a full day or date range
 * of sessions.
 *
 * Today's Sessions is fixed to today's date (02-ux.md): its search, filters,
 * sort and pagination narrow that one day's sessions in memory with the same
 * `filterSessions` / `sortSessions` All Sessions uses; its KPI strip totals
 * the whole day, independent of them.
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
  // The centre's own day and zone (Center Settings), never the viewer's.
  const timeZone = await getCenterTimezone();
  const today = todayInCentreTimezone(new Date(), timeZone);

  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const status = DISPLAY_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);
  // "" = no explicit choice: Table from `lg` up, Cards below (resolved in CSS).
  const layout = rawParams.layout === "cards" || rawParams.layout === "table" ? rawParams.layout : "";

  if (rawParams.view !== "all") {
    const sort = TODAY_SORT_OPTIONS.some((option) => option.value === rawParams.sort)
      ? rawParams.sort
      : DEFAULT_SESSION_SORT;

    const [todaysSessions, batchOptions, instructorOptions] = await Promise.all([
      listSessionsForDate(today),
      listBatchOptions(),
      listInstructorOptions(),
    ]);
    const allToday = await withAttendanceSummaries(todaysSessions);
    const totals = summarizeTodaysSessions(allToday);

    const matching = sortSessions(filterSessions(allToday, { q, batchId, instructorId, status, timeZone }), sort);
    const total = matching.length;
    const sessions = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const isFiltered = Boolean(q) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
      <>
        <PageHeader
          compact
          title="Attendance"
          description="View today's class sessions and take attendance."
          icon={<ClipboardCheck className="size-6" />}
          actions={
            <>
              <KpiToggle pageKey="attendance" />
              <TodayDateChip date={today} />
            </>
          }
          mobileActions={<TodayDateChip date={today} compact />}
        />

        <Container>
          <AttendanceViewToggle active="today" />

          {/* Whole-day totals, independent of the search/filters below - the
              sum of each session's own attendance summary. Present / Absent
              are shares of the day's eligible students. Desktop only: the
              mobile reference is the session list alone. */}
          <div className="max-lg:hidden">
            <KpiStrip pageKey="attendance">
              <StatTileGroup className="mb-6" ariaLabel="Today's attendance summary">
                <StatTile valueFirst decorativeChart icon={CalendarDays} label="Sessions Today" value={allToday.length} tone="brand" />
                <StatTile valueFirst decorativeChart icon={Users} label="Total Eligible" value={totals.eligible} tone="info" />
                <StatTile
                  valueFirst
                  decorativeChart
                  icon={CircleCheck}
                  label="Marked Present"
                  value={totals.present}
                  aside={formatShare(totals.present, totals.eligible)}
                  tone="success"
                />
                <StatTile
                  valueFirst
                  decorativeChart
                  icon={UserRoundX}
                  label="Marked Absent"
                  value={totals.absent}
                  aside={formatShare(totals.absent, totals.eligible)}
                  tone="danger"
                />
              </StatTileGroup>
            </KpiStrip>
          </div>

          {allToday.length === 0 ? (
            <EmptyState description="No class sessions are scheduled for today." />
          ) : (
            <>
              <AttendanceFilters
                key={`today:${batchId}:${instructorId}:${status}`}
                mode="today"
                defaultQuery={q}
                defaultBatchId={batchId || "all"}
                defaultInstructorId={instructorId || "all"}
                defaultStatus={status}
                layout={layout}
                batchOptions={batchOptions}
                instructorOptions={instructorOptions}
              />

              {sessions.length === 0 ? (
                <EmptyState
                  className="mt-6"
                  description="No sessions match your search or filters."
                  action={
                    isFiltered ? (
                      <Button variant="outline" render={<Link href="/attendance" />} nativeButton={false}>
                        Clear Filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <SessionList
                    sessions={sessions}
                    layout={layout}
                    total={total}
                    sort={sort}
                    sortOptions={TODAY_SORT_OPTIONS}
                    today={today}
                    timeZone={timeZone}
                  />

                  <Pagination
                    className="mt-4"
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    pageSize={PAGE_SIZE}
                    itemLabel="sessions"
                    ariaLabel="Today's Sessions pagination"
                    getHref={(targetPage) => buildListHref("/attendance", rawParams, { page: targetPage })}
                  />
                </>
              )}
            </>
          )}
        </Container>
      </>
    );
  }

  // All Sessions: the sessions of a date range grouped by date, beside a month
  // calendar. The range defaults to the displayed month - from today onward
  // when that month is the current one, since this list is about what is
  // coming - unless a past date was picked, or `from` / `to` are applied.
  const requestedFrom = isValidDateString(rawParams.from) ? rawParams.from : "";
  const requestedTo = isValidDateString(rawParams.to) ? rawParams.to : "";
  const requestedDate = isValidDateString(rawParams.date) ? rawParams.date : "";
  const month = isValidMonth(rawParams.month)
    ? rawParams.month
    : monthOf(requestedFrom || requestedTo || requestedDate || today);
  const fullMonth = monthRange(month);
  const startsToday = month === monthOf(today) && !(requestedDate && requestedDate < today);
  let rangeFrom = requestedFrom || (startsToday ? today : fullMonth.from);
  let rangeTo = requestedTo || fullMonth.to;
  if (rangeFrom > rangeTo) [rangeFrom, rangeTo] = [rangeTo, rangeFrom];

  const sort = ALL_SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_SESSION_SORT;

  const [{ sessions: rawSessions, total }, navigation, batchOptions, instructorOptions] = await Promise.all([
    listSessions({
      q,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
      batchId,
      instructorId,
      status,
      sort,
      page: 1,
      pageSize: ALL_SESSIONS_LIMIT,
    }),
    getSessionDateNavigation(month),
    listBatchOptions(),
    listInstructorOptions(),
  ]);
  const sessions = await withAttendanceSummaries(rawSessions);

  const groups = groupSessionsByDate(sessions);
  const selectedDate = groups.some((group) => group.date === requestedDate) ? requestedDate : (groups[0]?.date ?? "");

  const isFiltered =
    Boolean(q) ||
    Boolean(requestedFrom) ||
    Boolean(requestedTo) ||
    Boolean(batchId) ||
    Boolean(instructorId) ||
    status !== "all";

  return (
    <>
      <PageHeader
        compact
        title="Attendance"
        description="View and manage class sessions and attendance."
        icon={<ClipboardCheck className="size-6" />}
        actions={<SessionDateJump date={selectedDate} />}
        mobileActions={<SessionDateJump date={selectedDate} compact className="min-w-0" />}
      />

      <Container>
        <AttendanceViewToggle active="all" />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
          <DateNavigator
            basePath="/attendance"
            currentParams={rawParams}
            month={month}
            monthDays={navigation.monthDays}
            quickDates={navigation.quickDates}
            quickDatesTitle="Sessions by date"
            selectedDate={selectedDate}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
          />

          <div className="min-w-0">
            <AttendanceFilters
              key={`all:${requestedFrom}:${requestedTo}:${batchId}:${instructorId}:${status}`}
              mode="all"
              defaultQuery={q}
              defaultDateFrom={requestedFrom}
              defaultDateTo={requestedTo}
              defaultBatchId={batchId || "all"}
              defaultInstructorId={instructorId || "all"}
              defaultStatus={status}
              layout={layout}
              trailing={
                <SortSelect id="session-sort" options={ALL_SORT_OPTIONS} value={sort} defaultValue={DEFAULT_SESSION_SORT} />
              }
              batchOptions={batchOptions}
              instructorOptions={instructorOptions}
            />

            <div className="mt-5">
              {groups.length === 0 ? (
                <EmptyState
                  description={
                    isFiltered
                      ? "No sessions match your search or filters in this date range."
                      : "No class sessions fall in this date range."
                  }
                  action={
                    isFiltered ? (
                      <Button variant="outline" render={<Link href="/attendance?view=all" />} nativeButton={false}>
                        Clear Filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <SessionTimeline groups={groups} selectedDate={selectedDate} layout={layout} today={today} timeZone={timeZone} />
                  {total > sessions.length ? (
                    <p className="mt-4 text-small text-text-secondary">
                      Showing the first {sessions.length} of {total} sessions. Narrow the date range to see the rest.
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
