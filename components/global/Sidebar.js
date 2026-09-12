import { LogOut } from "lucide-react";
import NavList from "@/components/global/NavList";
import { signOut } from "@/lib/auth/actions";

export default function Sidebar({ role }) {
  return (
    <aside className="sidebar-surface hidden md:flex md:w-64 md:shrink-0 md:flex-col md:border-r md:border-border/70 md:bg-background">
      <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-6">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold text-text-primary">Yoga Center</span>
          <span className="text-xs text-text-secondary">Attendance System</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        <NavList role={role} />

        <form action={signOut} className="border-t border-border/60 pt-3">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
          >
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            Logout
          </button>
        </form>
      </div>
    </aside>
  );
}
