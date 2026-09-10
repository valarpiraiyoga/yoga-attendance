import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Attendance shell: auth boundary + shared page chrome. Mirrors
 * app/schedule/layout.js exactly. Admin-only in this slice (01-product.md
 * §7A: instructor read access to class sessions is a Phase 15 concern) —
 * even though the primary nav shows "Attendance" to both roles
 * (app/data/navigation.js), an instructor hitting this route is redirected
 * by `requireRole` just like every other admin-only feature area.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation). Every page
 * under /attendance must call `requireRole` again itself.
 */
export default async function AttendanceLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user}>
      <Container>{children}</Container>
    </AppShell>
  );
}
