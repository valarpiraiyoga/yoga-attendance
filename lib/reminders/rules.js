// Membership expiry and payment reminders - the pure rules (V1 Reminders; 01-product.md §5 "Reminders", 02-ux.md "Membership & payment reminders").
//
// Reminders are not stored: they are worked out from the current membership and payment data every time they are shown, on the centre's date.
// This module is that calculation and nothing else - no database, no network, no UI wording, and no hidden "now": every function takes the
// centre-local `today` ("YYYY-MM-DD") from its caller (normally `membershipToday()` / `getCentreToday()`), so the same inputs always give the same
// answer. Relative imports only, so `npm test` loads it under plain Node.
//
// Two reminder types, independent of each other - a membership can have both, and each is returned as its own reminder:
//   * expiry  - only the student's LATEST-ENDING membership(s): among the student's non-cancelled memberships with an end date, those whose end date
//               is the latest (several when they share it). An older membership never has one, even after the latest has expired. From end date
//               - 6 days (7 days left, the end date included - the Memberships list's "Expiring Soon" boundary) and every day after it expires,
//               until the same student has another non-cancelled membership that covers today. A membership that only starts in the future does
//               not resolve it. The student's Active / Inactive status plays no part. No end date (including a class-count membership with No
//               expiry) means no expiry reminder, and such a membership never counts as the latest-ending one; there are no class-count reminders.
//   * payment - a non-cancelled membership whose Payment Status is Pending or Partially Paid and whose outstanding balance is above zero,
//               whatever its dates (an upcoming membership included). A Paid or cancelled membership never has one.

import { addDaysToDateString, deriveMembershipStatusOn, EXPIRING_SOON_DAYS } from "../memberships/validity.js";
import { summarizePayments } from "../memberships/payments-core.js";

export const REMINDER_TYPES = Object.freeze({ EXPIRY: "expiry", PAYMENT: "payment" });

/** Payment statuses that can carry a payment reminder (a Paid membership never does). */
export const PAYMENT_REMINDER_STATUSES = Object.freeze(["pending", "partially_paid"]);

/**
 * How many days before its end date an expiry reminder starts: 7 days left counts the end date itself, so the first reminder day is
 * end date - 6. The same constant as the Memberships list's "Expiring Soon", so the two can never disagree.
 */
export const EXPIRY_REMINDER_LEAD_DAYS = EXPIRING_SOON_DAYS - 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

function requireToday(today) {
  if (typeof today !== "string" || !DATE_PATTERN.test(today) || Number.isNaN(Date.parse(`${today}T00:00:00Z`))) {
    throw new TypeError("A centre-local `today` (YYYY-MM-DD) is required: reminders never read the machine's clock.");
  }
  return today;
}

const isCancelled = (membership) => Boolean(membership?.cancelled_at);

/** The first day a membership with this end date has an expiry reminder: end date - 6 days. */
export function expiryReminderStart(endDate) {
  return addDaysToDateString(endDate, -EXPIRY_REMINDER_LEAD_DAYS);
}

/**
 * Whether another membership of the SAME student resolves this one's expiry reminder: it is a different membership, not cancelled, and covers
 * `today` (it has started and has not ended - Active on today, the same derivation every membership screen uses). One that starts later does not.
 *
 * @param {{ id: string, student_id: string }} membership
 * @param {{ id: string, student_id: string, start_date: string, end_date: string|null, cancelled_at?: string|null }[]} otherMemberships
 * @param {string} today
 */
export function isResolvedByRenewal(membership, otherMemberships, today) {
  requireToday(today);
  return (otherMemberships ?? []).some(
    (other) =>
      other &&
      other.id !== membership.id &&
      other.student_id === membership.student_id &&
      membership.student_id != null &&
      deriveMembershipStatusOn(other, today) === "active"
  );
}

/**
 * The latest end date among a student's non-cancelled memberships that have one - the membership itself included - or null when there is none.
 * Cancelled memberships and memberships with no end date never count. Only memberships of the same student are considered.
 *
 * @param {{ id: string, student_id: string, end_date: string|null, cancelled_at?: string|null }} membership
 * @param {object[]} studentMemberships
 * @returns {string|null}
 */
export function latestEndDateOf(membership, studentMemberships) {
  let latest = null;
  for (const candidate of [membership, ...(studentMemberships ?? [])]) {
    if (!candidate || isCancelled(candidate) || !candidate.end_date) continue;
    if (candidate !== membership && (membership.student_id == null || candidate.student_id !== membership.student_id)) continue;
    if (latest === null || candidate.end_date > latest) latest = candidate.end_date;
  }
  return latest;
}

