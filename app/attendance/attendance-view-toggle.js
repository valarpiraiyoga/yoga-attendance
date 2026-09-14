import Link from "next/link";
import { CalendarDays, List } from "lucide-react";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

/**
 * Today's Sessions / All Sessions toggle — same segmented control treatment
 * as Schedule's Weekly / List View toggle.
 */
export default function AttendanceViewToggle({ active }) {
  return (
    <div
      role="tablist"
      aria-label="Attendance views"
      className="mb-6 inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
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
                ? "inline-flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-body font-semibold text-text-primary shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body text-text-secondary hover:text-text-primary"
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
