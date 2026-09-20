import { LogOut } from "lucide-react";
import NavList from "@/components/global/NavList";
import { signOut } from "@/lib/auth/actions";

export default function Sidebar({ role }) {
  return (
    <aside className="sidebar-surface print:hidden hidden h-full lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-border/70 lg:bg-background">
      <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-6">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold text-text-primary">Yoga Center</span>
          <span className="text-xs text-text-secondary">Attendance System</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavList role={role} />
      </div>

      <form action={signOut} className="shrink-0 border-t border-border/60 px-3 py-3">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          Logout
        </button>
      </form>
    </aside>
  );
}
