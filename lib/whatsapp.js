/**
 * Click-to-chat helpers for `https://wa.me/<number>?text=<message>` links.
 *
 * This is a plain link the admin opens themselves — not a WhatsApp Business
 * API, login or messaging integration (`01-product.md` keeps WhatsApp/SMS
 * integrations out of V1). Nothing is sent or stored by the application.
 */

// Phone numbers are stored as national digits (`lib/students/validation.js`),
// now beside a separate `phone_country_code` (`lib/phone.js`). wa.me needs the
// full international number, so when a code is stored it is put in front of the
// digits. A legacy number with no stored code keeps the old convention: the
// centre is in India (amounts are ₹), so a bare 10-digit number gets this
// country code and anything longer is taken to already include one.
export const DEFAULT_COUNTRY_CODE = "91";

const LOCAL_NUMBER_LENGTH = 10;
const MAX_INTERNATIONAL_LENGTH = 15; // E.164

/**
 * The number as wa.me wants it — digits only, with country code — or `null`
 * when the stored value cannot be turned into one (empty, or too short/long),
 * so no broken link is ever built.
 *
 * @param {string|null|undefined} phone
 * @param {string|null|undefined} [countryCode] - stored calling code, e.g. "+91".
 * @returns {string|null}
 */
export function normalizeWhatsAppNumber(phone, countryCode) {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");

  const codeDigits = String(countryCode ?? "").replace(/\D/g, "");
  if (codeDigits) {
    const full = `${codeDigits}${digits}`;
    return digits && full.length > LOCAL_NUMBER_LENGTH - 1 && full.length <= MAX_INTERNATIONAL_LENGTH ? full : null;
  }

  if (digits.length === LOCAL_NUMBER_LENGTH) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length > LOCAL_NUMBER_LENGTH && digits.length <= MAX_INTERNATIONAL_LENGTH) return digits;
  return null;
}

/**
 * `https://wa.me/<number>?text=<encoded message>`, or `null` without a usable number.
 *
 * @param {string|null|undefined} phone
 * @param {string} message
 * @param {string|null|undefined} [countryCode] - stored calling code, e.g. "+91".
 * @returns {string|null}
 */
export function buildWhatsAppUrl(phone, message, countryCode) {
  const number = normalizeWhatsAppNumber(phone, countryCode);
  if (!number) return null;

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
