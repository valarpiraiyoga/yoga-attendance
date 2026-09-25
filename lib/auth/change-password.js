// Pure of framework imports (no "@/" aliases) so `npm test` can drive it with a fake Supabase client.
import { validatePasswordChange } from "./password-rules.js";

export const CHANGE_PASSWORD_MESSAGES = {
  success: "Password changed successfully.",
  sessionExpired: "Your session has expired. Sign in again to change your password.",
  currentIncorrect: "Your current password is incorrect.",
  cannotVerify: "We could not verify your current password. Try again in a moment.",
  samePassword: "Choose a password different from your current one.",
  weakPassword: "That password is too weak. Choose a stronger one.",
  failed: "We could not change your password. Please try again.",
};

/**
 * Changes the SIGNED-IN user's own password, and nothing else.
 *
 *  1. The submission is validated again here - the browser's check is a convenience, not the gate.
 *  2. Who is changing is decided by the server: `user` is the verified Supabase auth user, and its email is what
 *     the current password is checked against. Nothing about identity (id, email) is read from the form.
 *  3. The current password is verified with Supabase Auth (`signInWithPassword` for that email) BEFORE anything
 *     changes; a wrong one stops here.
 *  4. Only then does `updateUser({ password })` change the password of the session's own user - Supabase Auth's
 *     API has no way to name another user from this client.
 *
 * Passwords are never stored, logged or returned: the result carries only fixed messages, and the log line for an
 * unexpected failure carries the error's code and status, never its text or any input.
 *
 * @param {object} args
 * @param {import("@supabase/supabase-js").SupabaseClient} args.supabase - the session's server client
 * @param {{ id: string, email?: string }|null} args.user - the verified authenticated user
 * @param {string} args.currentPassword
 * @param {string} args.newPassword
 * @param {string} args.confirmPassword
 * @returns {Promise<{ success?: string, error?: string, fieldErrors?: object }>}
 */
export async function changeOwnPassword({ supabase, user, currentPassword, newPassword, confirmPassword }) {
  const { valid, fieldErrors } = validatePasswordChange({ currentPassword, newPassword, confirmPassword });
  if (!valid) return { fieldErrors };

  if (!user?.id || !user.email) return { error: CHANGE_PASSWORD_MESSAGES.sessionExpired };

  // Verify the current password for THIS user's own email.
  const { data: verified, error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (verifyError) {
    // A wrong password is the ordinary case; anything else (rate limit, network) is not "incorrect".
    const wrong = verifyError.code === "invalid_credentials" || verifyError.status === 400;
    if (!wrong) console.error("[auth] Could not verify the current password:", verifyError.code, verifyError.status);
    return wrong
      ? { fieldErrors: { currentPassword: CHANGE_PASSWORD_MESSAGES.currentIncorrect } }
      : { error: CHANGE_PASSWORD_MESSAGES.cannotVerify };
  }

  // Belt and braces: the verified session must be the very user we are changing.
  if (verified?.user?.id !== user.id) return { error: CHANGE_PASSWORD_MESSAGES.failed };

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

  if (updateError) {
    if (updateError.code === "same_password") return { fieldErrors: { newPassword: CHANGE_PASSWORD_MESSAGES.samePassword } };
    if (updateError.code === "weak_password") return { fieldErrors: { newPassword: CHANGE_PASSWORD_MESSAGES.weakPassword } };
    console.error("[auth] Could not change the password:", updateError.code, updateError.status);
    return { error: CHANGE_PASSWORD_MESSAGES.failed };
  }

  return { success: CHANGE_PASSWORD_MESSAGES.success };
}
