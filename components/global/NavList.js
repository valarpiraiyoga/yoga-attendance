"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavItemsForRole } from "@/app/data/navigation";
import { cn } from "@/lib/utils";

/**
 * Shared nav renderer for Sidebar (desktop, lg+) and MobileMenu (below lg)
 * — a single navigation definition, rendered twice, per the shell
 * requirements.
 *
 * The menu is a two-column grid of cards: a neutral icon tile (one quiet style
 * for every destination - no per-item colours) with the label beneath it. The
 * current page is the solid brand card. An odd last item (Settings for an admin)
 * spans both columns as a single row - icon and label - so the grid ends flush.
 */
export default function NavList({ role, onNavigate, className }) {
  const pathname = usePathname();
  const items = getNavItemsForRole(role);
  const lastIsAlone = items.length % 2 === 1;

  return (
    <nav aria-label="Primary" className={cn("grid grid-cols-2 gap-2.5", className)}>
      {items.map(({ label, href, icon: Icon }, index) => {
        // Segment-aware match: `pathname === href` covers the exact route
        // (including "/"), and `startsWith(`${href}/`)` only matches a real
        // nested route (e.g. "/students/123" under "/students"). A bare
        // `pathname.startsWith(href)` would also match "/attendance-history"
        // against the "/attendance" item, since it is a literal string
        // prefix of it — not a path segment of it.
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        const wide = lastIsAlone && index === items.length - 1;

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex rounded-xl border p-2.5 transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              wide ? "col-span-2 items-center gap-3" : "min-h-24 flex-col justify-between gap-2",
              isActive
                ? "border-brand bg-brand text-surface shadow-sm"
                : "border-border/60 bg-surface text-text-primary shadow-xs hover:border-border hover:shadow-sm"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                isActive ? "bg-surface/20 text-surface" : "bg-background text-text-secondary"
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>

            <span className="text-sm leading-snug font-semibold">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
