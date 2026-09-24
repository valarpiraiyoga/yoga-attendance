import { todayInCentreTimezone } from "../class-sessions/validation.js";

/**
 * A membership's validity window — its status on a given day, days left and
 * how much of the period has elapsed. Pure date arithmetic on values the
 * membership already carries; nothing here decides attendance eligibility
 * (that is resolved in the database against the session's own date).
 *
 * "Today" is always the centre's calendar date (Asia/Kolkata, the same clock
 * Attendance and the Dashboard use — see `membershipToday`), never the
 * server's UTC date: between 00:00 and 05:30 IST the UTC date is still the
 * previous day, which used to show an already-ended membership as Active.
 * `deriveMembershipStatusOn` and `getMembershipValidity` take that day as an
 * argument, so a status and its days-left always come from the same day.
 *
 * All dates are `YYYY-MM-DD` calendar-date strings (the columns are `date`,
 * no time or zone); they are turned into UTC day numbers only to count days.
 *
 * Counting is inclusive of both ends (a membership starting and ending the
 * same day is 1 day), matching Membership Details' duration.
 */

/**
 * The membership domain's "today": the current date at the centre
 * (Asia/Kolkata), reusing the one canonical helper. Every membership status,
 * validity, filter and count reads its "today" from here (through
 * `todayDateString` in `lib/memberships/data.js`).
 *
 * @param {Date} [now] - overridable for testing.
 * @returns {string} "YYYY-MM-DD"
 */
export function membershipToday(now = new Date()) {
  return todayInCentreTimezone(now);
}

/**
 * Derives Upcoming/Active/Expired/Cancelled from stored facts on the given
 * day (01-product.md §5, §12) — never stored, so a membership can't silently
 * stay "Active" after its end date passes. Start and end are both inclusive.
 * Cancellation overrides any date-derived status.
 *
 * @param {{ start_date: string, end_date: string, cancelled_at?: string|null }} membership
 * @param {string} today - "YYYY-MM-DD", normally `membershipToday()`.
 * @returns {"cancelled"|"upcoming"|"active"|"expired"}
 */
export function deriveMembershipStatusOn({ start_date, end_date, cancelled_at }, today) {
  if (cancelled_at) return "cancelled";
  if (today < start_date) return "upcoming";
  if (today > end_date) return "expired";
  return "active";
}

/** An Active membership is "Expiring Soon" when this many days or fewer remain. */
export const EXPIRING_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

function toDayNumber(dateString) {
  return Math.round(Date.parse(`${dateString}T00:00:00Z`) / DAY_MS);
}

/** `YYYY-MM-DD` plus `days` calendar days (UTC). */
export function addDaysToDateString(dateString, days) {
  return new Date((toDayNumber(dateString) + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The latest end date an Active membership can have and still be Expiring
 * Soon: with inclusive counting, `EXPIRING_SOON_DAYS` days left means the
 * end date is `EXPIRING_SOON_DAYS - 1` days from today.
 */
export function expiringSoonCutoff(today) {
  return addDaysToDateString(today, EXPIRING_SOON_DAYS - 1);
}

/**
 * @param {{ start_date: string, end_date: string, status: "upcoming"|"active"|"expired"|"cancelled" }} membership
 * @param {string} today - `YYYY-MM-DD`, the same centre day used to derive `status`.
 * @returns {{
 *   status: string,
 *   totalDays: number,
 *   daysLeft: number|null,      // Active only
 *   startsInDays: number|null,  // Upcoming only
 *   percentUsed: number,        // 0–100; 100 once Expired
 * }}
 */
export function getMembershipValidity({ start_date, end_date, status }, today) {
  const start = toDayNumber(start_date);
  const end = toDayNumber(end_date);
  const now = toDayNumber(today);
  const totalDays = Math.max(1, end - start + 1);

  if (status === "upcoming") {
    return { status, totalDays, daysLeft: null, startsInDays: Math.max(0, start - now), percentUsed: 0 };
  }

  if (status === "active") {
    const daysLeft = end - now + 1;
    const used = Math.min(totalDays, Math.max(0, now - start));
    return { status, totalDays, daysLeft, startsInDays: null, percentUsed: Math.round((used / totalDays) * 100) };
  }

  if (status === "expired") {
    return { status, totalDays, daysLeft: null, startsInDays: null, percentUsed: 100 };
  }

  // cancelled — no validity reading is shown.
  return { status, totalDays, daysLeft: null, startsInDays: null, percentUsed: 0 };
}

/**
 * The short "N days left" / "Starts in N days" / "Expired" / "—" text, plus
 * whether it should read as a problem. One place so the card and the table
 * always say the same thing.
 *
 * @returns {{ text: string, tone: "default"|"danger" }}
 */
export function getValidityLabel(validity, { compact = false } = {}) {
  const plural = (n) => (n === 1 ? "1 day" : `${n} days`);

  switch (validity.status) {
    case "active":
      return { text: compact ? String(validity.daysLeft) : `${plural(validity.daysLeft)} left`, tone: "default" };
    case "upcoming":
      return { text: `Starts in ${plural(validity.startsInDays)}`, tone: "default" };
    case "expired":
      return { text: compact ? "—" : "Expired", tone: compact ? "default" : "danger" };
    default:
      return { text: "—", tone: "default" };
  }
}
