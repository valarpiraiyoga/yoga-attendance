/**
 * How a refused enrollment save is shown on the Add / Edit Enrollment form (V1 Final Improvements, S3). Pure: no Supabase, no
 * Next.js, so every mapping is testable. `lib/enrollments/actions.js` calls the database's atomic `create_enrollment` /
 * `change_enrollment` (supabase/migrations/0060_schedule_capacity.sql) and passes any error here.
 *
 * Only refusals the form can act on are mapped, each to the field the Admin must change and a message written for them. Anything
 * else returns null: the action logs it and shows the generic message, so no database wording, SQL or internal id ever reaches the
 * screen.
 */

import { matchKnownJoinDateError } from "../students/join-date.js";
import { DAY_LABELS } from "../schedules/validation.js";
import { formatTimeRange } from "../format.js";

/** The generic message for a save that failed for any reason the form cannot act on. */
export const SAVE_ERROR_MESSAGE = "Could not save the enrollment. Try again.";

/** "At most one active enrollment per (student, batch)" - batch_enrollments_one_active_per_batch (0007), 23505. */
export const DUPLICATE_ENROLLMENT_MESSAGE = "This student already has an active enrollment in that batch.";

// 0060's capacity refusals (23514). Matched on their fixed opening words, never echoed.
const SCHEDULE_FULL = /^The schedule is full \(capacity (\d+)\)\./;
const CAPACITY_LOWERED = /^The capacity cannot be lowered to (\d+) because (\d+) places are taken\./;

// 0060's selection and change-date refusals (22023): the application's own validation messages, so they are shown as they are.
const KNOWN_INPUT_ERRORS = {
  "Select at least one schedule.": "schedule_series_ids",
  "Select schedules that belong to the chosen batch.": "schedule_series_ids",
  "Enter a valid date for the schedule change.": "schedule_effective_date",
  "The schedule change cannot be back-dated.": "schedule_effective_date",
};

/** True for 0060's "The schedule is full" refusal. */
export function isScheduleFullError(error) {
  return error?.code === "23514" && SCHEDULE_FULL.test(error.message ?? "");
}

/** True for 0060's "The capacity cannot be lowered" refusal (a schedule's capacity edit - S5). */
export function isCapacityLoweredError(error) {
  return error?.code === "23514" && CAPACITY_LOWERED.test(error.message ?? "");
}

/**
 * The schedule series a "schedule is full" refusal is about, from the database error's detail
 * ("schedule_series_id=<uuid> places_needed=… capacity=…"), or null. Used only to look the schedule's name up; never shown.
 */
export function fullScheduleSeriesId(error) {
  if (!isScheduleFullError(error)) return null;
  const match = /schedule_series_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(error.details ?? "");
  return match ? match[1] : null;
}

/** How a schedule is named to the Admin: "Monday 6:00 AM – 7:00 AM". Null when it cannot be named. */
export function scheduleLabel(schedule) {
  if (!schedule?.day_of_week || !schedule.start_time || !schedule.end_time) return null;
  return `${DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week} ${formatTimeRange(schedule.start_time, schedule.end_time)}`;
}

/**
 * The form's field error for a refused enrollment save, or null when the refusal is not one the form can act on.
 *
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error - the Supabase error.
 * @param {{ scheduleLabel?: string|null }} [context] - the full schedule's name, when it could be looked up.
 * @returns {{ field: string, error: string }|null}
 */
export function mapEnrollmentSaveError(error, { scheduleLabel: label = null } = {}) {
  if (!error) return null;

  // The join-date rules and the start-date cascade's refusals (0051) - unchanged.
  const joinRule = matchKnownJoinDateError(error);
  if (joinRule) return { field: joinRule.field, error: joinRule.error };

  if (error.code === "23505") return { field: "batch_id", error: DUPLICATE_ENROLLMENT_MESSAGE };

  const full = error.code === "23514" ? SCHEDULE_FULL.exec(error.message ?? "") : null;
  if (full) {
    const which = label ? `The ${label} schedule` : "One of the selected schedules";
    return {
      field: "schedule_series_ids",
      error: `${which} is full (capacity ${full[1]}). Raise its capacity first, or choose another schedule. Places held by future-dated enrollments and schedule changes count.`,
    };
  }

  if (error.code === "22023" && Object.hasOwn(KNOWN_INPUT_ERRORS, error.message)) {
    return { field: KNOWN_INPUT_ERRORS[error.message], error: error.message };
  }

  return null;
}
