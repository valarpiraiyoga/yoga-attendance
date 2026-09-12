import { Suspense } from "react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { listBatchOptions } from "@/lib/batches/data";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import BatchAttendanceFilters from "@/app/reports/batch/batch-attendance-filters";
import BatchAttendanceResults from "@/app/reports/batch/batch-attendance-results";

/**
 * Matches the results card's shape so the swap-in is not a layout jump.
 * A duplicate of `app/reports/page.js`'s own skeleton rather than a shared
 * export: both are small, page-local presentational helpers, the same
 * category of thing `formatDate`/`formatTime` already are per-component
 * throughout this codebase — see that file's own version for the identical
 * reasoning applied to this tab instead of Student Attendance.
 */
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

  const batchOptions = await listBatchOptions();
  const selectedBatch = batchOptions.find((batch) => batch.id === batchId) ?? null;

  const hasSelection = Boolean(batchId) && Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <Notice>Select a batch and a date range, then choose Generate Report.</Notice>;
  } else if (!range.success) {
    results = <Notice>{range.error}</Notice>;
  } else if (!selectedBatch) {
    results = <Notice>That batch could not be found. Select a batch from the list.</Notice>;
  } else {
    results = (
      <Suspense key={`${batchId}:${dateFrom}:${dateTo}`} fallback={<ResultsSkeleton />}>
        <BatchAttendanceResults
          batchId={batchId}
          batchLabel={`${selectedBatch.name} (${selectedBatch.code})`}
          dateFrom={range.data.dateFrom}
          dateTo={range.data.dateTo}
        />
      </Suspense>
    );
  }

  return (
    <>
      <PageHeader title="Reports" description="View attendance reports and summaries." />

      <ReportTabs active="batch" />

      <section className="mt-6">
        <h2 className="text-section-title font-semibold text-text-primary">Batch Attendance</h2>
        <p className="text-body mt-1 text-text-secondary">
          View attendance performance for a batch over a selected date range.
        </p>

        <BatchAttendanceFilters
          key={`${batchId}:${dateFrom}:${dateTo}`}
          defaultBatchId={batchId}
          defaultDateFrom={dateFrom}
          defaultDateTo={dateTo}
          batchOptions={batchOptions}
        />
      </section>

      {results}
    </>
  );
}