/**
 * Whether this membership is (one of) its student's latest-ending non-cancelled membership(s) - the only ones that can have an expiry reminder.
 * Memberships sharing the latest end date all qualify; none is picked over another.
 */
export function isLatestEndingMembership(membership, studentMemberships) {
  if (!membership || isCancelled(membership) || !membership.end_date) return false;
  return membership.end_date === latestEndDateOf(membership, studentMemberships);
}

/**
 * The expiry reminder of one membership on `today`, or null.
 *
 * @param {{ id: string, student_id: string, end_date: string|null, start_date: string, cancelled_at?: string|null }} membership
 * @param {{ today: string, studentMemberships?: object[] }} context - `studentMemberships`: ALL the student's memberships, whatever their status
 *   or dates (others are ignored) - they decide both which membership is the latest-ending one and whether a renewal covers today.
 * @returns {{ type: "expiry", membershipId: string, studentId: string, endDate: string, daysUntilEnd: number } | null}
 *   `daysUntilEnd`: the end date minus today - 6 on the first reminder day, 0 on the end date, negative once expired (-N = N days ago).
 */
export function expiryReminderOf(membership, { today, studentMemberships = [] } = {}) {
  requireToday(today);
  if (!membership || isCancelled(membership)) return null;
  if (!membership.end_date) return null;
  if (!isLatestEndingMembership(membership, studentMemberships)) return null;
  if (today < expiryReminderStart(membership.end_date)) return null;
  if (isResolvedByRenewal(membership, studentMemberships, today)) return null;

  return {
    type: REMINDER_TYPES.EXPIRY,
    membershipId: membership.id,
    studentId: membership.student_id,
    endDate: membership.end_date,
    daysUntilEnd: dayNumber(membership.end_date) - dayNumber(today),
  };
}

/**
 * The outstanding balance of a membership in paise, from its amount and recorded payments - the existing payment calculation
 * (`summarizePayments`), never below zero.
 */
export function outstandingBalancePaise(membership, payments) {
  return summarizePayments(membership?.amount ?? 0, payments ?? []).balancePaise;
}

/**
 * The payment reminder of one membership, or null. The dates play no part (an upcoming membership with a balance has one).
 *
 * @param {{ id: string, student_id: string, payment_status: string, cancelled_at?: string|null }} membership
 * @param {{ balancePaise: number }} context - the outstanding balance in paise (`outstandingBalancePaise`); anything not above zero is no balance.
 * @returns {{ type: "payment", membershipId: string, studentId: string, paymentStatus: string, balancePaise: number } | null}
 */
export function paymentReminderOf(membership, { balancePaise } = {}) {
  if (!membership || isCancelled(membership)) return null;
  if (!PAYMENT_REMINDER_STATUSES.includes(membership.payment_status)) return null;
  if (!Number.isFinite(balancePaise) || balancePaise <= 0) return null;

  return {
    type: REMINDER_TYPES.PAYMENT,
    membershipId: membership.id,
    studentId: membership.student_id,
    paymentStatus: membership.payment_status,
    balancePaise,
  };
}

/**
 * Every reminder of one membership on `today`: none, the expiry reminder, the payment reminder, or both - each its own entry, never merged.
 *
 * @param {object} membership
 * @param {{ today: string, studentMemberships?: object[], balancePaise: number }} context
 * @returns {object[]}
 */
export function remindersForMembership(membership, { today, studentMemberships = [], balancePaise } = {}) {
  return [expiryReminderOf(membership, { today, studentMemberships }), paymentReminderOf(membership, { balancePaise })].filter(Boolean);
}

/**
 * Every reminder across a set of memberships on `today`. The set doubles as the renewal context, so it should hold every membership of each
 * student concerned (a renewal that is not in it cannot resolve anything). `balancePaiseById` gives each membership's outstanding balance; a
 * membership with no entry has no payment reminder.
 *
 * @param {{ memberships: object[], today: string, balancePaiseById?: Map<string, number>|Record<string, number> }} input
 * @returns {object[]} expiry and payment reminders, each separate, in the order of `memberships`.
 */
export function collectReminders({ memberships, today, balancePaiseById = new Map() }) {
  requireToday(today);
  const balanceOf = (id) => (balancePaiseById instanceof Map ? balancePaiseById.get(id) : balancePaiseById?.[id]);

  const byStudent = new Map();
  for (const membership of memberships ?? []) {
    if (!membership) continue;
    const list = byStudent.get(membership.student_id) ?? [];
    list.push(membership);
    byStudent.set(membership.student_id, list);
  }

  return (memberships ?? []).flatMap((membership) =>
    membership
      ? remindersForMembership(membership, {
          today,
          studentMemberships: byStudent.get(membership.student_id) ?? [],
          balancePaise: balanceOf(membership.id),
        })
      : []
  );
}
