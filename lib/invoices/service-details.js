/**
 * How a receipt's stored service details are shown: presentation only.
 *
 * `invoices.service_details` (migration 0033) is structured data - the batches the student attended
 * and their weekly slots, as lower-case day names and "HH:MM" times, already in a deterministic order.
 * This module turns it into the lines a document prints ("Mon-Fri · 8:15 AM-9:15 AM"). It reads
 * nothing but its argument, never changes it, and has no database or React dependency, so the HTML,
 * Print and PDF documents all share it through `buildInvoiceDocument`.
 *
 * Nothing here is stored: the day ranges, the formatted times and the Sl. No. (an index in the list)
 * exist only in the model this returns.
 */

import { formatTime } from "../format.js";
import { DAYS_OF_WEEK, DAY_LABELS } from "../schedules/validation.js";

const DAY_INDEX = Object.fromEntries(DAYS_OF_WEEK.map((day, index) => [day, index]));
const RANGE_MINIMUM = 3;

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const dayLabel = (day) => DAY_LABELS[day].slice(0, 3);

/** "Mon-Fri" for a run of three or more consecutive days; otherwise the days, comma-separated. */
function formatDays(days) {
  const indexes = [...new Set(days.map((day) => DAY_INDEX[day]))].sort((a, b) => a - b);
  const parts = [];

  for (let i = 0; i < indexes.length; ) {
    let j = i;
    while (j + 1 < indexes.length && indexes[j + 1] === indexes[j] + 1) j += 1;
    const run = indexes.slice(i, j + 1);
    if (run.length >= RANGE_MINIMUM) parts.push(`${dayLabel(DAYS_OF_WEEK[run[0]])}–${dayLabel(DAYS_OF_WEEK[run[run.length - 1]])}`);
    else run.forEach((index) => parts.push(dayLabel(DAYS_OF_WEEK[index])));
    i = j + 1;
  }

  return parts.join(", ");
}

/** A stored slot, or null when it is not a usable one (unknown day, missing time). */
function usableSlot(slot) {
  if (!slot || !(slot.day_of_week in DAY_INDEX) || !text(slot.start_time) || !text(slot.end_time)) return null;
  return { day: slot.day_of_week, start: slot.start_time, end: slot.end_time };
}

/**
 * One schedule line per time: slots sharing a start and end are grouped ("Mon-Fri · 8:15 AM–9:15 AM"),
 * the groups ordered by their first day, then their time. Works on a copy; the input is not touched.
 */
export function scheduleLines(slots) {
  const usable = (Array.isArray(slots) ? slots : []).map(usableSlot).filter(Boolean);
  usable.sort((a, b) => DAY_INDEX[a.day] - DAY_INDEX[b.day] || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  const groups = new Map();
  for (const slot of usable) {
    const key = `${slot.start}|${slot.end}`;
    if (!groups.has(key)) groups.set(key, { start: slot.start, end: slot.end, days: [] });
    groups.get(key).days.push(slot.day);
  }

  return [...groups.values()].map((group) => `${formatDays(group.days)} · ${formatTime(group.start)}–${formatTime(group.end)}`);
}

/**
 * What a document prints for the stored service details, or null when there is nothing to add (NULL,
 * or no usable batch) - the document then renders exactly as before.
 *
 * - One batch: `{ lead, schedule, table: null }` - the batch name above the plan, its schedule lines
 *   below it; no numbering.
 * - Several batches: `{ lead: null, schedule: [], table: [{ number, batch, schedule }] }` - a
 *   Sl. No. / Batch / Schedule list, numbered from the array order. A batch without a slot is listed
 *   by name alone.
 *
 * @param {object|null|undefined} serviceDetails - `invoices.service_details`.
 */
export function buildServiceDetails(serviceDetails) {
  const batches = serviceDetails && Array.isArray(serviceDetails.batches) ? serviceDetails.batches : [];
  const rows = batches
    .map((batch) => ({ batch: text(batch?.name), schedule: scheduleLines(batch?.slots) }))
    .filter((row) => row.batch);

  if (rows.length === 0) return null;
  if (rows.length === 1) return { lead: rows[0].batch, schedule: rows[0].schedule, table: null };

  return { lead: null, schedule: [], table: rows.map((row, index) => ({ number: index + 1, ...row })) };
}
