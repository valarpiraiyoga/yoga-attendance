// Run with `npm test` (Node's built-in test runner).
//
// Admin-generated temporary access for an instructor: the creation and reset logic is driven with fake Supabase clients, so what it asks Auth to do
// and what it refuses is tested for real. How the server actions and the Login Access panel use it is pinned from source (they need the Next.js
// runtime), the project's way. Nothing is shown to a user here: every message is fixed text, and the generated password never reaches a log.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEMPORARY_ACCESS_MESSAGES, provisionTemporaryLogin, resetTemporaryPassword, temporaryAccessBlocker } from "./temporary-access.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const PASSWORD = "Tm9ydmFsLXMzY3JldCE";
const generate = () => PASSWORD;
const instructor = { id: "i1", full_name: "Kannan Thangavel", email: "kannan@example.com", status: "active", user_id: null };

// Records every call, and every console.error line, so a leak of the password can be asserted against.
function harness({ createResult, updateResult, profileResult, deleteResult } = {}) {
  const calls = { create: [], delete: [], update: [], profile: [] };
  const admin = {
    auth: {
      admin: {
        createUser: async (attributes) => (calls.create.push(attributes), createResult ?? { data: { user: { id: "new-user" } }, error: null }),
        deleteUser: async (id) => (calls.delete.push(id), deleteResult ?? { error: null }),
        updateUserById: async (id, attributes) => (calls.update.push([id, attributes]), updateResult ?? { error: null }),
      },
    },
    // The secret-key client is for the Auth Admin API only: a table query through it fails the test.
    from: (table) => {
      throw new Error(`the secret-key client must not query ${table}`);
    },
  };
  // The role lookup through the Admin's own session (supabase.rpc("login_profile_role", { p_user_id })): data is the role text or null.
  const readRole = async (userId) => {
    calls.profile.push(["login_profile_role", userId]);
    if (profileResult?.throws) throw profileResult.throws;
    const answer = profileResult ?? { data: { role: "instructor" }, error: null };
    return { data: answer.error ? null : (answer.data?.role ?? null), error: answer.error ?? null };
  };
  const logged = [];
  const original = console.error;
  return {
    admin,
    readRole,
    calls,
    logged,
    // Failures (console.error) and completed steps (console.info) are both recorded.
    capture() {
      console.error = (...args) => logged.push(args.map(String).join(" "));
      console.info = (...args) => logged.push(args.map(String).join(" "));
    },
    restore() {
      console.error = original;
      console.info = originalInfo;
    },
  };
}
const originalInfo = console.info;

async function withLogs(h, fn) {
  h.capture();
  try {
    return await fn();
  } finally {
    h.restore();
  }
}

// The structured diagnostic lines of a run, parsed.
const entries = (h) => h.logged.filter((line) => line.startsWith("[auth-admin] ")).map((line) => JSON.parse(line.slice("[auth-admin] ".length)));

// ---- who may be given temporary access ---------------------------------------------------------------------------------------------------

test("creation needs an active instructor with an email and no account yet", () => {
  assert.equal(temporaryAccessBlocker(instructor, "create"), null);
  assert.equal(temporaryAccessBlocker({ ...instructor, user_id: "u1" }, "create"), TEMPORARY_ACCESS_MESSAGES.alreadyHasAccess);
  assert.equal(temporaryAccessBlocker({ ...instructor, status: "inactive" }, "create"), TEMPORARY_ACCESS_MESSAGES.inactive);
  assert.equal(temporaryAccessBlocker({ ...instructor, email: "" }, "create"), TEMPORARY_ACCESS_MESSAGES.noEmail);
  assert.equal(temporaryAccessBlocker({ ...instructor, email: null }, "create"), TEMPORARY_ACCESS_MESSAGES.noEmail);
  assert.equal(temporaryAccessBlocker(null, "create"), TEMPORARY_ACCESS_MESSAGES.notFound);
});

