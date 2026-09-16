import Link from "next/link";
import { CalendarDays, List } from "lucide-react";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

/**
 * Today's Sessions / All Sessions toggle. The active tab is filled with the
 * brand color — the same "this is the current selection" treatment
 * `components/global/NavList.js` already uses for the active sidebar item —
 * so the current view reads clearly at a glance rather than blending into
 * the track.
 */
export default function AttendanceViewToggle({ active }) {
  return (
    <div
      role="tablist"
      aria-label="Attendance views"
      className="inline-flex shrink-0 gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const isActive = active === view.key;

        return (
          <Link
            key={view.key}
            href={view.href}
            role="tab"
            aria-selected={isActive}
            className={
              isActive
                ? "inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-body font-semibold text-surface shadow-sm"
                : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
            }
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}
