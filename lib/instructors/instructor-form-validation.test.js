// Run with `npm test` (Node's built-in test runner).
//
// The Instructor form's validation: Full Name is required, Phone is optional but must be a real number for its country when
// given, and a save attempt with any invalid field is stopped in the browser with ALL the errors shown at once and the first
// invalid field focused, using the same validator the server runs. The validator is tested directly; the form (which has no
// browser or component test setup) is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstInvalidInstructorField, INSTRUCTOR_FIELD_ORDER, validateInstructorInput } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const FORM = "../../app/settings/instructors/instructor-form.js";

const valid = { full_name: "Kannan", phone: "9876543210", phone_country_code: "+91" };

// ---- the rules (unchanged) ---------------------------------------------------------------------------------------------------

test("an empty Full Name is an error: Full Name is required", () => {
  const result = validateInstructorInput({ ...valid, full_name: "" });
  assert.equal(result.success, false);
  assert.equal(result.errors.full_name, "Full name is required.");
  assert.deepEqual(Object.keys(result.errors), ["full_name"]);
  assert.equal(validateInstructorInput({ ...valid, full_name: "   " }).errors.full_name, "Full name is required.");
});

test("a blank Phone stays valid, with or without a country code, and stores no phone or code", () => {
  for (const phone of ["", "   ", undefined, null]) {
    const result = validateInstructorInput({ full_name: "Kannan", phone, phone_country_code: "+91" });
    assert.equal(result.success, true, String(phone));
    assert.equal(result.data.phone, null);
    assert.equal(result.data.phone_country_code, null);
  }
  assert.equal(validateInstructorInput({ full_name: "Kannan" }).success, true);
});

test("a Phone that is given is validated for its country: a 4-digit Indian and an incomplete number are errors", () => {
  assert.equal(validateInstructorInput({ ...valid, phone: "1234" }).errors.phone, "This phone number is too short for India (+91).");
  assert.ok(validateInstructorInput({ ...valid, phone: "98765432" }).errors.phone);
  assert.equal(validateInstructorInput({ ...valid, phone: "98765 43210" }).errors.phone, "Phone must contain digits only.");
});

test("an empty Full Name and an invalid Phone are both reported together", () => {
  const result = validateInstructorInput({ full_name: "", phone: "1234", phone_country_code: "+91" });
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["full_name", "phone"]);
  assert.equal(result.errors.full_name, "Full name is required.");
  assert.equal(result.errors.phone, "This phone number is too short for India (+91).");
});

test("an empty Full Name, a bad Email and an invalid Phone are all reported together", () => {
  const result = validateInstructorInput({ full_name: "", email: "nope", phone: "1234", phone_country_code: "+91" });
  assert.deepEqual(Object.keys(result.errors).sort(), ["email", "full_name", "phone"]);
});

test("a valid form is accepted: with a phone, and with only a name", () => {
  const withPhone = validateInstructorInput(valid);
  assert.equal(withPhone.success, true);
  assert.equal(withPhone.data.phone, "9876543210");
  assert.equal(withPhone.data.phone_country_code, "+91");

  const nameOnly = validateInstructorInput({ full_name: "Kannan" });
  assert.equal(nameOnly.success, true);
  assert.equal(nameOnly.data.email, null);
});

// ---- which field is focused first -----------------------------------------------------------------------------------------

test("the first invalid field is the topmost one on the form; a country-code error belongs to the phone field", () => {
  assert.equal(firstInvalidInstructorField(validateInstructorInput({ full_name: "", phone: "1234" }).errors), "full_name");
  assert.equal(firstInvalidInstructorField(validateInstructorInput({ ...valid, phone: "1234" }).errors), "phone");
  assert.equal(firstInvalidInstructorField(validateInstructorInput({ ...valid, phone: "1234", email: "nope" }).errors), "phone");
  assert.equal(firstInvalidInstructorField(validateInstructorInput({ ...valid, email: "nope" }).errors), "email");
  assert.equal(firstInvalidInstructorField({ phone_country_code: "Choose a valid country code.", email: "x" }), "phone");
  assert.equal(firstInvalidInstructorField(validateInstructorInput(valid).errors), null);
  assert.equal(firstInvalidInstructorField(undefined), null);
});

