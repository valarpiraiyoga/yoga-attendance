import { Suspense } from "react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { listStudentOptions } from "@/lib/students/data";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import { ReportEmptyState, ReportResultsSkeleton } from "@/app/reports/report-results";
import StudentAttendanceFilters from "@/app/reports/student-attendance-filters";
import StudentAttendanceResults from "@/app/reports/student-attendance-results";

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
  const page = Math.max(1, Number(rawParams.page) || 1);

  const studentOptions = await listStudentOptions();
  const selectedStudent = studentOptions.find((student) => student.id === studentId) ?? null;

  const hasSelection = Boolean(studentId) && Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <ReportEmptyState title="No report data yet">Select a student and a date range, then choose Generate Report.</ReportEmptyState>;
  } else if (!range.success) {
    results = <ReportEmptyState>{range.error}</ReportEmptyState>;
  } else if (!selectedStudent) {
    results = <ReportEmptyState>That student could not be found. Select a student from the list.</ReportEmptyState>;
  } else {
    results = (
      // The filters and this boundary are siblings, so their keys differ by role prefix.
      <Suspense key={`results:${studentId}:${dateFrom}:${dateTo}`} fallback={<ReportResultsSkeleton />}>
        <StudentAttendanceResults
          studentId={studentId}
          studentLabel={selectedStudent.full_name}
          dateFrom={range.data.dateFrom}
          dateTo={range.data.dateTo}
          page={page}
        />
      </Suspense>
    );
  }

  return (
    <>
      <PageHeader compact title="Reports" description="View attendance reports and summaries." />

      <Container>
      <ReportTabs active="student">
        <StudentAttendanceFilters
          key={`filters:${studentId}:${dateFrom}:${dateTo}`}
          defaultStudentId={studentId}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
          studentOptions={studentOptions}
        />

        {results}
      </ReportTabs>
      </Container>
    </>
  );
}
