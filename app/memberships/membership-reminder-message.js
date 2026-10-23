"use client";

import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPeriod } from "@/lib/memberships/period";
import { PLAN } from "@/lib/status";
import ReminderMessageDialog from "@/app/memberships/reminder-message-dialog";

/** Whether a membership has a reminder to write about - one entry of `remindersByMembership`. */
export function hasReminder(reminders) {
  return Boolean(reminders?.expiry || reminders?.payment);
}

/**
 * The reminder message's own button on a membership row or card, beside the More (⋮) menu: a red bell, shown only while the membership has a
 * reminder. It opens the same popup as the menu's Reminder Message.
 */
export function ReminderMessageButton({ reminders, studentName, onClick }) {
  if (!hasReminder(reminders)) return null;
  const label = `Reminder message${studentName ? ` for ${studentName}` : ""}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger"
      aria-label={label}
      title="Reminder message"
      onClick={onClick}
    >
      <BellRing className="size-4" aria-hidden="true" />
    </Button>
  );
}

/**
 * The reminder message popup (`ReminderMessageDialog`) for one Memberships list row or card: it only turns the row into the props the popup
 * takes, the way `MembershipIssueInvoiceDialog` does for Issue Receipt. Rendered only while the membership has a reminder.
 */
export default function MembershipReminderMessage({ membership, reminders, centreName, initialType, open, onOpenChange }) {
  if (!hasReminder(reminders)) return null;

  return (
    <ReminderMessageDialog
      open={open}
      onOpenChange={onOpenChange}
      reminders={reminders}
      student={membership.students}
      membership={{
        code: membership.membership_code,
        planLabel: membership.package_name ?? PLAN[membership.plan] ?? membership.plan,
        period: formatPeriod(membership.start_date, membership.end_date),
      }}
      centreName={centreName}
      initialType={initialType}
    />
  );
}