test("the field order is the order of the inputs on the form, and each name is the id of its input", () => {
  const form = source(FORM);
  const positions = INSTRUCTOR_FIELD_ORDER.map((field) => form.indexOf(`id="${field}"`));
  assert.ok(positions.every((at) => at > 0), `an input is missing its id: ${positions}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the ids appear on the form in INSTRUCTOR_FIELD_ORDER");
});

// ---- the form ---------------------------------------------------------------------------------------------------------------

test("a save attempt with ANY invalid field is stopped in the browser, with every error shown and the first field focused", () => {
  const form = code(FORM);
  assert.match(form, /<form ref=\{formRef\} action=\{submitForm\} onSubmit=\{handleSubmit\} onBlur=\{handleBlur\}/);
  const handler = form.slice(form.indexOf("function handleSubmit"), form.indexOf("function handleBlur"));
  // The same validator the server runs, over the whole form - not only the phone.
  assert.match(handler, /const result = validateInstructorInput\(instructorInputOf\(new FormData\(event\.currentTarget\)\)\);/);
  assert.match(handler, /if \(result\.success\) return;/);
  assert.match(handler, /event\.preventDefault\(\);/);
  // Every error is shown, replacing the validated fields' old errors ...
  assert.match(handler, /for \(const key of \[\.\.\.INSTRUCTOR_FIELD_ORDER, "phone_country_code"\]\) delete next\[key\];/);
  assert.match(handler, /return \{ \.\.\.next, \.\.\.result\.errors \};/);
  // ... and the first invalid field is focused.
  assert.match(handler, /querySelector\(`#\$\{firstInvalidInstructorField\(result\.errors\)\}`\)\?\.focus\(\);/);
  assert.ok(handler.indexOf("if (result.success) return;") < handler.indexOf("event.preventDefault()"));
});

test("a blocked submit keeps what was typed and the photo's error: nothing runs the action or resets a value", () => {
  const form = code(FORM);
  const handler = form.slice(form.indexOf("function handleSubmit"), form.indexOf("function handleBlur"));
  assert.doesNotMatch(handler, /formAction|submitForm|reset\(|setValues|\.value\s*=|new FormData\(\)/);
  // Only the validator's fields are replaced; a photo error from the server (key `photo`) is kept.
  assert.doesNotMatch(handler, /photo/);
  assert.equal(INSTRUCTOR_FIELD_ORDER.includes("photo"), false);
  // React runs the form action only for a submit that was not prevented (the other half of this guarantee).
  const reactDom = readFileSync(new URL("../../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  assert.match(reactDom.slice(reactDom.indexOf("if (nativeEvent.defaultPrevented)")), /^[\s\S]{0,1600}\} else\s*"function" === typeof action/);
});

test("the Full Name error is shown with the form's existing error styling and is linked to its input", () => {
  const form = code(FORM);
  assert.match(form, /aria-invalid=\{Boolean\(fieldErrors\.full_name\)\}/);
  assert.match(form, /aria-describedby=\{fieldErrors\.full_name \? "full_name-error" : undefined\}/);
  assert.match(form, /<p id="full_name-error" role="alert" className="text-small text-danger">\s*\{fieldErrors\.full_name\}/);
});

test("the phone checks and the optional phone are kept: blur, country change, and no `required` on the input", () => {
  const form = code(FORM);
  assert.match(form, /if \(name === "phone"\) \{\s*recheckPhone\(formData\);\s*return;\s*\}/);
  assert.match(form, /onCountryChange=\{handleCountryChange\}/);
  assert.match(form, /formData\.set\("phone_country_code", dialCode\);\s*recheckPhone\(formData\);/);
  assert.match(form, /showPhoneErrors\(phoneErrorsOf\(result\.errors\)\);/);
  assert.doesNotMatch(form.match(/<PhoneInput[\s\S]*?\/>/)[0], /\brequired\b/);
});

test("the server action still validates everything itself and keeps reporting the photo's error", () => {
  const actions = code("./actions.js");
  assert.equal((actions.match(/validateInstructorInput\(\{/g) ?? []).length >= 2, true, "create and update");
  assert.match(actions, /fieldErrors: \{ \.\.\.\(result\.success \? null : result\.errors\), \.\.\.\(photo\.error \? \{ photo: photo\.error \} : null\) \}/);
});
