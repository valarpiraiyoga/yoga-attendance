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
import { getBatchAttendanceReport } from "@/lib/reports/data";
import { attendanceRatio } from "@/lib/reports/validation";
import { formatPercent, paginateRows, ReportHeader, ReportPagination } from "@/app/reports/report-results";

/**
 * Batch Attendance report results (approved wireframe p.36): the report
 * header, KPI tiles, and the per-session Session Attendance table.
 *
 * An async Server Component, awaited inside a `<Suspense>` boundary in
 * `app/reports/batch/page.js` — mirrors
 * `app/reports/student-attendance-results.js`'s own shape exactly.
 *
 * Every number comes from `getBatchAttendanceReport` (`lib/reports/data.js`),
 * which reads the shared `getSessionFacts` core over the
 * `report_session_facts` RPC — the same historical snapshot Student
 * Attendance reads, filtered to one batch instead of projected for one
 * student. This component issues no Supabase query of its own and derives
 * no eligibility.
 *
 * KPI tiles are Sessions / Present / Absent / Average Attendance, per the
 * approved Slice 3 scope. The wireframe's own mock additionally shows an
 * "Eligible Attendance" tile (the eligible total); it is intentionally
 * omitted here to match the approved scope exactly rather than silently
 * adding a fifth tile — see this slice's implementation report for the
 * reasoning. The eligible total is not lost: it is the ELIGIBLE column in
 * the table below, and it is what "Average Attendance" is computed from
 * (`totals.ratio` = pooled present / eligible, never a mean of per-row
 * percentages — see `computePooledTotals`).
 *
 * "Average Attendance" (approved wireframe p.36 "AVG. ATTENDANCE") is that
 * pooled ratio, not the mean of the per-session percentages: p.36's own
 * figures do not distinguish the two because every row shares the same
 * eligible count, but p.37 does (67/74 = 90.5%, not a mean).
 *
 * The tiles total every session in the range; only the table is paginated
 * (`page`, ten rows), so paging never changes a figure.
 */
export default async function BatchAttendanceResults({ batchId, batchLabel, dateFrom, dateTo, page }) {
  const report = await getBatchAttendanceReport({ batchId, dateFrom, dateTo });
  const { sessions, totals } = report;
  const paged = paginateRows(sessions, page);

  return (
    <section aria-label="Batch Attendance Report" className="mt-6 flex flex-col gap-4">
      <ReportHeader
        title={`Batch Attendance Report: ${batchLabel}`}
        dateFrom={dateFrom}
        dateTo={dateTo}
        exportType="batch"
        exportParams={{ batch: batchId, from: dateFrom, to: dateTo }}
      />

      <StatTileGroup ariaLabel="Batch attendance summary">
        <StatTile valueFirst icon={CalendarDays} label="Sessions" value={totals.sessionCount} tone="brand" />
        <StatTile valueFirst icon={CircleCheck} label="Present" value={totals.presentTotal} tone="success" />
        <StatTile valueFirst icon={UserRoundX} label="Absent" value={totals.absentTotal} tone="danger" />
        <StatTile
          valueFirst
          icon={BarChart3}
          label="Average Attendance"
          value={formatPercent(totals.ratio)}
          tone="info"
        />
      </StatTileGroup>

      {sessions.length === 0 ? (
        <EmptyState description="No completed sessions for this batch in the selected date range." />
      ) : (
        <div>
          <Panel className="overflow-hidden p-0 sm:p-0">
            <Table aria-label="Batch Attendance Report">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
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
            basePath="/reports/batch"
            params={{ batch: batchId, from: dateFrom, to: dateTo }}
            page={paged.page}
            totalPages={paged.totalPages}
            total={sessions.length}
          />
        </div>
      )}
    </section>
  );
}
