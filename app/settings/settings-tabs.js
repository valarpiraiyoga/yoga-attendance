"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The three approved Settings tabs (`02-ux.md` "Settings" IA; wireframe
 * p.38–40). All three now have a real screen (Phase 19 completes Center
 * Profile and Roles & Permissions; Instructors was already built).
 *
 * A Client Component, unlike `app/reports/report-tabs.js`'s equivalent:
 * Reports passes `active` down from each page because its tabs render
 * inside the PAGE, but Settings' tabs render inside the shared LAYOUT
 * (`app/settings/layout.js`), which wraps every sibling route and has no
 * page-level prop to tell it which child is current. `usePathname()` is
 * the only way a layout's own nav can know that.
 *
 * This replaces the previous version's tab-highlighting, which was
 * unconditional ("every tab with an href renders as active") — harmless
 * while only one tab had one, but it would have marked all three active at
 * once the moment a second and third tab gained a real destination, which
 * is exactly what this phase does.
 */
const TABS = [
  { label: "Center Profile", href: "/settings/center-profile" },
  { label: "Instructors", href: "/settings/instructors" },
  { label: "Roles & Permissions", href: "/settings/roles-permissions" },
];

export default function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="mb-6 border-b border-border">
      <ul className="flex gap-6">
        {TABS.map(({ label, href }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex border-b-2 px-0.5 pb-3 text-body font-semibold transition-colors",
                  isActive
                    ? "border-brand text-text-primary"
                    : "border-transparent text-text-secondary hover:text-text-primary"
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
