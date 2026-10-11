/**
 * Pure rules for recording a class against a class-count membership (migration 0043). Kept out of the "use server" file
 * so they can be tested: that file may only export async functions.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The generic message for anything that is not a refusal worth showing as it is. */
export const RECORD_FAILED_MESSAGE = "Could not record the class. Try again.";

// The refusals record_class_count_attendance() raises on purpose, each with a message written for the Admin:
// 55000 (cancelled, not started, expired, inactive student, no classes remain), 22023 (wrong kind or missing input),
// 23505 (the request ID was already used for another membership), P0002 (membership not found).
const SHOWN_CODES = new Set(["55000", "22023", "23505", "P0002"]);

/**
 * The message to show for a failed `record_class_count_attendance` call.
 *
 * @param {{ code?: string, message?: string }|null|undefined} error
 */
export function recordErrorMessage(error) {
  if (error?.code === "42501") return "You do not have permission to record a class.";
  if (SHOWN_CODES.has(error?.code) && error?.message) return error.message;
  return RECORD_FAILED_MESSAGE;
}

/** `3 classes left`, `1 class left`, `No classes left`. */
export function remainingText(remaining) {
  if (remaining <= 0) return "No classes left";
  return `${remaining} ${remaining === 1 ? "class" : "classes"} left`;
}

// ---- attendance date --------------------------------------------------------------------------------------------------

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!DATE_PATTERN.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Early feedback on the attendance date (migration 0045 enforces the same rules and is the authority): a real date, not in
 * the future at the centre, not before the membership starts and, when it has an end date, not after it. Dates are
 * "YYYY-MM-DD" strings, which compare correctly as text. Returns the message to show, or null when the date is acceptable.
 *
 * @param {string} date
 * @param {{ today: string, startDate: string, endDate?: string|null }} bounds - `today` is the centre's today.
 */
export function attendanceDateError(date, { today, startDate, endDate }) {
  if (!date) return "Choose the attendance date.";
  if (!isRealDate(date)) return "Enter a valid attendance date.";
  if (date > today) return "The attendance date cannot be in the future.";
  if (startDate && date < startDate) return "The attendance date cannot be before the membership starts.";
  if (endDate && date > endDate) return "The attendance date cannot be after the membership ends.";
  return null;
}

// ---- reversal reason --------------------------------------------------------------------------------------------------

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const REASON_MESSAGE = `Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`;
export const REVERSE_FAILED_MESSAGE = "Could not reverse the class. Try again.";

/** The reason as the database stores it: all leading and trailing whitespace removed. */
export function trimReason(reason) {
  return String(reason ?? "").replace(/^\s+|\s+$/g, "");
}

/** The message to show for a reason that is not 3 to 500 characters once trimmed, or null. */
export function reasonError(reason) {
  const length = trimReason(reason).length;
  return length < REASON_MIN || length > REASON_MAX ? REASON_MESSAGE : null;
}

/** The message to show for a failed `reverse_class_count_attendance` call. */
export function reverseErrorMessage(error) {
  if (error?.code === "42501") return "You do not have permission to reverse a class.";
  if (SHOWN_CODES.has(error?.code) && error?.message) return error.message;
  return REVERSE_FAILED_MESSAGE;
}
