/**
 * The centre's financial year: 1 April through 31 March, both days included. A financial year is named by the calendar year
 * it starts in - FY 2026 runs from 2026-04-01 to 2027-03-31 and is labelled "FY 2026–27". The start is fixed in V1 (not a
 * Center Setting).
 *
 * Every date here is a plain "YYYY-MM-DD" calendar date, the shape `payment_date` and `invoice_date` are stored in, so no
 * time zone applies to it. Only "the current financial year" depends on a clock, and it is read from the centre's own day
 * (`todayInCentreTimezone`) - never the server's or the viewer's date.
 *
 * Pure (no server or database access). Invalid input never throws: a calculation returns `null` and the label returns a dash,
 * like the formatters in `lib/format.js`.
 */

import { todayInCentreTimezone, DEFAULT_CENTRE_TIMEZONE } from "./class-sessions/validation.js";
import { isValidTimeZone } from "./timezones.js";

/** The month (1-12) a financial year starts in: April. */
export const FINANCIAL_YEAR_START_MONTH = 4;

// Four-digit years only, so both ends of a range are written as "YYYY".
const MIN_YEAR = 1000;
const MAX_YEAR = 9998;

const UNAVAILABLE = "—";

const pad = (value) => String(value).padStart(2, "0");

// A private copy rather than a shared helper, matching how every other module keeps its own small predicates
// (`lib/reports/validation.js`'s `isValidReportDate`).
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-trips only for a real date: "2026-02-29" normalises to March and fails.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidFinancialYear(fy) {
  return Number.isInteger(fy) && fy >= MIN_YEAR && fy <= MAX_YEAR;
}

/**
 * The financial year a calendar date belongs to: `"2026-03-31"` → 2025, `"2026-04-01"` → 2026.
 *
 * @param {string} date - "YYYY-MM-DD".
 * @returns {number|null} The year the financial year starts in, or null for an invalid date.
 */
export function financialYearOf(date) {
  if (!isValidDate(date)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const fy = month >= FINANCIAL_YEAR_START_MONTH ? year : year - 1;
  return isValidFinancialYear(fy) ? fy : null;
}

/**
 * The first and last day of a financial year, both inclusive: `2025` → `{ from: "2025-04-01", to: "2026-03-31" }`. A filter
 * on a `date` column is `>= from` and `<= to`.
 *
 * @param {number} fy - The year the financial year starts in.
 * @returns {{ from: string, to: string }|null} Null for an invalid year.
 */
export function financialYearRange(fy) {
  if (!isValidFinancialYear(fy)) return null;
  return {
    from: `${fy}-${pad(FINANCIAL_YEAR_START_MONTH)}-01`,
    to: `${fy + 1}-${pad(FINANCIAL_YEAR_START_MONTH - 1)}-31`,
  };
}

/**
 * The financial year it is at the centre at the instant `now`: the centre's own date, in its time zone, decides it. At
 * 2026-03-31T18:30:00Z it is already 1 April in Asia/Kolkata (FY 2026) while it is still 31 March in UTC.
 *
 * @param {Date} [now] - Defaults to the current time; overridable for testing.
 * @param {string} [timeZone] - The centre's IANA zone (`getCenterTimezone()`).
 * @returns {number|null} Null for an invalid instant or time zone.
 */
export function currentFinancialYear(now = new Date(), timeZone = DEFAULT_CENTRE_TIMEZONE) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !isValidTimeZone(timeZone)) return null;
  return financialYearOf(todayInCentreTimezone(now, timeZone));
}

/**
 * A financial year's label: `2026` → "FY 2026–27" (an en dash and the last two digits of the year it ends in, so 2099 →
 * "FY 2099–00"). Locale-independent.
 *
 * @param {number} fy
 * @returns {string} The label, or a dash for an invalid year.
 */
export function formatFinancialYear(fy) {
  if (!isValidFinancialYear(fy)) return UNAVAILABLE;
  return `FY ${fy}–${pad((fy + 1) % 100)}`;
}
