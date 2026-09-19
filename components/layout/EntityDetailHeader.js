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
 */
export function EntityDetailHeader({ avatar, title, status, subMeta, meta = [], highlight, actions, className }) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5",
        className
      )}
    >
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
