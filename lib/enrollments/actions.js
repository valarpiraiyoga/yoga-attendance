"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateEnrollmentInput, validateEnrollmentStatus } from "@/lib/enrollments/validation";

/**
 * Server actions for Batch Enrollments.
 *
 * Mirrors lib/batches/actions.js's and lib/students/actions.js's shape:
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0007_batch_enrollments.sql).
 *
 * "At most one active enrollment per (student, batch)" (01-product.md §12)
 * is enforced by a partial unique index at the database
 * (batch_enrollments_one_active_per_batch), exactly like
 * lib/batches/actions.js's duplicate-code handling — its 23505 is mapped
 * here to a field error on `batch_id`, the field the admin needs to change
 * (pick a different batch, or deactivate the existing enrollment first).
 *
 * Both actions redirect to the student's Details page on success — there is
 * no enrollment list separate from Student Details (wireframe p10).
 */

const STUDENTS_PATH = "/students";

function studentPath(studentId) {
  return `${STUDENTS_PATH}/${studentId}`;
}

// React resets every uncontrolled form field to its current `defaultValue`
// on every form-action submission, before the action even runs and
// regardless of outcome (react-dom's requestFormReset) — see
// InstructorForm's comment.
function submittedValues(formData) {
  return {
    batch_id: formData.get("batch_id"),
    effective_start_date: formData.get("effective_start_date"),
    effective_end_date: formData.get("effective_end_date"),
  };
}

const DUPLICATE_ENROLLMENT_MESSAGE =
  "This student already has an active enrollment in that batch.";

function isDuplicateEnrollmentError(error) {
  return error.code === "23505";
}

export async function createEnrollment(studentId, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!studentId) {
    return { error: "Could not save the enrollment. Try again." };
  }

  const result = validateEnrollmentInput({
    batch_id: formData.get("batch_id"),
    effective_start_date: formData.get("effective_start_date"),
    effective_end_date: formData.get("effective_end_date"),
  });

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("batch_enrollments")
    .insert({ ...result.data, student_id: studentId });

  if (error) {
    if (isDuplicateEnrollmentError(error)) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: { batch_id: DUPLICATE_ENROLLMENT_MESSAGE },
        values: submittedValues(formData),
      };
    }
    console.error(
      `[enrollments] Could not create enrollment for student ${studentId}:`,
      error.code,
      error.message
    );
    return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(studentPath(studentId));
  redirect(`${studentPath(studentId)}?success=enrollment_added`);
}

export async function updateEnrollment(id, studentId, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id || !studentId) {
    return { error: "Could not save the enrollment. Try again." };
  }

  const inputResult = validateEnrollmentInput({
    batch_id: formData.get("batch_id"),
    effective_start_date: formData.get("effective_start_date"),
    effective_end_date: formData.get("effective_end_date"),
  });
  const statusResult = validateEnrollmentStatus(formData.get("status"));

  const fieldErrors = {
    ...(inputResult.success ? null : inputResult.errors),
    ...(statusResult.success ? null : statusResult.errors),
  };

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors, values: submittedValues(formData) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("batch_enrollments")
    .update({ ...inputResult.data, status: statusResult.data })
    .eq("id", id);

  if (error) {
    if (isDuplicateEnrollmentError(error)) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: { batch_id: DUPLICATE_ENROLLMENT_MESSAGE },
        values: submittedValues(formData),
      };
    }
    console.error(`[enrollments] Could not update enrollment ${id}:`, error.code, error.message);
    return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(studentPath(studentId));
  redirect(`${studentPath(studentId)}?success=enrollment_updated`);
}
