import Header from "@/components/global/Header";
import Sidebar from "@/components/global/Sidebar";

/**
 * Reusable application-level layout.
 *
 * Structure (validated against docs/ui-reference/dashboard.png and
 * students-list.png): the Sidebar is the full-height left column from lg
 * (1024px) up. Below lg, the sidebar is hidden and Header's MobileMenu
 * (same NavList) provides navigation so tablet keeps a usable content
 * column. The Header belongs to the main column, so it does not span
 * across the Sidebar. Feature pages render inside as children — no
 * feature-specific content belongs in this shell.
 *
 * `role` and `user` come from the authenticated session and are required —
 * there is no default role.
 *
 * Printing: the sidebar and header are hidden and the fixed-height, scrolling
 * shell becomes ordinary flowing content, so a page (e.g. a membership
 * receipt) prints in full over as many sheets as it needs instead of just the
 * visible viewport.
 */
export default function AppShell({ role, user, children }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar role={role} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header role={role} user={user} />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
