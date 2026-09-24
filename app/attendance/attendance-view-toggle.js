import { CalendarDays, List } from "lucide-react";
import Tabs from "@/components/ui/tabs";
import ViewSwitcher from "@/components/ui/view-switcher";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

// `Tabs` is a client component, so its items must be plain data — no icon
// component functions (only the server-rendered `ViewSwitcher` takes icons).
const TAB_ITEMS = VIEWS.map(({ key, label, href }) => ({ key, label, href }));

/**
 * Today's Sessions / All Sessions navigation — two routes of one screen, as
 * the finalized references draw it: the brand-filled segmented `ViewSwitcher`
 * from `lg` up (the recorded exception to "named sections are tabs",
 * 06-ui-implementation-rules.md §16.4), and the standard underline `Tabs`
 * below it. Both are plain server-rendered links, so switching is a URL
 * change; only one is displayed at a time.
 */
export default function AttendanceViewToggle({ active }) {
  return (
    <>
      <ViewSwitcher items={VIEWS} active={active} ariaLabel="Attendance views" className="mb-4 max-lg:hidden" />
      <Tabs as="link" items={TAB_ITEMS} active={active} ariaLabel="Attendance views" className="mb-4 lg:hidden" />
    </>
  );
}
