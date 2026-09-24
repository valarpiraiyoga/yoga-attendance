import { cn } from "@/lib/utils";

/**
 * The one list-item card (06-ui-implementation-rules.md §8.2), replacing
 * `StudentCardItem` / `MembershipCardItem` / `BatchCardItem`'s independently
 * duplicated markup. Sits directly on the page background inside a plain
 * grid — no `DataTableShell` gradient wrapper (§8 rule 1).
 *
 * `subtitle` is the optional one-line identifier under the title (e.g. a
 * student/membership/batch code) — `02 Students card view.png` and its
 * siblings (`05`, `08`) stack Name → code → status badge; without it the
 * status badge sits directly under the bold title with nothing to share
 * the header's vertical rhythm, reading as oversized by isolation even
 * though its own box is unchanged.
 *
 * `meta`: `{ icon?, label, title? }[]` — the 3–5 icon + label rows under
 * the identity block. `iconClassName` on the component (not per row)
 * covers every current usage; pass one on a `meta` item only if a specific
 * row genuinely needs a different tone.
 *
 * `statusPlacement` — `"subtitle"` (default) puts `status` on its own line
 * under `subtitle`, in the left identity column, exactly as before this prop
 * existed. `"actions"` instead stacks it under `actions` in the right
 * column (View/menu icons on top, status below) — the Students card's
 * finalized header shape. Every existing caller is unaffected by default.
 */
export default function EntityCard({
  avatar,
  title,
  subtitle,
  status,
  statusPlacement = "subtitle",
  actions,
  meta = [],
  iconClassName = "text-text-secondary",
  className,
  children,
}) {
  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-body font-semibold leading-snug text-text-primary" title={typeof title === "string" ? title : undefined}>
                {title}
              </h3>
              {subtitle ? <p className="truncate text-small text-text-secondary">{subtitle}</p> : null}
              {status && statusPlacement === "subtitle" ? <div className="mt-1">{status}</div> : null}
            </div>
            {actions ? (
              <div className={cn("flex shrink-0", statusPlacement === "actions" ? "flex-col items-end gap-2" : "items-center")}>
                {actions}
                {status && statusPlacement === "actions" ? status : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {meta.length > 0 ? (
        <div className="flex flex-col gap-1.5 text-small text-text-secondary">
          {meta.map((row, index) => {
            const Icon = row.icon;
            return (
              <span key={index} className="inline-flex min-w-0 items-center gap-1.5" title={row.title}>
                {Icon ? <Icon className={cn("size-3.5 shrink-0", row.iconClassName ?? iconClassName)} aria-hidden="true" /> : null}
                <span className="min-w-0 truncate">{row.label}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {children}
    </article>
  );
}
