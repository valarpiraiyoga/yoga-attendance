"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavItemsForRole } from "@/app/data/navigation";
import { cn } from "@/lib/utils";

/**
 * Shared nav renderer for Sidebar (desktop, lg+) and MobileMenu (below lg)
 * — a single navigation definition, rendered twice, per the shell
 * requirements.
 */
export default function NavList({ role, onNavigate, className }) {
  const pathname = usePathname();
  const items = getNavItemsForRole(role);

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-1", className)}>
      {items.map(({ label, href, icon: Icon }) => {
        // Segment-aware match: `pathname === href` covers the exact route
        // (including "/"), and `startsWith(`${href}/`)` only matches a real
        // nested route (e.g. "/students/123" under "/students"). A bare
        // `pathname.startsWith(href)` would also match "/attendance-history"
        // against the "/attendance" item, since it is a literal string
        // prefix of it — not a path segment of it.
        const isActive = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
              isActive
                ? "bg-brand text-surface shadow-sm"
                : "text-text-secondary hover:bg-surface hover:text-text-primary hover:shadow-xs"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
