"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateCenterProfileInput } from "@/lib/center-profile/validation";
import { getStoredPhotoUrl, readPhotoFromForm, stagePhotoChange } from "@/lib/storage/profile-photos";

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
 * Regional Settings (time zone, currency) and the logo are saved in the same
 * update. The logo arrives in the same multipart submission (`photo` /
 * `remove_photo`) and is handled exactly as a Batch image or a person's photo:
 * uploaded first, its URL saved with the other fields, the replaced file deleted
 * only after that save succeeds, the new file deleted if the save fails. A
 * saved time zone / currency takes effect on the next request - nothing caches
 * them between requests (`getCenterSettings`, lib/center-profile/settings.js) -
 * so the whole app is revalidated.
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
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
  };
}

// The logo lives in the shared photo bucket, in the `center/` folder, and its
// URL in `center_profile.logo_url`.
const LOGO = { folder: "center", column: "logo_url" };

export async function updateCenterProfile(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateCenterProfileInput({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
  });
  const logo = readPhotoFromForm(formData, "logo");

  if (!result.success || logo.error) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(logo.error ? { photo: logo.error } : null) },
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const remove = formData.get("remove_photo") === "1";

  // The stored URL is read only when the logo is changing, so the old file can
  // be deleted once the new state is saved (and never before).
  let oldUrl = null;
  if (logo.file || remove) {
    const stored = await getStoredPhotoUrl(supabase, "center_profile", true, LOGO.column, "singleton");
    if (stored.error) return { error: stored.error, values: submittedValues(formData) };
    oldUrl = stored.url;
  }

  const staged = await stagePhotoChange(supabase, { ...LOGO, file: logo.file, remove, oldUrl });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { error } = await supabase
    .from("center_profile")
    .update({ ...result.data, ...staged.patch, updated_at: new Date().toISOString() })
    .eq("singleton", true);

  if (error) {
    await staged.rollback();
    console.error("[center-profile] Could not update the center profile:", error.code, error.message);
    return { error: "Could not save the center profile. Try again.", values: submittedValues(formData) };
  }

  await staged.commit();
  revalidatePath("/", "layout");
  revalidatePath(CENTER_PROFILE_PATH);
  redirect(`${CENTER_PROFILE_PATH}?success=updated`);
}
