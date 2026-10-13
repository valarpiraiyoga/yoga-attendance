/**
 * Durations of package-linked memberships (V1 Fee Structure, FS-1): the months a duration option stands for, the
 * standard duration whose package discount a Custom duration uses, and the inclusive end date.
 *
 * Pure and framework-agnostic. The database stays the authoritative calculation layer once memberships are created
 * from packages; these functions establish the calculation contract (01-product.md §5 "End Date", "Standard fee and
 * package discount").
 *
 * Legacy memberships keep `calculateMembershipEndDate` (lib/memberships/validation.js), which rolls calendar overflow
 * forward. Package-linked memberships use the clamped rule below instead.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The standard duration options and their months. */
export const STANDARD_DURATION_MONTHS = Object.freeze({
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
});

/** Every duration option a duration-based package can offer. */
export const DURATION_OPTIONS = Object.freeze([...Object.keys(STANDARD_DURATION_MONTHS), "custom"]);

/** A Custom duration is a whole number of calendar months in this range, chosen per membership. */
export const CUSTOM_MONTHS_MIN = 1;
export const CUSTOM_MONTHS_MAX = 120;

// Largest first, so the first one that fits is the largest standard duration not exceeding the months.
const STANDARD_DURATIONS_DESCENDING = Object.entries(STANDARD_DURATION_MONTHS).sort((a, b) => b[1] - a[1]);

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isWholeMonths(months) {
  return Number.isInteger(months) && months >= CUSTOM_MONTHS_MIN && months <= CUSTOM_MONTHS_MAX;
}

// A UTC calendar date. setUTCFullYear takes the year literally (Date.UTC would map years 0-99 to 1900-1999) and
// normalizes a day of 0 to the last day of the previous month.
function utcDateString(year, monthIndex, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date.toISOString().slice(0, 10);
}

/**
 * The months a duration option stands for.
 *
 * @param {string} option - monthly | quarterly | half_yearly | annual | custom.
 * @param {string|number} [customMonths] - for custom only: a whole number of months from 1 to 120.
 * @returns {{ success: true, data: number } | { success: false, errors: { duration_option?: string, custom_months?: string } }}
 */
export function resolveDurationMonths(option, customMonths) {
  const trimmedOption = String(option ?? "").trim();

  if (Object.hasOwn(STANDARD_DURATION_MONTHS, trimmedOption)) {
    return { success: true, data: STANDARD_DURATION_MONTHS[trimmedOption] };
  }

  if (trimmedOption !== "custom") {
    return { success: false, errors: { duration_option: "Select a valid duration." } };
  }

  const trimmedMonths = String(customMonths ?? "").trim();
  const months = /^\d+$/.test(trimmedMonths) ? Number(trimmedMonths) : NaN;
  if (!isWholeMonths(months)) {
    return {
      success: false,
      errors: { custom_months: `Enter a whole number of months from ${CUSTOM_MONTHS_MIN} to ${CUSTOM_MONTHS_MAX}.` },
    };
  }

  return { success: true, data: months };
}

/**
 * The standard duration whose package discount applies: the largest one that does not exceed `months`
 * (1-2 → monthly, 3-5 → quarterly, 6-11 → half_yearly, 12 or more → annual). Monthly never has a package discount,
 * so a result of `monthly` means none.
 *
 * @param {number} months - whole months, at least 1 (validated by the caller).
 * @returns {"monthly" | "quarterly" | "half_yearly" | "annual" | null} null for anything below one month.
 */
export function packageDiscountDurationFor(months) {
  if (!Number.isInteger(months) || months < 1) return null;
  const match = STANDARD_DURATIONS_DESCENDING.find(([, standardMonths]) => months >= standardMonths);
  return match ? match[0] : null;
}

/**
 * The inclusive end date of a package-linked duration membership (01-product.md §5 "End Date"): add the months by
 * calendar months, clamp to the last day of a shorter target month, then subtract one day.
 * 31 Jan 2027 + 1 month → 28 Feb 2027 → ends 27 Feb 2027.
 *
 * @param {string} startDate - "YYYY-MM-DD".
 * @param {number} months - whole months from 1 to 120.
 * @returns {{ success: true, data: string } | { success: false, errors: { start_date?: string, months?: string } }}
 */
export function calculateDurationEndDate(startDate, months) {
  const trimmedStart = String(startDate ?? "").trim();
  if (!isValidDateString(trimmedStart)) {
    return { success: false, errors: { start_date: "Enter a valid start date." } };
  }
  if (!isWholeMonths(months)) {
    return {
      success: false,
      errors: { months: `The duration must be a whole number of months from ${CUSTOM_MONTHS_MIN} to ${CUSTOM_MONTHS_MAX}.` },
    };
  }

  const [year, month, day] = trimmedStart.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = Number(utcDateString(targetYear, targetMonth + 1, 0).slice(8, 10));
  const anniversaryDay = Math.min(day, lastDayOfTarget);

  return { success: true, data: utcDateString(targetYear, targetMonth, anniversaryDay - 1) };
}
