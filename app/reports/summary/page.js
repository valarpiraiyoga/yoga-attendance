import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import { ReportEmptyState, ReportResultsSkeleton } from "@/app/reports/report-results";
import AttendanceSummaryFilters from "@/app/reports/summary/attendance-summary-filters";
import AttendanceSummaryResults from "@/app/reports/summary/attendance-summary-results";

/**
 * Reports — Attendance Summary (Phase 17 Slice 4; `01-product.md` §10,
 * `02-ux.md` Flow 13, approved wireframe p.37).
 *
 * A sibling route to `/reports` (Student Attendance) and `/reports/batch`
 * (Batch Attendance) — `ReportTabs` links here now that this slice exists,
 * completing the approved Reports IA (`02-ux.md`: Student Attendance /
 * Batch Attendance / Attendance Summary).
 *
 * The only Reports filter with no entity picker (`01-product.md` §10:
 * "Filters: Date or date range") — this report spans every batch and every
 * student, so DATE FROM / DATE TO are the whole filter bar. Otherwise
 * structured identically to the other two tabs: filters live in the URL
 * (`?from=&to=`), nothing is queried until the range validates, and the
 * report streams inside a `<Suspense>` boundary keyed on the filter values.
 * A single date (`01-product.md`'s "Date or date range") is simply
 * `dateFrom === dateTo`, the same convention `validateReportDateRange`
 * already establishes for the other two reports.
 *
 * Admin-only via `app/reports/layout.js`'s `requireRole(ROLES.ADMIN)`,
 * re-asserted here for the same reason every sibling page under a shared
 * layout does: a layout does not re-run on client-side navigation between
 * siblings (see app/settings/layout.js for the full explanation).
 *
 * This page issues no Supabase query of its own: every figure comes from
 * `getAttendanceSummaryReport` (`lib/reports/data.js`), which reads the
 * `report_session_facts` RPC. Historical eligibility is the frozen Phase
 * 16A snapshot's answer, resolved in SQL — never recomputed here from
 * current enrollments or memberships. Only completed sessions are ever
 * returned; cancelled and holiday sessions are excluded by the RPC itself,
 * not by anything filtered here.
 */
export default async function AttendanceSummaryReportPage({ searchParams }) {
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const hasSelection = Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <ReportEmptyState title="No report data yet">Select a date range, then choose Generate Report.</ReportEmptyState>;
  } else if (!range.success) {
    results = <ReportEmptyState>{range.error}</ReportEmptyState>;
  } else {
    results = (
      // The filters and this boundary are siblings, so their keys differ by role prefix.
      <Suspense key={`results:${dateFrom}:${dateTo}`} fallback={<ReportResultsSkeleton />}>
        <AttendanceSummaryResults dateFrom={range.data.dateFrom} dateTo={range.data.dateTo} page={page} />
      </Suspense>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="View attendance reports and summaries."
        icon={<BarChart3 className="size-6" />}
      />

      <ReportTabs active="summary">
        <AttendanceSummaryFilters
          key={`filters:${dateFrom}:${dateTo}`}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
        />

        {results}
      </ReportTabs>
    </>
  );
}
