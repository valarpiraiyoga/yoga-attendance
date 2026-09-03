import Header from "@/components/global/Header";
import Sidebar from "@/components/global/Sidebar";

/**
 * Reusable application-level layout: Header + Sidebar (desktop) / MobileMenu
 * (mobile) + a main content area. Feature pages render inside as children —
 * no feature-specific content belongs in this shell.
 */
export default function AppShell({ role = "admin", children }) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <Header role={role} />
      <div className="flex flex-1">
        <Sidebar role={role} />
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
