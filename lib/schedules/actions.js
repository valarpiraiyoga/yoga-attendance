"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  validateScheduleInput,
  isValidDateString,
  subtractOneDayUTC,
  todayDateString,
} from "@/lib/schedules/validation";

/**
 * Server actions for Schedules.
 *
 * Mirrors lib/batches/actions.js's and lib/memberships/actions.js's shape:
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0009_schedules.sql).
 *
 * `createSchedule` and `updateSchedule` share one form (app/schedule/schedule-
 * form.js) and therefore one validator (`validateScheduleInput`) — the Edit
 * form submits a hidden `batch_id` for the existing, non-editable batch, so
 * both actions can read the exact same field set from `formData`.
 *
 * No duplicate-value error mapping exists here, unlike Batches (short code)
 * or Students (student_code): Schedule has no unique/system-generated
 * identifier, and V1 does not block overlapping schedules
 * (01-product.md §12; approved Phase 13 decision) — see
 * 0009_schedules.sql's comment for why no such constraint exists to violate.
 */

const SCHEDULE_PATH = "/schedule";

function schedulePath(id) {
  return `${SCHEDULE_PATH}/${id}`;
}

// React resets every uncontrolled form field to its current `defaultValue`
// on every form-action submission, before the action even runs and
// regardless of outcome (react-dom's requestFormReset) — see
// StudentForm's comment.
function submittedValues(formData) {
  return {
    batch_id: formData.get("batch_id"),
    instructor_id: formData.get("instructor_id"),
    day_of_week: formData.get("day_of_week"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    effective_from: formData.get("effective_from"),
    effective_until: formData.get("effective_until"),
  };
}

function readScheduleInput(formData) {
  return {
    batch_id: formData.get("batch_id"),
    instructor_id: formData.get("instructor_id"),
    day_of_week: formData.get("day_of_week"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    effective_from: formData.get("effective_from"),
    effective_until: formData.get("effective_until"),
  };
}

export async function createSchedule(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const result = validateScheduleInput(readScheduleInput(formData));

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedules")
    .insert(result.data)
    .select("id")
    .single();

  if (error) {
    console.error("[schedules] Could not create schedule:", error.code, error.message);
    return { error: "Could not save the schedule. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(SCHEDULE_PATH);
  revalidatePath(`/batches/${result.data.batch_id}`);
  revalidatePath(`/batches/${result.data.batch_id}/schedules`);
  redirect(`${schedulePath(data.id)}?success=created`);
}

/**
 * Edits a schedule (02-ux.md Flow 04). Versions rather than rewriting in
 * place (01-product.md §7): the submitted `effective_from` is the date the
 * change takes effect, not a rewrite of the existing row's own start date.
 *
 * Two cases, both required to keep every row satisfying
 * `effective_until >= effective_from`:
 *
 * - The new effective date falls AFTER the current version's own effective
 *   from date (the normal case — the current version has already been, or
 *   is currently, in effect): the current row is closed by setting its
 *   `effective_until` to the day before, and a new row is inserted with the
 *   edited values starting on the given date. This is the "close existing,
 *   create new version" rule.
 * - The new effective date falls on or BEFORE the current version's own
 *   effective from date (editing a schedule that has not started yet, or
 *   correcting it the same day it starts): there is no live period to
 *   protect, so closing the current row would require an invalid
 *   `effective_until` earlier than its own `effective_from`. The row is
 *   updated in place instead.
 *
 * Either way, a change can never be back-dated before today — that would
 * silently rewrite what was scheduled on an already-elapsed date, which
 * §12's Historical Integrity rules forbid.
 */
export async function updateSchedule(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the schedule. Try again." };
  }

  const result = validateScheduleInput(readScheduleInput(formData));

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
      values: submittedValues(formData),
    };
  }

  const today = todayDateString();
  if (result.data.effective_from < today) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { effective_from: "Effective from cannot be in the past." },
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("schedules")
    .select("batch_id, effective_from, effective_until")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not update the schedule. Try again." };
  }

  if (result.data.effective_from <= existing.effective_from) {
    // No live period exists yet under the current version — update in
    // place rather than versioning into an invalid closed row.
    const { error } = await supabase.from("schedules").update(result.data).eq("id", id);

    if (error) {
      console.error(`[schedules] Could not update schedule ${id}:`, error.code, error.message);
      return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
    }

    revalidatePath(SCHEDULE_PATH);
    revalidatePath(schedulePath(id));
    revalidatePath(`/batches/${existing.batch_id}`);
    revalidatePath(`/batches/${existing.batch_id}/schedules`);
    redirect(`${schedulePath(id)}?success=updated`);
  }

  // Versioning: close the current row the day before the change, then
  // insert the new version. PostgREST offers no multi-statement
  // transaction here, so an insert failure after a successful close is
  // compensated by reverting the close rather than left half-applied.
  const closesAt = subtractOneDayUTC(result.data.effective_from);

  const { error: closeError } = await supabase
    .from("schedules")
    .update({ effective_until: closesAt })
    .eq("id", id);

  if (closeError) {
    console.error(`[schedules] Could not close schedule ${id} for versioning:`, closeError.code, closeError.message);
    return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
  }

  const { data: newRow, error: insertError } = await supabase
    .from("schedules")
    .insert(result.data)
    .select("id")
    .single();

  if (insertError) {
    await supabase.from("schedules").update({ effective_until: existing.effective_until }).eq("id", id);
    console.error(`[schedules] Could not insert new version for schedule ${id}:`, insertError.code, insertError.message);
    return { error: "Could not save the schedule changes. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(SCHEDULE_PATH);
  revalidatePath(schedulePath(id));
  revalidatePath(schedulePath(newRow.id));
  revalidatePath(`/batches/${existing.batch_id}`);
  revalidatePath(`/batches/${existing.batch_id}/schedules`);
  redirect(`${schedulePath(newRow.id)}?success=updated`);
}

/**
 * Deactivates a schedule (02-ux.md Flow 05: Deactivate → Set Effective
 * Until → Review → Confirm → Save). Called directly from a client component
 * wrapped in `useTransition` — Next.js's documented pattern for invoking a
 * Server Action outside a form — matching lib/students/actions.js's
 * `setStudentStatus` and lib/memberships/actions.js's `cancelMembership`.
 *
 * Closes the schedule by setting `effective_until` and marking it inactive;
 * never deletes. Rejects an already-inactive schedule rather than silently
 * no-op'ing. There is no reactivate action — 01-product.md §7 documents
 * deactivation as a capability but no equivalent "reactivate a closed
 * schedule" flow; starting a new schedule (Add Schedule) is how service
 * resumes, consistent with schedules being versioned records.
 */
export async function deactivateSchedule(id, effectiveUntil) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not deactivate the schedule. Try again." };
  }

  const trimmedUntil = String(effectiveUntil ?? "").trim();
  if (!isValidDateString(trimmedUntil)) {
    return { error: "Enter a valid effective until date." };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("schedules")
    .select("batch_id, effective_from, status")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not deactivate the schedule. Try again." };
  }

  if (existing.status === "inactive") {
    return { error: "This schedule is already inactive." };
  }

  if (trimmedUntil < existing.effective_from) {
    return { error: "Effective until cannot be before the schedule's effective from date." };
  }

  const { error } = await supabase
    .from("schedules")
    .update({ effective_until: trimmedUntil, status: "inactive" })
    .eq("id", id);

  if (error) {
    console.error(`[schedules] Could not deactivate schedule ${id}:`, error.code, error.message);
    return { error: "Could not deactivate the schedule. Try again." };
  }

  revalidatePath(SCHEDULE_PATH);
  revalidatePath(schedulePath(id));
  revalidatePath(`/batches/${existing.batch_id}`);
  revalidatePath(`/batches/${existing.batch_id}/schedules`);
  return { success: "Schedule deactivated successfully." };
}
