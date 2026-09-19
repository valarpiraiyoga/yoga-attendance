/**
 * Presentation-side reading of a membership's validity window — days left
 * and how much of the period has elapsed. Pure date arithmetic on values
 * the membership already carries; nothing here decides eligibility or
 * status (`deriveMembershipStatus` in `lib/memberships/data.js` owns that,
 * and this module takes its result as input).
 *
 * All dates are `YYYY-MM-DD` strings compared as UTC calendar days — the
 * same "today" `deriveMembershipStatus` uses, so a card's status and its
 * days-left can never disagree.
 *
 * Counting is inclusive of both ends (a membership starting and ending the
 * same day is 1 day), matching Membership Details' duration.
 */

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
 * @param {string} today - `YYYY-MM-DD`, the same day used to derive `status`.
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
