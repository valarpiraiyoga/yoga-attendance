import Link from "next/link";
import { CalendarDays, List, ListChecks } from "lucide-react";
import Tabs from "@/components/ui/tabs";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

// The third tab (01-product.md §8 "Class Count Attendance"): for an Admin and an Instructor, and a route of its own, so the two
// session views above are exactly what they were.
const CLASS_COUNT_VIEW = { key: "class-count", label: "Class Count Attendance", href: "/attendance/class-count", icon: ListChecks };

// The segmented section control from `lg` up: a white, softly shadowed frame holding one rounded segment per view - the active one
// brand-filled, the others muted with a soft brand hover. Full literal class strings, not `cn()` (tailwind-merge would drop the
// `text-button` size beside a text colour; see components/ui/view-switcher.js).
const FRAME = "mb-4 inline-flex items-center gap-1 rounded-card border border-border bg-surface p-1 shadow-xs max-lg:hidden";
const SEGMENT =
  "group inline-flex h-10 items-center gap-2 rounded-lg px-4 text-button font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const SEGMENT_ACTIVE = `${SEGMENT} bg-brand text-surface shadow-sm`;
const SEGMENT_INACTIVE = `${SEGMENT} text-text-secondary hover:bg-brand/5 hover:text-brand`;

/**
 * Today's Sessions / All Sessions (/ Class Count Attendance) navigation - routes of one screen. From `lg` up a segmented control of its
 * own (the list toolbars' shared `ViewSwitcher` is left as it is): each view a link with its icon, the current one marked
 * `aria-current="page"`. Below `lg` the standard underline `Tabs`. Both are plain server-rendered links, so switching is a URL change;
 * only one is displayed at a time. With `showClassCount` (an Admin or an Instructor) the third view follows the two session views.
 */
export default function AttendanceViewToggle({ active, showClassCount = false }) {
  const views = showClassCount ? [...VIEWS, CLASS_COUNT_VIEW] : VIEWS;
  // `Tabs` is a client component, so its items must be plain data — no icon component functions.
  const tabItems = views.map(({ key, label, href }) => ({ key, label, href }));

  return (
    <>
      <nav aria-label="Attendance views" className={FRAME}>
        {views.map(({ key, label, href, icon: Icon }) => {
          const isActive = key === active;
          return (
            <Link key={key} href={href} aria-current={isActive ? "page" : undefined} className={isActive ? SEGMENT_ACTIVE : SEGMENT_INACTIVE}>
              <Icon className={isActive ? "size-4 shrink-0" : "size-4 shrink-0 text-text-secondary group-hover:text-brand"} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <Tabs as="link" items={tabItems} active={active} ariaLabel="Attendance views" className="mb-4 lg:hidden" />
    </>
  );
}
