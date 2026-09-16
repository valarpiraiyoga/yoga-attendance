import { Settings } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import SettingsTabs from "@/app/settings/settings-tabs";

/**
 * Shared Settings shell: page heading, the three approved tabs
 * (`app/settings/settings-tabs.js` — docs/02-ux.md "Settings"; wireframe
 * p.38–40), and the shared page chrome. Individual tab pages render as
 * `children` inside the same Container the wireframe places them in.
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
    <AppShell role={user.role} user={user}>
      <Container>
        <PageHeader
          title="Settings"
          description="Manage center information, instructors, and access permissions."
          icon={<Settings className="size-6" />}
        />

        <SettingsTabs>{children}</SettingsTabs>
      </Container>
    </AppShell>
  );
}
