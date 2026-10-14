/**
 * Pure rules for editing a class-count membership's expiry (V1 Fee Structure, FS-7; migration 0049). Kept out of the "use server"
 * file so they can be tested: that file may only export async functions.
 *
 * The database (`edit_class_count_expiry`) is the authority: it checks the Admin, the reason, the start date, that something
 * changes, and writes the audit row. These rules give the Admin the same answers before anything is sent.
 */

import { REASON_MESSAGE, reasonError, trimReason } from "./record-core.js";

export const EDIT_EXPIRY_FAILED_MESSAGE = "Could not change the expiry. Try again.";

/** The informational flag on a record whose attendance date is after the membership's current expiry (no acknowledgement in V1). */
export const EXPIRY_FLAG_LABEL = "Attendance after current expiry";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validates what the dialog collects.
 *
 * @param {object} input
 * @param {"date"|"none"} input.mode - an expiry date, or No expiry.
 * @param {string} [input.date] - "YYYY-MM-DD" when `mode` is "date".
 * @param {string} input.reason
 * @param {string|null} input.currentExpiry - the membership's expiry now, or null for No expiry.
 * @param {string} input.startDate - the membership's start date.
 * @returns {{ success: true, data: { newExpiry: string|null, reason: string } }
 *   | { success: false, errors: { expiry?: string, reason?: string } }}
 */
export function validateExpiryEdit({ mode, date, reason, currentExpiry = null, startDate }) {
  const errors = {};
  let newExpiry = null;

  if (mode === "none") {
    newExpiry = null;
  } else if (mode === "date") {
    const chosen = String(date ?? "").trim();
    if (!isValidDateString(chosen)) errors.expiry = "Enter the new expiry date.";
    else if (startDate && chosen < startDate) errors.expiry = "The expiry date cannot be before the start date.";
    else newExpiry = chosen;
  } else {
    errors.expiry = "Choose an expiry date or No expiry.";
  }

  if (!errors.expiry && newExpiry === (currentExpiry ?? null)) errors.expiry = "The expiry is unchanged.";
  if (reasonError(reason)) errors.reason = REASON_MESSAGE;

  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, data: { newExpiry, reason: trimReason(reason) } };
}

// The refusals `edit_class_count_expiry` raises on purpose; their own words are shown.
const SHOWN_CODES = new Set(["22023", "55000", "P0002"]);

/** The message to show for a failed `edit_class_count_expiry` call. */
export function expiryEditErrorMessage(error) {
  if (error?.code === "42501") return "You do not have permission to change an expiry.";
  if (SHOWN_CODES.has(error?.code) && error?.message) return error.message;
  return EDIT_EXPIRY_FAILED_MESSAGE;
}

/**
 * Whether a record is flagged "Attendance after current expiry": it was NOT reversed and its attendance date is after the
 * membership's current expiry. A membership with no expiry has nothing to be after. Only a flag: the record is kept, is not
 * reversed, and still counts against the class balance.
 *
 * @param {{ attendedOn: string, reversal?: object|null }} record
 * @param {string|null} endDate - the membership's current expiry, or null for No expiry.
 */
export function attendedAfterExpiry(record, endDate) {
  return Boolean(endDate) && !record.reversal && record.attendedOn > endDate;
}

/** The history row of an expiry edit for the screen (the names are resolved by the caller). */
export function expiryEditRowFrom(row, nameOf) {
  return {
    id: row.id,
    previousExpiry: row.previous_expiry ?? null,
    newExpiry: row.new_expiry ?? null,
    reason: row.reason,
    editedAt: row.edited_at,
    editedBy: nameOf(row.edited_by),
  };
}
