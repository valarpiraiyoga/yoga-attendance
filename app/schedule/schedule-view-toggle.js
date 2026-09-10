import Link from "next/link";

const VIEWS = [
  { key: "weekly", label: "Weekly Schedule", href: "/schedule?view=weekly" },
  { key: "list", label: "List View", href: "/schedule" },
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
 */
export default function ScheduleViewToggle({ active }) {
  return (
    <div role="tablist" aria-label="Schedule views" className="mb-6 inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1">
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
