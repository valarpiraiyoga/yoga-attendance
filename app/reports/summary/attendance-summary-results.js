import { BarChart3, Calendar, UserRound, UserRoundX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
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

// Local copy — matches app/reports/batch/batch-attendance-results.js's
// ReportMetricCard exactly, so the KPI tiles share the same visual treatment
// across all three Reports tabs (Student/Batch/Summary).
function ReportMetricCard({ icon: Icon, label, value, tone }) {
  const tones = {
    info: "border-info/20 bg-info/10 text-info",
    success: "border-success/20 bg-success/10 text-success",
    danger: "border-danger/20 bg-danger/10 text-danger",
    purple: "border-purple-200 bg-purple-50 text-purple-600",
  };

  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 shadow-xs sm:px-4 ${tones[tone] ?? tones.info}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface/80 shadow-xs">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
          {label}
        </dt>
        <dd className="truncate text-page-title font-semibold tracking-tight text-text-primary">{value}</dd>
      </div>
    </div>
  );
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
      <header className="relative overflow-hidden border-b border-border/70 bg-gradient-to-br from-info/10 via-surface to-brand/10 p-4 sm:p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -right-6 size-32 rounded-full border border-info/20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-8 right-12 size-16 rounded-full border border-brand/20"
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span
              aria-hidden="true"
              className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-brand/40 bg-brand/10 text-brand sm:size-[4.25rem]"
            >
              <BarChart3 className="size-6" />
            </span>

            <div className="min-w-0">
              <h3 className="text-page-title font-semibold break-words text-brand">Attendance Summary Report</h3>
              <p className="text-small mt-1 text-text-secondary">
                {formatDate(dateFrom)} – {formatDate(dateTo)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <ExportLinks type="summary" params={{ from: dateFrom, to: dateTo }} />
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
        <ReportMetricCard icon={Calendar} label="Total Sessions" value={totals.sessionCount} tone="info" />
        <ReportMetricCard icon={UserRound} label="Total Present" value={totals.presentTotal} tone="success" />
        <ReportMetricCard icon={UserRoundX} label="Total Absent" value={totals.absentTotal} tone="danger" />
        <ReportMetricCard
          icon={BarChart3}
          label="Overall Attendance"
          value={formatPercent(totals.ratio)}
          tone="purple"
        />
      </dl>

      {sessions.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-body mx-auto max-w-sm text-text-secondary">
            No completed sessions in the selected date range.
          </p>
        </div>
      ) : (
        <DataTableShell>
          <Table aria-label="Attendance Summary Report">
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
        </DataTableShell>
      )}
    </section>
  );
}
