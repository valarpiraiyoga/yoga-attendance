import NavList from "@/components/global/NavList";
import UtilityRow from "@/components/global/UtilityRow";
import CenterLogo from "@/components/global/CenterLogo";

export default function Sidebar({ role, user, logoUrl }) {
  return (
    <aside className="sidebar-surface print:hidden hidden h-full lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-border/70 lg:bg-background">
      <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <CenterLogo url={logoUrl} />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-text-primary">Yoga Center</span>
            <span className="text-xs text-text-secondary">Attendance System</span>
          </div>
        </div>
      </div>

      {/* Only the navigation scrolls; the utility row stays pinned to the bottom. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavList role={role} />
      </div>

      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <UtilityRow role={role} name={user?.name} />
      </div>
    </aside>
  );
}
