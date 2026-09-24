import { cn } from "@/lib/utils";

/**
 * The one stat/metric tile (06-ui-implementation-rules.md §4.1, §22.3),
 * replacing the audit's 15 duplicated implementations (`MetricTile` ×6,
 * `SummaryTile` ×3, `ReportMetricCard` ×3, `StatTile`, `AttendanceStatTile`,
 * `SummaryChip`). Light tinted icon tile with dark text values — not the
 * Dashboard's former saturated gradient treatment, which this tile is also
 * the replacement for (that page adopts it when the Dashboard is next
 * implemented, per §21 rule 2).
 *
 * Typography is OWNED by this component (03-visual-tokens.md "Component
 * Typography Ownership"): every text element below sets its own size,
 * line-height, weight and colour, so nothing depends on parent styles.
 *   value  — 24/32 semibold, primary text  (the KPI figure, large)
 *   label  — 12/18 regular, secondary text (smaller than the value)
 *   aside  — 12/18 medium, tone colour     (compact supporting metric)
 *
 * Two hierarchies, one component:
 *   - default — uppercase label above the value (detail/report tiles).
 *   - `valueFirst` — value above a sentence-case label (list-page KPI
 *     strips: `02`/`03`/`05`/`06`/`08`/`09`). The DOM order stays
 *     label-then-value (`dt`, `dd`) so the reading order is unchanged;
 *     only the visual order flips.
 *
 * `aside` is an optional right-aligned figure in the tile's tone (e.g. a
 * share-of-total percentage).
 *
 * `compact` is the quieter variant for detail-page summary rows (Membership
 * Details): 12px padding, a 32px icon tile, an 18px value that wraps instead of
 * truncating. `children` renders under the caption (a progress bar, say).
 *
 * `decorativeChart` adds the small bar graphic from the list-page
 * references. It is purely decorative: `aria-hidden`, one fixed shape for
 * every tile, and it encodes no data — it must never be read as a trend.
 * Both `aside` and the chart are supplementary, so the right-hand cluster
 * yields wherever the tile is too narrow to carry it without squeezing the
 * label: hidden below `sm`, and in the `lg` band (1024–1279px) where the
 * sidebar leaves four tiles ~170px each. It shows again from `xl`.
 */
const TONE_STYLES = {
  brand: "bg-brand/10 text-brand",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  neutral: "bg-neutral/15 text-text-secondary",
};

const TONE_TEXT = {
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-text-secondary",
};

// Fixed decorative shape (heights on the 4px spacing scale). Identical for
// every tile by design — see the note above.
const CHART_BARS = [
  "h-2 opacity-30",
  "h-3 opacity-40",
  "h-4 opacity-60",
  "h-5 opacity-80",
  "h-6 opacity-100",
];

function DecorativeChart() {
  return (
    <span
      aria-hidden="true"
      data-slot="stat-tile-chart"
      className="mt-auto flex items-end gap-1"
    >
      {CHART_BARS.map((bar) => (
        <span key={bar} className={cn("w-1 rounded-full bg-current", bar)} />
      ))}
    </span>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  caption,
  aside,
  decorativeChart = false,
  tone = "brand",
  valueFirst = false,
  compact = false,
  children,
  className,
}) {
  const hasRightCluster = Boolean(aside) || decorativeChart;

  return (
    <div
      data-slot="stat-tile"
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-xs",
        compact && "items-start p-3",
        className
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            compact && "size-8",
            TONE_STYLES[tone] ?? TONE_STYLES.brand
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        </span>
      ) : null}
      <div className={cn("min-w-0", compact && "flex-1", valueFirst && "flex flex-col-reverse")}>
        {/* Full literal strings, deliberately NOT passed through `cn()`:
            tailwind-merge does not know our custom type tokens and treats
            `text-small` as a text colour, so `cn("text-small text-text-secondary")`
            silently drops the font size and the label falls back to the
            inherited 16px/24px. */}
        <dt
          data-slot="stat-tile-label"
          className={
            valueFirst
              ? "text-small font-normal text-text-secondary break-words"
              : "truncate text-small font-medium tracking-wide text-text-secondary uppercase"
          }
        >
          {label}
        </dt>
        <dd
          data-slot="stat-tile-value"
          className={
            compact
              ? "text-section-title font-semibold break-words text-text-primary"
              : "truncate text-page-title font-semibold text-text-primary"
          }
        >
          {value}
        </dd>
        {caption ? (
          <p
            className={
              compact
                ? "text-small font-normal break-words text-text-secondary"
                : "truncate text-small font-normal text-text-secondary"
            }
          >
            {caption}
          </p>
        ) : null}
        {children}
      </div>
      {hasRightCluster ? (
        <div
          className={cn(
            "ml-auto hidden shrink-0 flex-col items-end gap-1 self-stretch sm:flex lg:hidden xl:flex",
            TONE_TEXT[tone] ?? TONE_TEXT.brand
          )}
        >
          {aside ? (
            <span data-slot="stat-tile-aside" className="text-small font-medium">
              {aside}
            </span>
          ) : null}
          {decorativeChart ? <DecorativeChart /> : null}
        </div>
      ) : null}
    </div>
  );
}

// Static class map — Tailwind needs literal class names present in source,
// not an interpolated `grid-cols-${n}`, to keep them in the production build.
const GROUP_COLUMNS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3 lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export function StatTileGroup({ children, columns = 4, className, ariaLabel = "Summary" }) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn("grid grid-cols-2 gap-3", GROUP_COLUMNS[columns] ?? GROUP_COLUMNS[4], className)}
    >
      {children}
    </dl>
  );
}
