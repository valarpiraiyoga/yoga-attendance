// Run with `npm test` (Node's built-in test runner).
//
// changeOwnPassword drives Supabase Auth through an injected client, so the whole flow - validation, the
// current-password check, the update, and every failure - is tested here with a fake one. What this cannot
// prove is real Supabase behaviour; that needs a live account (see the report).

import test from "node:test";
import assert from "node:assert/strict";
import { changeOwnPassword, CHANGE_PASSWORD_MESSAGES } from "./change-password.js";
import { PASSWORD_MESSAGES } from "./password-rules.js";

const USER = { id: "user-1", email: "admin@example.com" };
const GOOD = { currentPassword: "current-pass-1", newPassword: "brand-new-pass", confirmPassword: "brand-new-pass" };

/** A fake Supabase client that records every Auth call and answers as configured. */
function fakeSupabase({ verify, update } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      async signInWithPassword(args) {
        calls.push({ method: "signInWithPassword", args });
        return verify ?? { data: { user: { id: USER.id } }, error: null };
      },
      async updateUser(args) {
        calls.push({ method: "updateUser", args });
        return update ?? { data: { user: { id: USER.id } }, error: null };
      },
    },
  };
}

/** Runs the flow while capturing console.error, so tests can check nothing sensitive is logged. */
async function run(overrides, supabase = fakeSupabase()) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    const result = await changeOwnPassword({ supabase, user: USER, ...GOOD, ...overrides });
    return { result, logged, supabase };
  } finally {
    console.error = original;
  }
}

test("a valid change verifies the current password, then updates the password, once each and in that order", async () => {
  const { result, supabase } = await run({});
  assert.deepEqual(result, { success: CHANGE_PASSWORD_MESSAGES.success });
  assert.deepEqual(supabase.calls.map((call) => call.method), ["signInWithPassword", "updateUser"]);
  assert.deepEqual(supabase.calls[1].args, { password: GOOD.newPassword }, "only the password is updated");
});

test("it targets only the authenticated user: the email checked is the session user's, and no identity is sent to update", async () => {
  const { supabase } = await run({});
  assert.equal(supabase.calls[0].args.email, USER.email);
  assert.equal(supabase.calls[0].args.password, GOOD.currentPassword);
  // updateUser is given nothing that could name another user
  assert.deepEqual(Object.keys(supabase.calls[1].args), ["password"]);
  // an email or id smuggled in as an extra argument is simply not read
  const smuggled = await run({ email: "victim@example.com", userId: "user-2" });
  assert.equal(smuggled.supabase.calls[0].args.email, USER.email);
});

test("without an authenticated user nothing is called and the person is told to sign in again", async () => {
  for (const user of [null, undefined, { id: "u", email: "" }, { email: "a@b.c" }]) {
    const supabase = fakeSupabase();
    const result = await changeOwnPassword({ supabase, user, ...GOOD });
    assert.deepEqual(result, { error: CHANGE_PASSWORD_MESSAGES.sessionExpired });
    assert.equal(supabase.calls.length, 0);
  }
});

test("required fields are enforced on the server too, before any Auth call", async () => {
  for (const [field, message] of [
    ["currentPassword", PASSWORD_MESSAGES.currentRequired],
    ["newPassword", PASSWORD_MESSAGES.newRequired],
    ["confirmPassword", PASSWORD_MESSAGES.confirmRequired],
  ]) {
    const { result, supabase } = await run({ [field]: "" });
    assert.equal(result.fieldErrors[field], message, field);
    assert.equal(supabase.calls.length, 0, `${field}: no Auth call`);
  }
});

test("a mismatch and a too-short password are rejected on the server, before any Auth call", async () => {
  const mismatch = await run({ confirmPassword: "different-one" });
  assert.equal(mismatch.result.fieldErrors.confirmPassword, PASSWORD_MESSAGES.mismatch);
  assert.equal(mismatch.supabase.calls.length, 0);

  const short = await run({ newPassword: "short", confirmPassword: "short" });
  assert.equal(short.result.fieldErrors.newPassword, PASSWORD_MESSAGES.newTooShort);
  assert.equal(short.supabase.calls.length, 0);
});