test("a reset needs an active instructor that already has an account", () => {
  assert.equal(temporaryAccessBlocker({ ...instructor, user_id: "u1" }, "reset"), null);
  assert.equal(temporaryAccessBlocker({ ...instructor, user_id: null }, "reset"), TEMPORARY_ACCESS_MESSAGES.noAccess);
  assert.equal(temporaryAccessBlocker({ ...instructor, user_id: "u1", status: "inactive" }, "reset"), TEMPORARY_ACCESS_MESSAGES.inactive);
  assert.equal(temporaryAccessBlocker({ ...instructor, user_id: "u1", email: null }, "reset"), null, "a reset does not need an email");
});

// ---- creating an instructor's login with a temporary password ---------------------------------------------------------------------

test("a new account is created with the generated password, a confirmed email and the first-login flag in app_metadata, then linked", async () => {
  const h = harness();
  const linked = [];
  const result = await provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async (userId) => (linked.push(userId), true) });

  assert.deepEqual(result, { temporaryPassword: PASSWORD });
  assert.equal(h.calls.create.length, 1);
  assert.deepEqual(h.calls.create[0], {
    email: "kannan@example.com",
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Kannan Thangavel" },
    app_metadata: { must_change_password: true },
  });
  assert.deepEqual(linked, ["new-user"], "linked from the id Auth returned, not by matching email");
  assert.deepEqual(h.calls.delete, [], "nothing is removed on success");
});

test("the role is never sent: the new account's role comes from the database default, not from the request", async () => {
  const h = harness();
  await provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => true });
  const sent = JSON.stringify(h.calls.create[0]);
  assert.doesNotMatch(sent, /role|admin/i);
});

test("each creation uses a freshly generated password", async () => {
  const seen = new Set();
  for (let index = 0; index < 3; index += 1) {
    const h = harness();
    const result = await provisionTemporaryLogin({ admin: h.admin, instructor, link: async () => true });
    seen.add(result.temporaryPassword);
  }
  assert.equal(seen.size, 3);
});

test("an email that already has an account is refused with its own message and nothing is linked", async () => {
  const h = harness({ createResult: { data: null, error: { code: "email_exists", message: "A user with this email address has already been registered" } } });
  let linkCalled = false;
  const result = await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => (linkCalled = true) }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.emailExists });
  assert.equal(linkCalled, false);
});

test("any other creation failure, or a missing user id, is the generic message - no Supabase wording is returned", async () => {
  for (const createResult of [
    { data: null, error: { code: "unexpected_failure", message: "database error saving new user" } },
    { data: { user: null }, error: null },
    { data: null, error: null },
  ]) {
    const h = harness({ createResult });
    const result = await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => true }));
    assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.createFailed });
    assert.doesNotMatch(JSON.stringify(result), /database error|unexpected_failure/);
  }
});

test("if the account cannot be linked it is deleted again - no unlinked account whose password nobody saw is left - and the password is not returned", async () => {
  for (const link of [async () => false, async () => { throw new Error("rls"); }]) {
    const h = harness();
    const result = await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, generate, link }));
    assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.linkFailed });
    assert.deepEqual(h.calls.delete, ["new-user"]);
    assert.ok(!JSON.stringify(result).includes(PASSWORD));
  }
});

test("a failed clean-up is logged for manual resolution, still without the password, and the result stays an error", async () => {
  const h = harness({ deleteResult: { error: { code: "unexpected_failure", message: "delete failed" } } });
  const result = await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => false }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.linkFailed });
  assert.ok(h.logged.some((line) => /resolve it manually/.test(line)));
});

test("the password is never logged, whatever fails", async () => {
  const failing = [
    harness({ createResult: { data: null, error: { code: "email_exists", message: "exists" } } }),
    harness({ createResult: { data: null, error: { code: "unexpected_failure", message: "boom" } } }),
    harness({ deleteResult: { error: { code: "unexpected_failure", message: "delete failed" } } }),
  ];
  for (const [index, h] of failing.entries()) {
    await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => index !== 2 }));
    assert.ok(h.logged.every((line) => !line.includes(PASSWORD)), `case ${index}: ${h.logged.join(" | ")}`);
  }
});

// ---- resetting an existing instructor's password ----------------------------------------------------------------------------------------------

const linkedInstructor = { ...instructor, user_id: "auth-user-1" };

