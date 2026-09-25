// Run with `npm test` (Node's built-in test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { MIN_PASSWORD_LENGTH, PASSWORD_MESSAGES, validatePasswordChange } from "./password-rules.js";

const ok = { currentPassword: "old-password", newPassword: "new-password-1", confirmPassword: "new-password-1" };

test("the established rule is kept: 8 characters, the same number the reset-password page has always required", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(PASSWORD_MESSAGES.newTooShort, "Password must be at least 8 characters.");
});

test("a complete, matching submission is valid", () => {
  assert.deepEqual(validatePasswordChange(ok), { valid: true, fieldErrors: {} });
});

test("every field is required, each with its own message", () => {
  const empty = validatePasswordChange({});
  assert.equal(empty.valid, false);
  assert.deepEqual(empty.fieldErrors, {
    currentPassword: PASSWORD_MESSAGES.currentRequired,
    newPassword: PASSWORD_MESSAGES.newRequired,
    confirmPassword: PASSWORD_MESSAGES.confirmRequired,
  });

  assert.deepEqual(Object.keys(validatePasswordChange({ ...ok, currentPassword: "" }).fieldErrors), ["currentPassword"]);
  assert.deepEqual(Object.keys(validatePasswordChange({ ...ok, confirmPassword: "" }).fieldErrors), ["confirmPassword"]);
});

test("the new password must be at least 8 characters (7 fails, 8 passes)", () => {
  const seven = "abcdefg";
  const eight = "abcdefgh";
  assert.equal(validatePasswordChange({ ...ok, newPassword: seven, confirmPassword: seven }).fieldErrors.newPassword, PASSWORD_MESSAGES.newTooShort);
  assert.equal(validatePasswordChange({ ...ok, newPassword: eight, confirmPassword: eight }).valid, true);
});

test("the two new entries must match, and the mismatch is reported on the confirmation field", () => {
  const result = validatePasswordChange({ ...ok, confirmPassword: "something-else" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.fieldErrors, { confirmPassword: PASSWORD_MESSAGES.mismatch });
});

test("a too-short new password does not also report a confusing mismatch", () => {
  const result = validatePasswordChange({ ...ok, newPassword: "short", confirmPassword: "short" });
  assert.deepEqual(Object.keys(result.fieldErrors), ["newPassword"]);
});

test("passwords are compared exactly: nothing is trimmed, case matters", () => {
  assert.equal(validatePasswordChange({ ...ok, newPassword: "  spaces-ok  ", confirmPassword: "  spaces-ok  " }).valid, true);
  assert.equal(validatePasswordChange({ ...ok, newPassword: "Password-1", confirmPassword: "password-1" }).valid, false);
});
