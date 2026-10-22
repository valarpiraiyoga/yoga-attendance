// Run with `npm test` (Node's built-in test runner).
//
// Safe diagnostics for privileged account operations: a log line names the step and the SDK's own status / code / message, and never a secret.

import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticLine, sanitizeError } from "./safe-error.js";

const PASSWORD = "Zx9!kQ2#mWv7&Lp4";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.c2lnbmF0dXJlLXZhbHVl";

test("only the SDK's name, status, code and message are kept", () => {
  const error = { name: "AuthApiError", status: 422, code: "weak_password", message: "Password is too weak", __isAuthError: true, request: { password: PASSWORD }, headers: { authorization: `Bearer ${JWT}` } };
  assert.deepEqual(sanitizeError(error), { name: "AuthApiError", status: 422, code: "weak_password", message: "Password is too weak" });
});

test("a known secret in the message is redacted, wherever it appears", () => {
  const { message } = sanitizeError({ message: `password ${PASSWORD} rejected; ${PASSWORD}` }, [PASSWORD]);
  assert.equal(message, "password [redacted] rejected; [redacted]");
  assert.ok(!message.includes(PASSWORD));
});

test("tokens, secret keys and bearer headers are redacted even when no secret was named", () => {
  const raw = `invalid ${JWT} for key sb_secret_AbC123_def and Authorization: Bearer abc.def-ghi`;
  const { message } = sanitizeError({ message: raw });
  assert.ok(!message.includes(JWT) && !message.includes("sb_secret_AbC123_def") && !message.includes("abc.def-ghi"), message);
  assert.match(message, /\[redacted\]/);
});

test("very short 'secrets' are ignored (they would redact ordinary words), and the message is capped", () => {
  assert.equal(sanitizeError({ message: "a is a letter" }, ["a"]).message, "a is a letter");
  assert.ok(sanitizeError({ message: "x".repeat(1000) }).message.length <= 301);
});

test("anything thrown is handled: no error, a string, or an odd object never throws", () => {
  assert.deepEqual(sanitizeError(undefined), { name: null, status: null, code: null, message: "" });
  assert.deepEqual(sanitizeError(null), { name: null, status: null, code: null, message: "" });
  assert.deepEqual(sanitizeError({ status: "500", code: 5 }), { name: null, status: null, code: null, message: "" });
});

test("a diagnostic line is one JSON line naming the operation, step and outcome, with the non-secret ids and the sanitized error", () => {
  const line = diagnosticLine({
    operation: "reset_password",
    step: "update_user",
    outcome: "failed",
    context: { instructorId: "i1", authUserId: "u1" },
    error: { name: "AuthApiError", status: 500, code: "unexpected_failure", message: `boom ${PASSWORD}` },
    secrets: [PASSWORD],
  });
  assert.ok(line.startsWith("[auth-admin] {"));
  assert.ok(!line.includes("\n"));
  const entry = JSON.parse(line.slice("[auth-admin] ".length));
  assert.deepEqual(entry, {
    operation: "reset_password",
    step: "update_user",
    outcome: "failed",
    instructorId: "i1",
    authUserId: "u1",
    error: { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "boom [redacted]" },
  });
  assert.ok(!line.includes(PASSWORD));
});

test("a successful step has no error entry", () => {
  const entry = JSON.parse(diagnosticLine({ operation: "reset_password", step: "read_profile", outcome: "ok", context: { instructorId: "i1" } }).slice("[auth-admin] ".length));
  assert.deepEqual(entry, { operation: "reset_password", step: "read_profile", outcome: "ok", instructorId: "i1" });
});