test("a reset sets a new generated password and the first-login flag on the instructor's OWN linked account", async () => {
  const h = harness();
  const result = await resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate });
  assert.deepEqual(result, { temporaryPassword: PASSWORD });
  assert.deepEqual(h.calls.update, [["auth-user-1", { password: PASSWORD, app_metadata: { must_change_password: true } }]]);
  assert.deepEqual(h.calls.profile, [["login_profile_role", "auth-user-1"]], "the role of that same account is checked first");
});

test("each reset generates a different password, so the previous one cannot be the new one", async () => {
  const seen = new Set();
  for (let index = 0; index < 5; index += 1) {
    const fresh = harness();
    const result = await resetTemporaryPassword({ admin: fresh.admin, readRole: fresh.readRole, instructor: linkedInstructor });
    seen.add(result.temporaryPassword);
  }
  assert.equal(seen.size, 5);
});

test("an account that is not an instructor's (an Admin, or one with no profile) is never reset", async () => {
  for (const profileResult of [{ data: { role: "admin" }, error: null }, { data: null, error: null }, { data: { role: null }, error: null }]) {
    const h = harness({ profileResult });
    const result = await resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate });
    assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.notAnInstructor });
    assert.deepEqual(h.calls.update, [], "no password was changed");
  }
});

test("a profile that cannot be read, or an update that fails, is the generic reset message and changes nothing it should not", async () => {
  const unreadable = harness({ profileResult: { data: null, error: { code: "42501", message: "permission denied" } } });
  assert.deepEqual(await withLogs(unreadable, () => resetTemporaryPassword({ admin: unreadable.admin, readRole: unreadable.readRole, instructor: linkedInstructor, generate })), { error: TEMPORARY_ACCESS_MESSAGES.resetFailed });
  assert.deepEqual(unreadable.calls.update, []);

  const failing = harness({ updateResult: { error: { code: "weak_password", message: "Password should contain letters" } } });
  const result = await withLogs(failing, () => resetTemporaryPassword({ admin: failing.admin, readRole: failing.readRole, instructor: linkedInstructor, generate }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.resetFailed });
  assert.ok(!JSON.stringify(result).includes(PASSWORD));
  assert.ok(failing.logged.every((line) => !line.includes(PASSWORD)));
});

test("a reset never reads or returns the existing password: its only output is the new one", async () => {
  const h = harness();
  const result = await resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: { ...linkedInstructor, password: "OldSecret1!" }, generate });
  assert.deepEqual(Object.keys(result), ["temporaryPassword"]);
  assert.ok(!JSON.stringify(h.calls).includes("OldSecret1!"));
});

// ---- the server actions (pinned from source) ---------------------------------------------------------------------------------------------------

const actions = code("lib/instructors/actions.js");
const create = actions.slice(actions.indexOf("export async function provideTemporaryLoginAccess("), actions.indexOf("export async function resetInstructorPassword("));
const reset = actions.slice(actions.indexOf("export async function resetInstructorPassword("));

test("both actions check the Admin role first - before any read or Auth call - so an instructor or a signed-out visitor is refused", () => {
  for (const body of [create, reset]) {
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") > 0);
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") < body.indexOf("createClient()"));
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") < body.indexOf("createAdminClient") || !body.includes("createAdminClient"));
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") < body.indexOf("adminClientOrError()"));
  }
});

