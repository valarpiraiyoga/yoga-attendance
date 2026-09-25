// Run with `npm test` (Node's built-in test runner).
//
// Settings -> Reset Password: structural guards for the parts a behavioural test with a fake client cannot see -
// what the server action reads from the form, where the user's identity comes from, and how the card behaves.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** The `changePassword` action's own source, so the rest of actions.js cannot satisfy or break these checks. */
function changePasswordAction() {
  const actions = code("./actions.js");
  const start = actions.indexOf("export async function changePassword(");
  assert.ok(start > 0, "changePassword exists");
  return actions.slice(start);
}

test("the action changes only the signed-in user's own password: identity comes from the verified session, not the form", () => {
  const action = changePasswordAction();
  assert.match(action, /const user = await getAuthUser\(\)/);
  assert.match(action, /user: \{ id: user\.id, email: user\.email \}/);
  // The form is read for exactly the three password fields and nothing that could name a user.
  const reads = [...action.matchAll(/formData\.get\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(reads, ["currentPassword", "newPassword", "confirmPassword"]);
  // No admin client, no other-user API.
  assert.doesNotMatch(action, /createAdminClient|auth\.admin|updateUserById|listUsers/);
});

test("with no signed-in user the action stops before touching Supabase", () => {
  const action = changePasswordAction();
  assert.ok(action.indexOf("if (!user)") < action.indexOf("await createClient()"));
  assert.match(action, /CHANGE_PASSWORD_MESSAGES\.sessionExpired/);
});

test("the core acts on the session's own client: verify the current password, then update, with no user identifier", () => {
  const core = code("./change-password.js");
  assert.match(core, /supabase\.auth\.signInWithPassword\(\{\s*email: user\.email,\s*password: currentPassword/);
  assert.match(core, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
  assert.ok(core.indexOf("signInWithPassword") < core.indexOf("updateUser"), "verify first");
  assert.match(core, /verified\?\.user\?\.id !== user\.id/, "the verified session must be the same user");
  assert.doesNotMatch(core, /\.from\(|createAdminClient|auth\.admin/, "no table and no admin API: passwords are never stored");
});

test("nothing sensitive is logged: only an error's code and status, never its text or an input", () => {
  for (const path of ["./change-password.js"]) {
    const logs = [...code(path).matchAll(/console\.\w+\([^;]*\);/g)].map((match) => match[0]);
    assert.ok(logs.length > 0);
    for (const line of logs) {
      // A fixed string, then the error's code and status - no input variable, no error text.
      assert.match(line, /^console\.error\("[^"$]*", \w+\.code, \w+\.status\);$/, line);
    }
  }
  const action = changePasswordAction();
  assert.doesNotMatch(action, /console\./);
});

test("the emailed-link reset keeps its behaviour, now reading the one shared minimum length", () => {
  const actions = code("./actions.js");
  const update = actions.slice(actions.indexOf("export async function updatePassword("), actions.indexOf("export async function changePassword("));
  assert.match(update, /password\.length < MIN_PASSWORD_LENGTH/);
  assert.match(update, /Passwords do not match\./);
  assert.match(update, /redirect\("\/"\)/, "the link flow still redirects; only the Settings flow stays on the page");
  assert.match(update, /supabase\.auth\.updateUser\(\{ password \}\)/);
});

test("the Reset Password card is on Settings, with the specified title, description, fields and action", () => {
  const card = code("../../app/settings/roles-permissions/reset-password-card.js");
  assert.match(card, /title="Reset Password"/);
  assert.match(card, /description="Change your account password to keep your account secure\."/);
  for (const label of ["Current Password", "New Password", "Confirm New Password"]) {
    assert.ok(card.includes(`label="${label}"`), label);
  }
  assert.match(card, /\{isPending \? "Updating…" : "Reset Password"\}/);
  assert.match(card, /import PasswordInput from "@\/components\/ui\/password-input"/);
  assert.equal((card.match(/<PasswordInput/g) ?? []).length, 3);
  assert.match(card, /autoComplete="current-password"/);
  assert.equal((card.match(/autoComplete="new-password"/g) ?? []).length, 2);

  const page = code("../../app/settings/roles-permissions/page.js");
  assert.match(page, /<ResetPasswordCard \/>/);
});

test("the card validates first, calls the action, clears the fields on success and stays on the page", () => {
  const card = code("../../app/settings/roles-permissions/reset-password-card.js");
  assert.match(card, /validatePasswordChange\(values\)/);
  assert.ok(card.indexOf("validatePasswordChange(values)") < card.indexOf("await changePassword("), "the browser check runs first");
  assert.match(card, /if \(result\?\.success\) \{\s*setValues\(EMPTY\);/, "fields are cleared on success");
  assert.match(card, /<Toast message=\{toast\?\.text\} tone=\{toast\?\.tone\} onDismiss=\{dismissToast\} \/>/, "the standard toast");
  // Stays on the Settings page: no redirect, no navigation, and passwords never go to a URL or storage.
  assert.doesNotMatch(card, /redirect|useRouter|router\.|window\.location|localStorage|sessionStorage|searchParams|console\./);
});

test("errors are shown beside the field or in the form banner, and typing clears them", () => {
  const card = code("../../app/settings/roles-permissions/reset-password-card.js");
  assert.match(card, /error=\{fieldErrors\.currentPassword\}/);
  assert.match(card, /error=\{fieldErrors\.newPassword\}/);
  assert.match(card, /error=\{fieldErrors\.confirmPassword\}/);
  assert.match(card, /role="alert"/);
  assert.match(card, /setFieldErrors\(\(previous\) => \(previous\[field\]/);
});

test("the shared password field is used by the sign-in form and the Settings card, and is a real button that never submits", () => {
  const input = code("../../components/ui/password-input.js");
  assert.match(input, /<button\s+type="button"/);
  assert.match(input, /aria-label=\{shown \? "Hide password" : "Show password"\}/);
  assert.match(code("../../app/login/login-form.js"), /<PasswordInput/);
});
