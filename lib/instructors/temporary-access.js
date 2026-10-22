// Admin-generated temporary access for an instructor (the alternative to the email invitation, `provideLoginAccess`). Pure of framework imports
// (relative imports only) so `npm test` can drive it with fake Supabase clients; `lib/instructors/actions.js` wraps it and does the Admin check.
//
// Two operations, both run with the Auth Admin API (the secret key, server side):
//   * provisionTemporaryLogin - a NEW auth account with a generated temporary password, linked to the instructor;
//   * resetTemporaryPassword  - a NEW temporary password for an instructor who already has an account.
// Both flag the account `must_change_password` (lib/auth/password-change-required.js), so the instructor must choose a password of their own before
// using the application. The password is returned once to the caller and is never stored, logged or put in an error. Every step logs one
// diagnostic line (lib/auth/safe-error.js): the operation, the step, ok or failed and, for a failure, the SDK's own status, code and message with
// any secret redacted - never an input - so a failure can be traced to the exact step. Every message returned here is fixed text.

import { generateTemporaryPassword } from "../auth/temporary-password.js";
import { MUST_CHANGE_PASSWORD_KEY } from "../auth/password-change-required.js";
import { diagnosticLine } from "../auth/safe-error.js";
import { TEMPORARY_ACCESS_MESSAGES } from "./temporary-access-rules.js";

export { TEMPORARY_ACCESS_MESSAGES, temporaryAccessBlocker } from "./temporary-access-rules.js";

// One diagnostic line per step. A failure goes to console.error, a completed step to console.info (so a partial success is visible in the log).
function logStep({ operation, step, outcome, context, error, secrets }) {
  const line = diagnosticLine({ operation, step, outcome, context, error, secrets });
  if (outcome === "failed") console.error(line);
  else console.info(line);
}

/**
 * Creates the instructor's auth account with a generated temporary password, links it and flags it for a first-login change. If the account
 * cannot be linked it is deleted again, so no unlinked account (whose password nobody was shown) is left behind.
 *
 * @param {object} args
 * @param {{ auth: { admin: { createUser: Function, deleteUser: Function } } }} args.admin - Supabase client with the secret key.
 * @param {{ id: string, full_name: string, email: string }} args.instructor - already read and authorized by the caller.
 * @param {(userId: string) => Promise<boolean>} args.link - writes `instructors.user_id` through the Admin's own session; true when it linked.
 * @param {() => string} [args.generate]
 * @returns {Promise<{ temporaryPassword: string } | { error: string }>}
 */
export async function provisionTemporaryLogin({ admin, instructor, link, generate = generateTemporaryPassword }) {
  const temporaryPassword = generate();

  const { data, error } = await admin.auth.admin.createUser({
    email: instructor.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: instructor.full_name },
    app_metadata: { [MUST_CHANGE_PASSWORD_KEY]: true },
  });

  const createContext = { instructorId: instructor.id };
  if (error) {
    logStep({ operation: "create_temporary_login", step: "create_user", outcome: "failed", context: createContext, error, secrets: [temporaryPassword] });
    return { error: error.code === "email_exists" ? TEMPORARY_ACCESS_MESSAGES.emailExists : TEMPORARY_ACCESS_MESSAGES.createFailed };
  }

  const userId = data?.user?.id;
  if (!userId) {
    logStep({ operation: "create_temporary_login", step: "create_user", outcome: "failed", context: createContext, error: { message: "no user id returned" } });
    return { error: TEMPORARY_ACCESS_MESSAGES.createFailed };
  }
  logStep({ operation: "create_temporary_login", step: "create_user", outcome: "ok", context: { ...createContext, authUserId: userId } });

  let linked = false;
  try {
    linked = await link(userId);
  } catch {
    linked = false;
  }

  if (!linked) {
    // The account is brand new and its password was never shown, so removing it is safe and leaves nothing to resolve by hand.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    const context = { instructorId: instructor.id, authUserId: userId };
    logStep({ operation: "create_temporary_login", step: "link_instructor", outcome: "failed", context, error: { message: "could not link the new account to the instructor" } });
    if (deleteError) {
      logStep({
        operation: "create_temporary_login",
        step: "delete_unlinked_user",
        outcome: "failed",
        context: { ...context, note: "the new auth account could not be removed - resolve it manually" },
        error: deleteError,
        secrets: [temporaryPassword],
      });
    }
    return { error: TEMPORARY_ACCESS_MESSAGES.linkFailed };
  }
  logStep({ operation: "create_temporary_login", step: "link_instructor", outcome: "ok", context: { instructorId: instructor.id, authUserId: userId } });

  return { temporaryPassword };
}

/**
 * Sets a new generated temporary password on the instructor's OWN linked account and flags it for a first-login change. The account is the one
 * `instructors.user_id` names - never an id from the request - and only an account whose profile role is exactly "instructor" is touched, so an
 * Admin's login can never be reset through here. The old password stops working with this update; the existing password is never read or shown.
 *
 * The role is read with `readRole` - the caller passes the Admin's OWN session calling `public.login_profile_role` (migration 0064), an
 * Admin-only function - not with the secret-key client, which is for the Auth Admin API alone and has no access to `profiles`. Anything but a
 * successful answer of exactly "instructor" (an error, a thrown call, a missing function, no profile, another role) stops here, before
 * `updateUserById` is ever called.
 *
 * @param {object} args
 * @param {{ auth: { admin: { updateUserById: Function } } }} args.admin - Supabase client with the secret key (Auth Admin API only).
 * @param {(userId: string) => Promise<{ data: unknown, error: unknown }>} args.readRole - the linked account's role through the Admin's session.
 * @param {{ id: string, user_id: string }} args.instructor - already read and authorized by the caller.
 * @param {() => string} [args.generate]
 * @returns {Promise<{ temporaryPassword: string } | { error: string }>}
 */
export async function resetTemporaryPassword({ admin, readRole, instructor, generate = generateTemporaryPassword }) {
  const context = { instructorId: instructor.id, authUserId: instructor.user_id };

  let roleAnswer;
  try {
    roleAnswer = await readRole(instructor.user_id);
  } catch (thrown) {
    roleAnswer = { data: null, error: thrown ?? { message: "the role lookup threw" } };
  }
  const { data: role, error: roleError } = roleAnswer ?? { data: null, error: { message: "the role lookup returned nothing" } };

  if (roleError) {
    logStep({ operation: "reset_password", step: "read_profile", outcome: "failed", context, error: roleError });
    return { error: TEMPORARY_ACCESS_MESSAGES.resetFailed };
  }
  if (role !== "instructor") {
    // Not an error of the system but a refusal: say which role it was (a role name is not sensitive), never reset it.
    const seen = typeof role === "string" ? role : null;
    logStep({ operation: "reset_password", step: "check_role", outcome: "failed", context: { ...context, role: seen }, error: { message: "the linked account is not an instructor account" } });
    return { error: TEMPORARY_ACCESS_MESSAGES.notAnInstructor };
  }
  logStep({ operation: "reset_password", step: "read_profile", outcome: "ok", context });

  const temporaryPassword = generate();
  const { error } = await admin.auth.admin.updateUserById(instructor.user_id, {
    password: temporaryPassword,
    app_metadata: { [MUST_CHANGE_PASSWORD_KEY]: true },
  });

  if (error) {
    logStep({ operation: "reset_password", step: "update_user", outcome: "failed", context, error, secrets: [temporaryPassword] });
    return { error: TEMPORARY_ACCESS_MESSAGES.resetFailed };
  }
  logStep({ operation: "reset_password", step: "update_user", outcome: "ok", context });

  return { temporaryPassword };
}
