import AppShell from "@/components/layout/AppShell";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * Shared Reports shell: auth boundary + shared page chrome.
 *
 * Reports are Admin-only (`01-product.md` §10 and §11 "Roles & Permissions":
 * "Instructor does not manage global Students, Memberships, Batches,
 * Schedules, Reports, or Settings"), which is why this is `ROLES.ADMIN`
 * alone — unlike app/attendance-history/layout.js, which admits both roles.
 * `app/data/navigation.js` already scopes the Reports nav entry to
 * `roles: ["admin"]`, so this layout is the enforcement behind that.
 *
 * This layout's own `requireRole` only builds the shell for the initial
 * request — it does not re-run on client-side navigation between sibling
 * pages (see app/settings/layout.js for the full explanation). Every page
 * under /reports must call `requireRole` again itself.
 */
export default async function ReportsLayout({ children }) {
  const user = await requireRole(ROLES.ADMIN);

  return (
    <AppShell role={user.role} user={user} mobileTitle="Reports">
      {children}
    </AppShell>
  );
}