test("the only input is the instructor's id: no user id, role or password is accepted from the browser", () => {
  assert.match(create, /export async function provideTemporaryLoginAccess\(id\) \{/);
  assert.match(reset, /export async function resetInstructorPassword\(id\) \{/);
  for (const body of [create, reset]) {
    assert.ok(!body.includes("formData"));
    assert.ok(!/\bpassword\b\s*[:=]\s*(?!result|temporaryPassword)/.test(body.replace(/temporaryPassword/g, "")), "no password is taken from the caller");
  }
});

test("the account touched is the one the instructor row is linked to, read through the Admin's own RLS session; a reset uses that row's user_id", () => {
  const read = actions.slice(actions.indexOf("async function readInstructorForAccess("), actions.indexOf("function adminClientOrError("));
  assert.ok(read.includes('.from("instructors")') && read.includes('.eq("id", id)'));
  assert.ok(reset.includes('temporaryAccessBlocker(read.instructor, "reset")'));
  assert.ok(reset.includes("instructor: read.instructor,"));
  assert.ok(reset.includes('readRole: (userId) => supabase.rpc("login_profile_role", { p_user_id: userId }),'));
  assert.ok(create.includes('temporaryAccessBlocker(read.instructor, "create")'));
  assert.match(create, /\.update\(\{ user_id: userId \}\)\s*\.eq\("id", id\)\s*\.is\("user_id", null\)/);
});

test("the secret key stays on the server: only server code imports the admin client", () => {
  assert.ok(read("lib/supabase/admin.js").includes('import "server-only";'));
  for (const file of ["app/settings/instructors/instructor-login-access.js", "app/settings/instructors/temporary-password-dialog.js", "app/change-password/page.js"]) {
    assert.ok(!read(file).includes("supabase/admin"), file);
    assert.ok(!read(file).includes("SUPABASE_SECRET_KEY"), file);
  }
  assert.ok(!read("lib/instructors/temporary-access-rules.js").includes("node:crypto"), "the client-side rules module has no Node-only import");
});

test("nothing logs, stores or puts a password in a URL: the actions and modules never reference a password in a log, storage or redirect", () => {
  for (const file of ["lib/instructors/actions.js", "lib/instructors/temporary-access.js", "lib/auth/password-change-required.js", "lib/auth/actions.js"]) {
    const source = code(file);
    for (const line of source.split("\n").filter((entry) => entry.includes("console."))) {
      // The words "password-change requirement" in a message are fine; a password VALUE (an interpolation or an argument) is not.
      assert.doesNotMatch(line, /\$\{[^}]*[pP]assword[^}]*\}|,\s*(temporaryPassword|password|newPassword|currentPassword|data\.password)\b/, `${file}: ${line.trim()}`);
    }
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(source), file);
  }
  const ui = code("app/settings/instructors/temporary-password-dialog.js") + code("app/settings/instructors/instructor-login-access.js");
  assert.ok(!/localStorage|sessionStorage|console\.|router\.(push|replace)|searchParams|URLSearchParams/.test(ui));
});

test("the existing email invitation flow is unchanged: same action, same Auth call, same redirect target, same messages", () => {
  const invite = actions.slice(actions.indexOf("export async function provideLoginAccess("), actions.indexOf("async function readInstructorForAccess("));
  assert.ok(invite.includes("admin.auth.admin.inviteUserByEmail("));
  assert.ok(invite.includes("inviteOptions.redirectTo = `${origin}/auth/invite?next=/reset-password`;"));
  assert.ok(invite.includes('return { success: "Login access invitation sent." };'));
  assert.ok(invite.includes('"This instructor already has login access."'));
  assert.ok(invite.includes('"Activate this instructor before providing login access."'));
  assert.ok(!invite.includes("createUser(") && !invite.includes("must_change_password"), "an invited instructor chooses their own password: no temporary flag");
});

// ---- the Login Access panel (pinned from source) ------------------------------------------------------------------------------------------------

const panel = code("app/settings/instructors/instructor-login-access.js");

test("the panel offers both ways, clearly separate, and Reset Password for an existing account", () => {
  assert.ok(panel.includes("Send Email Invitation") && panel.includes("Generate Temporary Password") && panel.includes("Reset Password"));
  assert.match(panel, /<form action=\{formAction\}/, "the invitation is still the form action");
  assert.ok(panel.includes("provideLoginAccess.bind(null, instructor.id)"));
  assert.ok(panel.includes("must change") || panel.includes("change it at first sign-in"));
});

test("a reset needs a confirmation: the reset action is only ever called from the confirm dialog's confirm", () => {
  assert.equal((panel.match(/resetInstructorPassword/g) ?? []).length, 2, "the import and one call");
  assert.match(panel, /onClick=\{\(\) => setConfirmReset\(true\)\}/);
  assert.match(panel, /onConfirm=\{\(\) => run\(resetInstructorPassword, "reset"\)\}/);
  assert.ok(panel.includes("Reset this instructor's password?"));
});

