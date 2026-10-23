import Link from "next/link";
import { AlarmClock, BellRing, Wallet } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { PLAN } from "@/lib/status";
import { REMINDER_TYPES } from "@/lib/reminders/rules";
import { reminderText, remindersByMembership } from "@/lib/reminders/presentation";
import DashboardReminderActions from "@/app/dashboard-reminder-actions";

/** The anchor the notification bell opens (02-ux.md "Notification bell"). */
export const REMINDERS_ANCHOR = "reminders";

function membershipLabel(membership) {
  const plan = membership.packageName ?? PLAN[membership.plan] ?? membership.plan;
  return [membership.code, plan].filter(Boolean).join(" · ");
}

function ReminderRow({ reminder, membershipReminders, centreName }) {
  const isExpiry = reminder.type === REMINDER_TYPES.EXPIRY;
  const Icon = isExpiry ? AlarmClock : Wallet;
  const text = reminderText(reminder);
  const detail = isExpiry ? `Ends ${formatDate(reminder.endDate)}` : "Payment pending";

  return (
    <li className="flex items-center gap-1 rounded-card border border-border pr-2 transition-colors hover:bg-background">
      <Link
        href={`/memberships/${reminder.membershipId}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-card py-2.5 pl-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Avatar name={reminder.student.fullName} src={reminder.student.photoUrl} />
        <span className="min-w-0 flex-1">
          <span className="text-body block truncate font-semibold text-text-primary">{reminder.student.fullName ?? "—"}</span>
          <span className="text-small block truncate text-text-secondary">
            {[reminder.student.studentCode, membershipLabel(reminder.membership)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {/* Both reminders are red: a payment reminder exists only while the balance is above zero. */}
          <Badge variant="danger">
            <Icon className="size-3" aria-hidden="true" />
            <span className="sr-only">{isExpiry ? "Expiry reminder: " : "Payment pending: "}</span>
            {text}
          </Badge>
          <span className="text-small text-text-secondary">{detail}</span>
        </span>
      </Link>
      <DashboardReminderActions reminder={reminder} reminders={membershipReminders} centreName={centreName} />
    </li>
  );
}

/**
 * Dashboard -> Reminders (01-product.md §5 "Reminders"; 02-ux.md "Membership & payment reminders"). Admin-only: the Dashboard renders it, and
 * loads its data (`getReminders`, which itself requires the Admin role), only for an Admin. Each expiry and payment reminder is its own row - a
 * membership with both appears twice - linking to that membership's Membership Details. Nothing is sent to anyone; this is an in-app list.
 *
 * @param {object} props
 * Each row ends with the same actions as a Memberships list row (`DashboardReminderActions`): the red reminder bell and the More (⋮) menu, both
 * opening the shared reminder message popup.
 *
 * @param {{ reminders: object[], counts: { total: number } } | null} props.result - `getReminders()`, or null when it could not be loaded.
 * @param {string} props.centreName - signs the reminder message.
 */
export default function DashboardReminders({ result, centreName }) {
  const reminders = result?.reminders ?? [];
  // The popup's reminders per membership, from the very reminders listed here - eligibility is never recomputed.
  const byMembership = remindersByMembership(reminders);

  return (
    <section
      id={REMINDERS_ANCHOR}
      aria-labelledby="dashboard-reminders-title"
      className="scroll-mt-6 rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="dashboard-reminders-title" className="text-section-title font-semibold text-text-primary">
            Reminders
            {result && reminders.length > 0 ? <span className="text-text-secondary"> ({reminders.length})</span> : null}
          </h2>
          <p className="text-small mt-1 text-text-secondary">Memberships that are expiring or have money still owed.</p>
        </div>
      </div>

      {!result ? (
        <p role="alert" className="text-body mt-4 rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          Reminders are not available right now. Try again later.
        </p>
      ) : reminders.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-body max-w-sm text-text-secondary">No reminders - every membership is current and paid up.</p>
        </div>
      ) : (
        <ul aria-label="Reminders" className="mt-4 flex flex-col gap-2">
          {reminders.map((reminder) => (
            <ReminderRow
              key={`${reminder.membershipId}:${reminder.type}`}
              reminder={reminder}
              membershipReminders={byMembership[reminder.membershipId]}
              centreName={centreName}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
