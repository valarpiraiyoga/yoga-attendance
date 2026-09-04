/**
 * Validation for the Instructor form fields (Settings → Instructors).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/lowercased values ready to write to the database, never the raw
 * form input.
 */

const MAX_FULL_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 255;
const MAX_PHONE_LENGTH = 30;

// Deliberately simple: format sanity, not exhaustive RFC 5322 matching.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Digits only — no "+", spaces, or separators. Phone is an identifier, not a
// quantity, so this is never parsed as a number (that would silently drop a
// leading zero); it is compared and stored as a string throughout.
const PHONE_PATTERN = /^\d+$/;

export const INSTRUCTOR_STATUSES = ["active", "inactive"];

/**
 * Validates the editable Instructor fields shared by create and update:
 * full name, email, phone. Status is deliberately excluded — it is only
 * ever changed via `validateInstructorStatus` / `setInstructorStatus`.
 *
 * @param {{ full_name?: unknown, email?: unknown, phone?: unknown }} input
 * @returns {{ success: true, data: { full_name: string, email: string|null, phone: string|null } }
 *         | { success: false, errors: Record<string, string> }}
 */
export function validateInstructorInput({ full_name, email, phone } = {}) {
  const errors = {};

  const trimmedName = String(full_name ?? "").trim();
  if (!trimmedName) {
    errors.full_name = "Full name is required.";
  } else if (trimmedName.length > MAX_FULL_NAME_LENGTH) {
    errors.full_name = `Full name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.`;
  }

  const trimmedEmail = String(email ?? "").trim().toLowerCase();
  if (trimmedEmail) {
    if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
      errors.email = `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Enter a valid email address.";
    }
  }

  const trimmedPhone = String(phone ?? "").trim();
  if (trimmedPhone) {
    if (trimmedPhone.length > MAX_PHONE_LENGTH) {
      errors.phone = `Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`;
    } else if (!PHONE_PATTERN.test(trimmedPhone)) {
      errors.phone = "Phone must contain digits only.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      full_name: trimmedName,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
    },
  };
}

/**
 * Validates a status value for `setInstructorStatus`.
 *
 * @param {unknown} status
 * @returns {{ success: true, data: "active"|"inactive" }
 *         | { success: false, errors: { status: string } }}
 */
export function validateInstructorStatus(status) {
  if (!INSTRUCTOR_STATUSES.includes(status)) {
    return {
      success: false,
      errors: { status: "Status must be active or inactive." },
    };
  }

  return { success: true, data: status };
}