test("duplicate submissions are prevented: every action disables while one is running, and the confirm dialog cannot be closed mid-request", () => {
  assert.ok(panel.includes("const busy = isInviting || isWorking;"));
  assert.equal((panel.match(/disabled=\{busy \|\| Boolean\(blocker\)\}/g) ?? []).length, 3);
  assert.ok(panel.includes("isPending={isWorking}") && panel.includes("if (!isWorking) setConfirmReset(next);"));
});

test("loading, success and error states are shown; a generated password is held only in state and dropped when its dialog closes", () => {
  assert.ok(panel.includes("Generating…") && panel.includes("Resetting…") && panel.includes("Sending invitation…"));
  assert.ok(panel.includes('role="alert"') && panel.includes("setError(result.error)"));
  assert.ok(panel.includes("setRevealed({ password: result.temporaryPassword"));
  assert.ok(panel.includes("onClose={() => setRevealed(null)}"));
  const dialog = code("app/settings/instructors/temporary-password-dialog.js");
  assert.ok(dialog.includes("navigator.clipboard.writeText(password)") && dialog.includes("Copy"));
  assert.ok(dialog.includes("cannot be retrieved again") && dialog.includes("must change it the first time they sign in"));
  assert.ok(dialog.includes("readOnly"));
});

// ---- regression: a second reset, accurate failures, Admin accounts, the first-login flag (browser QA: "Reset Password" a second time) ----------

test("an instructor's password can be reset more than once: every reset succeeds, sets a NEW password and the flag again, and changes only that account", async () => {
  const h = harness();
  const passwords = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor }));
    assert.ok(result.temporaryPassword, `reset ${attempt + 1}: ${JSON.stringify(result)}`);
    passwords.push(result.temporaryPassword);
  }
  assert.equal(new Set(passwords).size, 4, "a different password each time");
  assert.equal(h.calls.update.length, 4);
  for (const [index, [userId, attributes]] of h.calls.update.entries()) {
    assert.equal(userId, "auth-user-1", "always the instructor's own linked account");
    assert.equal(attributes.password, passwords[index]);
    assert.deepEqual(attributes.app_metadata, { must_change_password: true });
  }
  assert.equal(h.calls.profile.length, 4, "the role is checked on every reset");
});

test("a reset right after a creation, and a second one after that, behave the same", async () => {
  const h = harness();
  const created = await withLogs(h, () => provisionTemporaryLogin({ admin: h.admin, instructor, link: async () => true }));
  assert.ok(created.temporaryPassword);
  const first = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: { ...instructor, user_id: "new-user" } }));
  const second = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: { ...instructor, user_id: "new-user" } }));
  assert.ok(first.temporaryPassword && second.temporaryPassword && first.temporaryPassword !== second.temporaryPassword);
  assert.ok(h.calls.update.every(([userId]) => userId === "new-user"));
});

test("the first-login flag is a real boolean true, sent in the SAME call as the password, and the application reads it as 'must change'", async () => {
  const { mustChangePassword } = await import("../auth/password-change-required.js");
  const h = harness();
  await resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate });
  assert.equal(h.calls.update.length, 1, "one atomic update: the password and the flag are never set separately");
  const [, attributes] = h.calls.update[0];
  assert.strictEqual(attributes.app_metadata.must_change_password, true);
  assert.equal(mustChangePassword({ app_metadata: attributes.app_metadata }), true);
  assert.equal(mustChangePassword({ user_metadata: attributes.app_metadata }), false, "user_metadata is never what counts");
});

