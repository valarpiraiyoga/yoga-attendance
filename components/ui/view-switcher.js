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

/**
 * Sized to sit level with the Filters button beside it: a fixed 36px
 * container (the `default` step of the button size scale, same as Filters)
 * with 26px segments and the same 14px/20px label.
 */
export default function ViewSwitcher({ items, active, ariaLabel = "Views", className }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("inline-flex h-9 shrink-0 items-stretch gap-1 rounded-lg border border-border bg-background/60 p-1", className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === active;

        return (
          <Link
            key={item.key}
            href={item.href}
            role="tab"
            aria-selected={isActive}
            className={isActive ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}
          >
            {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
