import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAttendanceSummaryReport } from "@/lib/reports/data";
import { attendanceRatio } from "@/lib/reports/validation";
import ExportLinks from "@/app/reports/export-links";

// Local copies, matching how every other list/results component in this
// project keeps its own (app/reports/student-attendance-results.js,
// app/reports/batch/batch-attendance-results.js, etc.).
function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One decimal place, trailing ".0" trimmed — the same Reports-only
 * presentation rule every other results component in this feature uses
 * (approved wireframes p.35–37: "87.5%", "94.4%", "90.5%"). Duplicated
 * rather than imported, the same display-helper category as
 * `formatDate`/`formatTime` above; the arithmetic itself
 * (`attendanceRatio`/`computePooledTotals`) stays shared in
 * `lib/reports/validation.js`.
 *
 * `null` — no eligible students for that row/range — renders as an em dash,
 * never "0%", which would assert nobody attended rather than that there was
 * nothing to attend.
 */
function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${Number((ratio * 100).toFixed(1))}%`;
}

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
 */
export default async function AttendanceSummaryResults({ dateFrom, dateTo }) {
  const report = await getAttendanceSummaryReport({ dateFrom, dateTo });
  const { sessions, totals } = report;

  return (
    <section className="mt-6 rounded-card border border-border bg-surface shadow-xs">
      <header className="flex flex-col gap-4 border-b border-border px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-section-title font-semibold text-text-primary">Attendance Summary Report</h3>
          <p className="text-body mt-1 text-text-secondary">
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </p>
        </div>
        <ExportLinks type="summary" params={{ from: dateFrom, to: dateTo }} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border px-6 py-5 sm:grid-cols-4">
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Total Sessions</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.sessionCount}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Total Present</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.presentTotal}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Total Absent</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.absentTotal}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Overall Attendance</dt>
          <dd className="text-page-title font-semibold text-text-primary">{formatPercent(totals.ratio)}</dd>
        </div>
      </dl>

      {sessions.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-body mx-auto max-w-sm text-text-secondary">
            No completed sessions in the selected date range.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden">
          <Table aria-label="Attendance Summary Report">
            <TableHeader>
              <TableRow>
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
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="text-text-secondary">{formatDate(session.session_date)}</TableCell>
                  <TableCell className="text-text-secondary">
                    {formatTime(session.start_time)} – {formatTime(session.end_time)}
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
                  <TableCell className="text-text-secondary">{session.eligibleCount}</TableCell>
                  <TableCell className="text-text-secondary">{session.presentCount}</TableCell>
                  <TableCell className="text-text-secondary">{session.absentCount}</TableCell>
                  <TableCell className="text-text-secondary">
                    {formatPercent(attendanceRatio(session.presentCount, session.eligibleCount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
