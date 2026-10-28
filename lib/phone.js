// Framework-free (no `@/` alias, no React or Next), so `npm test` can load it under plain Node.
import { isValidPhoneNumber, validatePhoneNumberLength } from "libphonenumber-js/min";
import { countryForDialCode, COUNTRIES } from "./phone-countries.js";

/**
 * Phone handling shared by Students and Instructors: a phone is stored as two
 * separate values — `phone_country_code` ("+91") and `phone` (the national
 * digits, "9876543210") — never concatenated into one field.
 *
 * The digits-only / length-limit rules and the required / optional decision stay in
 * each feature's own validator (`lib/students/validation.js`,
 * `lib/instructors/validation.js`); this module owns the calling code, the display,
 * and whether the digits are a real number for that calling code.
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

// The calling codes the country picker offers. A stored code outside this set (a legacy or unusual one) is not judged.
const KNOWN_CALLING_CODES = new Set(COUNTRIES.map((country) => country.dialCode));

// "India (+91)"; a code shared by several countries (+1, +7) is named by its code alone, since no one country is meant.
function describeCallingCode(countryCode) {
  const sharing = COUNTRIES.filter((country) => country.dialCode === countryCode);
  return sharing.length === 1 ? `${sharing[0].name} (${countryCode})` : countryCode;
}

/**
 * Whether national digits are a complete, real phone number for the selected calling code (libphonenumber-js, `min`
 * metadata: number lengths and the per-country numbering patterns). The calling code and the digits are checked together
 * as one international number, so no country has to be stored beside them - a shared code (+1, +44) accepts a number valid
 * in any country that uses it. A leading national trunk "0" (07911 123456, 09876 543210) is accepted, as the library does;
 * the digits are stored as typed.
 *
 * Deliberately NOT judged, and reported as valid: no digits (the caller decides whether a phone is required), digits that
 * are not all digits (the caller reports those), and a calling code the country picker does not offer (a legacy value) -
 * so editing a record that carries one is not blocked by a rule it was never written under.
 *
 * @param {string|null|undefined} countryCode - a normalized calling code ("+91"); none means the default, +91.
 * @param {string|null|undefined} digits - the national digits.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validatePhoneForCountry(countryCode, digits) {
  const national = String(digits ?? "").trim();
  if (!national || !/^\d+$/.test(national)) return { valid: true };

  const code = countryCode || DEFAULT_COUNTRY_CODE;
  if (!KNOWN_CALLING_CODES.has(code)) return { valid: true };

  const international = `${code}${national}`;
  if (isValidPhoneNumber(international)) return { valid: true };

  const label = describeCallingCode(code);
  if (validatePhoneNumberLength(international) === "TOO_SHORT") {
    return { valid: false, error: `This phone number is too short for ${label}.` };
  }
  return { valid: false, error: `Enter a valid phone number for ${label}.` };
}

/** The two error keys that belong to the one phone field (the number, and its calling code). */
export const PHONE_ERROR_KEYS = ["phone", "phone_country_code"];

/**
 * A validator's errors, reduced to the phone field's own - what a form shows beside the phone input when it rechecks
 * only that field (on blur, on a country change, before submit).
 *
 * @param {Record<string, string>|undefined} errors
 * @returns {Record<string, string>}
 */
export function phoneErrorsOf(errors) {
  return Object.fromEntries(PHONE_ERROR_KEYS.filter((key) => errors?.[key]).map((key) => [key, errors[key]]));
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
