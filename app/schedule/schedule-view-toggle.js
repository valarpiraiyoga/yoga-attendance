import Link from "next/link";
import { CalendarDays, List } from "lucide-react";

const VIEWS = [
  { key: "weekly", label: "Weekly Schedule", href: "/schedule?view=weekly", icon: CalendarDays },
  { key: "list", label: "List View", href: "/schedule?view=list", icon: List },
];

/**
 * The Weekly Schedule / List View toggle (approved wireframe: two labels
 * drawn side by side beneath the page heading — see
 * lib/schedules/data.js's comment on why an extracted text rendering of
 * the wireframe can misread those two labels as one). A plain server-
 * rendered link pair, not client state: switching views is a full URL
 * change, matching every other real tab-nav in this project
 * (app/batches/[id]/batch-header.js, app/settings/layout.js) rather than
 * Schedule Details' client-toggled tabs, which have no disabled tab and no
 * URL-addressable reason to navigate.
 *
 * Visual treatment matches the Cards/Table segmented control on finalized
 * list pages (Students / Memberships / Batches).
 */
export default function ScheduleViewToggle({ active }) {
  return (
    <div
      role="tablist"
      aria-label="Schedule views"
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
