import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The one view switcher (06-ui-implementation-rules.md §16.4) — a
 * segmented control, distinct from `Tabs`: it switches the *presentation*
 * of one result set (Cards ⇄ Table), not between named content sections.
 * Active segment is always brand-filled, per every reference image
 * (`02`, `03`, `05`, `06`, `08`, `09`, `12`, `14`, `15`,
 * `16-…-final`) — this replaces the three prior implementations, two of
 * which used a surface-filled active state.
 *
 * `items`: `{ key, label, href, icon? }[]`. Server-rendered — view state is
 * a URL param, not client state, matching the existing Cards/Table and
 * Weekly/List toggles.
 *
 * Optional `autoActive` on an item (`"lg"` | `"below-lg"`) marks it as the
 * default view for that viewport range: while `active` is unset (no explicit
 * choice in the URL), that item is drawn active by CSS alone — from `lg` up or
 * below it — so the highlight follows the viewport with no client state and no
 * first-paint flash. An explicit `active` key always wins.
 *
 * `separate` draws each segment as its own bordered control (white surface,
 * subtle border, the standard button radius and height) instead of segments
 * inside one shared frame — the toolbar treatment where Search, Filters and
 * each view button are individual surfaces. The active segment keeps the
 * brand fill. Off by default; every other screen keeps the framed switcher.
 *
 * `iconOnly` (with `separate`; the Students toolbar) shows each view as a square icon button to save toolbar width, as ONE button group:
 * the buttons share a single bordered frame with a hairline between them, the active one in the secondary button style (a soft brand tint with
 * brand text, not the filled brand) and the other on the white surface. The label is not drawn but stays as the button's accessible name and
 * tooltip. Off by default.
 */
// Full literal class strings, deliberately NOT passed through `cn()`:
// tailwind-merge does not know our custom type tokens and treats
// `text-button` as a text colour, so it would drop the font size whenever a
// colour class (`text-surface` / `text-text-secondary`) is also present and
// the label would fall back to the inherited 16px/24px.
//
// Segment text uses the Button token (`text-button`, 14px/20px medium) so
// Cards/Table read at the same size as the Filters button beside them.
const SEGMENT_BASE = "inline-flex items-center gap-1.5 rounded-md px-3 text-button font-medium transition-colors";
const SEGMENT_ACTIVE = `${SEGMENT_BASE} bg-brand text-surface shadow-sm`;
const SEGMENT_INACTIVE = `${SEGMENT_BASE} text-text-secondary hover:bg-surface hover:text-text-primary`;

// `separate`: one bordered control per segment (same 36px height and 14px label
// as the Filters button beside them). Literal strings, for the same reason as above.
const SEPARATE_BASE =
  "inline-flex h-9 items-center gap-1.5 rounded-button border px-3 text-button font-medium transition-colors";
const SEPARATE_ACTIVE = `${SEPARATE_BASE} border-brand bg-brand text-surface`;
const SEPARATE_INACTIVE = `${SEPARATE_BASE} border-border bg-surface text-text-secondary hover:bg-muted hover:text-text-primary`;
const SEPARATE_AUTO = {
  lg: `${SEPARATE_BASE} lg:border-brand lg:bg-brand lg:text-surface max-lg:border-border max-lg:bg-surface max-lg:text-text-secondary max-lg:hover:bg-muted max-lg:hover:text-text-primary`,
  "below-lg": `${SEPARATE_BASE} max-lg:border-brand max-lg:bg-brand max-lg:text-surface lg:border-border lg:bg-surface lg:text-text-secondary lg:hover:bg-muted lg:hover:text-text-primary`,
};

// `iconOnly` button group: square segments inside one frame. Active = the secondary button style (`bg-primary/10 text-primary`). Literal strings.
const GROUP_BASE =
  "inline-flex h-full w-9 items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset not-first:border-l not-first:border-border";
const GROUP_ACTIVE = `${GROUP_BASE} bg-primary/10 text-primary`;
const GROUP_INACTIVE = `${GROUP_BASE} bg-surface text-text-secondary hover:bg-muted hover:text-text-primary`;
const GROUP_AUTO = {
  lg: `${GROUP_BASE} lg:bg-primary/10 lg:text-primary max-lg:bg-surface max-lg:text-text-secondary max-lg:hover:bg-muted max-lg:hover:text-text-primary`,
  "below-lg": `${GROUP_BASE} max-lg:bg-primary/10 max-lg:text-primary lg:bg-surface lg:text-text-secondary lg:hover:bg-muted lg:hover:text-text-primary`,
};

const SEGMENT_AUTO = {
  lg: `${SEGMENT_BASE} lg:bg-brand lg:text-surface lg:shadow-sm max-lg:text-text-secondary max-lg:hover:bg-surface max-lg:hover:text-text-primary`,
  "below-lg": `${SEGMENT_BASE} max-lg:bg-brand max-lg:text-surface max-lg:shadow-sm lg:text-text-secondary lg:hover:bg-surface lg:hover:text-text-primary`,
};

/**
 * Sized to sit level with the Filters button beside it: a fixed 36px
 * container (the `default` step of the button size scale, same as Filters)
 * with 26px segments and the same 14px/20px label.
 */
export default function ViewSwitcher({ items, active, ariaLabel = "Views", separate = false, iconOnly = false, className }) {
  const grouped = iconOnly && separate && items.every((item) => Boolean(item.icon));

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        grouped
          ? "inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-button border border-border bg-surface"
          : separate
          ? "inline-flex shrink-0 items-stretch gap-2"
          : "inline-flex h-9 shrink-0 items-stretch gap-1 rounded-lg border border-border bg-background/60 p-1",
        className
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isAuto = !active && Boolean(item.autoActive);
        const isActive = item.key === active;

        return (
          <Link
            key={item.key}
            href={item.href}
            role="tab"
            aria-selected={isAuto ? undefined : isActive}
            aria-label={grouped ? item.label : undefined}
            title={grouped ? item.label : undefined}
            className={
              grouped
                ? isAuto
                  ? GROUP_AUTO[item.autoActive]
                  : isActive
                    ? GROUP_ACTIVE
                    : GROUP_INACTIVE
                : separate
                ? isAuto
                  ? SEPARATE_AUTO[item.autoActive]
                  : isActive
                    ? SEPARATE_ACTIVE
                    : SEPARATE_INACTIVE
                : isAuto
                  ? SEGMENT_AUTO[item.autoActive]
                  : isActive
                    ? SEGMENT_ACTIVE
                    : SEGMENT_INACTIVE
            }
          >
            {Icon ? <Icon className={grouped ? "size-4 shrink-0" : "size-3.5 shrink-0"} aria-hidden="true" /> : null}
            {grouped ? null : item.label}
          </Link>
        );
      })}
    </div>
  );
}
