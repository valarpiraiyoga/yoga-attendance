import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state for a list page: page header, filter bar, table and
 * pagination row, in the proportions those pages actually use.
 *
 * One shared component rather than a copy per route — every list page in
 * this application (Students, Memberships, Batches, Schedule, Attendance,
 * Attendance History) is the same shape, so this is the repeated problem
 * CLAUDE.md's "prefer reusable components" rule is about. The per-route
 * differences that actually matter visually are the column count, whether
 * the header carries a primary action, and how many filter controls sit in
 * the bar — so those are the only props.
 *
 * Rendered inside each section layout's existing `<AppShell><Container>`,
 * so the sidebar, header and page gutter are already on screen around it:
 * navigating between sections swaps only this region, which is the point.
 *
 * Widths are varied deliberately. A grid of identical bars reads as a
 * broken table; uneven ones read as text that has not arrived yet.
 */

const HEADER_WIDTHS = ["w-20", "w-16", "w-24", "w-20", "w-14", "w-20", "w-16", "w-24", "w-16"];
const CELL_WIDTHS = ["w-32", "w-24", "w-28", "w-20", "w-16", "w-24", "w-20", "w-28", "w-16"];

export default function ListPageSkeleton({
  columns = 6,
  rows = 8,
  filters = 3,
  withAction = true,
  withPagination = true,
  label = "Loading",
}) {
  const columnIndexes = Array.from({ length: columns }, (_, index) => index);
  const rowIndexes = Array.from({ length: rows }, (_, index) => index);
  const filterIndexes = Array.from({ length: filters }, (_, index) => index);

  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>

      {/* PageHeader */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        {withAction ? <Skeleton className="h-9 w-32 shrink-0 rounded-md" /> : null}
      </div>

      {/* Filter bar */}
      {filters > 0 ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end">
          {filterIndexes.map((index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md sm:w-40" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
        <div className="flex items-center gap-6 border-b border-border px-4 py-3">
          {columnIndexes.map((index) => (
            <Skeleton key={index} className={`h-3 ${HEADER_WIDTHS[index % HEADER_WIDTHS.length]}`} />
          ))}
        </div>

        {rowIndexes.map((row) => (
          <div key={row} className="flex items-center gap-6 border-b border-border px-4 py-4 last:border-b-0">
            {columnIndexes.map((index) => (
              <Skeleton key={index} className={`h-4 ${CELL_WIDTHS[index % CELL_WIDTHS.length]}`} />
            ))}
          </div>
        ))}
      </div>

      {/* Pagination row */}
      {withPagination ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-4 w-56" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
