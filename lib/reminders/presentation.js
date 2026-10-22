// How reminders are worded and grouped on screen (02-ux.md "Membership & payment reminders"). Pure: relative imports only, so `npm test` loads it,
// and both server and client components can use it. The rules themselves are lib/reminders/rules.js; the data lib/reminders/data.js.

import { formatCurrency } from "../currencies.js";
import { fromPaise } from "../memberships/payments-core.js";
import { REMINDER_TYPES } from "./rules.js";

/**
 * The expiry wording from `daysUntilEnd` (the end date minus today): positive - days until it expires, zero - it expires today, negative - days
 * since it expired. "Expires in 3 days", "Expires in 1 day", "Expires today", "Expired 1 day ago", "Expired 5 days ago".
 */
export function expiryReminderText(daysUntilEnd) {
  if (!Number.isInteger(daysUntilEnd)) return "Expiring";
  if (daysUntilEnd === 0) return "Expires today";
  const days = Math.abs(daysUntilEnd);
  const unit = days === 1 ? "day" : "days";
  return daysUntilEnd > 0 ? `Expires in ${days} ${unit}` : `Expired ${days} ${unit} ago`;
}

/** The outstanding balance in the membership's own currency: "Balance ₹1,500.00". */
export function paymentReminderText(balancePaise, currency) {
  return `Balance ${formatCurrency(fromPaise(balancePaise), currency ?? undefined)}`;
}

/** The text of one reminder from the data layer (`getReminders()` entries). */
export function reminderText(reminder) {
  if (reminder?.type === REMINDER_TYPES.EXPIRY) return expiryReminderText(reminder.daysUntilEnd);
  if (reminder?.type === REMINDER_TYPES.PAYMENT) return paymentReminderText(reminder.balancePaise, reminder.membership?.currency);
  return "";
}

/**
 * The reminders grouped by membership, as plain data a client component can receive: `{ [membershipId]: { expiry?, payment? } }`, each with the
 * numbers and its text. A membership with both reminders has both entries; one with neither is absent.
 *
 * @param {object[]|null|undefined} reminders - `getReminders().reminders`.
 * @returns {Record<string, { expiry?: { daysUntilEnd: number, endDate: string, text: string }, payment?: { balancePaise: number, currency: string|null, text: string } }>}
 */
export function remindersByMembership(reminders) {
  const byMembership = {};
  for (const reminder of reminders ?? []) {
    if (!reminder?.membershipId) continue;
    const entry = byMembership[reminder.membershipId] ?? {};
    if (reminder.type === REMINDER_TYPES.EXPIRY) {
      entry.expiry = { daysUntilEnd: reminder.daysUntilEnd, endDate: reminder.endDate, text: reminderText(reminder) };
    } else if (reminder.type === REMINDER_TYPES.PAYMENT) {
      entry.payment = { balancePaise: reminder.balancePaise, currency: reminder.membership?.currency ?? null, text: reminderText(reminder) };
    } else {
      continue;
    }
    byMembership[reminder.membershipId] = entry;
  }
  return byMembership;
}
