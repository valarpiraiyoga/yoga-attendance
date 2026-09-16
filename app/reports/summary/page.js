import { Suspense } from "react";
import { BarChart3, ClipboardList } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import PageHeader from "@/components/layout/PageHeader";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportTabs from "@/app/reports/report-tabs";
import TabContentHeading from "@/components/layout/TabContentHeading";
import AttendanceSummaryFilters from "@/app/reports/summary/attendance-summary-filters";
import AttendanceSummaryResults from "@/app/reports/summary/attendance-summary-results";

/**
 * Matches the results card's shape so the swap-in is not a layout jump. A
 * duplicate of `app/reports/page.js` and `app/reports/batch/page.js`'s own
 * skeletons rather than a shared export — see either file's comment for the
 * reasoning applied to this tab instead.
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

  const hasSelection = Boolean(dateFrom) && Boolean(dateTo);
  const range = hasSelection ? validateReportDateRange(dateFrom, dateTo) : null;

  let results = null;
  if (!hasSelection) {
    results = <Notice>Select a date range, then choose Generate Report.</Notice>;
  } else if (!range.success) {
    results = <Notice>{range.error}</Notice>;
  } else {
    results = (
      <Suspense key={`${dateFrom}:${dateTo}`} fallback={<ResultsSkeleton />}>
        <AttendanceSummaryResults dateFrom={range.data.dateFrom} dateTo={range.data.dateTo} />
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
        <section>
          <TabContentHeading
            icon={ClipboardList}
            title="Attendance Summary"
            description="View attendance totals for a selected date or date range."
          />

          <AttendanceSummaryFilters
            key={`${dateFrom}:${dateTo}`}
            defaultDateFrom={dateFrom}
            defaultDateTo={dateTo}
          />
        </section>

        {results}
      </ReportTabs>
    </>
  );
}
