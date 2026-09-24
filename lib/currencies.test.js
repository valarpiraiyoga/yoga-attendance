// Run with `npm test` (Node's built-in test runner).
//
// The centre's currency is an ISO 4217 code; symbols and names are derived, and
// `formatCurrency` is the one way amounts are shown. It formats - it never
// converts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  currencyFlag,
  currencyLabel,
  currencyName,
  currencySymbol,
  formatCurrency,
  isCurrencyCode,
  listCurrencies,
  searchCurrencies,
} from "./currencies.js";

test("the default currency is INR", () => {
  assert.equal(DEFAULT_CURRENCY, "INR");
  assert.ok(isCurrencyCode(DEFAULT_CURRENCY));
});

test("ISO 4217 codes are valid", () => {
  for (const code of ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "CHF"]) {
    assert.equal(isCurrencyCode(code), true, code);
  }
});

test("symbols, lower case, names, withdrawn codes and non-strings are rejected", () => {
  for (const bad of ["₹", "$", "inr", "Rs", "Rupee", "US", "USDD", "HRK", "XXX", "", null, undefined, 3]) {
    assert.equal(isCurrencyCode(bad), false, String(bad));
  }
});

test("every offered code is one the platform can format", () => {
  assert.ok(CURRENCY_CODES.length > 100, "a worldwide list, not an India-only one");
  assert.equal(new Set(CURRENCY_CODES).size, CURRENCY_CODES.length, "no duplicates");
  for (const code of CURRENCY_CODES) {
    assert.doesNotThrow(() => new Intl.NumberFormat("en", { style: "currency", currency: code }), code);
  }
});

test("formatCurrency shows each currency the way its own amounts are written", () => {
  assert.equal(formatCurrency(2500, "INR"), "₹2,500.00");
  assert.equal(formatCurrency(50, "USD"), "$50.00");
  assert.equal(formatCurrency(45, "EUR"), "€45.00");
  assert.equal(formatCurrency(40, "GBP"), "£40.00");
  // Intl puts a no-break space between a code-style symbol and the number.
  assert.equal(formatCurrency(200, "AED"), "AED 200.00");
  assert.equal(formatCurrency(1234.5, "USD"), "$1,234.50");
});

test("INR keeps the Indian lakh grouping the app has always used", () => {
  assert.equal(formatCurrency(100000, "INR"), "₹1,00,000.00");
  assert.equal(formatCurrency(1000, "INR"), "₹1,000.00");
});

test("a currency without decimals is shown without them", () => {
  assert.equal(formatCurrency(5000, "JPY"), "¥5,000");
});

test("amounts arrive as numbers or numeric strings (the database returns numeric as either)", () => {
  assert.equal(formatCurrency("2500.00", "INR"), "₹2,500.00");
  assert.equal(formatCurrency("50", "USD"), "$50.00");
});

test("no currency, or an unknown one, falls back to INR instead of throwing", () => {
  assert.equal(formatCurrency(100), "₹100.00");
  assert.equal(formatCurrency(100, null), "₹100.00");
  assert.equal(formatCurrency(100, "ZZZ"), "₹100.00");
});

test("formatCurrency only formats: the same number is not converted", () => {
  // 2500 rupees is not turned into dollars - it is labelled with the given code.
  assert.equal(formatCurrency(2500, "USD"), "$2,500.00");
  assert.equal(formatCurrency(2500, "EUR"), "€2,500.00");
});

test("names, symbols and the label are derived from the code", () => {
  assert.equal(currencyName("INR"), "Indian Rupee");
  assert.equal(currencySymbol("INR"), "₹");
  assert.equal(currencySymbol("USD"), "$");
  assert.equal(currencySymbol("EUR"), "€");
  assert.equal(currencySymbol("AED"), "", "a currency with no distinct symbol has none");
  assert.equal(currencyLabel("INR"), "INR — Indian Rupee (₹)");
  assert.equal(currencyLabel("USD"), "USD — US Dollar ($)");
  assert.match(currencyLabel("AED"), /^AED — .*Dirham$/);
});

test("the flag is the currency's home country (none for shared currencies)", () => {
  assert.equal(currencyFlag("INR"), "\u{1F1EE}\u{1F1F3}");
  assert.equal(currencyFlag("EUR"), "\u{1F1EA}\u{1F1FA}");
  assert.equal(currencyFlag("XOF"), "");
});

test("search matches the code, the name or the symbol", () => {
  const all = listCurrencies();
  const codes = (query) => searchCurrencies(all, query).map((currency) => currency.code);

  assert.deepEqual(codes("inr"), ["INR"]);
  assert.ok(codes("rupee").includes("INR"));
  assert.ok(codes("dirham").includes("AED"));
  assert.ok(codes("€").includes("EUR"));
  assert.ok(codes("pound").includes("GBP"));
  assert.deepEqual(codes("zzzzzz"), []);
  assert.equal(searchCurrencies(all, "  ").length, all.length);
});
