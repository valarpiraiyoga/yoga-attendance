"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateStudentInput, validateStudentStatus } from "@/lib/students/validation";
import { getStoredPhotoUrl, readPhotoFromForm, stagePhotoChange } from "@/lib/storage/profile-photos";

/**
 * Server actions for Students.
 *
 * Mirrors lib/instructors/actions.js's and lib/batches/actions.js's shape:
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0006_students.sql), but
 * the DAL check lets us fail with a clear result instead of a generic 42501
 * from Postgres. Only the validated, whitelisted fields ever reach the
 * database; `student_code` is never accepted as input (system-generated and
 * immutable — see that migration).
 *
 * Unlike Instructors/Batches, there is no duplicate-field error path: the
 * approved rules make neither phone nor email unique for students
 * (01-product.md §12), so no 23505 mapping is needed here.
 *
 * `createStudent` redirects into the Add Membership step (02-ux.md Flow 02:
 * Save Student → ... → Add Membership → ... → Add Batch Enrollment), not to
 * the student list or Details — that step is skippable
 * (app/students/[id]/memberships/new/page.js), so an admin can still reach
 * Batch Enrollment without creating a membership first.
 *
 * `updateStudent` and `setStudentStatus` take the student `id` as a leading
 * argument, bound at the call site.
 *
 * The profile photo (optional) arrives in the same multipart submission:
 * `photo` (a new file) and/or `remove_photo`. It is validated here again,
 * uploaded through `stagePhotoChange` (lib/storage/profile-photos.js) before
 * the row is written, and the replaced object is deleted only once the row
 * is saved. `photo_url` is never taken from form input.
 *
 * Status is intentionally NOT part of `updateStudent`: Flow 11 documents
 * deactivation as its own explicit action (Review → Confirm → Save),
 * separate from editing a student's details, so status only ever changes
 * through `setStudentStatus`.
 */

const STUDENTS_PATH = "/students";

function studentPath(id) {
  return `${STUDENTS_PATH}/${id}`;
}

// React resets every uncontrolled form field to its current `defaultValue`
// as part of submitting a form action, before the action even runs and
// regardless of outcome (react-dom's requestFormReset) — see
// InstructorForm's comment. Returning what was submitted lets the form show
// it back instead of snapping to the student's original values (or blank).
function submittedValues(formData) {
  return {
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    date_of_birth: formData.get("date_of_birth"),
    gender: formData.get("gender"),
    join_date: formData.get("join_date"),
    notes: formData.get("notes"),
  };
}

export async function createStudent(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateStudentInput({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    date_of_birth: formData.get("date_of_birth"),
    gender: formData.get("gender"),
    join_date: formData.get("join_date"),
    notes: formData.get("notes"),
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
  const staged = await stagePhotoChange(supabase, { folder: "students", file: photo.file, remove: false });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { data, error } = await supabase
    .from("students")
    .insert({ ...result.data, ...staged.patch })
    .select("id")
    .single();

  if (error) {
    await staged.rollback();
    console.error("[students] Could not create student:", error.code, error.message);
    return { error: "Could not create the student. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(STUDENTS_PATH);
  redirect(`${studentPath(data.id)}/memberships/new?guided=1`);
}

export async function updateStudent(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the student. Try again." };
  }

  const result = validateStudentInput({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    date_of_birth: formData.get("date_of_birth"),
    gender: formData.get("gender"),
    join_date: formData.get("join_date"),
    notes: formData.get("notes"),
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
  const remove = formData.get("remove_photo") === "1";

  let oldUrl = null;
  if (photo.file || remove) {
    const stored = await getStoredPhotoUrl(supabase, "students", id);
    if (stored.error) return { error: stored.error, values: submittedValues(formData) };
    oldUrl = stored.url;
  }

  const staged = await stagePhotoChange(supabase, { folder: "students", file: photo.file, remove, oldUrl });
  if (staged.error) {
    return { error: staged.error, values: submittedValues(formData) };
  }

  const { error } = await supabase
    .from("students")
    .update({ ...result.data, ...staged.patch })
    .eq("id", id);

  if (error) {
    await staged.rollback();
    console.error(`[students] Could not update student ${id}:`, error.code, error.message);
    return { error: "Could not update the student. Try again.", values: submittedValues(formData) };
  }

  await staged.commit();
  revalidatePath(STUDENTS_PATH);
  revalidatePath(studentPath(id));
  redirect(`${studentPath(id)}?success=updated`);
}

export async function setStudentStatus(id, status) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update student status. Try again." };
  }

  const result = validateStudentStatus(status);
  if (!result.success) {
    return { error: result.errors.status };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("students").update({ status: result.data }).eq("id", id);

  if (error) {
    console.error(`[students] Could not set status for student ${id}:`, error.code, error.message);
    return { error: "Could not update student status. Try again." };
  }

  revalidatePath(STUDENTS_PATH);
  revalidatePath(studentPath(id));
  return {
    success:
      result.data === "active"
        ? "Student activated successfully."
        : "Student deactivated successfully.",
  };
}
