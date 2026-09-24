import { cn } from "@/lib/utils";

/**
 * The one entity-detail header (06-ui-implementation-rules.md §19),
 * replacing 5 near-identical headers (Student, Membership, Batch, Schedule,
 * Attendance session). Pairs with `Breadcrumb` above it and the action
 * cluster passed as `actions` (top-right, per the locked "breadcrumb +
 * top-right actions" decision — §19 rule 1).
 *
 * Three zones: identity (`avatar` + `title` + `status` + `subMeta`), a
 * `meta` list of icon/label/value pairs, and an optional `highlight` (a
 * single emphasised figure, e.g. Membership's Days Progress). The page's
 * `<h1>` lives here, not in `PageHeader` — a detail page has one heading
 * area, this is it.
 *
 * The card is pinned to the top of the workspace while the page scrolls
 * (`sm` and up; on phones it scrolls away, since a tall hero would eat the
 * screen). `-top-6` cancels the workspace's `py-6`, so it pins flush with the
 * top edge instead of leaving a strip where content scrolls past. For that to work its parent must be the page's own tall container,
 * so callers render it as a direct child of the page stack.
 *
 * A page can opt out of the decoration with `decorative={false}` (a plain
 * surface card, still pinned) — Membership Details does, to stay a compact
 * identification header.
 *
 * Its background is a soft brand-tinted gradient with a few faint abstract
 * shapes (circles / rings) — the one approved decorative-gradient exception
 * besides the sidebar tint (06-ui-implementation-rules.md §2). Built from the
 * existing `brand` / `info` tokens only, clipped to the card, and purely
 * decorative (`aria-hidden`, no pointer events).
 */
export function EntityDetailHeader({
  avatar,
  title,
  status,
  subMeta,
  meta = [],
  highlight,
  actions,
  decorative = true,
  className,
}) {
  return (
    <div
      className={cn(
        "relative isolate mb-6 flex flex-col gap-4 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-xs sm:sticky sm:-top-6 sm:z-20 sm:p-5 print:static",
        className
      )}
    >
      {decorative ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-linear-to-br from-brand/10 via-surface to-brand/5" />
          <div className="absolute -top-20 -right-12 size-56 rounded-full bg-brand/10 blur-2xl" />
          <div className="absolute -right-6 -top-14 size-44 rounded-full border border-brand/15" />
          <div className="absolute -right-16 -top-24 size-72 rounded-full border border-brand/10" />
          <div className="absolute -bottom-24 left-1/3 size-52 rounded-full bg-info/10 blur-3xl" />
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          {avatar}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-page-title font-semibold text-text-primary">{title}</h1>
              {status}
            </div>
            {subMeta ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-text-secondary">
                {subMeta}
              </div>
            ) : null}
          </div>
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </div>

      {meta.length > 0 || highlight ? (
        <div className="flex flex-col gap-4 border-t border-border pt-4 lg:flex-row lg:items-center lg:justify-between">
          {meta.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:flex lg:flex-1 lg:items-center lg:gap-8">
              {meta.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="min-w-0">
                    <p className="flex items-center gap-1.5 text-small text-text-secondary">
                      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                      {item.label}
                    </p>
                    <p className="mt-0.5 truncate text-body font-medium text-text-primary">{item.value}</p>
                  </div>
                );
              })}
            </div>
          ) : null}
          {highlight}
        </div>
      ) : null}
    </div>
  );
}
