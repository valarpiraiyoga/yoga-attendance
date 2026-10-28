// Run with `npm test` (Node's built-in test runner).
//
// Phone country code: a phone is stored as a calling code ("+91") and the
// national digits ("9876543210"), separately. These pin the default, the
// country list/search, code validation and the display format — including the
// legacy rows that have no stored code.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePhoneNumberLength } from "libphonenumber-js/min";
import { COUNTRIES, DEFAULT_COUNTRY, countryForDialCode, flagEmoji, searchCountries } from "./phone-countries.js";
import {
  DEFAULT_COUNTRY_CODE,
  formatPhone,
  normalizeCountryCode,
  PHONE_ERROR_KEYS,
  phoneErrorsOf,
  resolveCountryCodeForPhone,
  validatePhoneForCountry,
} from "./phone.js";
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

// ---- the number is judged against its selected country (libphonenumber-js, `min` metadata) ----------------------------------
// The calling code and the national digits are checked together; the country itself is never stored. These use the shared
// check directly, then both server-side validators that call it, then the form wiring.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const studentBase = { full_name: "Kavish", join_date: "2026-09-01" };

test("validatePhoneForCountry: a valid Indian mobile number is accepted", () => {
  assert.deepEqual(validatePhoneForCountry("+91", "9876543210"), { valid: true });
});

test("validatePhoneForCountry: an Indian number of only 4 digits is rejected, as too short, naming the country", () => {
  const result = validatePhoneForCountry("+91", "1234");
  assert.equal(result.valid, false);
  assert.equal(result.error, "This phone number is too short for India (+91).");
});

test("validatePhoneForCountry: incomplete, over-long and mis-shaped numbers are rejected", () => {
  for (const digits of ["98765", "987654321", "98765432101", "0987654321"]) {
    assert.equal(validatePhoneForCountry("+91", digits).valid, false, digits);
  }
  assert.equal(validatePhoneForCountry("+91", "987654321").error, "Enter a valid phone number for India (+91).");
  assert.equal(validatePhoneForCountry("+44", "79111").error, "This phone number is too short for United Kingdom (+44).");
});

test("validatePhoneForCountry: valid UK, Australian, US, Singapore and UAE numbers are accepted", () => {
  const valid = [["+44", "7911123456"], ["+61", "412345678"], ["+1", "6502530000"], ["+65", "91234567"], ["+971", "501234567"]];
  for (const [callingCode, digits] of valid) {
    assert.deepEqual(validatePhoneForCountry(callingCode, digits), { valid: true }, `${callingCode} ${digits}`);
  }
});

test("validatePhoneForCountry: the same digits are judged by the selected country", () => {
  // A valid Indian mobile is not a US number (987 is not an area code); an Australian mobile is too short for India.
  assert.equal(validatePhoneForCountry("+91", "9876543210").valid, true);
  assert.equal(validatePhoneForCountry("+1", "9876543210").valid, false);
  assert.equal(validatePhoneForCountry("+61", "412345678").valid, true);
  assert.equal(validatePhoneForCountry("+91", "412345678").valid, false);
});

test("validatePhoneForCountry: a code shared by several countries is named by its code alone", () => {
  const result = validatePhoneForCountry("+1", "123");
  assert.equal(result.error, "This phone number is too short for +1.");
  assert.doesNotMatch(result.error, /United States/);
  // ... and a number valid in another country that shares the code is accepted (Canada, +1).
  assert.equal(validatePhoneForCountry("+1", "4165550123").valid, true);
});

test("validatePhoneForCountry: a national trunk '0' is accepted and nothing is rewritten", () => {
  assert.equal(validatePhoneForCountry("+44", "07911123456").valid, true);
  assert.equal(validatePhoneForCountry("+91", "09876543210").valid, true);
});

test("validatePhoneForCountry: no code means +91, and what it does not judge it reports as valid", () => {
  assert.equal(validatePhoneForCountry(undefined, "1234").valid, false);
  assert.equal(validatePhoneForCountry(null, "9876543210").valid, true);
  assert.equal(validatePhoneForCountry("+91", "").valid, true, "empty: the caller decides whether a phone is required");
  assert.equal(validatePhoneForCountry("+91", "98 76").valid, true, "not digits: the caller reports that");
  assert.equal(validatePhoneForCountry("+999", "12345").valid, true, "a calling code the picker does not offer is not judged");
});

test("every country in the picker has a calling code the library knows, so none is silently unjudgeable", () => {
  for (const country of COUNTRIES) {
    assert.notEqual(validatePhoneNumberLength(`${country.dialCode}1`), "INVALID_COUNTRY", `${country.name} ${country.dialCode}`);
    // A 1-digit number is never complete in any of them.
    assert.equal(validatePhoneForCountry(country.dialCode, "1").valid, false, country.name);
  }
});

