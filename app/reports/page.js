import { Suspense } from "react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listStudentOptions } from "@/lib/students/data";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import StudentAttendanceFilters from "@/app/reports/student-attendance-filters";
import StudentAttendanceResults from "@/app/reports/student-attendance-results";

/** Matches the results card's shape so the swap-in is not a layout jump. */
function ResultsSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Generating report"
      className="mt-6 animate-pulse rounded-card border border-border bg-surface shadow-xs"
    >
      <div className="border-b border-border px-6 py-4">
        <div className="h-5 w-64 rounded bg-neutral/15" />
        <div className="mt-2 h-4 w-44 rounded bg-neutral/15" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border px-6 py-5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile}>
            <div className="h-3 w-16 rounded bg-neutral/15" />
            <div className="mt-2 h-7 w-12 rounded bg-neutral/15" />
          </div>
        ))}
      </div>
      <div className="space-y-3 px-6 py-6">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-4 w-full rounded bg-neutral/15" />
        ))}
      </div>
    </section>
  );
}

function Notice({ children }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-body max-w-md text-text-secondary">{children}</p>
    </div>
  );
}

/**
 * Reports — Student Attendance (Phase 17 Slice 2; `01-product.md` §10,
 * `02-ux.md` Flow 13, approved wireframe p.35).
 *
 * `/reports` IS the Student Attendance report because the approved Reports
 * IA marks it the default tab (`02-ux.md`: "Student Attendance ← Default").
 * Batch Attendance and Attendance Summary get their own sibling routes in
 * their own slices; `ReportTabs` renders them inert until then.
 *
 * Filters live in the URL (`?student=&from=&to=`), the same convention
 * Attendance History uses, so a generated report is linkable, refreshable
 * and back-button-safe.
 *
 * Nothing is queried until all three filters are present AND the range
 * validates. The wireframe gates its whole result behind Generate Report,
 * and a report has no sensible "everything" default the way a history list
 * does. The client filter bar validates first for speed; this page
 * re-validates because a hand-edited URL must not reach the data layer with
 * a reversed or malformed range.
 *
 * The report itself is awaited inside `<Suspense>`, keyed on the three
 * filter values so each new query re-suspends and shows the skeleton rather
 * than silently holding the previous result on screen.
 *
 * This page issues no Supabase query of its own beyond the student picker's
 * option list: every figure comes from `getStudentAttendanceReport`
 * (`lib/reports/data.js`), which reads the `report_session_facts` RPC.
 * Historical eligibility is the frozen Phase 16A snapshot's answer, resolved
 * in SQL — never recomputed here from current enrollments or memberships.
 */
export default async function ReportsPage({ searchParams }) {
  // Authorization boundary. app/reports/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages — see app/settings/layout.js for the full explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const studentId = typeof rawParams.student === "string" ? rawParams.student : "";
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";

  const studentOptions = await listStudentOptions();
  const selectedStudent = studentOptions.find((student) => student.id === studentId) ?? null;

  const hasSelection = Boolean(studentId) && Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <Notice>Select a student and a date range, then choose Generate Report.</Notice>;
  } else if (!range.success) {
    results = <Notice>{range.error}</Notice>;
  } else if (!selectedStudent) {
    results = <Notice>That student could not be found. Select a student from the list.</Notice>;
  } else {
    results = (
      <Suspense key={`${studentId}:${dateFrom}:${dateTo}`} fallback={<ResultsSkeleton />}>
        <StudentAttendanceResults
          studentId={studentId}
          studentLabel={selectedStudent.full_name}
          dateFrom={range.data.dateFrom}
          dateTo={range.data.dateTo}
        />
      </Suspense>
    );
  }

  return (
    <>
      <PageHeader title="Reports" description="View attendance reports and summaries." />

      <ReportTabs active="student" />

      <section className="mt-6">
        <h2 className="text-section-title font-semibold text-text-primary">Student Attendance</h2>
        <p className="text-body mt-1 text-text-secondary">
          View attendance history for a student over a selected date range.
        </p>

        <StudentAttendanceFilters
          key={`${studentId}:${dateFrom}:${dateTo}`}
          defaultStudentId={studentId}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
          studentOptions={studentOptions}
        />
      </section>

      {results}
    </>
  );
}
