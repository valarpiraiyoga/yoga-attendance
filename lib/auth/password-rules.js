// Pure module (no "@/" imports) so `npm test` can load it under plain Node, and so the browser form and
// the server action apply the very same rules.

/**
 * The project's established password rule: at least 8 characters (what the reset-password page has always
 * enforced), and the two entries must match. Nothing stricter is invented here; if the Supabase project
 * itself enforces more, its own message is shown by the server (see `change-password.js`).
 */
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_MESSAGES = {
  currentRequired: "Enter your current password.",
  newRequired: "Enter a new password.",
  newTooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  confirmRequired: "Confirm your new password.",
  mismatch: "Passwords do not match.",
};

/**
 * Validates a change-password submission. Nothing is trimmed: a password may begin or end with a space.
 *
 * @param {{ currentPassword?: string, newPassword?: string, confirmPassword?: string }} input
 * @returns {{ valid: boolean, fieldErrors: { currentPassword?: string, newPassword?: string, confirmPassword?: string } }}
 */
export function validatePasswordChange({ currentPassword = "", newPassword = "", confirmPassword = "" } = {}) {
  const fieldErrors = {};

  if (!currentPassword) fieldErrors.currentPassword = PASSWORD_MESSAGES.currentRequired;

  if (!newPassword) fieldErrors.newPassword = PASSWORD_MESSAGES.newRequired;
  else if (newPassword.length < MIN_PASSWORD_LENGTH) fieldErrors.newPassword = PASSWORD_MESSAGES.newTooShort;

  if (!confirmPassword) fieldErrors.confirmPassword = PASSWORD_MESSAGES.confirmRequired;
  else if (newPassword && confirmPassword !== newPassword) fieldErrors.confirmPassword = PASSWORD_MESSAGES.mismatch;

  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
