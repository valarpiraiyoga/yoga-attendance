// Run with `npm test` (Node's built-in test runner).
//
// Phone country code: a phone is stored as a calling code ("+91") and the
// national digits ("9876543210"), separately. These pin the default, the
// country list/search, code validation and the display format — including the
// legacy rows that have no stored code.

import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, DEFAULT_COUNTRY, countryForDialCode, flagEmoji, searchCountries } from "./phone-countries.js";
import { DEFAULT_COUNTRY_CODE, formatPhone, normalizeCountryCode, resolveCountryCodeForPhone } from "./phone.js";
import { validateStudentInput } from "./students/validation.js";
import { validateInstructorInput } from "./instructors/validation.js";

test("the default country is India, +91", () => {
  assert.equal(DEFAULT_COUNTRY_CODE, "+91");
  assert.equal(DEFAULT_COUNTRY.iso, "IN");
  assert.equal(DEFAULT_COUNTRY.dialCode, "+91");
  assert.equal(COUNTRIES[0].iso, "IN");
});

test("every country has a valid ISO code, a name and a well-formed calling code", () => {
  const seen = new Set();
  for (const country of COUNTRIES) {
    assert.match(country.iso, /^[A-Z]{2}$/);
    assert.ok(country.name.length > 1);
    assert.match(country.dialCode, /^\+[1-9]\d{0,3}$/);
    assert.equal(normalizeCountryCode(country.dialCode).value, country.dialCode);
    assert.ok(!seen.has(country.iso), `duplicate ${country.iso}`);
    seen.add(country.iso);
  }
});

test("flagEmoji builds the flag from the ISO code", () => {
  assert.equal(flagEmoji("IN"), "\u{1F1EE}\u{1F1F3}");
  assert.equal(flagEmoji("us"), "\u{1F1FA}\u{1F1F8}");
});

test("searchCountries matches by name, ISO code and calling code", () => {
  assert.equal(searchCountries("").length, COUNTRIES.length);
  assert.ok(searchCountries("india").some((c) => c.iso === "IN"));
  assert.ok(searchCountries("UNITED").some((c) => c.iso === "GB"));
  assert.ok(searchCountries("+44").some((c) => c.iso === "GB"));
  assert.ok(searchCountries("44").some((c) => c.iso === "GB"));
  assert.ok(searchCountries("0044").some((c) => c.iso === "GB"));
  assert.ok(searchCountries("us").some((c) => c.iso === "US"));
  assert.deepEqual(searchCountries("zzzzzz"), []);
});

test("a shared calling code resolves to its first country; an unknown code to null", () => {
  assert.equal(countryForDialCode("+91").iso, "IN");
  assert.equal(countryForDialCode("+1").iso, "CA");
  assert.equal(countryForDialCode("+999"), null);
});

test("normalizeCountryCode accepts a code with or without '+', and rejects bad shapes", () => {
  assert.deepEqual(normalizeCountryCode("+91"), { value: "+91" });
  assert.deepEqual(normalizeCountryCode("91"), { value: "+91" });
  assert.deepEqual(normalizeCountryCode(" + 44 "), { value: "+44" });
  assert.deepEqual(normalizeCountryCode(""), { value: null });
  assert.deepEqual(normalizeCountryCode(undefined), { value: null });
  for (const bad of ["+", "+0", "+abc", "+12345", "++91", "91-1"]) {
    assert.ok("error" in normalizeCountryCode(bad), bad);
  }
});

test("resolveCountryCodeForPhone defaults to +91 with a number, and is null without one", () => {
  assert.deepEqual(resolveCountryCodeForPhone("+44", "7911123456"), { value: "+44" });
  assert.deepEqual(resolveCountryCodeForPhone("", "9876543210"), { value: "+91" });
  assert.deepEqual(resolveCountryCodeForPhone(null, "9876543210"), { value: "+91" });
  assert.deepEqual(resolveCountryCodeForPhone("+44", ""), { value: null });
  assert.deepEqual(resolveCountryCodeForPhone("+44", null), { value: null });
  assert.ok("error" in resolveCountryCodeForPhone("+0", "9876543210"));
});

