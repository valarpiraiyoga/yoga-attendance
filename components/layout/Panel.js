import { cn } from "@/lib/utils";

/**
 * The one bordered content container (06-ui-implementation-rules.md §8.1),
 * replacing 5 local `Panel` definitions across the detail pages. Also the
 * canonical table surface (§9.2): a table lives inside a `Panel`, not
 * `DataTableShell`'s retired gradient frame.
 */
export function Panel({ children, className, ...props }) {
  return (
    <section
      className={cn("rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5", className)}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * A panel's own heading row: optional icon, title, description, and one
 * right-aligned action. Distinct from `PageHeader` (the page's single
 * `<h1>`) and `TabContentHeading` (a tab body's heading) — this is for a
 * `Panel` nested inside a page, e.g. "Student Information" or "Current
 * Enrollments" on a detail page.
 */
export function PanelHeader({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" /> : null}
        <div>
          <h2 className="text-body font-semibold text-text-primary">{title}</h2>
          {description ? <p className="text-small text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
