import { cn } from "@/lib/utils";

/**
 * The one empty-state component (06-ui-implementation-rules.md §13),
 * replacing 23 call sites and ~6 visual variants. Every list page renders
 * one of two variants via this component: `variant="empty"` (no records at
 * all — pairs with a primary action) or `variant="filtered"` (no records
 * match the current search/filters — pairs with a "Clear Filters" action).
 * `size="sm"` drops the icon and the outer padding for an empty state
 * nested inside a `Panel`.
 */
export default function EmptyState({ icon: Icon, title, description, action, size = "default", className }) {
  const isSmall = size === "sm";

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface text-center",
        isSmall ? "gap-2 px-4 py-8" : "px-6 py-16",
        className
      )}
    >
      {Icon && !isSmall ? (
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-background text-text-secondary"
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      {title ? <p className="text-body font-medium text-text-primary">{title}</p> : null}
      {description ? (
        <p className="max-w-sm text-small text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
