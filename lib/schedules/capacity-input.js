/**
 * The Capacity field of the Add / Edit Schedule form (V1 Final Improvements, S5; 01-product.md §7 "Schedule Capacity"): reading it,
 * the messages for a refused value, and deciding whether an edit changes nothing but the capacity. Pure - no Supabase, no Next.js -
 * so the browser form, the server actions and the tests all use the same rules.
 *
 * Capacity belongs to the schedule SERIES (`schedule_series.capacity`), never to a schedule row: it is deliberately not part of
 * `validateScheduleInput`'s output, which is spread into `schedules` inserts.
 */

import { MAX_SCHEDULE_CAPACITY } from "./capacity.js";

export const CAPACITY_RANGE_MESSAGE = `Enter a whole number from 1 to ${MAX_SCHEDULE_CAPACITY}, or leave it blank for no limit.`;

const FAIL = (message) => ({ success: false, errors: { capacity: message } });

/**
 * Reads the Capacity field. Blank is unlimited (`value` null); otherwise a whole number from 1 to 1000. `provided` says whether
 * the field was submitted at all - an Edit form that could not load the current capacity leaves it out, and the action then
 * leaves the stored capacity alone instead of reading "absent" as "unlimited".
 *
 * @param {unknown} raw - `formData.get("capacity")`: a string, or null when the field was not submitted.
 * @returns {{ success: true, data: { provided: boolean, value: number|null } } | { success: false, errors: { capacity: string } }}
 */
export function validateScheduleCapacity(raw) {
  const provided = raw !== null && raw !== undefined;
  const text = String(raw ?? "").trim();

  if (!text) return { success: true, data: { provided, value: null } };

  if (/^-?\d+$/.test(text)) {
    const value = Number(text);
    if (value < 1) return FAIL("Capacity must be at least 1. Leave it blank for no limit.");
    if (value > MAX_SCHEDULE_CAPACITY) return FAIL(`Capacity can be at most ${MAX_SCHEDULE_CAPACITY}.`);
    return { success: true, data: { provided, value } };
  }
  if (/^-?(\d+\.\d*|\.\d+)$/.test(text)) return FAIL("Capacity must be a whole number.");

  return FAIL(CAPACITY_RANGE_MESSAGE);
}

const LOWERED = /^The capacity cannot be lowered to (\d+) because (\d+) places are taken\./;

/**
 * The message for a capacity write the database refused, or null when the refusal is not about the capacity (the caller then
 * shows its generic message - database wording is never shown). A capacity below the places taken now (0060's guard) names the
 * number taken and the smallest capacity allowed; the range constraint is the field's own range message.
 *
 * @param {{ code?: string, message?: string }|null|undefined} error - the Supabase error.
 * @returns {string|null}
 */
export function mapScheduleCapacityError(error) {
  if (error?.code !== "23514") return null;

  const lowered = LOWERED.exec(error.message ?? "");
  if (lowered) {
    const [, requested, taken] = lowered;
    const places = taken === "1" ? "1 place is" : `${taken} places are`;
    return `Capacity can't be lowered to ${requested}: ${places} taken now. Set it to ${taken} or more, or end some students' assignments first.`;
  }
  if (/schedule_series_capacity_valid/.test(error.message ?? "")) return CAPACITY_RANGE_MESSAGE;

  return null;
}

// "06:00:00" and "06:00" are the same time.
const hhmm = (time) => String(time ?? "").slice(0, 5);

/**
 * True when an Edit Schedule submission changes nothing about the schedule except (possibly) its capacity - the same day only (no
 * extra day to create), the same instructor, times and Effective Until - so saving it must not create a new version or ask for an
 * effective date (a capacity change applies at once; 01-product.md §7). For a direct edit of an unused schedule the Effective
 * From must also be the stored one, since there it is edited in place. For a versioned edit Effective From is the date a change
 * would start, so it is ignored: with nothing else changed there is nothing to start.
 *
 * @param {object} input
 * @param {{ day_of_week: string, instructor_id: string, start_time: string, end_time: string, effective_from: string, effective_until?: string|null }} input.existing - the stored schedule version.
 * @param {{ days?: string[], instructor_id?: unknown, start_time?: unknown, end_time?: unknown, effective_from?: unknown, effective_until?: unknown }} input.submitted
 * @param {boolean} [input.direct] - the schedule is edited in place (unused).
 * @returns {boolean}
 */
export function scheduleEditChangesOnlyCapacity({ existing, submitted, direct = false }) {
  if (!existing || !submitted) return false;

  const days = submitted.days ?? [];
  const sameDays = direct ? days.length === 1 && days[0] === existing.day_of_week : days.length > 0 && days.every((day) => day === existing.day_of_week);

  return (
    sameDays &&
    String(submitted.instructor_id ?? "") === String(existing.instructor_id ?? "") &&
    hhmm(submitted.start_time) === hhmm(existing.start_time) &&
    hhmm(submitted.end_time) === hhmm(existing.end_time) &&
    String(submitted.effective_until ?? "").trim() === String(existing.effective_until ?? "") &&
    (!direct || String(submitted.effective_from ?? "").trim() === String(existing.effective_from ?? ""))
  );
}