test("phoneErrorsOf keeps only the phone field's own errors", () => {
  assert.deepEqual(PHONE_ERROR_KEYS, ["phone", "phone_country_code"]);
  assert.deepEqual(phoneErrorsOf({ full_name: "Full name is required.", phone: "Bad.", email: "Bad." }), { phone: "Bad." });
  assert.deepEqual(phoneErrorsOf({ phone_country_code: "Choose a valid country code." }), { phone_country_code: "Choose a valid country code." });
  assert.deepEqual(phoneErrorsOf({ full_name: "x" }), {});
  assert.deepEqual(phoneErrorsOf(undefined), {});
});

// ---- Student (server-side validation path) --------------------------------------------------------------------------------

test("Student: a valid Indian mobile is accepted and stored exactly as before", () => {
  const result = validateStudentInput({ ...studentBase, phone: "9876543210", phone_country_code: "+91" });
  assert.equal(result.success, true);
  assert.equal(result.data.phone, "9876543210");
  assert.equal(result.data.phone_country_code, "+91");
});

test("Student: a 4-digit Indian number is rejected on the phone field, and the data is not returned", () => {
  const result = validateStudentInput({ ...studentBase, phone: "1234", phone_country_code: "+91" });
  assert.equal(result.success, false);
  assert.equal(result.errors.phone, "This phone number is too short for India (+91).");
  assert.equal("phone_country_code" in result.errors, false);
});

test("Student: an incomplete or invalid number is rejected for every country, and a valid UK, Australian and US one passes", () => {
  for (const [callingCode, digits] of [["+91", "98765"], ["+44", "79111"], ["+61", "4123"], ["+1", "650253"]]) {
    const result = validateStudentInput({ ...studentBase, phone: digits, phone_country_code: callingCode });
    assert.equal(result.success, false, `${callingCode} ${digits}`);
    assert.ok(result.errors.phone, `${callingCode} ${digits}`);
  }
  for (const [callingCode, digits] of [["+44", "7911123456"], ["+61", "412345678"], ["+1", "6502530000"]]) {
    const result = validateStudentInput({ ...studentBase, phone: digits, phone_country_code: callingCode });
    assert.equal(result.success, true, `${callingCode} ${digits}`);
    assert.equal(result.data.phone_country_code, callingCode);
  }
});

test("Student: changing the country changes the verdict on the same digits", () => {
  const as = (callingCode) => validateStudentInput({ ...studentBase, phone: "412345678", phone_country_code: callingCode });
  assert.equal(as("+61").success, true);
  assert.equal(as("+91").success, false);
  assert.equal(as("+61").success, true);
});

test("Student: a submission without a code is judged as +91, like the stored default", () => {
  assert.equal(validateStudentInput({ ...studentBase, phone: "1234" }).success, false);
  assert.equal(validateStudentInput({ ...studentBase, phone: "9876543210" }).success, true);
});

test("Student: the digits-only and length messages are not doubled by the country check", () => {
  const base = { ...studentBase, phone_country_code: "+91" };
  assert.equal(validateStudentInput({ ...base, phone: "" }).errors.phone, "Phone is required.");
  assert.equal(validateStudentInput({ ...base, phone: "98765 43210" }).errors.phone, "Phone must contain digits only.");
  assert.match(validateStudentInput({ ...base, phone: "1".repeat(31) }).errors.phone, /30 characters or fewer/);
});

test("Student: a malformed code stays its own error, and the number is not also judged against it", () => {
  const result = validateStudentInput({ ...studentBase, phone: "1234", phone_country_code: "+0" });
  assert.equal(result.errors.phone_country_code, "Choose a valid country code.");
  assert.equal("phone" in result.errors, false);
});

test("Student: a legacy calling code the picker does not offer keeps working as before", () => {
  const result = validateStudentInput({ ...studentBase, phone: "12345", phone_country_code: "+999" });
  assert.equal(result.success, true);
  assert.equal(result.data.phone_country_code, "+999");
});

// ---- Instructor (server-side validation path) -----------------------------------------------------------------------------

test("Instructor: a blank phone stays valid and stores no code", () => {
  const result = validateInstructorInput({ full_name: "Kannan", phone: "", phone_country_code: "+91" });
  assert.equal(result.success, true);
  assert.equal(result.data.phone, null);
  assert.equal(result.data.phone_country_code, null);
});

