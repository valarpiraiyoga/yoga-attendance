"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCentreToday } from "@/lib/center-profile/settings";
import { getRepresentativeSchedulesForSeries } from "@/lib/schedules/data";
import { attendanceConflictMessage, findAttendanceOnDate } from "@/lib/enrollments/attendance-conflict";
import { fullScheduleSeriesId, mapEnrollmentSaveError, SAVE_ERROR_MESSAGE, scheduleLabel } from "@/lib/enrollments/save-errors";
import { changedStartBeforeJoinDateError, startBeforeJoinDateError } from "@/lib/students/join-date";
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
 * (lib/enrollments/save-errors.js) to a field error on `batch_id`, the field
 * the admin needs to change (pick a different batch, or deactivate the
 * existing enrollment first).
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
 * closed (or withdrawn, if they had not started yet), and added series start on an explicit, separately validated
 * "schedule effective date" — the documented close-and-create behaviour
 * (02-ux.md Flow 10), never a rewrite of an existing assignment's period.
 * Join date and start date (migration 0051): an enrollment cannot START before its student joined. `createEnrollment` checks it
 * before writing, and `updateEnrollment` checks it only when the start date CHANGES, so an unrelated edit of a record that is
 * already out of range still works; the database refuses the same writes whoever sends them. When the start date changes, the
 * database also moves the enrollment's INITIAL schedule assignments (those that start exactly on the old start) in the same
 * statement; `change_enrollment` (0060) re-reads their dates before it decides what to close or withdraw, and `updateEnrollment`
 * reports the moved count it returns.
 *
 * Attendance on the effective date (Phase 16A step 6): a new enrollment's start date, a CHANGED start date and a schedule/batch change
 * date are refused when the student already has recorded class-session attendance on that date, in any batch (see
 * `lib/enrollments/attendance-conflict.js`). The check runs on the server before anything is written. End dates, status and
 * instructor changes are not checked.
 *
 * Schedule capacity (V1 Final Improvements, S3; 01-product.md §7 "Schedule
 * Capacity"): every write goes through one database function -
 * `create_enrollment` or `change_enrollment` (migration 0060) - which saves
 * the enrollment and all its schedule assignments (the close, withdraw and
 * add steps, and the 0051 start-date cascade with its moved count) in ONE
 * transaction. If a selected schedule is full, or any other database rule
 * refuses, nothing at all is written: no enrollment without its schedules,
 * no schedule ended without its replacement. The checks above still run
 * first, so the Admin gets the same field errors as before; the database
 * checks again, including capacity, which only it can judge safely when two
 * Admins save at once. Its refusals are mapped to field errors by
 * lib/enrollments/save-errors.js, and anything else is logged and shown as
 * the generic message, never as database wording. Needs 0060 applied.
 */

const STUDENTS_PATH = "/students";

// The attendance-on-the-effective-date rule as an action result: null when the date is free, else the result to return. A failed
// lookup refuses the save too - the rule is never skipped because it could not be checked.
async function attendanceDateRefusal(supabase, studentId, date, field, formData) {
  const { conflict, failed } = await findAttendanceOnDate(supabase, studentId, date);
  if (failed) return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  if (conflict) {
    return { error: "Check the highlighted fields.", fieldErrors: { [field]: attendanceConflictMessage(date) }, values: submittedValues(formData) };
  }
  return null;
}

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

// A refused save as an action result: a field error the Admin can act on, or the generic message (the details are logged, never
// shown). A full schedule is named ("The Monday 6:00 AM – 7:00 AM schedule is full ...") when it can be looked up.
async function saveRefusal(error, formData, logPrefix) {
  let label = null;
  const seriesId = fullScheduleSeriesId(error);
  if (seriesId) {
    try {
      label = scheduleLabel((await getRepresentativeSchedulesForSeries([seriesId])).get(seriesId));
    } catch {
      label = null; // naming the schedule is a courtesy; the refusal stands without it
    }
  }

  const mapped = mapEnrollmentSaveError(error, { scheduleLabel: label });
  if (mapped) {
    return { error: "Check the highlighted fields.", fieldErrors: { [mapped.field]: mapped.error }, values: submittedValues(formData) };
  }

  console.error(logPrefix, error?.code, error?.message);
  return { error: SAVE_ERROR_MESSAGE, values: submittedValues(formData) };
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

  // The start date cannot be before the student joined (the database refuses it again, whoever writes).
  const { data: joiner } = await supabase.from("students").select("join_date").eq("id", studentId).maybeSingle();
  const joinDateError = startBeforeJoinDateError("enrollment", result.data.effective_start_date, joiner?.join_date);
  if (joinDateError) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { effective_start_date: joinDateError },
      values: submittedValues(formData),
    };
  }

  // A new enrollment may start on a past date: not on a day this student already attended a class.
  const startRefusal = await attendanceDateRefusal(supabase, studentId, result.data.effective_start_date, "effective_start_date", formData);
  if (startRefusal) return startRefusal;

  // The enrollment and every selected schedule, each from the enrollment's start, in one transaction (0060): a full schedule, a
  // duplicate enrollment or the join date refuses all of it.
  const { error } = await supabase.rpc("create_enrollment", {
    p_student_id: studentId,
    p_batch_id: result.data.batch_id,
    p_start_date: result.data.effective_start_date,
    p_end_date: result.data.effective_end_date,
    p_series_ids: scheduleResult.data,
  });

  if (error) {
    return saveRefusal(error, formData, `[enrollments] Could not create enrollment for student ${studentId}:`);
  }

  revalidatePath(studentPath(studentId));
  // The Add Student guided flow's last step marks itself with a hidden
  // `guided=1` field; Student Details then shows the flow's completion screen.
  const guidedSuffix = formData.get("guided") === "1" ? "&guided=1" : "";
  redirect(`${studentPath(studentId)}?success=enrollment_added${guidedSuffix}`);
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

  // The enrollment as stored now, and its student's join date. Only a CHANGED start date is judged against the join date, so an
  // unrelated edit of a record that is already out of range (a status change, an end date) is never refused.
  const { data: stored } = await supabase
    .from("batch_enrollments")
    .select("batch_id, student_id, effective_start_date, students(join_date)")
    .eq("id", id)
    .maybeSingle();

  if (!stored) {
    return { error: "Could not save the enrollment. Try again.", values: submittedValues(formData) };
  }

  const joinDateError = changedStartBeforeJoinDateError("enrollment", {
    previousStart: stored.effective_start_date,
    nextStart: inputResult.data.effective_start_date,
    joinDate: stored.students?.join_date,
  });
  if (joinDateError) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { effective_start_date: joinDateError },
      values: submittedValues(formData),
    };
  }

  // A CHANGED start date cannot be a day this student already attended a class. (An unchanged start date is never re-judged, so an
  // unrelated edit - status, end date - of an enrollment whose first day has attendance still works.)
  if (inputResult.data.effective_start_date !== stored.effective_start_date) {
    const startRefusal = await attendanceDateRefusal(supabase, stored.student_id, inputResult.data.effective_start_date, "effective_start_date", formData);
    if (startRefusal) return startRefusal;
  }

  // What is *currently* assigned, read fresh from the database — never
  // trusted from whatever the client pre-checked at page load, since this
  // submission may be minutes or days later.
  const today = await getCentreToday();
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

    // A schedule or batch change (a different batch always means different schedules) cannot take effect on a day this student
    // already attended a class, in any batch.
    const changeRefusal = await attendanceDateRefusal(supabase, stored.student_id, scheduleChangeDate, "schedule_effective_date", formData);
    if (changeRefusal) return changeRefusal;
  }

  // The enrollment fields (with the 0051 start-date cascade), then the dropped schedules closed the day before the change date or
  // withdrawn if they have not started, then the added ones from it - in one transaction (0060). A full schedule, a cascade
  // conflict, the join date or a duplicate enrollment refuses all of it: nothing is half-saved.
  const { data: saved, error } = await supabase.rpc("change_enrollment", {
    p_enrollment_id: id,
    p_batch_id: inputResult.data.batch_id,
    p_start_date: inputResult.data.effective_start_date,
    p_end_date: inputResult.data.effective_end_date,
    p_status: statusResult.data,
    p_series_ids: scheduleResult.data,
    p_change_date: scheduleChangeDate,
  });

  if (error) {
    return saveRefusal(error, formData, `[enrollments] Could not update enrollment ${id}:`);
  }

  // How many initial assignments moved with the start date (0051), as the database counted them.
  const movedAssignments = Number(saved?.moved) || 0;

  revalidatePath(studentPath(studentId));
  redirect(`${studentPath(studentId)}?success=enrollment_updated${movedAssignments > 0 ? `&moved=${movedAssignments}` : ""}`);
}
