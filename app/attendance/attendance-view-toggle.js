import { CalendarDays, List, ListChecks } from "lucide-react";
import Tabs from "@/components/ui/tabs";
import ViewSwitcher from "@/components/ui/view-switcher";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

// The third tab (01-product.md §8 "Class Count Attendance"): Admin only, and a route of its own, so the two session
// views above are exactly what they were. An instructor is never shown it.
const CLASS_COUNT_VIEW = { key: "class-count", label: "Class Count Attendance", href: "/attendance/class-count", icon: ListChecks };

/**
 * Today's Sessions / All Sessions navigation — two routes of one screen, as
 * the finalized references draw it: the brand-filled segmented `ViewSwitcher`
 * from `lg` up (the recorded exception to "named sections are tabs",
 * 06-ui-implementation-rules.md §16.4), and the standard underline `Tabs`
 * below it. Both are plain server-rendered links, so switching is a URL
 * change; only one is displayed at a time. For an Admin (`showClassCount`) a third
 * tab, Class Count Attendance, follows the two session views.
 */
export default function AttendanceViewToggle({ active, showClassCount = false }) {
  const views = showClassCount ? [...VIEWS, CLASS_COUNT_VIEW] : VIEWS;
  // `Tabs` is a client component, so its items must be plain data — no icon
  // component functions (only the server-rendered `ViewSwitcher` takes icons).
  const tabItems = views.map(({ key, label, href }) => ({ key, label, href }));

  return (
    <>
      <ViewSwitcher items={views} active={active} ariaLabel="Attendance views" className="mb-4 max-lg:hidden" />
      <Tabs as="link" items={tabItems} active={active} ariaLabel="Attendance views" className="mb-4 lg:hidden" />
    </>
  );
}
