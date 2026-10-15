/**
 * Who a class-count record, reversal or expiry edit is attributed to, as Membership Details shows it ("by ..."). Pure, so the
 * rules are tested without a server.
 *
 * The audit columns (`recorded_by`, `reversed_by`, `edited_by`) hold an auth user ID - `auth.uid()` of whoever called the database
 * function, an Admin or (migration 0053) an Instructor. A name has to be looked up from that ID, and two tables can answer, each
 * only for what the Admin's own session may read under RLS:
 *
 *   - `profiles` (id, role, full_name): a user can read ONLY THEIR OWN row (profiles_select_own, 0001). The Admin reading it sees
 *     their own profile and nobody else's.
 *   - `instructors` (user_id, full_name): readable by an Admin (instructors_select_admin, 0002), and the only place an
 *     Instructor's name lives.
 *
 * So an ID that is not the signed-in Admin's own is an Instructor's if it is some instructor's `user_id`; any other ID cannot be
 * identified from here and is shown as unknown - never guessed to be an Admin.
 */

export const UNKNOWN_ACTOR_LABEL = "Unknown user";
export const INSTRUCTOR_ROLE_LABEL = "Instructor";
export const ADMIN_LABEL = "Admin";

/**
 * The label for each user ID: an Instructor "Name (Instructor)", an Admin their name (or "Admin" when the profile has none), anyone
 * else "Unknown user".
 *
 * @param {{ ids: string[], profiles: { id: string, role?: string|null, full_name?: string|null }[],
 *           instructors: { user_id: string, full_name?: string|null }[] }} input
 * @returns {Map<string, string>}
 */
export function actorLabels({ ids, profiles = [], instructors = [] }) {
  const profileOf = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const instructorOf = new Map((instructors ?? []).filter((row) => row.user_id).map((row) => [row.user_id, row]));
  const labels = new Map();

  for (const id of ids ?? []) {
    if (!id) continue;
    const instructor = instructorOf.get(id);
    const profile = profileOf.get(id);
    if (instructor) {
      const name = String(instructor.full_name ?? "").trim() || String(profile?.full_name ?? "").trim();
      labels.set(id, name ? `${name} (${INSTRUCTOR_ROLE_LABEL})` : INSTRUCTOR_ROLE_LABEL);
    } else if (profile?.role === "admin") {
      labels.set(id, String(profile.full_name ?? "").trim() || ADMIN_LABEL);
    } else if (profile?.role === "instructor") {
      const name = String(profile.full_name ?? "").trim();
      labels.set(id, name ? `${name} (${INSTRUCTOR_ROLE_LABEL})` : INSTRUCTOR_ROLE_LABEL);
    } else {
      labels.set(id, UNKNOWN_ACTOR_LABEL);
    }
  }

  return labels;
}

/** The label for one stored ID: null when nothing was stored (the account was deleted, ON DELETE SET NULL), never "Admin". */
export function actorLabelOf(labels, id) {
  if (!id) return null;
  return labels.get(id) ?? UNKNOWN_ACTOR_LABEL;
}
