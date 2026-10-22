// The "must change the temporary password" requirement (Admin-generated instructor passwords). Pure: relative imports only.
//
// Where it lives. The flag is `must_change_password` in the Supabase Auth user's `app_metadata`. Unlike `user_metadata`, `app_metadata` can only be
// written with the Auth Admin API (the secret key, server side): a signed-in user cannot clear it or set it on themselves, which is what makes it
// trustworthy. It is set when the Admin generates a temporary password and cleared by the server once the user has chosen a new one, so no table,
// column or migration is needed and no password is ever stored.
//
// Where it is enforced. (1) The proxy redirects every request of a flagged user to CHANGE_PASSWORD_PATH, so a typed URL or a refresh cannot get past
// it; (2) the Data Access Layer's `requireUser` (used by every protected page and server action) redirects there too, so a path the proxy
// matcher does not cover is still closed. Both read the flag from `supabase.auth.getUser()`, which asks Supabase Auth, never from the cookie alone.

import { diagnosticLine } from "./safe-error.js";

/** The `app_metadata` key. */
export const MUST_CHANGE_PASSWORD_KEY = "must_change_password";

/** The one page a flagged user may use (besides signing out and the emailed-link pages). */
export const CHANGE_PASSWORD_PATH = "/change-password";

/** Whether a Supabase Auth user still has to replace a temporary password. Only an explicit `true` counts. */
export function mustChangePassword(user) {
  return user?.app_metadata?.[MUST_CHANGE_PASSWORD_KEY] === true;
}

/**
 * Where the proxy should send a request, or null to let it through.
 *
 * @param {{ user: object|null, pathname: string, isPublicRoute: boolean }} input
 * @returns {string|null}
 */
export function passwordChangeRedirect({ user, pathname, isPublicRoute }) {
  if (!mustChangePassword(user)) return null;
  if (pathname === CHANGE_PASSWORD_PATH) return null;
  // The emailed invitation / recovery pages carry no application data and are how a user may legitimately pick a password of their own.
  if (isPublicRoute) return null;
  return CHANGE_PASSWORD_PATH;
}

/**
 * Clears the requirement for the signed-in user once they have chosen their own password. Only the Auth Admin API can write `app_metadata`, so a
 * user cannot do this for themselves; `userId` must be the verified session user's id. Only an error's code and message are logged.
 *
 * @param {{ admin: { auth: { admin: { updateUserById: Function } } }, userId: string }} args
 * @returns {Promise<boolean>} true when the flag was cleared.
 */
export async function clearPasswordChangeRequirement({ admin, userId }) {
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { [MUST_CHANGE_PASSWORD_KEY]: false } });
  if (error) {
    console.error(
      diagnosticLine({ operation: "finish_password_change", step: "clear_requirement", outcome: "failed", context: { authUserId: userId }, error })
    );
    return false;
  }
  return true;
}
