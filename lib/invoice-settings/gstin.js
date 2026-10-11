/**
 * GSTIN (Goods and Services Tax Identification Number) - the pure rules, with no Next.js and no React, so the
 * Settings validation and the tests share them.
 *
 * A GSTIN has 15 characters: a 2-digit state code, the holder's 10-character PAN (5 letters, 4 digits, 1 letter),
 * an entity number (1-9 or A-Z), the letter Z, and a check character. The database enforces the FORMAT
 * (`invoice_settings_gstin_valid`, `invoices_business_gstin_valid`, migration 0041); the application also checks the
 * check character, which catches a mistyped number before it is printed on a document.
 *
 * The GSTIN itself is configuration (Settings -> Invoice / Receipt -> Tax). Nothing in this file, and nothing in a
 * document template, contains a GSTIN: a document shows the value copied into it when it was issued.
 */

/** The format, exactly as the database CHECK writes it. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GSTIN_LENGTH = 15;

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The check character a GSTIN's first 14 characters call for (the GST network's base-36 weighted checksum).
 *
 * @param {string} gstin - at least the first 14 characters, upper case.
 * @returns {string}
 */
export function gstinCheckCharacter(gstin) {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = CHARSET.indexOf(gstin[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

/** Whether the text is a well-formed GSTIN with a correct check character. Upper case only: normalise first. */
export function isValidGstin(value) {
  return typeof value === "string" && GSTIN_PATTERN.test(value) && gstinCheckCharacter(value) === value[14];
}

/**
 * The stored form of what an Admin typed: surrounding whitespace removed and upper case; blank is no GSTIN (null).
 * Anything else - inner spaces, dashes - is left as typed, so validation reports it instead of quietly rewriting it.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizeGstin(input) {
  const text = String(input ?? "").trim().toUpperCase();
  return text === "" ? null : text;
}

/**
 * Validates a GSTIN as typed.
 *
 * @param {unknown} input
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }} - `value` is null for a blank input.
 */
export function validateGstin(input) {
  const value = normalizeGstin(input);
  if (value === null) return { ok: true, value: null };
  if (!isValidGstin(value)) {
    return { ok: false, error: `Enter a valid ${GSTIN_LENGTH}-character GSTIN, for example 29ABCDE1234F1ZW, or leave it blank.` };
  }
  return { ok: true, value };
}
