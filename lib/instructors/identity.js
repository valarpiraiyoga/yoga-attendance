import "server-only";

import { cache } from "react";
import { getAuthUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Instructor identity for the signed-in user — the instructor-side
 * counterpart to `getCurrentUser()` in lib/auth/dal.js.
 *
 * It lives here rather than in the auth DAL because it reads a feature table:
 * `lib/auth/dal.js` stays limited to authentication and role, and feature
 * tables stay with their feature.
 *
 * The database enforces the same rule independently through
 * `public.current_instructor_id()` (supabase/migrations/0004), which is what
 * instructor-scoped RLS will use in later phases. This function is the
 * application-side half; neither one is sufficient alone.
 */

/**
 * Why the caller does or does not have instructor access. Kept explicit so a
 * later instructor route can tell these apart instead of collapsing them into
 * "no access" — in particular, INACTIVE must produce a clear "your access is
 * disabled" screen rather than a bounce to /login, which the proxy would send
 * straight back for an authenticated user (the Phase 8 redirect loop).
 */
export const INSTRUCTOR_ACCESS = {
  /** Not signed in. */
  ANONYMOUS: "anonymous",
  /** Signed in, but no instructor record is linked to this user. */
  UNLINKED: "unlinked",
  /** Linked to an instructor record that is deactivated. */
  INACTIVE: "inactive",
  /** Linked to an active instructor record. */
  ACTIVE: "active",
};

/**
 * Resolves the signed-in user to their instructor record.
 *
 * Memoized per render pass like the auth DAL, so repeated calls within one
 * request do not repeat the round-trips.
 *
 * @returns {Promise<{ access: string, instructor: { id: string, full_name: string, status: string } | null }>}
 */
export const getCurrentInstructor = cache(async () => {
  const user = await getAuthUser();
  if (!user) {
    return { access: INSTRUCTOR_ACCESS.ANONYMOUS, instructor: null };
  }

  const supabase = await createClient();
  const { data: instructor, error } = await supabase
    .from("instructors")
    .select("id, full_name, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Fail closed and loudly. Returning "unlinked" here would deny access
    // just the same, but would report a misconfiguration as "you are not an
    // instructor" — the silent-failure mode that made the Phase 8 grant bug
    // so hard to diagnose.
    console.error(
      `[instructors] Could not resolve instructor identity for user ${user.id}:`,
      error.code,
      error.message
    );
    throw new Error(
      `Could not resolve instructor identity for user ${user.id}. Check that ` +
        "supabase/migrations/0004_instructor_identity.sql has been applied " +
        "(instructors.user_id and the instructors_select_self policy)."
    );
  }

  if (!instructor) {
    return { access: INSTRUCTOR_ACCESS.UNLINKED, instructor: null };
  }

  if (instructor.status !== "active") {
    return { access: INSTRUCTOR_ACCESS.INACTIVE, instructor };
  }

  return { access: INSTRUCTOR_ACCESS.ACTIVE, instructor };
});