test("a wrong current password is reported on that field and the password is NOT changed", async () => {
  const supabase = fakeSupabase({ verify: { data: { user: null }, error: { code: "invalid_credentials", status: 400 } } });
  const { result } = await run({}, supabase);
  assert.deepEqual(result, { fieldErrors: { currentPassword: CHANGE_PASSWORD_MESSAGES.currentIncorrect } });
  assert.deepEqual(supabase.calls.map((call) => call.method), ["signInWithPassword"], "updateUser was never reached");
});

test("if the current password cannot be checked (rate limit, network) it is not called 'incorrect', and nothing changes", async () => {
  const supabase = fakeSupabase({ verify: { data: { user: null }, error: { code: "over_request_rate_limit", status: 429, message: "Too many requests SECRET-DETAIL" } } });
  const { result, logged } = await run({}, supabase);
  assert.deepEqual(result, { error: CHANGE_PASSWORD_MESSAGES.cannotVerify });
  assert.equal(supabase.calls.length, 1);
  assert.ok(!JSON.stringify(result).includes("SECRET-DETAIL"), "the technical text is not returned");
  assert.ok(logged.every((line) => !line.includes("SECRET-DETAIL")), "and not logged either: only the code and status");
});

test("a verified session for a DIFFERENT user is refused: nothing is changed", async () => {
  const supabase = fakeSupabase({ verify: { data: { user: { id: "someone-else" } }, error: null } });
  const { result } = await run({}, supabase);
  assert.deepEqual(result, { error: CHANGE_PASSWORD_MESSAGES.failed });
  assert.deepEqual(supabase.calls.map((call) => call.method), ["signInWithPassword"]);
});

test("Supabase's own 'same password' and 'weak password' answers become messages on the new-password field", async () => {
  const same = await run({}, fakeSupabase({ update: { data: null, error: { code: "same_password", status: 422 } } }));
  assert.deepEqual(same.result, { fieldErrors: { newPassword: CHANGE_PASSWORD_MESSAGES.samePassword } });

  const weak = await run({}, fakeSupabase({ update: { data: null, error: { code: "weak_password", status: 422 } } }));
  assert.deepEqual(weak.result, { fieldErrors: { newPassword: CHANGE_PASSWORD_MESSAGES.weakPassword } });
});

test("any other failure is a friendly message with no technical detail, and the log has only the code and status", async () => {
  const supabase = fakeSupabase({ update: { data: null, error: { code: "unexpected_failure", status: 500, message: "db exploded: SECRET-DETAIL" } } });
  const { result, logged } = await run({}, supabase);
  assert.deepEqual(result, { error: CHANGE_PASSWORD_MESSAGES.failed });
  assert.ok(!JSON.stringify(result).includes("SECRET-DETAIL"));
  assert.deepEqual(logged, ["[auth] Could not change the password: unexpected_failure 500"]);
});

test("no password is ever returned or logged, on any path", async () => {
  const cases = [
    {},
    { confirmPassword: "nope" },
    { currentPassword: "" },
  ];
  const suppliers = [
    fakeSupabase(),
    fakeSupabase({ verify: { data: { user: null }, error: { code: "invalid_credentials", status: 400 } } }),
    fakeSupabase({ update: { data: null, error: { code: "boom", status: 500 } } }),
  ];
  for (const overrides of cases) {
    for (const supabase of suppliers) {
      const { result, logged } = await run(overrides, { ...supabase, calls: [] });
      const text = JSON.stringify(result) + logged.join("\n");
      for (const secret of [GOOD.currentPassword, GOOD.newPassword]) {
        assert.ok(!text.includes(secret), "a password leaked into a result or a log line");
      }
    }
  }
});
