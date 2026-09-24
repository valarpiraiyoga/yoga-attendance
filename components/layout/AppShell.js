import Header from "@/components/global/Header";
import Sidebar from "@/components/global/Sidebar";
import { getCenterSettings } from "@/lib/center-profile/settings";

/**
 * Reusable application-level layout.
 *
 * Structure (validated against docs/ui-reference/dashboard.png and
 * students-list.png): the Sidebar is the full-height left column from lg
 * (1024px) up. Below lg, the sidebar is hidden and Header's MobileMenu
 * (same NavList) provides navigation so tablet keeps a usable content
 * column. The Sidebar's bottom row (profile, notifications, help, logout) is
 * the same `UtilityRow` the mobile sheet shows, so the top Header bar only
 * exists below lg. Each page renders its own compact `PageHeader` at the top
 * of its content. Feature pages render inside as children — no
 * feature-specific content belongs in this shell.
 *
 * `role` and `user` come from the authenticated session and are required —
 * there is no default role.
 *
 * Printing: the sidebar and header are hidden and the fixed-height, scrolling
 * shell becomes ordinary flowing content, so a page (e.g. a membership
 * receipt) prints in full over as many sheets as it needs instead of just the
 * visible viewport.
 *
 * `mobileTitle` (optional) names the section in the mobile top bar in place of
 * the app name — see `Header`.
 *
 * The centre's logo (Center Settings) appears in the shell's one brand slot -
 * the Sidebar and the mobile menu's header - when one has been uploaded; the
 * layout is otherwise unchanged. A logo that cannot be read never fails the
 * page: the shell just renders without it.
 */
export default async function AppShell({ role, user, mobileTitle, children }) {
  const logoUrl = await getCenterSettings()
    .then((settings) => settings.logoUrl)
    .catch(() => null);

  return (
    <div className="flex h-dvh overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar role={role} user={user} logoUrl={logoUrl} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header role={role} user={user} mobileTitle={mobileTitle} logoUrl={logoUrl} />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
