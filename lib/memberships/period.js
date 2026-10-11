import { formatDate, formatDateShort } from "../format.js";

/** What a membership with no end date shows in place of one (a class-count membership with no expiry). */
export const NO_EXPIRY_LABEL = "No expiry";

/** A membership's end date as text: the date, or "No expiry" when it has none. */
export function formatEndDate(endDate) {
  return endDate ? formatDate(endDate) : NO_EXPIRY_LABEL;
}

/**
 * `Sep 1 – Sep 30, 2026` within a year; both years shown when the period crosses one.
 * A membership with no end date reads `Sep 1, 2026 – No expiry`: the start date is always kept.
 */
export function formatPeriod(startDate, endDate) {
  if (!startDate) return "—";
  if (!endDate) return `${formatDate(startDate)} – ${NO_EXPIRY_LABEL}`;
  return startDate.slice(0, 4) === endDate.slice(0, 4)
    ? `${formatDateShort(startDate)} – ${formatDate(endDate)}`
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
}
