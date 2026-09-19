import Tabs from "@/components/ui/tabs";

const TABS = [
  { key: "weekly", label: "Weekly Schedule", href: "/schedule?view=weekly" },
  { key: "list", label: "List View", href: "/schedule?view=list" },
];

/**
 * The Weekly Schedule / List View section tabs (`12 schedule list card
 * view.png`; 06-ui-implementation-rules.md §15): the canonical underline
 * `Tabs`, route-based (`as="link"`) because switching views is a URL change.
 * Sits beneath the page heading on both views.
 */
export default function ScheduleTabs({ active }) {
  return <Tabs as="link" items={TABS} active={active} ariaLabel="Schedule views" className="mb-6" />;
}
