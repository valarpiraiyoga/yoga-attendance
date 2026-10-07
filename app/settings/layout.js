import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";
import SettingsChrome from "@/app/settings/settings-chrome";

/**
 * Shared Settings shell: the page chrome, plus (via `settings-chrome.js`) the compact
 * page-header strip and the four approved tabs (`app/settings/settings-tabs.js` —
 * docs/02-ux.md "Settings"; wireframe p.38–40, plus Invoice / Receipt) around the four tab pages. On mobile the
 * top bar names the page ("Settings", `mobileTitle`) and the strip steps aside. Add /
 * Edit Instructor are task screens and draw their own strip with a back button.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see node_modules/next/dist/docs/01-app/02-guides/authentication.md,
 * "Layouts and auth checks"), so it is not the real authorization boundary.
 * Every page under /settings must call `requireRole` again itself.
 */
export default async function SettingsLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Settings">
      <SettingsChrome>{children}</SettingsChrome>
    </AppShell>
  );
}
