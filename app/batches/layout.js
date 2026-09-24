import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Batches shell: auth boundary + shared page chrome. Unlike Settings,
 * Batches has no section-level tabs of its own — the Overview/Students/
 * Schedules tabs on wireframe p17-19 belong to one batch's Details page
 * (app/batches/[id]/page.js), not to this top-level area, so they live
 * there instead of here.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation, and the
 * installed Next.js docs it cites). Every page under /batches must call
 * `requireRole` again itself.
 */
export default async function BatchesLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Batches">
      {children}
    </AppShell>
  );
}
