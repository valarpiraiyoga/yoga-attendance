import Link from "next/link";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance" },
  { key: "all", label: "All Sessions", href: "/attendance?view=all" },
];

/**
 * The Today's Sessions / All Sessions toggle (docs/02-ux.md's approved IA,
 * approved wireframe). Mirrors app/schedule/schedule-view-toggle.js exactly
 * — a plain server-rendered link pair, not client state, so switching views
 * is a full URL change like every other real tab-nav in this project.
 */
export default function AttendanceViewToggle({ active }) {
  return (
    <div
      role="tablist"
      aria-label="Attendance views"
      className="mb-6 inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {VIEWS.map((view) => (
        <Link
          key={view.key}
          href={view.href}
          role="tab"
          aria-selected={active === view.key}
          className={
            active === view.key
              ? "rounded-md bg-surface px-3 py-1.5 text-body font-semibold text-text-primary shadow-xs"
              : "rounded-md px-3 py-1.5 text-body text-text-secondary hover:text-text-primary"
          }
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
