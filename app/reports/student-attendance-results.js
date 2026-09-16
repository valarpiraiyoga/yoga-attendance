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
import { Badge } from "@/components/ui/badge";
import { getStudentAttendanceReport } from "@/lib/reports/data";
import ExportLinks from "@/app/reports/export-links";

// Local copies, matching how every other list component in this project
// keeps its own (app/attendance-history/admin-history-list.js, etc.).
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
 * Reports render attendance to ONE decimal place (approved wireframes p.35
 * "87.5%", p.36 "94.4%", p.37 "90.5%"), with a trailing ".0" trimmed so a
 * whole number reads "100%" rather than "100.0%" — exactly as p.36 shows it.
 *
 * This is a Reports-only presentation rule and deliberately lives here, not
 * in the data layer: `lib/reports/validation.js` returns an UNROUNDED ratio
 * (approved decision D1) precisely so display precision is decided once, at
 * the point of display. Attendance History's own integer percentage
 * (`computeAttendanceSummary`) is untouched by this and keeps behaving
 * exactly as it does today.
 *
 * `null` — a range with no eligible sessions — renders as an em dash, never
 * "0%", which would assert that nobody attended rather than that there was
 * nothing to attend.
 */
function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${Number((ratio * 100).toFixed(1))}%`;
}

const STATUS_LABELS = { present: "Present", absent: "Absent", unmarked: "Unmarked" };
const STATUS_VARIANTS = { present: "success", absent: "danger", unmarked: "neutral" };

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
 */
export default async function StudentAttendanceResults({ studentId, studentLabel, dateFrom, dateTo }) {
  const report = await getStudentAttendanceReport({ studentId, dateFrom, dateTo });
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
                Student Attendance Report: {studentLabel}
              </h3>
              <p className="text-small mt-1 text-text-secondary">
                {formatDate(dateFrom)} – {formatDate(dateTo)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <ExportLinks type="student" params={{ student: studentId, from: dateFrom, to: dateTo }} />
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
        <ReportMetricCard icon={Calendar} label="Sessions" value={totals.eligibleSessions} tone="info" />
        <ReportMetricCard icon={UserRound} label="Present" value={totals.presentCount} tone="success" />
        <ReportMetricCard icon={UserRoundX} label="Absent" value={totals.absentCount} tone="danger" />
        <ReportMetricCard icon={BarChart3} label="Attendance" value={formatPercent(totals.ratio)} tone="purple" />
      </dl>

      {sessions.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-body mx-auto max-w-sm text-text-secondary">
            This student was not eligible for any completed session in the selected date range.
          </p>
        </div>
      ) : (
        <DataTableShell>
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
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANTS[session.status] ?? "neutral"}
                      className="rounded-full px-2 py-0"
                    >
                      <span className="text-[10px] leading-[14px] font-medium">
                        {STATUS_LABELS[session.status] ?? "Unmarked"}
                      </span>
                    </Badge>
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
