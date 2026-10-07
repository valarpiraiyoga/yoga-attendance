"use client";

import { usePathname } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import SettingsTabs from "@/app/settings/settings-tabs";

// The four approved Settings tab pages (docs/02-ux.md "Settings"). Anything deeper - Add / Edit
// Instructor - is a task screen with its own back-button strip, not a fifth tab.
const TAB_PAGES = [
  "/settings/center-profile",
  "/settings/invoice-receipt",
  "/settings/instructors",
  "/settings/roles-permissions",
];

/**
 * The Settings chrome, only where it belongs: the compact "Settings" strip and the four tabs
 * around the four tab pages. A deeper page (Add / Edit Instructor) gets the children as they
 * are and draws its own strip with a back button, like every other task screen.
 *
 * A Client Component because a layout has no other way to know which child route is current
 * (`usePathname`, the same reason `SettingsTabs` is one). The strip is still a direct child of
 * the shell's `<main>` in the DOM (it bleeds through the shell padding), so only the tabs and
 * the tab pages sit in the `Container`.
 */
export default function SettingsChrome({ children }) {
  const pathname = usePathname();

  if (!TAB_PAGES.includes(pathname)) return children;

  return (
    <>
      <PageHeader
        compact
        collapseOnMobile
        title="Settings"
        description="Manage your center, invoices, instructors, and access permissions."
      />

      <Container>
        <SettingsTabs>{children}</SettingsTabs>
      </Container>
    </>
  );
}
