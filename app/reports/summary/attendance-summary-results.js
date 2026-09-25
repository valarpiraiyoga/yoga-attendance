import { BarChart3, CalendarDays, CircleCheck, UserRoundX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/layout/Panel";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import EmptyState from "@/components/ui/empty-state";
import { formatDate, formatTimeRange } from "@/lib/format";
import { getAttendanceSummaryReport } from "@/lib/reports/data";
import { attendanceRatio } from "@/lib/reports/validation";
import { formatPercent, paginateRows, ReportHeader, ReportPagination } from "@/app/reports/report-results";

/**
 * Attendance Summary report results (approved wireframe p.37): the report
 * header, the TOTAL SESSIONS / TOTAL PRESENT / TOTAL ABSENT / OVERALL
 * ATTENDANCE tiles, and the per-session results table.
 *
 * An async Server Component, awaited inside a `<Suspense>` boundary in
 * `app/reports/summary/page.js` — the same shape
 * `app/reports/student-attendance-results.js` and
 * `app/reports/batch/batch-attendance-results.js` already use.
 *
 * Every number comes from `getAttendanceSummaryReport` (`lib/reports/data.js`),
 * which reads the shared `getSessionFacts` core over the
 * `report_session_facts` RPC — the same historical snapshot Student and
 * Batch Attendance read, unfiltered by entity: every completed session in
 * range, across every batch. This component issues no Supabase query of its
 * own and derives no eligibility.
 *
 * Unlike the Batch report's table (scoped to one batch, so BATCH/INSTRUCTOR
 * would be redundant on every row), this report spans every batch, so its
 * table carries BATCH and INSTRUCTOR per row, matching wireframe p.37's own
 * columns exactly: DATE, TIME, BATCH, INSTRUCTOR, ELIGIBLE, PRESENT, ABSENT,
 * ATTENDANCE.
 *
 * "Overall Attendance" (wireframe p.37 "OVERALL ATTENDANCE") is the POOLED
 * ratio, total present / total eligible — never a mean of the per-session
 * percentages. p.37's own figures make the distinction concrete: 67 present
 * / 74 eligible = 90.5%, not the mean of the four row percentages shown
 * (90%, 87.5%, 90%, 94.4% -> mean 90.475%, which rounds differently).
 *
 * The tiles total every session in the range; only the table is paginated
 * (`page`, ten rows), so paging never changes a figure.
 */
export default async function AttendanceSummaryResults({ dateFrom, dateTo, page }) {
  const report = await getAttendanceSummaryReport({ dateFrom, dateTo });
  const { sessions, totals } = report;
  const paged = paginateRows(sessions, page);

  return (
    <section aria-label="Attendance Summary Report" className="mt-6 flex flex-col gap-4">
      <ReportHeader
        title="Attendance Summary Report"
        dateFrom={dateFrom}
        dateTo={dateTo}
        exportType="summary"
        exportParams={{ from: dateFrom, to: dateTo }}
      />

      <StatTileGroup ariaLabel="Attendance summary">
        <StatTile valueFirst icon={CalendarDays} label="Total Sessions" value={totals.sessionCount} tone="brand" />
        <StatTile valueFirst icon={CircleCheck} label="Total Present" value={totals.presentTotal} tone="success" />
        <StatTile valueFirst icon={UserRoundX} label="Total Absent" value={totals.absentTotal} tone="danger" />
        <StatTile
          valueFirst
          icon={BarChart3}
          label="Overall Attendance"
          value={formatPercent(totals.ratio)}
          tone="info"
        />
      </StatTileGroup>

      {sessions.length === 0 ? (
        <EmptyState description="No completed sessions in the selected date range." />
      ) : (
        <div>
          <Panel className="overflow-hidden p-0 sm:p-0">
            <Table aria-label="Attendance Summary Report" className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead>Eligible</TableHead>
                  <TableHead>Present</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Attendance (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.rows.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(session.session_date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary">
                      {formatTimeRange(session.start_time, session.end_time)}
                    </TableCell>
                    <TableCell>
                      {session.batch ? (
                        <>
                          <p className="font-medium text-text-primary">{session.batch.name}</p>
                          <p className="text-small text-text-secondary">{session.batch.code}</p>
                        </>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary">{session.instructor?.full_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums text-text-secondary">{session.eligibleCount}</TableCell>
                    <TableCell className="tabular-nums text-text-secondary">{session.presentCount}</TableCell>
                    <TableCell className="tabular-nums text-text-secondary">{session.absentCount}</TableCell>
                    <TableCell className="tabular-nums font-medium text-text-primary">
                      {formatPercent(attendanceRatio(session.presentCount, session.eligibleCount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <ReportPagination
            basePath="/reports/summary"
            params={{ from: dateFrom, to: dateTo }}
            page={paged.page}
            totalPages={paged.totalPages}
            total={sessions.length}
          />
        </div>
      )}
    </section>
  );
}
