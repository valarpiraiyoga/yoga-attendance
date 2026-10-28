import { resolveCountryCodeForPhone, validatePhoneForCountry } from "../phone.js";
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
 * The fields `validateInstructorInput` judges, top to bottom as they appear on the Instructor form (each is also the id of
 * its input) - the order a blocked submit reports them in and focuses the first of.
 */
export const INSTRUCTOR_FIELD_ORDER = ["full_name", "phone", "email"];

/**
 * The id of the first field on the form that has an error, or null when there is none. A country-code error belongs to the
 * phone field, which is where the form shows it.
 *
 * @param {Record<string, string>|undefined} errors - `validateInstructorInput`'s `errors`.
 * @returns {string|null}
 */
export function firstInvalidInstructorField(errors) {
  return INSTRUCTOR_FIELD_ORDER.find((field) => errors?.[field] || (field === "phone" && errors?.phone_country_code)) ?? null;
}

/**
 * Validates the editable Instructor fields shared by create and update:
 * full name, email, phone. Status is deliberately excluded — it is only
 * ever changed via `validateInstructorStatus` / `setInstructorStatus`.
 *
 * @param {{ full_name?: unknown, email?: unknown, phone?: unknown, phone_country_code?: unknown }} input
 * @returns {{ success: true, data: { full_name: string, email: string|null, phone: string|null, phone_country_code: string|null } }
 *         | { success: false, errors: Record<string, string> }}
 */
export function validateInstructorInput({ full_name, email, phone, phone_country_code } = {}) {
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

  // The calling code is validated on its own (shape only) and stored beside the
  // number; an empty phone carries no code, and a number sent without one gets
  // the default.
  const countryCode = resolveCountryCodeForPhone(phone_country_code, trimmedPhone);
  if ("error" in countryCode) {
    errors.phone_country_code = countryCode.error;
  } else if (trimmedPhone && !errors.phone) {
    // Optional, but when given it must be a real number for the selected country (see validatePhoneForCountry).
    const check = validatePhoneForCountry(countryCode.value, trimmedPhone);
    if (!check.valid) errors.phone = check.error;
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
      phone_country_code: "value" in countryCode ? countryCode.value : null,
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
