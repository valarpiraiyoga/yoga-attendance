import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Documents shell: auth boundary + shared page chrome. Mirrors app/memberships/layout.js exactly.
 *
 * This layout's own `requireRole` only builds the shell for the initial request - it does not re-run on client-side navigation
 * between sibling pages (see app/settings/layout.js for the full explanation). Every page under /documents must call
 * `requireRole` again itself.
 */
export default async function DocumentsLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Documents">
      {children}
    </AppShell>
  );
}
