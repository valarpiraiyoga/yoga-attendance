// Run with `npm test` (Node's built-in test runner).
//
// The Student form's required-field validation: Full Name, Phone and Join Date are required; a save attempt with any invalid
// field is stopped in the browser with ALL the errors shown at once and the first invalid field focused, using the same
// validator the server runs. The validator is tested directly; the form (which has no browser or component test setup) is
// pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstInvalidStudentField, STUDENT_FIELD_ORDER, validateStudentInput } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const FORM = "../../app/students/student-form.js";

const valid = { full_name: "Kavish", phone: "9876543210", phone_country_code: "+91", join_date: "2026-09-01" };

// ---- the rules (unchanged) ---------------------------------------------------------------------------------------------------

test("an empty Full Name is an error: Full Name is required", () => {
  const result = validateStudentInput({ ...valid, full_name: "" });
  assert.equal(result.success, false);
  assert.equal(result.errors.full_name, "Full name is required.");
  assert.deepEqual(Object.keys(result.errors), ["full_name"]);
  assert.equal(validateStudentInput({ ...valid, full_name: "   " }).errors.full_name, "Full name is required.");
});

test("an empty Join Date is an error: Join Date is required", () => {
  const result = validateStudentInput({ ...valid, join_date: "" });
  assert.equal(result.success, false);
  assert.equal(result.errors.join_date, "Join date is required.");
  assert.deepEqual(Object.keys(result.errors), ["join_date"]);
});

test("an invalid Phone is an error on the phone field - empty, 4-digit Indian and incomplete numbers", () => {
  assert.equal(validateStudentInput({ ...valid, phone: "" }).errors.phone, "Phone is required.");
  assert.equal(validateStudentInput({ ...valid, phone: "1234" }).errors.phone, "This phone number is too short for India (+91).");
  assert.ok(validateStudentInput({ ...valid, phone: "98765" }).errors.phone);
});

test("a valid form is accepted, and the optional fields stay optional", () => {
  const result = validateStudentInput(valid);
  assert.equal(result.success, true);
  assert.equal(result.data.email, null);
  assert.equal(result.data.date_of_birth, null);
  assert.equal(result.data.gender, null);
  assert.equal(result.data.notes, null);
  // Email, date of birth, gender and notes are not required: blank or whitespace never blocks a save.
  const blanks = validateStudentInput({ ...valid, email: "  ", date_of_birth: "", gender: "", notes: "   " });
  assert.equal(blanks.success, true);
});

test("an empty form reports Full Name, Phone and Join Date together, not one at a time", () => {
  const result = validateStudentInput({});
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["full_name", "join_date", "phone"]);
  assert.equal(result.errors.full_name, "Full name is required.");
  assert.equal(result.errors.phone, "Phone is required.");
  assert.equal(result.errors.join_date, "Join date is required.");
});

test("an empty Full Name and Join Date alongside an invalid Phone are all reported", () => {
  const result = validateStudentInput({ full_name: "", phone: "1234", phone_country_code: "+91", join_date: "" });
  assert.deepEqual(Object.keys(result.errors).sort(), ["full_name", "join_date", "phone"]);
  assert.equal(result.errors.phone, "This phone number is too short for India (+91).");
});

// ---- which field is focused first -----------------------------------------------------------------------------------------

test("the first invalid field is the topmost one on the form; a country-code error belongs to the phone field", () => {
  assert.equal(firstInvalidStudentField(validateStudentInput({}).errors), "full_name");
  assert.equal(firstInvalidStudentField(validateStudentInput({ ...valid, full_name: "", join_date: "" }).errors), "full_name");
  assert.equal(firstInvalidStudentField(validateStudentInput({ ...valid, phone: "1234", join_date: "" }).errors), "phone");
  assert.equal(firstInvalidStudentField(validateStudentInput({ ...valid, join_date: "" }).errors), "join_date");
  assert.equal(firstInvalidStudentField(validateStudentInput({ ...valid, email: "nope", join_date: "" }).errors), "email");
  assert.equal(firstInvalidStudentField({ phone_country_code: "Choose a valid country code.", join_date: "x" }), "phone");
  assert.equal(firstInvalidStudentField(validateStudentInput(valid).errors), null);
  assert.equal(firstInvalidStudentField(undefined), null);
});

