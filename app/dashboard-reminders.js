"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, ArrowRight, BellRing, Wallet } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

// The list's filter tabs: every reminder, or one kind. Presentation only - the reminders themselves are the data layer's.
const FILTERS = [
  { key: "all", label: "All" },
  { key: REMINDER_TYPES.PAYMENT, label: "Payment Due" },
  { key: REMINDER_TYPES.EXPIRY, label: "Expiring" },
];

function ReminderRow({ reminder, membershipReminders, centreName }) {
  const isExpiry = reminder.type === REMINDER_TYPES.EXPIRY;
  const Icon = isExpiry ? AlarmClock : Wallet;
  const text = reminderText(reminder);
  const detail = isExpiry ? `Ends ${formatDate(reminder.endDate)}` : "Payment pending";

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-3 last:border-b-0 sm:flex-nowrap">
      <Link
        href={`/memberships/${reminder.membershipId}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Avatar name={reminder.student.fullName} src={reminder.student.photoUrl} size="md" />
        <span className="min-w-0 flex-1">
          <span className="text-body block truncate font-semibold text-text-primary">{reminder.student.fullName ?? "—"}</span>
          <span className="text-small block truncate text-text-secondary">
            {[reminder.student.studentCode, membershipLabel(reminder.membership)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </Link>
      {/* The reminder as a red pill - its kind and figure, with the end date or "Payment pending" beneath. Both reminders are red: a payment
          reminder exists only while the balance is above zero. */}
      <span className="flex shrink-0 flex-col items-start gap-0.5 rounded-lg border border-danger/20 bg-danger/5 px-3 py-1.5 text-danger">
        <span className="text-small inline-flex items-center gap-1.5 font-semibold">
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{isExpiry ? "Expiry reminder: " : "Payment pending: "}</span>
          {text}
        </span>
        <span className="text-small text-danger/80">{detail}</span>
      </span>
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
  const [filter, setFilter] = useState("all");
  const countOf = (key) => (key === "all" ? reminders.length : reminders.filter((reminder) => reminder.type === key).length);
  const shown = filter === "all" ? reminders : reminders.filter((reminder) => reminder.type === filter);
  // The popup's reminders per membership, from the very reminders listed here - eligibility is never recomputed.
  const byMembership = remindersByMembership(reminders);

  return (
    <section
      id={REMINDERS_ANCHOR}
      aria-labelledby="dashboard-reminders-title"
      className="scroll-mt-6 rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
        <Button variant="outline" size="sm" className="self-start border-brand/40 text-brand hover:bg-brand/5 hover:text-brand" render={<Link href="/memberships" />} nativeButton={false}>
          View All
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
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
        <>
        <div role="group" aria-label="Show reminders" className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={
                filter === option.key
                  ? "text-small rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 font-semibold text-brand outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  : "text-small rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
              }
            >
              {option.label} ({countOf(option.key)})
            </button>
          ))}
        </div>
        <ul aria-label="Reminders" className="mt-3 flex flex-col rounded-card border border-border">
          {shown.map((reminder) => (
            <ReminderRow
              key={`${reminder.membershipId}:${reminder.type}`}
              reminder={reminder}
              membershipReminders={byMembership[reminder.membershipId]}
              centreName={centreName}
            />
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
