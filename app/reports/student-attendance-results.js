import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <header className="flex flex-col gap-4 border-b border-border px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-section-title font-semibold text-text-primary">
            Student Attendance Report: {studentLabel}
          </h3>
          <p className="text-body mt-1 text-text-secondary">
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </p>
        </div>
        <ExportLinks type="student" params={{ student: studentId, from: dateFrom, to: dateTo }} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border px-6 py-5 sm:grid-cols-4">
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Sessions</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.eligibleSessions}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Present</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.presentCount}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Absent</dt>
          <dd className="text-page-title font-semibold text-text-primary">{totals.absentCount}</dd>
        </div>
        <div>
          <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Attendance</dt>
          <dd className="text-page-title font-semibold text-text-primary">{formatPercent(totals.ratio)}</dd>
        </div>
      </dl>

      {sessions.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-body mx-auto max-w-sm text-text-secondary">
            This student was not eligible for any completed session in the selected date range.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden">
          <Table aria-label="Student Attendance Report">
            <TableHeader>
              <TableRow>
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
                    <Badge variant={STATUS_VARIANTS[session.status] ?? "neutral"}>
                      {STATUS_LABELS[session.status] ?? "Unmarked"}
                    </Badge>
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