test("the field order is the order of the inputs on the form, and each name is the id of its input", () => {
  const form = source(FORM);
  const positions = STUDENT_FIELD_ORDER.map((field) => form.indexOf(`id="${field}"`));
  assert.ok(positions.every((at) => at > 0), `an input is missing its id: ${positions}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the ids appear on the form in STUDENT_FIELD_ORDER");
});

// ---- the form ---------------------------------------------------------------------------------------------------------------

test("a save attempt with ANY invalid field is stopped in the browser, with every error shown and the first field focused", () => {
  const form = code(FORM);
  assert.match(form, /<form ref=\{formRef\} action=\{submitForm\} onSubmit=\{handleSubmit\} onBlur=\{handleBlur\}/);
  const handler = form.slice(form.indexOf("function handleSubmit"), form.indexOf("function handleBlur"));
  // The same validator the server runs, over the whole form - not only the phone.
  assert.match(handler, /const result = validateStudentInput\(studentInputOf\(new FormData\(event\.currentTarget\)\)\);/);
  assert.match(handler, /if \(result\.success\) return;/);
  assert.match(handler, /event\.preventDefault\(\);/);
  // Every error is shown (replacing the validated fields' old errors, keeping e.g. the photo's) ...
  assert.match(handler, /for \(const key of \[\.\.\.STUDENT_FIELD_ORDER, "phone_country_code"\]\) delete next\[key\];/);
  assert.match(handler, /return \{ \.\.\.next, \.\.\.result\.errors \};/);
  // ... and the first invalid field is focused.
  assert.match(handler, /querySelector\(`#\$\{firstInvalidStudentField\(result\.errors\)\}`\)\?\.focus\(\);/);
  assert.ok(handler.indexOf("if (result.success) return;") < handler.indexOf("event.preventDefault()"));
});

test("a blocked submit keeps what was typed: nothing runs the form action or resets or rewrites a value", () => {
  const form = code(FORM);
  const handler = form.slice(form.indexOf("function handleSubmit"), form.indexOf("function handleBlur"));
  assert.doesNotMatch(handler, /formAction|submitForm|reset\(|setValues|\.value\s*=|new FormData\(\)/);
  // React runs the form action only for a submit that was not prevented (the other half of this guarantee).
  const reactDom = readFileSync(new URL("../../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  assert.match(reactDom.slice(reactDom.indexOf("if (nativeEvent.defaultPrevented)")), /^[\s\S]{0,1600}\} else\s*"function" === typeof action/);
});

test("the Full Name and Join Date errors are shown with the form's existing error styling and are linked to their inputs", () => {
  const form = code(FORM);
  for (const field of ["full_name", "join_date"]) {
    assert.match(form, new RegExp(`aria-invalid=\\{Boolean\\(fieldErrors\\.${field}\\)\\}`));
    assert.match(form, new RegExp(`aria-describedby=\\{fieldErrors\\.${field} \\? "${field}-error" : undefined\\}`));
    assert.match(form, new RegExp(`<p id="${field}-error" role="alert" className="text-small text-danger">\\s*\\{fieldErrors\\.${field}\\}`));
  }
});

test("the phone checks are kept: blur, country change, and the stored values unchanged", () => {
  const form = code(FORM);
  assert.match(form, /if \(name === "phone"\) \{\s*recheckPhone\(formData\);\s*return;\s*\}/);
  assert.match(form, /onCountryChange=\{handleCountryChange\}/);
  assert.match(form, /formData\.set\("phone_country_code", dialCode\);\s*recheckPhone\(formData\);/);
  // Rechecking the phone shows only the phone field's errors, and never touches the other fields' errors.
  assert.match(form, /showPhoneErrors\(phoneErrorsOf\(result\.errors\)\);/);
  // The saved data is the same two phone fields as ever.
  assert.equal(validateStudentInput(valid).data.phone, "9876543210");
  assert.equal(validateStudentInput(valid).data.phone_country_code, "+91");
});

test("the server action still validates everything itself, and reports the same errors", () => {
  const actions = code("./actions.js");
  assert.equal((actions.match(/validateStudentInput\(\{/g) ?? []).length, 2, "create and update");
  assert.match(actions, /fieldErrors: \{ \.\.\.\(result\.success \? null : result\.errors\)/);
});
