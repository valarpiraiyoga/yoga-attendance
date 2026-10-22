/**
 * How a refused Edit Schedule save is shown (V1 Final Improvements, S5; migration 0061). Pure: no Supabase, no Next.js, so every mapping
 * is testable. `lib/schedules/actions.js` calls the database's atomic `save_schedule_edit` / `save_unused_schedule_edit` and passes any
 * error here. Because those functions write nothing when they fail, every message here may truthfully say the schedule was not saved.
 *
 * Only refusals the form or the Admin can act on are mapped; anything else returns null, and the action logs it and shows the generic
 * message - database wording is never shown.
 */

import { mapScheduleCapacityError } from "./capacity-input.js";
import { instructorConflictMessage } from "./instructor-conflict.js";
import { USAGE_BLOCK_REASONS } from "./usage.js";

/** The generic message for a save that failed for any reason the Admin cannot act on. */
export const SAVE_SCHEDULE_ERROR_MESSAGE = "Could not update the schedule. Try again.";

export const SCHEDULE_GONE_MESSAGE = "This schedule no longer exists.";

export const SCHEDULE_HAS_HISTORY_MESSAGE =
  "This schedule now has history, so it can no longer be edited directly. Reload the page to edit it with an effective date.";

export const EFFECTIVE_FROM_PAST_MESSAGE = "Effective from cannot be in the past.";

/**
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error - the Supabase error.
 * @param {{ direct?: boolean }} [options] - `direct`: the error comes from `save_unused_schedule_edit`.
 * @returns {{ field: string, error: string } | { message: string } | null} a field error for the form, or a message for the top of
 *   it, or null when the refusal is not one the Admin can act on.
 */
export function mapScheduleSaveError(error, { direct = false } = {}) {
  if (!error) return null;

  // A capacity below the places taken, or out of range: the capacity field (0060's guard and constraint).
  const capacity = mapScheduleCapacityError(error);
  if (capacity) return { field: "capacity", error: capacity };

  if (error.code === "P0002") return { message: SCHEDULE_GONE_MESSAGE };

  // The instructor already has a class at an overlapping time (migration 0062's trigger, 23P01 with a JSON DETAIL): the same message for a
  // new version, an in-place edit, a Direct Edit and the extra days, at the top of the form - it involves instructor, day, time and dates
  // together. Checked before the Direct Edit refusals so it is never read as "this schedule now has history". A 23P01 without that
  // payload is not mapped (the generic message stays).
  const conflict = instructorConflictMessage(error);
  if (conflict) return { message: conflict };

  // The date rule the form checks first and the database repeats (a change can never be back-dated).
  if (!direct && error.code === "22023" && error.message === EFFECTIVE_FROM_PAST_MESSAGE) {
    return { field: "effective_from", error: EFFECTIVE_FROM_PAST_MESSAGE };
  }

  if (direct) {
    // correct_unused_schedule refuses a schedule that has gained history with 22023 and the reason in DETAIL; the foreign-key
    // backstops are the same refusal. A 22023 WITHOUT one of those reasons is another check of the save (for example an extra day
    // equal to the schedule's own day) and is not "this schedule now has history".
    const reason = String(error.details ?? "").trim();
    if ((error.code === "22023" && USAGE_BLOCK_REASONS.includes(reason)) || error.code === "23001" || error.code === "23503") {
      return { message: SCHEDULE_HAS_HISTORY_MESSAGE };
    }
  }

  return null;
}
