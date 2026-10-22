// Run with `npm test` (Node's built-in test runner).
//
// The first-login password change for Admin-generated temporary passwords: what counts as "must change", where a flagged user may go, how the flag is
// cleared, and - pinned from source, the project's way for the proxy, the DAL and the server actions - where it is enforced.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHANGE_PASSWORD_PATH,
  MUST_CHANGE_PASSWORD_KEY,
  clearPasswordChangeRequirement,
  mustChangePassword,
  passwordChangeRedirect,
} from "./password-change-required.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const flagged = { id: "u1", app_metadata: { [MUST_CHANGE_PASSWORD_KEY]: true } };

// ---- what counts ----------------------------------------------------------------------------------------------------------------------

test("only an explicit true in app_metadata means the password must be changed", () => {
  assert.equal(mustChangePassword(flagged), true);
  for (const user of [null, undefined, {}, { app_metadata: {} }, { app_metadata: { must_change_password: false } }, { app_metadata: { must_change_password: "true" } }, { app_metadata: { must_change_password: 1 } }]) {
    assert.equal(mustChangePassword(user), false, JSON.stringify(user));
  }
});

test("user_metadata - which the signed-in user can write - is never read: it cannot set or clear the requirement", () => {
  assert.equal(mustChangePassword({ user_metadata: { must_change_password: true } }), false);
  assert.equal(mustChangePassword({ app_metadata: { must_change_password: true }, user_metadata: { must_change_password: false } }), true);
});

// ---- where a flagged user may go -------------------------------------------------------------------------------------------------------

test("a flagged user is sent to the change-password page from every protected route, however they got there", () => {
  for (const pathname of ["/", "/students", "/schedule/abc/edit", "/settings", "/attendance", "/reports", "/login", "/some/typed/url"]) {
    assert.equal(passwordChangeRedirect({ user: flagged, pathname, isPublicRoute: false }), CHANGE_PASSWORD_PATH, pathname);
  }
});

test("the change-password page itself, and the emailed-link public pages, are not redirected (no loop)", () => {
  assert.equal(passwordChangeRedirect({ user: flagged, pathname: CHANGE_PASSWORD_PATH, isPublicRoute: false }), null);
  assert.equal(passwordChangeRedirect({ user: flagged, pathname: "/auth/recovery", isPublicRoute: true }), null);
});

test("a user who does not have to change a password is never redirected", () => {
  for (const user of [null, { id: "u2" }, { id: "u2", app_metadata: { must_change_password: false } }]) {
    assert.equal(passwordChangeRedirect({ user, pathname: "/students", isPublicRoute: false }), null);
  }
});

// ---- clearing the requirement ------------------------------------------------------------------------------------------------------------

test("clearing writes false into app_metadata of exactly the given user, through the Auth Admin API", async () => {
  const calls = [];
  const admin = { auth: { admin: { updateUserById: async (id, attributes) => { calls.push([id, attributes]); return { error: null }; } } } };
  assert.equal(await clearPasswordChangeRequirement({ admin, userId: "u1" }), true);
  assert.deepEqual(calls, [["u1", { app_metadata: { must_change_password: false } }]]);
});

test("a failed clear returns false and logs only a code and message - never a password", async () => {
  const admin = { auth: { admin: { updateUserById: async () => ({ error: { code: "unexpected_failure", message: "boom" } }) } } };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.equal(await clearPasswordChangeRequirement({ admin, userId: "u1" }), false);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /unexpected_failure/);
});

// ---- where it is enforced ------------------------------------------------------------------------------------------------------------------

test("the proxy redirects a flagged user to the change-password page, before the login-page rule and on every protected route", () => {
  const proxy = code("proxy.js");
  assert.ok(proxy.includes("passwordChangeRedirect({ user, pathname, isPublicRoute: isPublicRoute(pathname) })"));
  assert.ok(proxy.indexOf("passwordChangeRedirect(") > proxy.indexOf("if (!user && !isPublicRoute(pathname))"));
  assert.ok(proxy.indexOf("passwordChangeRedirect(") < proxy.indexOf('pathname === "/login"'));
  assert.ok(proxy.includes("NextResponse.redirect(url)"));
  assert.ok(!/PUBLIC_ROUTES = \[[^\]]*change-password/.test(proxy), "the change-password page requires a signed-in user");
});

test("requireUser (every protected page and server action) also sends a flagged user to the change-password page", () => {
  const dal = code("lib/auth/dal.js");
  const guard = dal.indexOf("if (mustChangePassword(authUser)) redirect(CHANGE_PASSWORD_PATH);");
  assert.ok(guard > dal.indexOf("export async function requireUser()"));
  assert.ok(guard > dal.indexOf("if (!authUser) redirect(\"/login\");"));
  assert.ok(guard < dal.indexOf("const user = await getCurrentUser();"));
  // requireRole goes through requireUser, so Admin-only actions are closed too.
  assert.ok(dal.indexOf("const user = await requireUser();", dal.indexOf("export async function requireRole")) > 0);
});

test("the change-password page uses getAuthUser (requireUser would loop) and sends everyone else on", () => {
  const page = code("app/change-password/page.js");
  assert.ok(page.includes("getAuthUser()") && !page.includes("requireUser"));
  assert.ok(page.includes('if (!user) redirect("/login");') && page.includes('if (!mustChangePassword(user)) redirect("/");'));
  assert.ok(page.includes("<ResetPasswordForm />") && page.includes("action={signOut}"));
});

test("updatePassword lifts the requirement only AFTER the password changed, for the session's own user, and fails closed if it cannot", () => {
  const actions = code("lib/auth/actions.js");
  const body = actions.slice(actions.indexOf("export async function updatePassword("), actions.indexOf("export async function changePassword("));
  const update = body.indexOf("supabase.auth.updateUser({ password })");
  const clear = body.indexOf("clearPasswordChangeRequirement({ admin: createAdminClient(), userId: data.user.id })");
  assert.ok(update > 0 && clear > update, "after the update");
  assert.match(body, /if \(mustChangePassword\(data\?\.user\)\) \{/);
  assert.match(body, /if \(!cleared\) \{\s*return \{\s*error:/);
  assert.ok(body.indexOf("redirect(\"/\")") > clear, "redirects only after the requirement is cleared");
  assert.ok(!/formData\.get\("(userId|user_id|id)"\)/.test(body), "no identity is read from the form");
  // A failure to change the password never reaches the clear.
  assert.ok(body.indexOf("if (error) {") < clear);
});

test("updatePassword still enforces the existing password rules and keeps its generic failure message", () => {
  const actions = code("lib/auth/actions.js");
  const body = actions.slice(actions.indexOf("export async function updatePassword("), actions.indexOf("export async function changePassword("));
  assert.ok(body.includes("password.length < MIN_PASSWORD_LENGTH") && body.includes("password !== confirmPassword"));
  assert.ok(body.includes('"Could not update the password. Request a new reset link."'));
});
