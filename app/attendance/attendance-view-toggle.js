import { CalendarDays, List } from "lucide-react";
import ViewSwitcher from "@/components/ui/view-switcher";

const VIEWS = [
  { key: "today", label: "Today's Sessions", href: "/attendance", icon: CalendarDays },
  { key: "all", label: "All Sessions", href: "/attendance?view=all", icon: List },
];

/**
 * Today's Sessions / All Sessions switch — the finalized brand-filled
 * `ViewSwitcher`, the recorded exception to "named sections are tabs"
 * (06-ui-implementation-rules.md §16.4: references `14` and `15` draw it as a
 * segmented control). A plain server-rendered link pair: switching is a URL
 * change.
 */
export default function AttendanceViewToggle({ active }) {
  return <ViewSwitcher items={VIEWS} active={active} ariaLabel="Attendance views" className="mb-6" />;
}
