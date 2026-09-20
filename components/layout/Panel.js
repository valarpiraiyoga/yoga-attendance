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
 * A panel's own heading row — the one Detail-page section header: a left icon,
 * the title, and an optional one-line description directly under it, with one
 * right-aligned action. Distinct from `PageHeader` (the page's single `<h1>`)
 * and `TabContentHeading` (a tab body's heading) — this is for a `Panel`
 * nested inside a page, e.g. "Student Information" or "Current Enrollments" on
 * a detail page.
 *
 * The icon sits in a fixed 16×22px slot that is exactly the title's line box
 * (`text-body` is 14/22), and the icon + text unit is top-aligned. So the icon
 * always centres on the *title line*, whether or not there is a description —
 * centring it on the whole title + description block (the earlier
 * `items-center`) dropped it ~9px below the title on every header that had a
 * description. Without an action the row is top-aligned too, so the title
 * starts at the panel's padding edge regardless of `min-h-*` on the caller.
 */
export function PanelHeader({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap justify-between gap-2",
        action ? "items-center" : "items-start",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {Icon ? (
          <span aria-hidden="true" className="flex h-5.5 w-4 shrink-0 items-center justify-center text-text-secondary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-text-primary">{title}</h2>
          {description ? <p className="text-small text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
