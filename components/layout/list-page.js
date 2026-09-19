import { cn } from "@/lib/utils";

/**
 * List-page composition primitives (06-ui-implementation-rules.md §18,
 * §22.3). Created here, against the Students List template, rather than
 * speculatively during the foundation phase — this is their first real
 * consumer, and every other list page (Memberships, Batches, Schedule,
 * Attendance, Attendance History) reuses them unchanged.
 */

/**
 * The toolbar row every list page's own `*Filters` component renders into:
 * the bordered card holding search + the Filters trigger + the view
 * switcher, one row on `sm+`, stacked below it. `chips` renders inside the
 * same card, below the row — the existing applied-filter chips position.
 */
export function ListToolbar({ children, chips, className }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-4 shadow-xs", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{children}</div>
      {chips}
    </div>
  );
}

/**
 * The "N Students / Card list view" caption line above a list's results
 * (`02`/`03`/`05`/`06`/`08`/`09` etc.) — count on the left, current-view
 * label beneath it. `aside` is the right-hand slot (the "Sort by" control).
 */
export function ResultsHeader({ count, label, viewLabel, aside, className }) {
  return (
    <div className={cn("mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div>
        <p className="text-body font-medium text-text-primary">
          {count} {label}
        </p>
        {viewLabel ? <p className="text-small text-text-secondary">{viewLabel}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/** The card-view grid — sits directly on the page background, no wrapper (§8 rule 1). */
export function CardGrid({ children, className, ariaLabel }) {
  return (
    <div
      className={cn("grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
