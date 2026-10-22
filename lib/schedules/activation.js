// Activating an inactive schedule (V1; 01-product.md §7 "Deactivation" and "Activation"). Pure: no Next.js, no Supabase, so the rules are tested
// by running them (relative imports only).
//
// How it is stored. A deactivated schedule keeps its row exactly as it was left: status 'inactive' and the effective until the Admin set. That
// row is history and is never reused or rewritten. Activating starts a NEW version of the SAME series - the batch, instructor, day, times and
// the series (so its capacity and its students' assignments) carry over - active from the Effective From the Admin chooses and open-ended, the
// way every other new version of a schedule is created. Nothing about the inactive row, its sessions or their attendance changes. The
// instructor-conflict trigger (migration 0062) judges the new row like any other write and stays the final authority.

import { isValidDateString } from "./validation.js";
import { formatDate } from "../format.js";

export const ACTIVATE_NOT_INACTIVE_MESSAGE = "This schedule is not inactive, so there is nothing to activate.";
export const ACTIVATE_DATE_REQUIRED_MESSAGE = "Enter the date the schedule becomes active.";
export const ACTIVATE_PAST_MESSAGE = "Effective from cannot be in the past.";
export const ACTIVATE_ALREADY_ACTIVE_MESSAGE =
  "This class already has an active schedule that covers that date, so it cannot be activated again. Edit that schedule instead.";
export const ACTIVATE_ERROR_MESSAGE = "Could not activate the schedule. Try again.";

/** Shown when an inactive schedule is edited with a new effective date: that save would create an ACTIVE version, i.e. reactivate it silently. */
export const EDIT_INACTIVE_MESSAGE =
  "This schedule is inactive. Activate it first, then edit it - saving a change with an effective date would otherwise reactivate it.";

/**
 * Whether an inactive schedule may be activated from `effectiveFrom`, and the date to store.
 *
 * @param {{ status: string, effective_until: string|null }} schedule - the inactive schedule being activated.
 * @param {string} effectiveFrom - the date the Admin chose (an ISO date).
 * @param {string} today - the centre's date (never the server's or the browser's).
 * @param {{ id?: string, status: string, effective_until: string|null }[]} [otherVersions] - the series' OTHER versions.
 * @returns {{ success: true, data: { effective_from: string } } | { success: false, error: string }}
 */
export function validateActivation(schedule, effectiveFrom, today, otherVersions = []) {
  if (schedule.status !== "inactive") return { success: false, error: ACTIVATE_NOT_INACTIVE_MESSAGE };

  const from = String(effectiveFrom ?? "").trim();
  if (!from || !isValidDateString(from)) return { success: false, error: ACTIVATE_DATE_REQUIRED_MESSAGE };

  // Activation can never be back-dated: it would invent classes on days that have passed (01-product.md §12, Historical Integrity).
  if (from < today) return { success: false, error: ACTIVATE_PAST_MESSAGE };

  // The inactive schedule's own period is history and is not reused: the new version starts AFTER it ended.
  if (schedule.effective_until && from <= schedule.effective_until) {
    return {
      success: false,
      error: `Effective from must be after this schedule ended on ${formatDate(schedule.effective_until)}.`,
    };
  }

  // One current version per class: another ACTIVE version whose period reaches the chosen date means the class is already running.
  const running = otherVersions.some((version) => version.status === "active" && (!version.effective_until || version.effective_until >= from));
  if (running) return { success: false, error: ACTIVATE_ALREADY_ACTIVE_MESSAGE };

  return { success: true, data: { effective_from: from } };
}

/**
 * The row an activation inserts: the inactive schedule's own class (batch, instructor, day, times, series), active from the chosen date and
 * open-ended. `status` is left to the table's default ('active'), as for every new version.
 */
export function activatedScheduleRow(schedule, effectiveFrom) {
  return {
    batch_id: schedule.batch_id,
    instructor_id: schedule.instructor_id,
    day_of_week: schedule.day_of_week,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    effective_from: effectiveFrom,
    effective_until: null,
    series_id: schedule.series_id,
  };
}
