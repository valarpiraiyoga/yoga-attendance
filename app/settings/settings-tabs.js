"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The three approved Settings tabs (`02-ux.md` "Settings" IA; wireframe
 * p.38–40). All three now have a real screen (Phase 19 completes Center
 * Profile and Roles & Permissions; Instructors was already built).
 *
 * Same folder-tab card visual as `app/reports/report-tabs.js` (the
 * `folder-tabs-track`/`folder-tab-active` global classes, the bordered
 * `rounded-2xl` card, tab content rendered as `children` inside the card
 * body) — the two tab bars share the same visual language, unified across
 * both features.
 *
 * A Client Component, unlike `ReportTabs`: Reports passes `active` down
 * from each page because its tabs render inside the PAGE, but Settings'
 * tabs render inside the shared LAYOUT (`app/settings/layout.js`), which
 * wraps every sibling route and has no page-level prop to tell it which
 * child is current. `usePathname()` is the only way a layout's own nav can
 * know that.
 */
const TABS = [
  { label: "Center Profile", href: "/settings/center-profile" },
  { label: "Instructors", href: "/settings/instructors" },
  { label: "Roles & Permissions", href: "/settings/roles-permissions" },
];

export default function SettingsTabs({ children }) {
  const pathname = usePathname();

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-xs">
      <nav aria-label="Settings sections" className="folder-tabs-track px-3 pt-1.5">
        <ul className="flex flex-wrap items-end gap-0.5">
          {TABS.map(({ label, href }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "folder-tab-active inline-flex px-4 pt-2.5 pb-2.5 text-body font-semibold text-text-primary sm:px-5"
                      : "inline-flex px-4 pt-2.5 pb-2.5 text-body text-text-secondary transition-colors hover:text-text-primary sm:px-5"
                  }
                >
                  <span className="relative inline-flex flex-col items-center gap-1.5">
                    {label}
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
