import Tabs from "@/components/ui/tabs";

/**
 * The three approved Reports tabs (`02-ux.md`'s Reports IA; wireframe
 * p.35–37): Student Attendance (default), Batch Attendance, Attendance
 * Summary.
 *
 * The canonical underline `Tabs` (06-ui-implementation-rules.md §15),
 * route-based (`as="link"`): each tab is its own route, and the active tab is
 * passed in rather than read from `usePathname`. The tab panel content is the
 * caller's own — the report form and results render as their own panels below
 * the tab row, not inside a tab-shaped card.
 */
const TABS = [
  { key: "student", label: "Student Attendance", href: "/reports" },
  { key: "batch", label: "Batch Attendance", href: "/reports/batch" },
  { key: "summary", label: "Attendance Summary", href: "/reports/summary" },
];

export default function ReportTabs({ active, children }) {
  return (
    <>
      <Tabs as="link" items={TABS} active={active} ariaLabel="Reports" className="mb-6" />
      {children}
    </>
  );
}