test("formatPhone shows the code and groups an Indian 10-digit number 5 + 5", () => {
  assert.equal(formatPhone("9876543210", "+91"), "+91 98765 43210");
  assert.equal(formatPhone("7911123456", "+44"), "+44 7911123456");
  assert.equal(formatPhone("98765432101", "+91"), "+91 98765432101");
});

test("formatPhone shows a legacy number (no stored code) exactly as stored", () => {
  assert.equal(formatPhone("9876543210", null), "9876543210");
  assert.equal(formatPhone("919876543210", undefined), "919876543210");
  assert.equal(formatPhone("9876543210", ""), "9876543210");
});

test("formatPhone shows a dash when there is no number", () => {
  assert.equal(formatPhone("", "+91"), "—");
  assert.equal(formatPhone(null, null), "—");
});

// ---- Validators: the code and the number are validated separately, and the
// number's own rules (required / optional, digits only, length) are unchanged.

test("Student: a valid code and number pass and both are returned", () => {
  const result = validateStudentInput({
    full_name: "Kavish",
    phone: "9876543210",
    phone_country_code: "+91",
    join_date: "2026-09-01",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.phone, "9876543210");
  assert.equal(result.data.phone_country_code, "+91");
});

test("Student: a submission without a code (an older client) falls back to +91", () => {
  const result = validateStudentInput({ full_name: "Kavish", phone: "9876543210", join_date: "2026-09-01" });
  assert.equal(result.success, true);
  assert.equal(result.data.phone_country_code, "+91");
});

test("Student: another country's code is kept", () => {
  const result = validateStudentInput({
    full_name: "Kavish",
    phone: "7911123456",
    phone_country_code: "+44",
    join_date: "2026-09-01",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.phone_country_code, "+44");
});

test("Student: phone is still required, digits only, and length-limited", () => {
  const base = { full_name: "Kavish", phone_country_code: "+91", join_date: "2026-09-01" };
  assert.equal(validateStudentInput({ ...base, phone: "" }).errors.phone, "Phone is required.");
  assert.equal(validateStudentInput({ ...base, phone: "98765 43210" }).errors.phone, "Phone must contain digits only.");
  assert.match(validateStudentInput({ ...base, phone: "1".repeat(31) }).errors.phone, /30 characters or fewer/);
});

test("Student: a malformed country code is its own error, separate from the phone", () => {
  const result = validateStudentInput({
    full_name: "Kavish",
    phone: "9876543210",
    phone_country_code: "+abc",
    join_date: "2026-09-01",
  });
  assert.equal(result.success, false);
  assert.equal(result.errors.phone_country_code, "Choose a valid country code.");
  assert.equal(result.errors.phone, undefined);
});

test("Instructor: phone stays optional; an empty phone stores no code", () => {
  const result = validateInstructorInput({ full_name: "Kannan", phone: "", phone_country_code: "+91" });
  assert.equal(result.success, true);
  assert.equal(result.data.phone, null);
  assert.equal(result.data.phone_country_code, null);
});

test("Instructor: a number keeps its code, defaulting to +91 when none was sent", () => {
  const withCode = validateInstructorInput({ full_name: "Kannan", phone: "7911123456", phone_country_code: "+44" });
  assert.equal(withCode.data.phone, "7911123456");
  assert.equal(withCode.data.phone_country_code, "+44");

  const withoutCode = validateInstructorInput({ full_name: "Kannan", phone: "9876543210" });
  assert.equal(withoutCode.data.phone_country_code, "+91");
});

test("Instructor: digits-only and length rules for the number are unchanged", () => {
  assert.equal(
    validateInstructorInput({ full_name: "Kannan", phone: "98-765" }).errors.phone,
    "Phone must contain digits only."
  );
  assert.match(validateInstructorInput({ full_name: "Kannan", phone: "1".repeat(31) }).errors.phone, /30 characters/);
});

test("Instructor: a malformed country code is rejected on its own", () => {
  const result = validateInstructorInput({ full_name: "Kannan", phone: "9876543210", phone_country_code: "+0" });
  assert.equal(result.success, false);
  assert.equal(result.errors.phone_country_code, "Choose a valid country code.");
});
