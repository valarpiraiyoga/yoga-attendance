"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateBatchInput, validateBatchStatus } from "@/lib/batches/validation";
import { getStoredPhotoUrl, readPhotoFromForm, stagePhotoChange } from "@/lib/storage/profile-photos";

/**
 * Server actions for Batches.
 *
 * Mirrors lib/instructors/actions.js's shape and reasoning throughout:
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0005_batches.sql), but the
 * DAL check lets us fail with a clear result instead of a generic 42501 from
 * Postgres. Only the validated, whitelisted fields ever reach the database.
 *
 * `updateBatch` takes the batch `id` as a leading argument, bound at the
 * call site (`action={updateBatch.bind(null, id)}`).
 *
 * Unlike Instructors, `createBatch`/`updateBatch` redirect to the new/edited
 * batch's own Details page, not the list — 02-ux.md Flow 03 ("Batches → Add
 * Batch → Batch Details → Save → New Batch → Schedules → Add Schedule")
 * continues directly from there into adding a schedule, and the wireframe's
 * "Edit Batch" action (p17) is launched from that same Details page.
 *
 * Batch Identity: the colour key (`batch_color`) is validated with the other
 * fields; the optional image arrives in the same multipart submission
 * (`photo` and/or `remove_photo`) and is handled exactly as a person's photo
 * is - see lib/storage/profile-photos.js. Its URL is saved to
 * `batch_image_url` in the same insert/update, the replaced object is deleted
 * only after that save succeeds, and a failed save deletes the new upload.
 *
 * There is no standalone `setBatchStatus` (the Instructor list's quick
 * Activate/Deactivate has no equivalent here): no product/UX document or
 * wireframe describes an inline status action for Batches, only the
 * capability itself (01-product.md §6). Status changes go through
 * `updateBatch`'s Status field, matching wireframe p17's "Edit Batch".
 */

const BATCHES_PATH = "/batches";

function batchPath(id) {
  return `${BATCHES_PATH}/${id}`;
}

// React resets every uncontrolled form field to its current `defaultValue`
// as part of submitting a form action, before the action even runs and
// regardless of outcome (react-dom's requestFormReset) — see
// InstructorForm's comment. Returning what was submitted lets the form show
// it back instead of snapping to the batch's original values (or blank).
function submittedValues(formData) {
  return {
    name: formData.get("name"),
    code: formData.get("code"),
    category: formData.get("category"),
    description: formData.get("description"),
    batch_color: formData.get("batch_color"),
  };
}

// The image lives in the shared photo bucket, in the `batches/` folder, and
// its URL in `batch_image_url` rather than `photo_url`.
const IMAGE = { folder: "batches", column: "batch_image_url" };

// Postgres unique_violation — batches_code_unique (0005_batches.sql). Not
// logged: this is an expected, user-actionable conflict, not a failure worth
// investigating, so it's treated like a validation error rather than a
// database error.
function duplicateCodeResult(formData) {
  return {
    error: "Check the highlighted fields.",
    fieldErrors: { code: "This short code is already used by another batch." },
    values: submittedValues(formData),
  };
}

function isDuplicateCodeError(error) {
  return error.code === "23505";
}

export async function createBatch(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateBatchInput({
    name: formData.get("name"),
    code: formData.get("code"),
    category: formData.get("category"),
    description: formData.get("description"),
    batch_color: formData.get("batch_color"),
  });
  const image = readPhotoFromForm(formData, "image");

  if (!result.success || image.error) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(image.error ? { photo: image.error } : null) },
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const staged = await stagePhotoChange(supabase, { ...IMAGE, file: image.file, remove: false });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { data, error } = await supabase
    .from("batches")
    .insert({ ...result.data, ...staged.patch })
    .select("id")
    .single();

  if (error) {
    await staged.rollback();
    if (isDuplicateCodeError(error)) {
      return duplicateCodeResult(formData);
    }
    console.error("[batches] Could not create batch:", error.code, error.message);
    return { error: "Could not create the batch. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(BATCHES_PATH);
  redirect(`${batchPath(data.id)}?success=created`);
}

export async function updateBatch(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the batch. Try again." };
  }

  const inputResult = validateBatchInput({
    name: formData.get("name"),
    code: formData.get("code"),
    category: formData.get("category"),
    description: formData.get("description"),
    batch_color: formData.get("batch_color"),
  });
  const statusResult = validateBatchStatus(formData.get("status"));
  const image = readPhotoFromForm(formData, "image");

  const fieldErrors = {
    ...(inputResult.success ? null : inputResult.errors),
    ...(statusResult.success ? null : statusResult.errors),
    ...(image.error ? { photo: image.error } : null),
  };

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors, values: submittedValues(formData) };
  }

  const supabase = await createClient();
  const remove = formData.get("remove_photo") === "1";

  // The stored URL is read only when the image is changing, so it can be
  // deleted once the new state is saved (and never before).
  let oldUrl = null;
  if (image.file || remove) {
    const stored = await getStoredPhotoUrl(supabase, "batches", id, IMAGE.column);
    if (stored.error) return { error: stored.error, values: submittedValues(formData) };
    oldUrl = stored.url;
  }

  const staged = await stagePhotoChange(supabase, { ...IMAGE, file: image.file, remove, oldUrl });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { error } = await supabase
    .from("batches")
    .update({ ...inputResult.data, status: statusResult.data, ...staged.patch })
    .eq("id", id);

  if (error) {
    await staged.rollback();
    if (isDuplicateCodeError(error)) {
      return duplicateCodeResult(formData);
    }
    console.error(`[batches] Could not update batch ${id}:`, error.code, error.message);
    return { error: "Could not update the batch. Try again.", values: submittedValues(formData) };
  }

  await staged.commit();
  revalidatePath(BATCHES_PATH);
  revalidatePath(batchPath(id));
  revalidatePath("/schedule");
  redirect(`${batchPath(id)}?success=updated`);
}
