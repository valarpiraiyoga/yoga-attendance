import Link from "next/link";
import { cn } from "@/lib/utils";

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

export default function ReportTabs({ active }) {
  return (
    <nav aria-label="Reports" className="flex flex-wrap items-center gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const base =
          "text-body -mb-px border-b-2 px-3 py-2 font-medium transition-colors";

        if (!tab.href) {
          return (
            <span
              key={tab.key}
              aria-disabled="true"
              title="Not available yet"
              className={cn(base, "cursor-not-allowed border-transparent text-text-secondary/50")}
            >
              {tab.label}
            </span>
          );
        }

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              base,
              isActive
                ? "border-brand text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
