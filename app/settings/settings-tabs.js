"use client";

import { usePathname } from "next/navigation";
import Tabs from "@/components/ui/tabs";

/**
 * The four approved Settings tabs (`02-ux.md` "Settings" IA; wireframe
 * p.38–40, plus Invoice / Receipt from the V1 Invoice / Receipt Enhancement).
 * All four have a real screen (Phase 19 completes Center Profile and Roles &
 * Permissions; Instructors was already built).
 *
 * The canonical underline `Tabs` (06-ui-implementation-rules.md §15),
 * route-based (`as="link"`), with the tab content rendered as `children`
 * directly beneath it. There is no wrapping container: each tab page owns its
 * own content panel(s), so the hierarchy is header → tabs → content panel.
 *
 * A Client Component, unlike `ReportTabs`: Reports passes `active` down
 * from each page because its tabs render inside the PAGE, but Settings'
 * tabs render inside the shared LAYOUT (`app/settings/layout.js`), which
 * wraps every sibling route and has no page-level prop to tell it which
 * child is current. `usePathname()` is the only way a layout's own nav can
 * know that.
 */
const TABS = [
  { key: "center-profile", label: "Center Profile", href: "/settings/center-profile" },
  { key: "invoice-receipt", label: "Invoice / Receipt", href: "/settings/invoice-receipt" },
  { key: "instructors", label: "Instructors", href: "/settings/instructors" },
  { key: "roles-permissions", label: "Roles & Permissions", href: "/settings/roles-permissions" },
];

export default function SettingsTabs({ children }) {
  const pathname = usePathname();
  const active = TABS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.key;

  return (
    <>
      <Tabs as="link" items={TABS} active={active} ariaLabel="Settings sections" className="mb-5" />
      {children}
    </>
  );
}
