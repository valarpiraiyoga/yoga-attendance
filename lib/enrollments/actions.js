"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString, subtractOneDayUTC } from "@/lib/schedules/validation";
import {
  validateEnrollmentInput,
  validateEnrollmentStatus,
  validateScheduleSelection,
  validateScheduleChangeDate,
} from "@/lib/enrollments/validation";

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
 *
 * Phase 15A (01-product.md §4 "Schedule Assignment") added schedule
 * selection to both actions: an enrollment must carry at least one
 * schedule assignment (`enrollment_schedules`). `createEnrollment` writes
 * every selected assignment starting on the enrollment's own effective
 * start date — the whole enrollment is new, so its schedules start when it
 * does. `updateEnrollment` instead diffs the submission against whatever
 * is *currently* assigned (read fresh from the database, never trusted
 * from the client): unchanged series are left alone, removed series are
 * closed, and added series start on an explicit, separately validated
 * "schedule effective date" — the documented close-and-create behaviour
 * (02-ux.md Flow 10), never a rewrite of an existing assignment's period.
 * Neither action can make this fully atomic with the enrollment write
 * itself — PostgREST has no cross-statement transaction, the same
 * accepted gap Phase 14/15's session and attendance actions already carry
 * — so a schedule-write failure after a successful enrollment write is
 * logged and left for Student Details' "no schedule assigned" flag to
 * surface honestly, not hidden or silently retried.
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
  const scheduleResult = validateScheduleSelection(formData.getAll("schedule_series_ids"));

  const fieldErrors = {
    ...(result.success ? null : result.errors),
    ...(scheduleResult.success ? null : scheduleResult.errors),
  };

  if (Object.keys(fieldErrors).length > 0) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();

  // Every selected schedule must actually belong to the enrolled batch —
  // verified against the database, not trusted from whatever the client
  // rendered (01-product.md §4: "Do not allow schedules from another batch").
  const { data: seriesRows, error: seriesError } = await supabase
    .from("schedule_series")
    .select("id, batch_id")
    .in("id", scheduleResult.data);

  if (seriesError) {
    console.error("[enrollments] Could not verify schedule selection:", seriesError.code, seriesError.message);
    return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  }

  const invalidSelection =
    seriesRows.length !== scheduleResult.data.length ||
    seriesRows.some((series) => series.batch_id !== result.data.batch_id);

  if (invalidSelection) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { schedule_series_ids: "Select schedules that belong to the chosen batch." },
      values: submittedValues(formData),
    };
  }

  const { data: enrollment, error } = await supabase
    .from("batch_enrollments")
    .insert({ ...result.data, student_id: studentId })
    .select("id")
    .single();

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

  // One multi-row insert, not one call per schedule — a single statement is
  // atomic for the assignments themselves. See the module comment for why
  // this still cannot be one transaction together with the enrollment
  // insert above, and why that gap is accepted rather than worked around.
  const { error: scheduleError } = await supabase.from("enrollment_schedules").insert(
    scheduleResult.data.map((seriesId) => ({
      batch_enrollment_id: enrollment.id,
      schedule_series_id: seriesId,
      effective_start_date: result.data.effective_start_date,
    }))
  );

  if (scheduleError) {
    // Not returned as a form error: the enrollment already exists, so
    // re-showing this form would look like nothing was saved. Student
    // Details' "No schedule assigned" flag surfaces this honestly instead
    // of silently repairing or hiding it.
    console.error(
      `[enrollments] Enrollment ${enrollment.id} was created but its schedule assignments could not be saved:`,
      scheduleError.code,
      scheduleError.message
    );
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
  const scheduleResult = validateScheduleSelection(formData.getAll("schedule_series_ids"));

  const fieldErrors = {
    ...(inputResult.success ? null : inputResult.errors),
    ...(statusResult.success ? null : statusResult.errors),
    ...(scheduleResult.success ? null : scheduleResult.errors),
  };

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors, values: submittedValues(formData) };
  }

  const supabase = await createClient();

  // Every selected schedule must actually belong to the enrolled batch —
  // verified against the database, not trusted from whatever the client
  // rendered (01-product.md §4: "Do not allow schedules from another batch").
  const { data: seriesRows, error: seriesError } = await supabase
    .from("schedule_series")
    .select("id, batch_id")
    .in("id", scheduleResult.data);

  if (seriesError) {
    console.error("[enrollments] Could not verify schedule selection:", seriesError.code, seriesError.message);
    return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  }

  const invalidSelection =
    seriesRows.length !== scheduleResult.data.length ||
    seriesRows.some((series) => series.batch_id !== inputResult.data.batch_id);

  if (invalidSelection) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { schedule_series_ids: "Select schedules that belong to the chosen batch." },
      values: submittedValues(formData),
    };
  }

  // What is *currently* assigned, read fresh from the database — never
  // trusted from whatever the client pre-checked at page load, since this
  // submission may be minutes or days later.
  const today = todayDateString();
  const { data: currentAssignments, error: assignmentsError } = await supabase
    .from("enrollment_schedules")
    .select("id, schedule_series_id, effective_start_date")
    .eq("batch_enrollment_id", id)
    .or(`effective_end_date.is.null,effective_end_date.gte.${today}`);

  if (assignmentsError) {
    console.error(
      `[enrollments] Could not load current schedule assignments for enrollment ${id}:`,
      assignmentsError.code,
      assignmentsError.message
    );
    return { error: "Could not save the enrollment. Try again." };
  }

  const currentSeriesIds = new Set((currentAssignments ?? []).map((a) => a.schedule_series_id));
  const nextSeriesIds = new Set(scheduleResult.data);
  const assignmentsToClose = (currentAssignments ?? []).filter((a) => !nextSeriesIds.has(a.schedule_series_id));
  const seriesIdsToAdd = scheduleResult.data.filter((seriesId) => !currentSeriesIds.has(seriesId));
  const scheduleSelectionChanged = assignmentsToClose.length > 0 || seriesIdsToAdd.length > 0;

  // A no-op schedule selection (identical to what is currently assigned)
  // needs no effective date and writes nothing here — the enrollment's own
  // fields below may still change independently.
  let scheduleChangeDate = null;
  if (scheduleSelectionChanged) {
    const dateResult = validateScheduleChangeDate(formData.get("schedule_effective_date"), today);
    if (!dateResult.success) {
      return { error: "Check the highlighted fields.", fieldErrors: dateResult.errors, values: submittedValues(formData) };
    }
    scheduleChangeDate = dateResult.data;
  }

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

  if (assignmentsToClose.length > 0) {
    // Close each removed assignment the day before the change — unless it
    // started on or after that date itself (e.g. it was only just added in
    // an earlier edit today), in which case backing up a day would put the
    // end date before its own start date. Per-row, not a single bulk
    // update, because each assignment can have its own start date.
    const naiveClosesAt = subtractOneDayUTC(scheduleChangeDate);

    for (const assignment of assignmentsToClose) {
      const closesAt = naiveClosesAt > assignment.effective_start_date ? naiveClosesAt : assignment.effective_start_date;
      const { error: closeError } = await supabase
        .from("enrollment_schedules")
        .update({ effective_end_date: closesAt })
        .eq("id", assignment.id);

      if (closeError) {
        console.error(
          `[enrollments] Could not close schedule assignment ${assignment.id} for enrollment ${id}:`,
          closeError.code,
          closeError.message
        );
        return { error: "The enrollment was updated, but its schedule change could not be saved. Try again." };
      }
    }
  }

  if (seriesIdsToAdd.length > 0) {
    const { error: addError } = await supabase.from("enrollment_schedules").insert(
      seriesIdsToAdd.map((seriesId) => ({
        batch_enrollment_id: id,
        schedule_series_id: seriesId,
        effective_start_date: scheduleChangeDate,
      }))
    );

    if (addError) {
      console.error(
        `[enrollments] Could not add schedule assignments for enrollment ${id}:`,
        addError.code,
        addError.message
      );
      return { error: "The enrollment was updated, but its schedule change could not be saved. Try again." };
    }
  }

  revalidatePath(studentPath(studentId));
  redirect(`${studentPath(studentId)}?success=enrollment_updated`);
}