test("a failed reset changes nothing: no update succeeded, so neither the password nor the flag was set, and the log says which step failed", async () => {
  const h = harness({ updateResult: { error: { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Database error updating user" } } });
  const result = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.resetFailed });
  assert.equal(h.calls.update.length, 1);

  const steps = entries(h).map((entry) => `${entry.step}:${entry.outcome}`);
  assert.deepEqual(steps, ["read_profile:ok", "update_user:failed"], "the profile read passed, the update failed - nothing was partially applied");
  const failure = entries(h).find((entry) => entry.outcome === "failed");
  assert.deepEqual(failure.error, { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Database error updating user" });
  assert.equal(failure.instructorId, "i1");
  assert.equal(failure.authUserId, "auth-user-1");
});

test("each step of a failure is reported accurately: a profile read failure is read_profile, a refused role is check_role, a failed update is update_user", async () => {
  const cases = [
    [{ profileResult: { data: null, error: { code: "42501", message: "permission denied for table profiles" } } }, "read_profile", TEMPORARY_ACCESS_MESSAGES.resetFailed],
    [{ profileResult: { data: { role: "admin" }, error: null } }, "check_role", TEMPORARY_ACCESS_MESSAGES.notAnInstructor],
    [{ updateResult: { error: { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" } } }, "update_user", TEMPORARY_ACCESS_MESSAGES.resetFailed],
  ];
  for (const [options, failedStep, message] of cases) {
    const h = harness(options);
    const result = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
    assert.deepEqual(result, { error: message }, failedStep);
    assert.equal(entries(h).find((entry) => entry.outcome === "failed").step, failedStep);
  }
});

test("a failure is explained in the log, never in the result, and nothing sensitive reaches either: the password, a token and a key are redacted", async () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";
  const h = harness({
    updateResult: { error: { status: 400, code: "weak_password", message: `Password ${PASSWORD} was rejected (token ${jwt}, key sb_secret_Zz9)` } },
  });
  const result = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.resetFailed });
  const everything = h.logged.join("\n") + JSON.stringify(result);
  for (const secret of [PASSWORD, jwt, "sb_secret_Zz9"]) assert.ok(!everything.includes(secret), secret);
  const failure = entries(h).find((entry) => entry.outcome === "failed");
  assert.equal(failure.error.code, "weak_password");
  assert.equal(failure.error.status, 400);
  assert.match(failure.error.message, /\[redacted\]/);
});

test("an Admin's account can never be reset through the instructor action, even when an instructor row is linked to it", async () => {
  // The instructor row says user_id is the Admin's auth id; the profile behind that id is an admin.
  const h = harness({ profileResult: { data: { role: "admin" }, error: null } });
  const result = await withLogs(h, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: { ...instructor, user_id: "admin-auth-id" }, generate }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.notAnInstructor });
  assert.deepEqual(h.calls.update, [], "no password or flag was written");
  assert.deepEqual(h.calls.profile, [["login_profile_role", "admin-auth-id"]], "the role of exactly that account was checked");
  const refusal = entries(h).find((entry) => entry.step === "check_role");
  assert.equal(refusal.role, "admin");
  assert.equal(refusal.outcome, "failed");
});

test("the action never reaches a reset for a different account than the instructor row's own", () => {
  assert.ok(reset.includes("instructor: read.instructor,") && reset.includes("admin: client.admin,"));
  assert.ok(!/user_id\s*:\s*(id|formData)/.test(reset));
});

test("the module logs only through the safe diagnostic helper: no raw error text, no password, no request body", () => {
  const source = code("lib/instructors/temporary-access.js");
  assert.ok(source.includes("diagnosticLine("));
  for (const line of source.split("\n").filter((entry) => entry.includes("console."))) {
    assert.match(line, /console\.(error|info)\(line\)/, line.trim());
  }
  assert.ok(!/error\??\.message/.test(source), "the SDK message only goes through sanitizeError");
});

// ---- 0064: the role is read through the Admin's own session (login_profile_role), never through the secret-key client ------------------------
// These are mocks: they prove what the application does with each answer, not that the database function behaves - that is
// supabase/verification/verify_0064_login_profile_role_behavior.sql.

// Records the order of the role lookup and the Auth update across both clients.
function orderedHarness(roleAnswer) {
  const order = [];
  const admin = {
    auth: { admin: { updateUserById: async (id, attributes) => (order.push(["update", id, attributes]), { error: null }) } },
    from: () => {
      throw new Error("the secret-key client must not query a table");
    },
  };
  const readRole = async (userId) => {
    order.push(["role", userId]);
    if (roleAnswer instanceof Error) throw roleAnswer;
    return roleAnswer;
  };
  return { admin, readRole, order };
}

test("0064: a role of exactly 'instructor' lets the reset proceed - and the role is checked BEFORE the Auth update, in one update call", async () => {
  const h = orderedHarness({ data: "instructor", error: null });
  const result = await withLogs(harness(), () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
  assert.deepEqual(result, { temporaryPassword: PASSWORD });
  assert.deepEqual(h.order, [
    ["role", "auth-user-1"],
    ["update", "auth-user-1", { password: PASSWORD, app_metadata: { must_change_password: true } }],
  ]);
});

test("0064: an Admin, a missing profile (NULL) or any other value is refused and the Auth user is never updated", async () => {
  for (const data of ["admin", null, undefined, "", "Instructor", "instructor ", ["instructor"], { role: "instructor" }, 1]) {
    const h = orderedHarness({ data, error: null });
    const result = await withLogs(harness(), () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
    assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.notAnInstructor }, JSON.stringify(data));
    assert.deepEqual(h.order.filter(([kind]) => kind === "update"), [], JSON.stringify(data));
  }
});

test("0064: an RPC error - not authorized, the function not applied yet, anything else - or a thrown call fails closed with the generic message", async () => {
  for (const answer of [
    { data: null, error: { code: "42501", message: "Not authorized." } },
    { data: null, error: { code: "PGRST202", message: "Could not find the function public.login_profile_role(p_user_id) in the schema cache" } },
    { data: null, error: { code: "42883", message: "function public.login_profile_role(uuid) does not exist" } },
    { data: "instructor", error: { code: "XX000", message: "internal error" } },
    new Error("fetch failed"),
    undefined,
  ]) {
    const h = orderedHarness(answer);
    const logs = harness();
    const result = await withLogs(logs, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
    assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.resetFailed }, JSON.stringify(answer));
    assert.deepEqual(h.order.filter(([kind]) => kind === "update"), [], "no update without a verified role");
    assert.equal(entries(logs).find((entry) => entry.outcome === "failed").step, "read_profile");
  }
});

test("0064: an error that echoes a token or key in its message is logged redacted, and the generated password never appears", async () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJl";
  const h = orderedHarness({ data: null, error: { code: "PGRST301", message: `JWT ${jwt} rejected with key sb_secret_Qq1` } });
  const logs = harness();
  const result = await withLogs(logs, () => resetTemporaryPassword({ admin: h.admin, readRole: h.readRole, instructor: linkedInstructor, generate }));
  assert.deepEqual(result, { error: TEMPORARY_ACCESS_MESSAGES.resetFailed });
  const everything = logs.logged.join("\n");
  for (const secret of [jwt, "sb_secret_Qq1", PASSWORD]) assert.ok(!everything.includes(secret), secret);
});

test("0064: creating a temporary login never looks up a role (it creates a new instructor account), and the email invitation is untouched", async () => {
  const h = harness();
  let roleLookups = 0;
  const result = await withLogs(h, () =>
    provisionTemporaryLogin({ admin: h.admin, instructor, generate, link: async () => true, readRole: async () => (roleLookups += 1, { data: "admin", error: null }) })
  );
  assert.deepEqual(result, { temporaryPassword: PASSWORD });
  assert.equal(roleLookups, 0);
  const invite = actions.slice(actions.indexOf("export async function provideLoginAccess("), actions.indexOf("async function readInstructorForAccess("));
  assert.ok(invite.includes("admin.auth.admin.inviteUserByEmail(") && !invite.includes("login_profile_role"));
});

test("0064: the action reads the role through the Admin's OWN session client, not the secret-key client, and only after the Admin check", () => {
  assert.ok(reset.includes('readRole: (userId) => supabase.rpc("login_profile_role", { p_user_id: userId }),'));
  assert.ok(!reset.includes("client.admin.rpc(") && !reset.includes("client.admin.from("));
  assert.ok(reset.indexOf("await requireRole(ROLES.ADMIN);") < reset.indexOf("const supabase = await createClient();"));
  const source = code("lib/instructors/temporary-access.js");
  assert.ok(!source.includes('admin.from("profiles")') && !source.includes(".from("), "the module never queries a table");
});
