import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listBatchOptions } from "@/lib/batches/data";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import { ReportEmptyState, ReportResultsSkeleton } from "@/app/reports/report-results";
import BatchAttendanceFilters from "@/app/reports/batch/batch-attendance-filters";
import BatchAttendanceResults from "@/app/reports/batch/batch-attendance-results";

/**
 * Reports — Batch Attendance (Phase 17 Slice 3; `01-product.md` §10,
 * `02-ux.md` Flow 13, approved wireframe p.36).
 *
 * A sibling route to `/reports` (Student Attendance, the default tab) —
 * `ReportTabs` links here once this slice exists, matching the approved
 * Reports IA (`02-ux.md`: Student Attendance / Batch Attendance / Attendance
 * Summary). Attendance Summary remains inert until its own slice.
 *
 * Structured identically to `app/reports/page.js`, because the approved
 * scope for this slice is explicitly "handle prompt, validation, loading,
 * empty, and results states consistently with Student Attendance" — filters
 * live in the URL (`?batch=&from=&to=`), nothing is queried until all three
 * are present and the range validates, and the report itself streams inside
 * a `<Suspense>` boundary keyed on the filter values.
 *
 * Admin-only via `app/reports/layout.js`'s `requireRole(ROLES.ADMIN)`,
 * re-asserted here for the same reason every other page under a shared
 * layout does: a layout does not re-run on client-side navigation between
 * sibling pages (see app/settings/layout.js for the full explanation) — and
 * `/reports` -> `/reports/batch` is exactly that kind of navigation.
 *
 * This page issues no Supabase query of its own beyond the batch picker's
 * option list: every figure comes from `getBatchAttendanceReport`
 * (`lib/reports/data.js`), which reads the `report_session_facts` RPC.
 * Historical eligibility is the frozen Phase 16A snapshot's answer, resolved
 * in SQL — never recomputed here from current enrollments or memberships.
 */
export default async function BatchAttendanceReportPage({ searchParams }) {
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const dateFrom = typeof rawParams.from === "string" ? rawParams.from : "";
  const dateTo = typeof rawParams.to === "string" ? rawParams.to : "";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const batchOptions = await listBatchOptions();
  const selectedBatch = batchOptions.find((batch) => batch.id === batchId) ?? null;

  const hasSelection = Boolean(batchId) && Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <ReportEmptyState title="No report data yet">Select a batch and a date range, then choose Generate Report.</ReportEmptyState>;
  } else if (!range.success) {
    results = <ReportEmptyState>{range.error}</ReportEmptyState>;
  } else if (!selectedBatch) {
    results = <ReportEmptyState>That batch could not be found. Select a batch from the list.</ReportEmptyState>;
  } else {
    results = (
      // The filters and this boundary are siblings, so their keys differ by role prefix.
      <Suspense key={`results:${batchId}:${dateFrom}:${dateTo}`} fallback={<ReportResultsSkeleton />}>
        <BatchAttendanceResults
          batchId={batchId}
          batchLabel={`${selectedBatch.name} (${selectedBatch.code})`}
          dateFrom={range.data.dateFrom}
          dateTo={range.data.dateTo}
          page={page}
        />
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

      <ReportTabs active="batch">
        <BatchAttendanceFilters
          key={`filters:${batchId}:${dateFrom}:${dateTo}`}
          defaultBatchId={batchId}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
          batchOptions={batchOptions}
        />

        {results}
      </ReportTabs>
    </>
  );
}
