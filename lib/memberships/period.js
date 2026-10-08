import { formatDate, formatDateShort } from "../format.js";

/** `Sep 1 – Sep 30, 2026` within a year; both years shown when the period crosses one. */
export function formatPeriod(startDate, endDate) {
  if (!startDate || !endDate) return "—";
  return startDate.slice(0, 4) === endDate.slice(0, 4)
    ? `${formatDateShort(startDate)} – ${formatDate(endDate)}`
    : `${formatDate(startDate)} – ${formatDate(endDate)}`;
}
