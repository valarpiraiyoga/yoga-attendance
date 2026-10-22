// What an instructor needs before temporary access can be created or reset, and the fixed messages for it. Pure and free of Node-only imports
// (no crypto), so the Login Access panel - a client component - can use the very same text and check the server applies
// (lib/instructors/temporary-access.js, lib/instructors/actions.js).

export const TEMPORARY_ACCESS_MESSAGES = {
  notFound: "That instructor no longer exists.",
  alreadyHasAccess: "This instructor already has login access.",
  noAccess: "This instructor does not have login access yet.",
  inactive: "Activate this instructor before providing login access.",
  noEmail: "Add an email address for this instructor before providing login access.",
  notConfigured: "Login access is not configured on the server yet.",
  emailExists: "An account already exists for that email address. Use a different email, or link the existing account manually.",
  createFailed: "Could not create the account. Try again.",
  linkFailed: "The account could not be linked to the instructor, so it was not kept. Try again.",
  notAnInstructor: "This login belongs to an account that is not an instructor, so its password cannot be reset here.",
  resetFailed: "Could not reset the password. Try again.",
};

/**
 * Why an instructor cannot be given (or have reset) temporary access, or null. The Admin screen shows the same text; the server re-checks.
 *
 * @param {{ status?: string, email?: string|null, user_id?: string|null }|null} instructor
 * @param {"create"|"reset"} mode - create: no account yet; reset: an account is linked.
 */
export function temporaryAccessBlocker(instructor, mode) {
  if (!instructor) return TEMPORARY_ACCESS_MESSAGES.notFound;
  if (mode === "create" && instructor.user_id) return TEMPORARY_ACCESS_MESSAGES.alreadyHasAccess;
  if (mode === "reset" && !instructor.user_id) return TEMPORARY_ACCESS_MESSAGES.noAccess;
  if (instructor.status !== "active") return TEMPORARY_ACCESS_MESSAGES.inactive;
  if (mode === "create" && !instructor.email) return TEMPORARY_ACCESS_MESSAGES.noEmail;
  return null;
}
