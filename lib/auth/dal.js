import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CHANGE_PASSWORD_PATH, mustChangePassword } from "@/lib/auth/password-change-required";

export const ROLES = {
  ADMIN: "admin",
  INSTRUCTOR: "instructor",
};

/**
 * Data Access Layer for authentication and authorization.
 *
 * The proxy performs a coarse authentication check, but it is not the security
 * boundary. Every protected page and server action must call `requireUser()`
 * or `requireRole()` from here, so authorization is enforced server-side and
 * cannot be bypassed by navigating directly to a URL.
 *
 * Results are memoized with React `cache()` for the duration of a single
 * render pass, so repeated calls do not repeat the network round-trips.
 */

/** The verified Supabase auth user, or null. */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
});

/**
 * The authenticated user combined with their application role.
 *
 * Role lives in `public.profiles` (see supabase/migrations). RLS restricts a
 * user to reading only their own row.
 */
export const getCurrentUser = cache(async () => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (error) {
    // Surface the real cause instead of failing silently — e.g. a missing
    // table grant (42501) or a missing profile row (PGRST116).
    console.error(
      `[auth] Could not read profile for user ${user.id}:`,
      error.code,
      error.message
    );
    return null;
  }

  if (!profile?.role) return null;

  return {
    id: user.id,
    email: user.email,
    name: profile.full_name || user.email,
    role: profile.role,
  };
});

/**
 * Requires an authenticated user with a resolvable role.
 *
 * The two failure modes are deliberately different:
 *
 * - No authenticated user -> redirect to /login (normal signed-out path).
 * - Authenticated but no role -> throw. Redirecting here would bounce against
 *   the proxy, which sends authenticated users away from /login, producing an
 *   infinite redirect loop and a page stuck rendering.
 */
export async function requireUser() {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");

  // A user still on an Admin-generated temporary password may use nothing but the change-password page. The proxy redirects them too; this is
  // the second line, covering every protected page and server action even where the proxy's matcher does not reach (a signed-in user's
  // metadata comes from Supabase Auth itself, never from the cookie alone).
  if (mustChangePassword(authUser)) redirect(CHANGE_PASSWORD_PATH);

  const user = await getCurrentUser();
  if (!user) {
    throw new Error(
      `Signed-in user ${authUser.id} has no application role. ` +
        "Check that public.profiles has a row for this user and that the " +
        "'authenticated' role has been granted access (see " +
        "supabase/migrations/0001_auth_profiles.sql)."
    );
  }

  return user;
}

/**
 * Requires the authenticated user to hold one of `allowedRoles`.
 *
 * Use this to guard Admin-only pages and server actions in later phases, so
 * an Instructor cannot reach them by typing the URL.
 */
export async function requireRole(...allowedRoles) {
  const user = await requireUser();
  if (!allowedRoles.includes(user.role)) redirect("/");
  return user;
}
