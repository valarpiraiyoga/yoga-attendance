import Header from "@/components/global/Header";
import Sidebar from "@/components/global/Sidebar";

/**
 * Reusable application-level layout.
 *
 * Structure (validated against docs/ui-reference/dashboard.png and
 * students-list.png): the Sidebar is the full-height left column and the
 * Header belongs to the main column, so the Header does not span across the
 * Sidebar. Feature pages render inside as children — no feature-specific
 * content belongs in this shell.
 *
 * `role` and `user` come from the authenticated session and are required —
 * there is no default role.
 */
export default function AppShell({ role, user, children }) {
  return (
    <div className="flex flex-1 bg-background">
      <Sidebar role={role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header role={role} user={user} />
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
