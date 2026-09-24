"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateInstructorInput, validateInstructorStatus } from "@/lib/instructors/validation";
import { getStoredPhotoUrl, readPhotoFromForm, stagePhotoChange } from "@/lib/storage/profile-photos";

/**
 * Server actions for Settings → Instructors.
 *
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0002_instructors.sql), but
 * the DAL check lets us fail with a clear result instead of a generic 42501
 * from Postgres. Only the validated, whitelisted fields ever reach the
 * database; no caller input is passed through to `insert`/`update` directly.
 *
 * `updateInstructor` and `setInstructorStatus` take the instructor `id` as a
 * leading argument, bound at the call site (`action={updateInstructor.bind(null, id)}`),
 * the standard Next.js pattern for a per-row action.
 *
 * `updateInstructor` also accepts `status` (the Edit form's Status field) and
 * validates it with the same `validateInstructorStatus` that
 * `setInstructorStatus` uses — `createInstructor` does not accept it at all;
 * a new instructor keeps the database's default of 'active'.
 *
 * The profile photo (optional) arrives in the same multipart submission
 * (`photo` and/or `remove_photo`) and is handled exactly as for students -
 * see lib/students/actions.js and lib/storage/profile-photos.js. `photo_url`
 * is never taken from form input.
 *
 * `createInstructor`/`updateInstructor` redirect with a `?success=created` /
 * `?success=updated` query param so the list page (a fresh request after the
 * redirect) can render the matching success message — there is no
 * client-side state connecting the two requests. `setInstructorStatus` isn't
 * redirect-based (it's called directly from the list, no navigation), so it
 * returns its message the normal `{ success }` way instead.
 */

const INSTRUCTORS_PATH = "/settings/instructors";

// React resets every uncontrolled form field to its current `defaultValue`
// as part of submitting a form action — before the action even runs, and
// regardless of whether it succeeds or fails (react-dom's
// requestFormReset). The only way a failed submission can show back what
// the user actually typed is for the action to hand it back, so the form
// can use it as that current `defaultValue` (see instructor-form.js).
// Never included on success: a redirect follows immediately and there is no
// re-render to preserve anything for.
function submittedValues(formData) {
  return {
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    phone_country_code: formData.get("phone_country_code"),
    email: formData.get("email"),
  };
}

// Postgres unique_violation — instructors_email_unique (0002_instructors.sql).
// Not logged: this is an expected, user-actionable conflict, not a failure
// worth investigating, so it's treated like a validation error rather than a
// database error.
function duplicateEmailResult(formData) {
  return {
    error: "Check the highlighted fields.",
    fieldErrors: { email: "This email is already registered to another instructor." },
    values: submittedValues(formData),
  };
}

function isDuplicateEmailError(error) {
  return error.code === "23505";
}

export async function createInstructor(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateInstructorInput({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    phone_country_code: formData.get("phone_country_code"),
  });
  const photo = readPhotoFromForm(formData);

  if (!result.success || photo.error) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(photo.error ? { photo: photo.error } : null) },
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const staged = await stagePhotoChange(supabase, { folder: "instructors", file: photo.file, remove: false });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { error } = await supabase.from("instructors").insert({ ...result.data, ...staged.patch });

  if (error) {
    await staged.rollback();
    if (isDuplicateEmailError(error)) {
      return duplicateEmailResult(formData);
    }
    console.error("[instructors] Could not create instructor:", error.code, error.message);
    return { error: "Could not create the instructor. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(INSTRUCTORS_PATH);
  redirect(`${INSTRUCTORS_PATH}?success=created`);
}

export async function updateInstructor(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the instructor. Try again." };
  }

  const inputResult = validateInstructorInput({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    phone_country_code: formData.get("phone_country_code"),
  });
  const statusResult = validateInstructorStatus(formData.get("status"));
  const photo = readPhotoFromForm(formData);

  const fieldErrors = {
    ...(inputResult.success ? null : inputResult.errors),
    ...(statusResult.success ? null : statusResult.errors),
    ...(photo.error ? { photo: photo.error } : null),
  };

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors, values: submittedValues(formData) };
  }

  const supabase = await createClient();
  const remove = formData.get("remove_photo") === "1";

  let oldUrl = null;
  if (photo.file || remove) {
    const stored = await getStoredPhotoUrl(supabase, "instructors", id);
    if (stored.error) return { error: stored.error, values: submittedValues(formData) };
    oldUrl = stored.url;
  }

  const staged = await stagePhotoChange(supabase, { folder: "instructors", file: photo.file, remove, oldUrl });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { error } = await supabase
    .from("instructors")
    .update({ ...inputResult.data, status: statusResult.data, ...staged.patch })
    .eq("id", id);

  if (error) {
    await staged.rollback();
    if (isDuplicateEmailError(error)) {
      return duplicateEmailResult(formData);
    }
    console.error(`[instructors] Could not update instructor ${id}:`, error.code, error.message);
    return { error: "Could not update the instructor. Try again.", values: submittedValues(formData) };
  }

  await staged.commit();
  revalidatePath(INSTRUCTORS_PATH);
  redirect(`${INSTRUCTORS_PATH}?success=updated`);
}

