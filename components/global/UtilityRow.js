import { Bell, HelpCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import UserMenu from "@/components/global/UserMenu";
import { signOut } from "@/lib/auth/actions";

// Quiet icon buttons: same hover treatment as the nav items above them.
const UTILITY_BUTTON_CLASS = "w-full text-text-secondary hover:bg-surface hover:text-text-primary";

/**
 * The compact utility row at the bottom of the Sidebar and of the mobile
 * navigation sheet: Profile · Notifications · Help · Logout, four equal icon
 * targets in one line instead of stacked text rows.
 *
 * Behaviour is exactly what the header carried before: the profile control is
 * the existing `UserMenu` (account menu), Notifications and Help are the same
 * buttons, Logout submits the existing `signOut` action. Nothing new is added.
 */
export default function UtilityRow({ role, name }) {
  return (
    <div role="group" aria-label="Account and utilities" className="grid grid-cols-4 gap-1">
      <UserMenu role={role} name={name} />
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className={UTILITY_BUTTON_CLASS}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className={UTILITY_BUTTON_CLASS}
        aria-label="Help"
        title="Help"
      >
        <HelpCircle className="size-4" aria-hidden="true" />
      </Button>
      <form action={signOut}>
        <Button
          type="submit"
          variant="ghost"
          size="icon-lg"
          className={UTILITY_BUTTON_CLASS}
          aria-label="Logout"
          title="Logout"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
