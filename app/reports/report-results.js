import { BarChart3 } from "lucide-react";
import { Panel } from "@/components/layout/Panel";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { formatDate } from "@/lib/format";
import ExportLinks from "@/app/reports/export-links";

/**
 * Presentation helpers shared by the three Reports results screens (Student,
 * Batch, Attendance Summary). None of it reads or derives report data: the
 * figures, sessions and totals come from `lib/reports/data.js`, and the
 * arithmetic stays in `lib/reports/validation.js`.
 */

/** Rows per page of a report's session table. Totals always cover every row. */
export const REPORT_PAGE_SIZE = 10;

/**
 * Reports render attendance to ONE decimal place (approved wireframes p.35
 * "87.5%", p.36 "94.4%", p.37 "90.5%"), with a trailing ".0" trimmed so a
 * whole number reads "100%" rather than "100.0%" — exactly as p.36 shows it.
 *
 * This is a Reports-only presentation rule and deliberately lives here, not
 * in the data layer: `lib/reports/validation.js` returns an UNROUNDED ratio
 * (approved decision D1) precisely so display precision is decided once, at
 * the point of display. Attendance History's own integer percentage
 * (`computeAttendanceSummary`) is untouched by this.
 *
 * `null` — a range with no eligible sessions — renders as an em dash, never
 * "0%", which would assert that nobody attended rather than that there was
 * nothing to attend.
 */
export function formatPercent(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${Number((ratio * 100).toFixed(1))}%`;
}

/**
 * One page of an already-fetched, already-ordered session list. `page` is
 * clamped into range, so a hand-edited `?page=` can never show nothing.
 * Pure slicing — the report itself is fetched whole, and its KPI totals are
 * computed from every row, not from this page.
 */
export function paginateRows(rows, requestedPage) {
  const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * REPORT_PAGE_SIZE;

  return { rows: rows.slice(start, start + REPORT_PAGE_SIZE), page, totalPages };
}

/**
 * The report's own header (`17 Reports student addendance.png`): the title
 * and the selected date range on the left, and the Export CSV / Export Excel
 * actions on the right. `exportParams` are exactly the filters the report was
 * generated with, so an export always matches what is on screen.
 */
export function ReportHeader({ title, dateFrom, dateTo, exportType, exportParams }) {
  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-section-title font-semibold break-words text-text-primary">{title}</h2>
        <p className="text-small mt-1 text-text-secondary">
          {formatDate(dateFrom)} – {formatDate(dateTo)}
        </p>
      </div>
      <ExportLinks type={exportType} params={exportParams} />
    </Panel>
  );
}

/**
 * Pagination under a report's session table. `params` are the filters in the
 * URL (never `page`), so every page link keeps the same report.
 */
export function ReportPagination({ basePath, params, page, totalPages, total }) {
  return (
    <Pagination
      className="mt-4"
      page={page}
      totalPages={totalPages}
      total={total}
      pageSize={REPORT_PAGE_SIZE}
      itemLabel="sessions"
      ariaLabel="Report pagination"
      getHref={(targetPage) => `${basePath}?${new URLSearchParams({ ...params, page: String(targetPage) }).toString()}`}
    />
  );
}

/**
 * The placeholder shown while a report is produced — the same shape as the
 * results (header panel, four tiles, table panel) so the swap-in is not a
 * layout jump. Shared by all three Reports pages' `<Suspense>` fallbacks.
 */
export function ReportResultsSkeleton() {
  return (
    <section aria-busy="true" aria-label="Generating report" className="mt-6 flex animate-pulse flex-col gap-4">
      <Panel>
        <div className="h-5 w-64 rounded bg-neutral/15" />
        <div className="mt-2 h-4 w-44 rounded bg-neutral/15" />
      </Panel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="h-18 rounded-card border border-border bg-surface shadow-xs" />
        ))}
      </div>
      <Panel className="space-y-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-4 w-full rounded bg-neutral/15" />
        ))}
      </Panel>
    </section>
  );
}

/**
 * The state before a report is generated (`17 Reports … help.png`: "No report
 * data yet" with the instruction to select and generate), and the messages
 * for an invalid range or an unknown picker value. Same text the pages
 * already showed — only the presentation is the shared `EmptyState`.
 */
export function ReportEmptyState({ title, children }) {
  return <EmptyState className="mt-6" icon={BarChart3} title={title} description={children} />;
}
