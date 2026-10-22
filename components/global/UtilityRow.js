import Link from "next/link";
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
 * buttons, Logout submits the existing `signOut` action.
 *
 * Notifications (01-product.md §5 "Reminders"; 02-ux.md "Notification bell"): for an Admin the bell opens the Dashboard's Reminders panel and
 * shows the number of current reminders (each reminder counted, so a membership with both an expiry and a payment reminder counts 2; no count
 * when there are none or the number could not be read). An Instructor's bell is unchanged and shows nothing - reminders are Admin-only.
 */
export default function UtilityRow({ role, name, reminderCount = null }) {
  const isAdmin = role === "admin";
  const count = isAdmin && Number.isInteger(reminderCount) && reminderCount > 0 ? reminderCount : 0;
  const bellLabel = count > 0 ? `Notifications: ${count} ${count === 1 ? "reminder" : "reminders"}` : "Notifications";

  return (
    <div role="group" aria-label="Account and utilities" className="grid grid-cols-4 gap-1">
      <UserMenu role={role} name={name} />
      {isAdmin ? (
        <Button
          variant="ghost"
          size="icon-lg"
          className={`relative ${UTILITY_BUTTON_CLASS}`}
          aria-label={bellLabel}
          title={bellLabel}
          render={<Link href="/#reminders" />}
          nativeButton={false}
        >
          <Bell className="size-4" aria-hidden="true" />
          {count > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] leading-4 font-semibold text-surface tabular-nums"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      ) : (
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
      )}
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
