import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import { getBatchAttendanceReport } from "@/lib/reports/data";
import { attendanceRatio } from "@/lib/reports/validation";
import ExportLinks from "@/app/reports/export-links";

// Local copies, matching how every other list/results component in this
// project keeps its own (app/reports/student-attendance-results.js,
// app/attendance-history/admin-history-list.js, etc.).
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
 * presentation rule `app/reports/student-attendance-results.js` uses
 * (approved wireframes p.35–37: "87.5%", "94.4%", "90.5%"). Duplicated
 * rather than imported: it is display formatting local to a results
 * component, the same category of helper `formatDate`/`formatTime` already
 * are, not report arithmetic — the arithmetic itself
 * (`attendanceRatio`/`computePooledTotals`) stays in
 * `lib/reports/validation.js` and is shared for real.
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
 */
export default async function BatchAttendanceResults({ batchId, batchLabel, dateFrom, dateTo }) {
  const report = await getBatchAttendanceReport({ batchId, dateFrom, dateTo });
  const { sessions, totals } = report;

  return (
    <section className="mt-6 rounded-card border border-border bg-surface shadow-xs">
      <header className="flex flex-col gap-4 border-b border-border px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-section-title font-semibold text-text-primary">
            Batch Attendance Report: {batchLabel}
          </h3>
          <p className="text-body mt-1 text-text-secondary">
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </p>
        </div>
        <ExportLinks type="batch" params={{ batch: batchId, from: dateFrom, to: dateTo }} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border px-6 py-5 sm:grid-cols-4">
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Sessions</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.sessionCount}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Present</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.presentTotal}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Absent</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.absentTotal}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Average Attendance</dt>
          <dd className="text-page-title font-semibold text-text-primary">{formatPercent(totals.ratio)}</dd>
        </div>
      </dl>

      {sessions.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-body mx-auto max-w-sm text-text-secondary">
            No completed sessions for this batch in the selected date range.
          </p>
        </div>
      ) : (
        <DataTableShell>
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
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="text-text-secondary">{formatDate(session.session_date)}</TableCell>
                  <TableCell className="text-text-secondary">
                    {formatTime(session.start_time)} – {formatTime(session.end_time)}
                  </TableCell>
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
        </DataTableShell>
      )}
    </section>
  );
}
