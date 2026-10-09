import { resolveCountryCodeForPhone } from "../phone.js";
/**
 * Validation for the Student form fields (Students).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/normalized values ready to write to the database, never the raw
 * form input.
 */

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 30;
const MAX_EMAIL_LENGTH = 255;
const MAX_NOTES_LENGTH = 1000;

// Deliberately simple: format sanity, not exhaustive RFC 5322 matching.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Digits only — mirrors lib/instructors/validation.js's phone rule exactly.
const PHONE_PATTERN = /^\d+$/;

// Native <input type="date"> always submits (or is empty) in this format.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const STUDENT_STATUSES = ["active", "inactive"];
export const STUDENT_GENDERS = ["male", "female", "other"];

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validates the editable Student fields shared by create and update: name,
 * phone, email, date of birth, gender, join date, notes. Status is
 * deliberately excluded — it is only ever changed via the deactivation
 * confirmation, validated separately by `validateStudentStatus`. student_code
 * is excluded entirely — it is system-generated and immutable
 * (0006_students.sql), never accepted as input here.
 *
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateStudentInput({
  full_name,
  phone,
  phone_country_code,
  email,
  date_of_birth,
  gender,
  join_date,
  notes,
  tax_invoice_default,
} = {}) {
  const errors = {};

  const trimmedName = String(full_name ?? "").trim();
  if (!trimmedName) {
    errors.full_name = "Full name is required.";
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.full_name = `Full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const trimmedPhone = String(phone ?? "").trim();
  if (!trimmedPhone) {
    errors.phone = "Phone is required.";
  } else if (trimmedPhone.length > MAX_PHONE_LENGTH) {
    errors.phone = `Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`;
  } else if (!PHONE_PATTERN.test(trimmedPhone)) {
    errors.phone = "Phone must contain digits only.";
  }

  // The calling code is validated on its own (shape only) and stored beside the
  // number, never merged into it; a number sent without a code gets the default.
  const countryCode = resolveCountryCodeForPhone(phone_country_code, trimmedPhone);
  if ("error" in countryCode) {
    errors.phone_country_code = countryCode.error;
  }

  const trimmedEmail = String(email ?? "").trim().toLowerCase();
  if (trimmedEmail) {
    if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
      errors.email = `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Enter a valid email address.";
    }
  }

  const trimmedDob = String(date_of_birth ?? "").trim();
  if (trimmedDob) {
    if (!isValidDateString(trimmedDob)) {
      errors.date_of_birth = "Enter a valid date of birth.";
    } else if (trimmedDob > todayDateString()) {
      errors.date_of_birth = "Date of birth cannot be in the future.";
    }
  }

  const trimmedGender = String(gender ?? "").trim().toLowerCase();
  if (trimmedGender && !STUDENT_GENDERS.includes(trimmedGender)) {
    errors.gender = "Select a valid gender.";
  }

  const trimmedJoinDate = String(join_date ?? "").trim();
  if (!trimmedJoinDate) {
    errors.join_date = "Join date is required.";
  } else if (!isValidDateString(trimmedJoinDate)) {
    errors.join_date = "Enter a valid join date.";
  }

  const trimmedNotes = String(notes ?? "").trim();
  if (trimmedNotes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      full_name: trimmedName,
      phone: trimmedPhone,
      phone_country_code: "value" in countryCode ? countryCode.value : null,
      email: trimmedEmail || null,
      date_of_birth: trimmedDob || null,
      gender: trimmedGender || null,
      join_date: trimmedJoinDate,
      notes: trimmedNotes || null,
      // V1 Tax Adjustment: the student's default tax invoice choice. Enabled unless explicitly turned off.
      tax_invoice_default: parseTaxInvoiceDefault(tax_invoice_default),
    },
  };
}

/** The switch posts "1" / "0"; anything other than an explicit off (or no value at all) means on, the system default. */
export function parseTaxInvoiceDefault(value) {
  return !(value === false || value === "0" || value === "false" || value === "off");
}

/**
 * Validates a status value for the deactivate/activate confirmation.
 *
 * @param {unknown} status
 * @returns {{ success: true, data: "active"|"inactive" }
 *         | { success: false, errors: { status: string } }}
 */
export function validateStudentStatus(status) {
  if (!STUDENT_STATUSES.includes(status)) {
    return {
      success: false,
      errors: { status: "Status must be active or inactive." },
    };
  }

  return { success: true, data: status };
}
