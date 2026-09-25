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
import { Badge } from "@/components/ui/badge";
import { formatDate, formatTimeRange } from "@/lib/format";
import { getStudentAttendanceReport } from "@/lib/reports/data";
import { formatPercent, paginateRows, ReportHeader, ReportPagination } from "@/app/reports/report-results";

const STATUS_LABELS = { present: "Present", absent: "Absent", unmarked: "Unmarked" };
const STATUS_VARIANTS = { present: "success", absent: "danger", unmarked: "neutral" };

/**
 * Student Attendance report results (approved wireframe p.35): the report
 * header, the SESSIONS / PRESENT / ABSENT / ATTENDANCE tiles, and the
 * per-session DATE / TIME / BATCH / INSTRUCTOR / STATUS table.
 *
 * An async Server Component, awaited inside a `<Suspense>` boundary in
 * `app/reports/page.js` so the filter bar stays interactive while the
 * report is produced.
 *
 * Every number here comes from `getStudentAttendanceReport`
 * (`lib/reports/data.js`), which reads the `report_session_facts` RPC. This
 * component performs no Supabase query of its own and derives no
 * eligibility: which sessions a student was eligible for is the frozen
 * Phase 16A snapshot's answer, resolved in SQL, never recomputed here from
 * current enrollments or memberships.
 *
 * SESSIONS is the count of sessions the student was ELIGIBLE for, which is
 * the denominator of ATTENDANCE — p.35's 8 sessions / 7 present / 1 absent
 * yields 87.5% = 7/8. Unmarked sessions stay in that denominator and are
 * never converted to absences (approved decision D2); they appear in the
 * table with their own Unmarked status.
 *
 * The tiles total every session in the range; only the table is paginated
 * (`page`, ten rows), so paging never changes a figure.
 */
export default async function StudentAttendanceResults({ studentId, studentLabel, dateFrom, dateTo, page }) {
  const report = await getStudentAttendanceReport({ studentId, dateFrom, dateTo });
  const { sessions, totals } = report;
  const paged = paginateRows(sessions, page);

  return (
    <section aria-label="Student Attendance Report" className="mt-6 flex flex-col gap-4">
      <ReportHeader
        title={`Student Attendance Report: ${studentLabel}`}
        dateFrom={dateFrom}
        dateTo={dateTo}
        exportType="student"
        exportParams={{ student: studentId, from: dateFrom, to: dateTo }}
      />

      <StatTileGroup ariaLabel="Student attendance summary">
        <StatTile valueFirst icon={CalendarDays} label="Sessions" value={totals.eligibleSessions} tone="brand" />
        <StatTile valueFirst icon={CircleCheck} label="Present" value={totals.presentCount} tone="success" />
        <StatTile valueFirst icon={UserRoundX} label="Absent" value={totals.absentCount} tone="danger" />
        <StatTile valueFirst icon={BarChart3} label="Attendance" value={formatPercent(totals.ratio)} tone="info" />
      </StatTileGroup>

      {sessions.length === 0 ? (
        <EmptyState description="This student was not eligible for any completed session in the selected date range." />
      ) : (
        <div>
          <Panel className="overflow-hidden p-0 sm:p-0">
            <Table aria-label="Student Attendance Report">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead>Status</TableHead>
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
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[session.status] ?? "neutral"}>
                        {STATUS_LABELS[session.status] ?? "Unmarked"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <ReportPagination
            basePath="/reports"
            params={{ student: studentId, from: dateFrom, to: dateTo }}
            page={paged.page}
            totalPages={paged.totalPages}
            total={sessions.length}
          />
        </div>
      )}
    </section>
  );
}