export async function setInstructorStatus(id, status) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update instructor status. Try again." };
  }

  const result = validateInstructorStatus(status);
  if (!result.success) {
    return { error: result.errors.status };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("instructors")
    .update({ status: result.data })
    .eq("id", id);

  if (error) {
    console.error(
      `[instructors] Could not set status for instructor ${id}:`,
      error.code,
      error.message
    );
    return { error: "Could not update instructor status. Try again." };
  }

  revalidatePath(INSTRUCTORS_PATH);
  return {
    success:
      result.data === "active"
        ? "Instructor activated successfully."
        : "Instructor deactivated successfully.",
  };
}

/**
 * Provides login access to an instructor (01-product.md §11; 02-ux.md Flow 12).
 *
 * A deliberate, separate admin action — never a side effect of creating an
 * instructor, matching Flow 12's ordering (Add/Edit → Set Active/Inactive →
 * Provide Login Access).
 *
 * The link is established from the id the invite API returns, not by matching
 * on email: email is mutable and is an identifier the admin can edit later,
 * so it must never be what authorization depends on. The authorization
 * relationship is only ever `instructors.user_id = auth.uid()`.
 *
 * Only the invite itself uses the secret key. The link is written back
 * through the admin's own session, so RLS still applies to the write.
 */
export async function provideLoginAccess(id, _prevState) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not provide login access. Try again." };
  }

  const supabase = await createClient();
  const { data: instructor, error: readError } = await supabase
    .from("instructors")
    .select("id, full_name, email, status, user_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error(
      `[instructors] Could not read instructor ${id} for login access:`,
      readError.code,
      readError.message
    );
    return { error: "Could not provide login access. Try again." };
  }

  if (!instructor) {
    return { error: "That instructor no longer exists." };
  }
  if (instructor.user_id) {
    return { error: "This instructor already has login access." };
  }
  if (instructor.status !== "active") {
    return { error: "Activate this instructor before providing login access." };
  }
  if (!instructor.email) {
    return { error: "Add an email address for this instructor before providing login access." };
  }

  const origin = (await headers()).get("origin");
  const inviteOptions = { data: { full_name: instructor.full_name } };
  if (origin) {
    // /auth/invite (not /auth/confirm or /auth/callback) — this project uses
    // Supabase's DEFAULT, unmodified invite email template, which redirects
    // here via GoTrue's own /verify with the session in a URL fragment
    // (#access_token=...), not a ?code= or ?token_hash= query param. Only a
    // client page can read a fragment, so app/auth/invite/page.js is a page,
    // not another route.js — see its own comment for the full trace.
    inviteOptions.redirectTo = `${origin}/auth/invite?next=/reset-password`;
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (configError) {
    // SUPABASE_SECRET_KEY missing. Keep the detail in the log, not in the UI.
    console.error("[instructors] Admin client unavailable:", configError.message);
    return { error: "Login access is not configured on the server yet." };
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    instructor.email,
    inviteOptions
  );

  if (inviteError) {
    console.error(
      `[instructors] Could not invite instructor ${id}:`,
      inviteError.code,
      inviteError.message
    );
    if (inviteError.code === "email_exists") {
      return {
        error:
          "An account already exists for that email address. Use a different " +
          "email, or link the existing account manually.",
      };
    }
    return { error: "Could not send the invitation. Try again." };
  }

  const invitedUserId = invited?.user?.id;
  if (!invitedUserId) {
    console.error(`[instructors] Invite for instructor ${id} returned no user id.`);
    return { error: "Could not complete the invitation. Check the server logs." };
  }

  // `is("user_id", null)` makes the write lose safely if a concurrent request
  // linked this instructor first, rather than overwriting an existing link.
  const { data: linked, error: linkError } = await supabase
    .from("instructors")
    .update({ user_id: invitedUserId })
    .eq("id", id)
    .is("user_id", null)
    .select("id");

  if (linkError || linked?.length !== 1) {
    console.error(
      `[instructors] Invitation sent but linking failed for instructor ${id} ` +
        `(auth user ${invitedUserId}). The auth account now exists without an ` +
        "instructor link and needs manual resolution:",
      linkError?.code,
      linkError?.message
    );
    return {
      error:
        "The invitation was sent but the account could not be linked. " +
        "Check the server logs before retrying.",
    };
  }

  revalidatePath(INSTRUCTORS_PATH);
  revalidatePath(`${INSTRUCTORS_PATH}/${id}/edit`);
  return { success: "Login access invitation sent." };
}
