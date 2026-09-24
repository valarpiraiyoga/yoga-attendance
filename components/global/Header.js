import MobileMenu from "@/components/global/MobileMenu";
import { MOBILE_HEADER_ACTIONS_ID } from "@/components/layout/MobileHeaderAction";

/**
 * The top bar exists only below `lg`, where the Sidebar is hidden: it carries
 * the navigation button (MobileMenu, whose sheet also holds the account /
 * notifications / help / logout row) and, beside it, the page title
 * (`mobileTitle`, passed down from a section layout through `AppShell`) — or
 * the app name when a section gives none — with a right-hand slot a page can
 * fill with an icon action (`MobileHeaderAction`). From `lg` up those all
 * live in the Sidebar, so the bar is removed and the page starts at the top of
 * the workspace.
 */
export default function Header({ role, user, mobileTitle }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 md:px-6 lg:hidden print:hidden">
      <MobileMenu role={role} user={user} />
      {mobileTitle ? (
        <span className="min-w-0 truncate text-body font-semibold text-text-primary">{mobileTitle}</span>
      ) : (
        <span className="text-body font-semibold whitespace-nowrap text-text-primary">Yoga Center</span>
      )}
      <div id={MOBILE_HEADER_ACTIONS_ID} className="ml-auto flex min-w-0 items-center gap-2" />
    </header>
  );
}
