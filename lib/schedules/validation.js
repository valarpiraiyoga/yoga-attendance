/**
 * Validation for the Schedule form fields (Add/Edit Schedule).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/normalized values ready to write to the database, never the raw
 * form input.
 */

// Native <input type="date"> / <input type="time"> always submit (or are
// empty) in these formats.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const DEFAULT_DURATION_MINUTES = 60;

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const DAY_LABELS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export const SCHEDULE_STATUSES = ["active", "inactive"];

export function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The day before a given date — used to close the current version of a
 * schedule the day before an edit's new version takes effect
 * (01-product.md §7's versioning rule).
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD".
 */
export function subtractOneDayUTC(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Adds (or, with a negative count, subtracts) whole days to a date — used
 * for the Weekly Schedule view's Previous/Next week navigation and for
 * stepping across a displayed week's seven days.
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @param {number} days
 * @returns {string} "YYYY-MM-DD".
 */
export function addDaysUTC(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The Monday on or before the given date — the Weekly Schedule view's week
 * boundary (02-ux.md: "Monday–Sunday columns"). Postgres/JS `getUTCDay()`
 * returns 0 for Sunday, so Sunday is treated as 6 days after the preceding
 * Monday rather than 0.
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD", always a Monday.
 */
export function getMondayOfWeek(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const jsDay = date.getUTCDay();
  const daysSinceMonday = (jsDay + 6) % 7;
  return addDaysUTC(dateString, -daysSinceMonday);
}

/**
 * Minutes since midnight for an "HH:MM" time string — the common unit the
 * Weekly Schedule grid positions cards in (02-ux.md D14: a fixed 6:00 AM–
 * 10:00 PM axis).
 *
 * @param {string} timeString - "HH:MM".
 * @returns {number}
 */
export function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidTimeString(value) {
  if (!TIME_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Derives End Time from Start Time (01-product.md §7: "Default duration is
 * 60 minutes... automatically calculates the end time... editable"). Pure
 * and framework-agnostic so both the client form (live recompute on Start
 * Time change) and this module's own validation can call it.
 *
 * Returns "" rather than a wrapped-past-midnight time when the default
 * duration would cross into the next day — a class starting at 23:30 has no
 * same-day +60-minute end time, so the admin must enter one manually rather
 * than being handed a silently wrong value.
 *
 * @param {string} startTime - "HH:MM".
 * @returns {string} "HH:MM", or "" if it cannot be derived same-day.
 */
export function calculateEndTime(startTime) {
  if (!isValidTimeString(startTime)) return "";

  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + DEFAULT_DURATION_MINUTES;
  if (totalMinutes >= 24 * 60) return "";

  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

/**
 * Validates the editable Schedule fields shared by create and update: batch,
 * instructor, day of week, start/end time, effective from/until.
 * `status` is excluded — new schedules always start active via the database
 * default, and status only changes through the dedicated Deactivate action
 * (there is no reactivate flow — see app/schedule/[id]/deactivate-schedule.js).
 *
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateScheduleInput({
  batch_id,
  instructor_id,
  day_of_week,
  start_time,
  end_time,
  effective_from,
  effective_until,
} = {}) {
  const errors = {};

  const trimmedBatchId = String(batch_id ?? "").trim();
  if (!trimmedBatchId) {
    errors.batch_id = "Select a batch.";
  }

  const trimmedInstructorId = String(instructor_id ?? "").trim();
  if (!trimmedInstructorId) {
    errors.instructor_id = "Select an instructor.";
  }

  const trimmedDay = String(day_of_week ?? "").trim().toLowerCase();
  if (!trimmedDay) {
    errors.day_of_week = "Select a day of week.";
  } else if (!DAYS_OF_WEEK.includes(trimmedDay)) {
    errors.day_of_week = "Select a valid day of week.";
  }

  const trimmedStart = String(start_time ?? "").trim();
  if (!trimmedStart) {
    errors.start_time = "Start time is required.";
  } else if (!isValidTimeString(trimmedStart)) {
    errors.start_time = "Enter a valid start time.";
  }

  const trimmedEnd = String(end_time ?? "").trim();
  if (!trimmedEnd) {
    errors.end_time = "End time is required.";
  } else if (!isValidTimeString(trimmedEnd)) {
    errors.end_time = "Enter a valid end time.";
  } else if (!errors.start_time && trimmedEnd <= trimmedStart) {
    errors.end_time = "End time must be later than start time.";
  }

  const trimmedFrom = String(effective_from ?? "").trim();
  if (!trimmedFrom) {
    errors.effective_from = "Effective from date is required.";
  } else if (!isValidDateString(trimmedFrom)) {
    errors.effective_from = "Enter a valid effective from date.";
  }

  const trimmedUntil = String(effective_until ?? "").trim();
  if (trimmedUntil) {
    if (!isValidDateString(trimmedUntil)) {
      errors.effective_until = "Enter a valid effective until date.";
    } else if (!errors.effective_from && trimmedUntil < trimmedFrom) {
      errors.effective_until = "Effective until cannot be before effective from.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      batch_id: trimmedBatchId,
      instructor_id: trimmedInstructorId,
      day_of_week: trimmedDay,
      start_time: trimmedStart,
      end_time: trimmedEnd,
      effective_from: trimmedFrom,
      effective_until: trimmedUntil || null,
    },
  };
}
