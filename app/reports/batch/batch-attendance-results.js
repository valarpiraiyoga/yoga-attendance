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
              <h3 className="text-page-title font-semibold break-words text-brand">
                Batch Attendance Report: {batchLabel}
              </h3>
              <p className="text-small mt-1 text-text-secondary">
                {formatDate(dateFrom)} – {formatDate(dateTo)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <ExportLinks type="batch" params={{ batch: batchId, from: dateFrom, to: dateTo }} />
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
        <ReportMetricCard icon={Calendar} label="Sessions" value={totals.sessionCount} tone="info" />
        <ReportMetricCard icon={UserRound} label="Present" value={totals.presentTotal} tone="success" />
        <ReportMetricCard icon={UserRoundX} label="Absent" value={totals.absentTotal} tone="danger" />
        <ReportMetricCard
          icon={BarChart3}
          label="Average Attendance"
          value={formatPercent(totals.ratio)}
          tone="purple"
        />
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
