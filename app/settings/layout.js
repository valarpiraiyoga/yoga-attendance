import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";

/**
 * The three approved Settings tabs (docs/02-ux.md "Settings"; wireframe p39).
 * Only Instructors is implemented; the other two are visible but inert —
 * no href, so there is nothing to navigate to.
 */
const TABS = [
  { label: "Center Profile", href: null },
  { label: "Instructors", href: "/settings/instructors" },
  { label: "Roles & Permissions", href: null },
];

/**
 * Shared Settings shell: page heading, the three approved tabs, and the
 * shared page chrome. Individual tab pages render as `children` inside the
 * same Container the wireframe (p39) places them in.
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
        />

        <nav aria-label="Settings sections" className="mb-6 border-b border-border">
          <ul className="flex gap-6">
            {TABS.map(({ label, href }) => (
              <li key={label}>
                {href ? (
                  <Link
                    href={href}
                    aria-current="page"
                    className="inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                  >
                    {label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="inline-flex cursor-not-allowed border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary/70"
                  >
                    {label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>

        {children}
      </Container>
    </AppShell>
  );
}
