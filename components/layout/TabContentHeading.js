/**
 * Small icon-tile heading for a tab's own content (Reports' Student/Batch
 * Attendance and Attendance Summary tabs; Settings' Center Profile,
 * Instructors, and Roles & Permissions tabs) — same icon-tile + title +
 * description composition as `PageHeader`, scaled down since this sits
 * inside a tab body rather than at the top of the page (the page's own
 * `PageHeader` already carries the page-level heading).
 */
export default function TabContentHeading({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-body font-semibold text-text-primary">{title}</h2>
        <p className="text-small mt-1 text-text-secondary">{description}</p>
      </div>
    </div>
  );
}
