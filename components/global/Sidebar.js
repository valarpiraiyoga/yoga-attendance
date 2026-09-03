import { LogOut } from "lucide-react";
import NavList from "@/components/global/NavList";

export default function Sidebar({ role }) {
  return (
    <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col md:border-r md:border-border md:bg-background">
      <div className="flex h-16 shrink-0 items-center border-b border-border px-6">
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-text-primary">Yoga Center</span>
          <span className="text-xs text-text-secondary">Attendance System</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between overflow-y-auto px-3 py-4">
        <NavList role={role} />

        <button
          type="button"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface hover:text-text-primary"
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          Logout
        </button>
      </div>
    </aside>
  );
}