test("Instructor: a valid number is accepted; a 4-digit Indian or an incomplete number is rejected on the phone field", () => {
  const ok = validateInstructorInput({ full_name: "Kannan", phone: "9876543210", phone_country_code: "+91" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.phone_country_code, "+91");

  const short = validateInstructorInput({ full_name: "Kannan", phone: "1234", phone_country_code: "+91" });
  assert.equal(short.success, false);
  assert.equal(short.errors.phone, "This phone number is too short for India (+91).");

  const incomplete = validateInstructorInput({ full_name: "Kannan", phone: "98765432", phone_country_code: "+91" });
  assert.equal(incomplete.success, false);
  assert.ok(incomplete.errors.phone);
});

test("Instructor: valid UK, Australian and US numbers pass, and the verdict follows the selected country", () => {
  for (const [callingCode, digits] of [["+44", "7911123456"], ["+61", "412345678"], ["+1", "6502530000"]]) {
    assert.equal(validateInstructorInput({ full_name: "Kannan", phone: digits, phone_country_code: callingCode }).success, true, callingCode);
  }
  assert.equal(validateInstructorInput({ full_name: "Kannan", phone: "412345678", phone_country_code: "+91" }).success, false);
});

test("Instructor: digits-only and length messages come first, and a legacy code is not judged", () => {
  assert.equal(validateInstructorInput({ full_name: "Kannan", phone: "98765 43210", phone_country_code: "+91" }).errors.phone, "Phone must contain digits only.");
  assert.match(validateInstructorInput({ full_name: "Kannan", phone: "1".repeat(31), phone_country_code: "+91" }).errors.phone, /30 characters or fewer/);
  assert.equal(validateInstructorInput({ full_name: "Kannan", phone: "12345", phone_country_code: "+999" }).success, true);
});

test("the server actions use the same validators, so the form's check cannot be the only one", () => {
  assert.match(code("./students/actions.js"), /validateStudentInput\(\{/);
  assert.match(code("./instructors/actions.js"), /validateInstructorInput\(\{/);
  assert.equal((code("./students/actions.js").match(/validateStudentInput\(\{/g) ?? []).length, 2, "create and update");
});

// ---- the forms (wiring; there is no browser or component test setup) -------------------------------------------------------

for (const [label, path, validate, input] of [
  ["Student", "../app/students/student-form.js", "validateStudentInput", "studentInputOf"],
  ["Instructor", "../app/settings/instructors/instructor-form.js", "validateInstructorInput", "instructorInputOf"],
]) {
  test(`${label} form: the phone is rechecked on blur, on a country change, and before submit - with the shared validator`, () => {
    const form = code(path);
    // Blur: the phone number is judged (not only cleared).
    assert.match(form, /if \(name === "phone"\) \{\s*recheckPhone\(formData\);\s*return;\s*\}/);
    // Country change: the picker hands over the new code, which replaces the hidden input's stale one.
    assert.match(form, /onCountryChange=\{handleCountryChange\}/);
    assert.match(form, /formData\.set\("phone_country_code", dialCode\);\s*recheckPhone\(formData\);/);
    assert.match(form, new RegExp(`${validate}\\(${input}\\(new FormData\\(event\\.currentTarget\\)\\)\\)`));
    // Both rechecks use the one validator the server runs, and show only the phone field's errors.
    assert.match(form, /phoneErrorsOf\(result\.errors\)/);
    assert.match(form, /import \{ PHONE_ERROR_KEYS, phoneErrorsOf \} from "@\/lib\/phone";/);
  });
}

test("Student form: phone stays required and the Instructor form keeps its phone optional", () => {
  assert.match(code("../app/students/student-form.js"), /<PhoneInput[\s\S]*?\brequired\b[\s\S]*?onCountryChange/);
  assert.doesNotMatch(code("../app/settings/instructors/instructor-form.js").match(/<PhoneInput[\s\S]*?\/>/)[0], /\brequired\b/);
});

test("PhoneInput reports the chosen country, with its code, before the hidden input has re-rendered", () => {
  const input = code("../components/forms/PhoneInput.js");
  const choose = input.slice(input.indexOf("function choose"), input.indexOf("function handleOpenChange"));
  assert.match(choose, /setCountry\(next\);\s*onCountryChange\?\.\(next\.dialCode\);/);
  // It is a callback only: it is not spread onto the DOM input, and PhoneInput itself validates nothing.
  assert.match(input, /\n {2}onCountryChange,\n/);
  assert.doesNotMatch(input, /validatePhoneForCountry|libphonenumber/);
  // The submitted values are unchanged: the number and the calling code, as two fields.
  assert.match(input, /name=\{countryCodeName\} value=\{country\.dialCode\}/);
});

test("the installed react-dom still skips a form action for a prevented submit (what the forms rely on)", () => {
  // The forms cancel the action by calling preventDefault in onSubmit. react-dom's form-action plugin runs the action only in
  // the branch where `nativeEvent.defaultPrevented` is false; if a React upgrade changes this, recheck the forms by hand.
  const reactDom = readFileSync(new URL("../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  const at = reactDom.indexOf("if (nativeEvent.defaultPrevented)");
  assert.ok(at > 0, "react-dom no longer checks defaultPrevented before running a form action");
  const branch = reactDom.slice(at, at + 1600);
  assert.match(branch, /\} else\s*"function" === typeof action/);
});

test("the dependency is the approved one: libphonenumber-js, imported from its `min` build only", () => {
  const manifest = JSON.parse(source("../package.json"));
  assert.match(manifest.dependencies["libphonenumber-js"], /^\^1\./);
  assert.match(code("./phone.js"), /from "libphonenumber-js\/min";/);
  assert.doesNotMatch(code("./phone.js"), /libphonenumber-js\/(max|mobile)|from "libphonenumber-js";/);
});
