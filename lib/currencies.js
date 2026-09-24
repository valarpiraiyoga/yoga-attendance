/**
 * Currency metadata and the one money formatter (Center Regional Settings).
 *
 * The centre stores an ISO 4217 CODE ("INR"), never a symbol. Names and symbols
 * are derived from the code with the platform's own `Intl` data, so there is no
 * hand-kept name table to drift and no dependency. Only the list of codes the
 * centre may choose from lives here.
 *
 * Pure (no imports), so the browser (the Currency selector), the server (the
 * settings validator) and the tests all use the same module.
 */

export const DEFAULT_CURRENCY = "INR";

// Current ISO 4217 currencies a centre can pick. Withdrawn codes (CUC, HRK,
// SLL, ZWL) and funds / units that are not a country's money (XDR, XSU) are left
// out. Add a code here to offer it; nothing else needs to change.
export const CURRENCY_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF",
  "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC",
  "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS",
  "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD",
  "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
  "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
  "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP",
  "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES",
  "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW",
];

const CODE_SET = new Set(CURRENCY_CODES);

/** True for a currency code the centre may use (case-sensitive: "INR", not "inr"). */
export function isCurrencyCode(value) {
  return typeof value === "string" && CODE_SET.has(value);
}

// Money is grouped the way each currency's home market writes it. The one
// exception the app has always had is the Indian lakh grouping (₹1,00,000.00),
// kept for INR; everything else uses en-US grouping, which is unambiguous.
const CURRENCY_LOCALES = { INR: "en-IN" };
const DEFAULT_LOCALE = "en-US";

const formatters = new Map();

function formatterFor(currency) {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? DEFAULT_LOCALE, {
      style: "currency",
      currency,
    });
    formatters.set(currency, formatter);
  }
  return formatter;
}

/**
 * Formats an amount in a currency: `(2500, "INR")` → "₹2,500.00",
 * `(50, "USD")` → "$50.00", `(200, "AED")` → "AED 200.00". The currency's own
 * decimal places are used (JPY has none). Display only - it never converts an
 * amount between currencies.
 *
 * A missing or unknown code falls back to the default (INR) rather than
 * throwing, so a page can never fail to render over a bad value.
 *
 * @param {number|string|null|undefined} amount
 * @param {string} [currency] - ISO 4217 code.
 */
export function formatCurrency(amount, currency = DEFAULT_CURRENCY) {
  const code = isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY;
  return formatterFor(code).format(Number(amount));
}

const nameFormatter = (() => {
  try {
    return new Intl.DisplayNames("en", { type: "currency" });
  } catch {
    return null;
  }
})();

/** "Indian Rupee" for "INR" (the code itself when the platform has no name). */
export function currencyName(code) {
  return nameFormatter?.of(code) ?? code;
}

/** "₹" for "INR", "$" for "USD"; "" when the currency has no distinct symbol ("AED"). */
export function currencySymbol(code) {
  try {
    const part = new Intl.NumberFormat("en-US", { style: "currency", currency: code })
      .formatToParts(0)
      .find((piece) => piece.type === "currency");
    return part && part.value !== code ? part.value : "";
  } catch {
    return "";
  }
}

// Currency codes whose first two letters are not the country's ISO code.
const FLAG_REGION_OVERRIDES = { EUR: "EU", ANG: null, XAF: null, XOF: null, XCD: null, XPF: null };

/** The flag emoji for a currency's home country ("🇮🇳" for INR), or "" when it has none. */
export function currencyFlag(code) {
  const region = Object.hasOwn(FLAG_REGION_OVERRIDES, code) ? FLAG_REGION_OVERRIDES[code] : code.slice(0, 2);
  if (!region) return "";
  return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/**
 * The label a currency has everywhere it is chosen or shown as a setting:
 * "INR — Indian Rupee (₹)" (the parentheses are left out when there is no symbol).
 */
export function currencyLabel(code) {
  const symbol = currencySymbol(code);
  return `${code} — ${currencyName(code)}${symbol ? ` (${symbol})` : ""}`;
}

/**
 * The currencies as picker options: `{ code, name, symbol, flag, label, search }`,
 * ordered by code. `search` is the lower-cased text a query is matched against
 * (code, name and symbol).
 */
export function listCurrencies() {
  return CURRENCY_CODES.map((code) => {
    const name = currencyName(code);
    const symbol = currencySymbol(code);
    return {
      code,
      name,
      symbol,
      flag: currencyFlag(code),
      label: currencyLabel(code),
      search: `${code} ${name} ${symbol}`.toLowerCase(),
    };
  });
}

/** Filters `listCurrencies()` output by a typed query (code, name or symbol). */
export function searchCurrencies(currencies, query) {
  const term = String(query ?? "").trim().toLowerCase();
  if (!term) return currencies;
  return currencies.filter((currency) => currency.search.includes(term));
}
