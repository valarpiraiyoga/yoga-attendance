import Link from "next/link";

/**
 * The three approved Reports tabs (`02-ux.md`'s Reports IA; wireframe
 * p.35–37): Student Attendance (default), Batch Attendance, Attendance
 * Summary.
 *
 * A plain server component — the active tab is passed in rather than read
 * from `usePathname`, so this ships no client JavaScript.
 *
 * All three are built: Student Attendance (Slice 2), Batch Attendance
 * (Slice 3), Attendance Summary (Slice 4) — completing the approved Reports
 * IA. The inert-tab fallback below (an unclickable `<span>` for any `href`
 * of `null`) remains in place as the pattern for a future Reports tab that
 * ships its screen after its entry appears — the same judgement
 * `app/data/navigation.js` already applies to "Assigned Classes" — but
 * nothing currently uses it.
 */
const TABS = [
  { key: "student", label: "Student Attendance", href: "/reports" },
  { key: "batch", label: "Batch Attendance", href: "/reports/batch" },
  { key: "summary", label: "Attendance Summary", href: "/reports/summary" },
];

export default function ReportTabs({ active, children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-xs">
      <nav aria-label="Reports" className="folder-tabs-track px-3 pt-1.5">
        <ul className="flex flex-wrap items-end gap-0.5">
          {TABS.map((tab) => {
            const isActive = tab.key === active;

            if (!tab.href) {
              return (
                <li key={tab.key}>
                  <span
                    aria-disabled="true"
                    title="Not available yet"
                    className="inline-flex cursor-not-allowed px-4 pt-2.5 pb-2.5 text-body text-text-secondary/50 sm:px-5"
                  >
                    <span className="relative inline-flex flex-col items-center gap-1.5">
                      {tab.label}
                      <span aria-hidden="true" className="h-0.5 w-full" />
                    </span>
                  </span>
                </li>
              );
            }

            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "folder-tab-active inline-flex px-4 pt-2.5 pb-2.5 text-body font-semibold text-text-primary sm:px-5"
                      : "inline-flex px-4 pt-2.5 pb-2.5 text-body text-text-secondary transition-colors hover:text-text-primary sm:px-5"
                  }
                >
                  <span className="relative inline-flex flex-col items-center gap-1.5">
                    {tab.label}
                    {isActive ? (
                      <span aria-hidden="true" className="h-0.5 w-full rounded-full bg-text-primary" />
                    ) : (
                      <span aria-hidden="true" className="h-0.5 w-full" />
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="bg-surface px-4 pt-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </div>
  );
}
