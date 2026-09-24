// Relative-import-free and framework-free, so `npm test` can load it under plain Node.

/**
 * Phone handling shared by Students and Instructors: a phone is stored as two
 * separate values — `phone_country_code` ("+91") and `phone` (the national
 * digits, "9876543210") — never concatenated into one field.
 *
 * The digits-only / length rules for the number itself are unchanged and stay
 * in each feature's own validator (`lib/students/validation.js`,
 * `lib/instructors/validation.js`); this module owns the calling code and the
 * display.
 */

/** The default calling code — the centre is in India. */
export const DEFAULT_COUNTRY_CODE = "+91";

// "+" then 1-4 digits, no leading zero (ITU-T E.164 country codes are 1-3
// digits; the fourth allows the few shared-plan codes such as "+1268"). A shape
// check only — deliberately not a list of assigned codes, so no legitimate
// number is rejected.
const COUNTRY_CODE_PATTERN = /^\+[1-9]\d{0,3}$/;

/**
 * Normalizes a submitted calling code: trims it, accepts a bare "91" as "+91",
 * and returns `{ value }` or `{ error }`. An empty code is not an error here —
 * it is `{ value: null }`, and the caller decides (a phone number present with
 * no code falls back to the default).
 *
 * @param {unknown} input
 * @returns {{ value: string|null } | { error: string }}
 */
export function normalizeCountryCode(input) {
  const trimmed = String(input ?? "").trim().replace(/\s+/g, "");
  if (!trimmed) return { value: null };

  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  if (!COUNTRY_CODE_PATTERN.test(withPlus)) {
    return { error: "Choose a valid country code." };
  }
  return { value: withPlus };
}

/**
 * The calling code to store alongside a phone number: the submitted code, or
 * the default when a number was given without one; `null` when there is no
 * number at all (an optional phone left empty carries no code either).
 *
 * @param {unknown} countryCode - raw submitted code.
 * @param {string|null|undefined} phone - the already-trimmed phone digits.
 * @returns {{ value: string|null } | { error: string }}
 */
export function resolveCountryCodeForPhone(countryCode, phone) {
  if (!phone) return { value: null };
  const normalized = normalizeCountryCode(countryCode);
  if ("error" in normalized) return normalized;
  return { value: normalized.value ?? DEFAULT_COUNTRY_CODE };
}

/**
 * A stored phone for display: "+91 98765 43210". An Indian 10-digit number is
 * grouped 5 + 5; any other number is shown as stored, after its code. A row
 * with no stored code (a legacy number the migration could not attribute to a
 * country) is shown exactly as stored, never with an invented code. Returns
 * "—" when there is no number.
 *
 * @param {string|null|undefined} phone
 * @param {string|null|undefined} countryCode
 * @returns {string}
 */
export function formatPhone(phone, countryCode) {
  const digits = String(phone ?? "").trim();
  if (!digits) return "—";
  if (!countryCode) return digits;

  const grouped = countryCode === "+91" && /^\d{10}$/.test(digits) ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  return `${countryCode} ${grouped}`;
}
