"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateCenterProfileInput } from "@/lib/center-profile/validation";

/**
 * Server action for the Center Profile (Settings — Phase 19).
 *
 * Mirrors `lib/instructors/actions.js`'s `updateInstructor` shape and
 * reasoning: `requireRole(ROLES.ADMIN)` runs first — RLS also enforces this
 * at the database level (`0018_center_profile.sql`'s
 * `center_profile_update_admin`), but the DAL check fails with a clear
 * result instead of a generic 42501 from Postgres. Only the validated,
 * whitelisted fields ever reach the database.
 *
 * No `id` parameter, unlike every other entity's update action: there is
 * exactly one center profile row, keyed by `singleton = true`
 * (0018_center_profile.sql), not by an id the caller would otherwise need
 * to bind.
 */

const CENTER_PROFILE_PATH = "/settings/center-profile";

function submittedValues(formData) {
  return {
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  };
}

export async function updateCenterProfile(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateCenterProfileInput({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  });

  if (!result.success) {
    return { error: "Check the highlighted fields.", fieldErrors: result.errors, values: submittedValues(formData) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("center_profile")
    .update({ ...result.data, updated_at: new Date().toISOString() })
    .eq("singleton", true);

  if (error) {
    console.error("[center-profile] Could not update the center profile:", error.code, error.message);
    return { error: "Could not save the center profile. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(CENTER_PROFILE_PATH);
  redirect(`${CENTER_PROFILE_PATH}?success=updated`);
}
