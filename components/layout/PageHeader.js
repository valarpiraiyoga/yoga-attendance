import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import MobileHeaderAction from "@/components/layout/MobileHeaderAction";
import { cn } from "@/lib/utils";

/**
 * Compact heading strip for an application page.
 *
 * Renders the page's single <h1> at a small, section-heading scale, an
 * optional one-line description beneath it, and optional actions on the right
 * (stacked beneath on narrow screens). It is only the strip: page content —
 * hero/profile cards, KPIs, tabs — belongs in the page body below it, never
 * in here, so it never competes with a page's own hero.
 *
 * `icon` is still accepted so existing call sites keep working, but the strip
 * no longer draws the tinted icon tile: the compact header is title,
 * description and actions only.
 *
 * `compact` is the finalized page-header pattern (Attendance History): a white
 * strip at the very top of the workspace — flush against the sidebar and the
 * page's right edge, one bottom rule, compact type and padding — with the
 * title block on the left and the actions on the right of one row from `sm`
 * up. It bleeds through the shell's content padding with negative margins, so
 * it must be a direct child of the shell's `<main>` (render the page body in
 * its own `Container` beside it, not the strip inside one). Its inner row is
 * capped to line up with that `Container`'s 1200px content on very wide screens.
 *
 * Below `lg` the compact strip yields to the mobile top bar: the section layout
 * names the page there (`AppShell`'s `mobileTitle`), so the strip keeps its
 * `<h1>` for assistive tech only and drops its frame and description.
 *
 * `collapseOnMobile` drops the strip's frame below `lg` the same way
 * `mobileActions` does, for a page that has no mobile top-bar control of its
 * own (Settings): the mobile top bar names the page and nothing sits under it.
 * It defaults to whether `mobileActions` was given.
 *
 * `back` (`{ href, label }`) puts a compact, boxed arrow-only button before the title for a
 * page reached from another record (an Edit page); `label` is its accessible name
 * ("Back to Kavish Kannan"), not visible text. It stays visible at every width -
 * below `lg`, where a compact strip drops the title and description, it is the one
 * thing the strip still shows - so the way back is never lost.
 *
 * `mobileActions` puts a page-level control in the mobile top bar's right-hand
 * slot (`MobileHeaderAction`) — a compact icon-sized control; the `actions`
 * node then shows only from `lg` up. Without it, `actions` show at every
 * width (below `lg`, alone in the strip under the top bar).
 */
export default function PageHeader({
  title,
  description,
  actions,
  mobileActions,
  collapseOnMobile,
  back,
  compact = false,
  className,
}) {
  const collapseMobile = collapseOnMobile ?? Boolean(mobileActions);
  const titleBlock = (
    <div className="min-w-0">
      <h1
        className={cn(
          "font-semibold break-words text-text-primary",
          // The compact strip is one size on every page: a small title keeps it short.
          compact ? "text-body max-lg:sr-only" : "text-section-title"
        )}
      >
        {title}
      </h1>
      {description ? (
        <p className={cn("break-words text-text-secondary", compact ? "text-small max-lg:hidden" : "text-body mt-0.5")}>
          {description}
        </p>
      ) : null}
    </div>
  );

  const heading = back ? (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        href={back.href}
        aria-label={back.label}
        title={back.label}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-secondary shadow-xs hover:bg-background hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Link>
      {titleBlock}
    </div>
  ) : (
    titleBlock
  );

  const actionArea = actions ? (
    <div className={cn("shrink-0 flex-wrap items-center gap-2 sm:gap-3", mobileActions ? "hidden lg:flex" : "flex")}>
      {actions}
    </div>
  ) : null;

  const mobileSlot = mobileActions ? <MobileHeaderAction>{mobileActions}</MobileHeaderAction> : null;

  if (compact) {
    return (
      <div
        className={cn(
          "-mx-4 -mt-6 mb-4 border-b border-border bg-surface sm:-mx-6 lg:-mx-8",
          collapseMobile && "max-lg:-mt-2 max-lg:mb-0 max-lg:border-0 max-lg:bg-transparent",
          className
        )}
      >
        <div
          className={cn(
            "mx-auto flex max-w-[1264px] flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8",
            "py-1.5 lg:py-2",
            collapseMobile && "max-lg:sr-only"
          )}
        >
          {heading}
          {actionArea}
          {mobileSlot}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      {heading}
      {actionArea}
      {mobileSlot}
    </div>
  );
}
