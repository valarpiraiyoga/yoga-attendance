import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Schedule shell: auth boundary + shared page chrome. No `Container`
 * here: the list page's full-bleed header strip must be a direct child of the
 * shell's `<main>`, so the list page wraps its own body in `Container` and the
 * `new` and `[id]` routes get theirs from their own layouts. Mirrors
 * app/batches/layout.js, app/students/layout.js and app/memberships/layout.js
 * exactly.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation). Every page
 * under /schedule must call `requireRole` again itself.
 */
export default async function ScheduleLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Schedule">
      {children}
    </AppShell>
  );
}
