"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getScheduleDeleteImpact } from "@/lib/schedules/data";
import { NOT_UNUSED_ERROR_CODES, blockReasonFromError, describeBlockReason } from "@/lib/schedules/usage";
import {
  validateScheduleInput,
  validateScheduleDays,
  validateTimeSlots,
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
 * Edit Schedule can also tick extra weekdays: this schedule keeps its own day
 * (it is one recurring class with its own student assignments) and each extra
 * day becomes a new schedule with the same values.
 *
 * Add Schedule can select several weekdays: `createSchedule` creates one
 * schedule (and one schedule series) per selected day, all with the same batch,
 * instructor, times and effective dates. Each is an ordinary independent
 * schedule (01-product.md §7) — a schedule is always one weekday — so nothing
 * downstream changes, and Edit stays single-day.
 *
 * Unused schedules (01-product.md §7 "Deleting and correcting an unused
 * schedule": no class session, one version, no started assignment) are the
 * exception to "edit versions, never rewrite": `updateSchedule` corrects them
 * in place and `deleteSchedule` removes them, both through database functions
 * (0021) that re-check under locks. Every other schedule keeps the versioned
 * edit and Deactivate.
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
 *
 * Phase 15A (0013_schedule_assignment.sql) added `schedules.series_id`,
 * NOT NULL — every insert here must supply one. `createSchedule` creates a
 * brand-new `schedule_series` for a brand-new schedule; `updateSchedule`'s
 * versioning branch carries the existing row's `series_id` forward onto
 * the new version, since the two are the same stable schedule identity,
 * just a new version of it. Student schedule assignments and attendance
 * eligibility resolve through this series, not through any one version's
 * id — see that migration's own comments for why.
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
    days: formData.getAll("day_of_week"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    // The full time-slot arrays — Add Schedule's multiple slots (start_time /
    // end_time are repeated fields, one pair per slot, same convention as
    // `days` above). Edit keeps exactly one slot, so these are single-item
    // arrays there.
    start_times: formData.getAll("start_time"),
    end_times: formData.getAll("end_time"),
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

/**
 * Creates one new schedule (each with its own new series) per day, all with the
 * same `data` apart from `day_of_week`. A brand-new schedule is a brand-new
 * stable identity (0013_schedule_assignment.sql "Schedule Series") —
 * schedules.series_id is NOT NULL, so a series must exist before each schedule
 * row can. The series are inserted in one statement and the schedules in
 * another, so a multi-day save is not left half-written by a failure between
 * days.
 *
 * @returns {Promise<{ created: { id: string, day_of_week: string }[] } | { error: string }>}
 */
async function insertSchedulesForDays(supabase, data, days) {
  const { data: seriesRows, error: seriesError } = await supabase
    .from("schedule_series")
    .insert(days.map(() => ({ batch_id: data.batch_id })))
    .select("id");

  if (seriesError || seriesRows?.length !== days.length) {
    console.error("[schedules] Could not create schedule series:", seriesError?.code, seriesError?.message);
    return { error: "Could not save the schedule. Try again." };
  }

  const { data: created, error } = await supabase
    .from("schedules")
    .insert(days.map((day, index) => ({ ...data, day_of_week: day, series_id: seriesRows[index].id })))
    .select("id, day_of_week");

  if (error) {
    console.error("[schedules] Could not create schedule:", error.code, error.message);
    return { error: "Could not save the schedule. Try again." };
  }

  return { created };
}

/**
 * Creates one new schedule (each with its own new series) per `rows` entry —
 * Add Schedule's day × time-slot cross product. Same "series then schedules,
 * two inserts" shape as `insertSchedulesForDays` below (a brand-new schedule
 * is a brand-new series; both statements run so a multi-row save is not left
 * half-written by a failure between rows), generalized to vary start/end
 * time per row as well as day. Kept separate from `insertSchedulesForDays`
 * (used only by Edit's single-time-slot "add extra days" path) rather than
 * widening that function's contract, so Edit/Direct-Edit's insert path is
 * untouched by Add Schedule's multi-time-slot support.
 *
 * @param {{ day_of_week: string, start_time: string, end_time: string }[]} rows
 * @returns {Promise<{ created: { id: string, day_of_week: string }[] } | { error: string }>}
 */
async function insertScheduleRows(supabase, data, rows) {
  const { data: seriesRows, error: seriesError } = await supabase
    .from("schedule_series")
    .insert(rows.map(() => ({ batch_id: data.batch_id })))
    .select("id");

  if (seriesError || seriesRows?.length !== rows.length) {
    console.error("[schedules] Could not create schedule series:", seriesError?.code, seriesError?.message);
    return { error: "Could not save the schedule. Try again." };
  }

  const { data: created, error } = await supabase
    .from("schedules")
    .insert(rows.map((row, index) => ({ ...data, ...row, series_id: seriesRows[index].id })))
    .select("id, day_of_week");

  if (error) {
    console.error("[schedules] Could not create schedule:", error.code, error.message);
    return { error: "Could not save the schedule. Try again." };
  }

  return { created };
}

export async function createSchedule(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  // The shared validator checks one day and one time slot; the full sets are
  // checked separately (validateScheduleDays / validateTimeSlots), and every
  // other field (batch, instructor, effective dates) is identical for all of
  // the day × slot rows this creates.
  const daysResult = validateScheduleDays(formData.getAll("day_of_week"));
  const slotsResult = validateTimeSlots(formData.getAll("start_time"), formData.getAll("end_time"));
  const result = validateScheduleInput({
    ...readScheduleInput(formData),
    day_of_week: daysResult.success ? daysResult.data[0] : "",
    start_time: slotsResult.success ? slotsResult.data[0].start_time : "",
    end_time: slotsResult.success ? slotsResult.data[0].end_time : "",
  });

  if (!result.success || !daysResult.success || !slotsResult.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(daysResult.success ? null : daysResult.errors) },
      slotErrors: slotsResult.success ? null : slotsResult.errors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  // The day × time-slot cross product — each combination is its own
  // independent schedule record, never merged or deduplicated (01-product.md
  // §7: a schedule is always one weekday and one time range).
  const rows = daysResult.data.flatMap((day) =>
    slotsResult.data.map((slot) => ({ day_of_week: day, start_time: slot.start_time, end_time: slot.end_time }))
  );
  const inserted = await insertScheduleRows(supabase, result.data, rows);
  if (inserted.error) {
    return { error: inserted.error, values: submittedValues(formData) };
  }
  const { created } = inserted;

  revalidatePath(SCHEDULE_PATH);
  revalidatePath(`/batches/${result.data.batch_id}`);
  revalidatePath(`/batches/${result.data.batch_id}/schedules`);

  if (created.length === 1) {
    redirect(`${schedulePath(created[0].id)}?success=created`);
  }
  // Several schedules: land on the list, filtered to the batch, with a count.
  redirect(`${SCHEDULE_PATH}?view=list&batch=${result.data.batch_id}&created=${created.length}`);
}

/**
 * The direct-edit branch of `updateSchedule`: an unused schedule is updated in
 * place (`correct_unused_schedule`), never versioned. Day, time, instructor
 * and the effective dates may all change.
 *
 * The ticked days work as they do on Add: this schedule keeps its own day if
 * it is still ticked, otherwise it moves to the first ticked day (Monday-first);
 * every other ticked day becomes a new schedule with the same values. Students
 * with an unstarted assignment stay on this schedule's series, so a day change
 * moves their assignment with it — the form's Review step says so.
 */
async function correctUnusedSchedule({ supabase, id, existing, result, daysResult, formData }) {
  const ownDay = daysResult.data.includes(existing.day_of_week) ? existing.day_of_week : daysResult.data[0];
  const extraDays = daysResult.data.filter((day) => day !== ownDay);

  const { error } = await supabase.rpc("correct_unused_schedule", {
    p_schedule_id: id,
    p_day_of_week: ownDay,
    p_instructor_id: result.data.instructor_id,
    p_start_time: result.data.start_time,
    p_end_time: result.data.end_time,
    p_effective_from: result.data.effective_from,
    p_effective_until: result.data.effective_until,
  });

  if (error) {
    if (NOT_UNUSED_ERROR_CODES.has(error.code)) {
      return {
        error:
          "This schedule now has history, so it can no longer be edited directly. Reload the page to edit it with an effective date.",
        values: submittedValues(formData),
      };
    }
    if (error.code === "P0002") {
      return { error: "This schedule no longer exists.", values: submittedValues(formData) };
    }
    console.error(`[schedules] Could not correct schedule ${id}:`, error.code, error.message);
    return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
  }

  let added = 0;
  if (extraDays.length > 0) {
    const inserted = await insertSchedulesForDays(supabase, result.data, extraDays);
    if (inserted.error) {
      revalidateScheduleViews(existing.batch_id, [id]);
      return {
        error:
          "This schedule was updated, but the additional days could not be added. " +
          "Add them from Add Schedule, or go back to Schedule Details.",
        values: submittedValues(formData),
      };
    }
    added = inserted.created.length;
  }

  revalidateScheduleViews(existing.batch_id, [id]);
  redirect(`${schedulePath(id)}?success=updated${added > 0 ? `&added=${added}` : ""}`);
}

function revalidateScheduleViews(batchId, scheduleIds = []) {
  revalidatePath(SCHEDULE_PATH);
  for (const scheduleId of scheduleIds) revalidatePath(schedulePath(scheduleId));
  revalidatePath("/batches");
  revalidatePath(`/batches/${batchId}`);
  revalidatePath(`/batches/${batchId}/schedules`);
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

  // The form submits this schedule's own (locked) day plus any extra days the
  // admin ticked. The shared validator checks one day; the set is checked
  // separately, and every other field applies to all of them.
  const daysResult = validateScheduleDays(formData.getAll("day_of_week"));
  const result = validateScheduleInput({
    ...readScheduleInput(formData),
    day_of_week: daysResult.success ? daysResult.data[0] : "",
  });

  if (!result.success || !daysResult.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(daysResult.success ? null : daysResult.errors) },
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("schedules")
    .select("batch_id, day_of_week, effective_from, effective_until, series_id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not update the schedule. Try again." };
  }

  // An unused schedule is corrected in place — no effective date to choose, no
  // new version. The database function re-checks under locks, so this read only
  // picks the path; a schedule that turned used in between is refused there.
  let usage;
  try {
    usage = await getScheduleDeleteImpact(id);
  } catch {
    return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
  }
  if (!usage) {
    return { error: "This schedule no longer exists.", values: submittedValues(formData) };
  }
  if (usage.editMode === "direct") {
    return correctUnusedSchedule({ supabase, id, existing, result, daysResult, formData });
  }

  const today = todayDateString();
  if (result.data.effective_from < today) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { effective_from: "Effective from cannot be in the past." },
      values: submittedValues(formData),
    };
  }

  // This schedule keeps its own weekday — it is one recurring class with its
  // own student assignments (a series never changes day). Any other ticked
  // day becomes a NEW schedule, created after this one is saved.
  const primary = { ...result.data, day_of_week: existing.day_of_week };
  const extraDays = daysResult.data.filter((day) => day !== existing.day_of_week);

  async function addExtraDays() {
    if (extraDays.length === 0) return { added: 0 };
    const inserted = await insertSchedulesForDays(supabase, result.data, extraDays);
    return inserted.error ? { error: inserted.error } : { added: inserted.created.length };
  }

  // Runs once this schedule's own change is saved. If the extra days then fail,
  // this schedule's edit is already saved — say so rather than report a
  // failure that leaves the admin re-submitting it.
  async function finish(savedId, revalidateIds) {
    const extras = await addExtraDays();

    revalidatePath(SCHEDULE_PATH);
    for (const revalidateId of revalidateIds) revalidatePath(schedulePath(revalidateId));
    revalidatePath(`/batches/${existing.batch_id}`);
    revalidatePath(`/batches/${existing.batch_id}/schedules`);

    if (extras.error) {
      return {
        error:
          "This schedule was updated, but the additional days could not be added. " +
          "Add them from Add Schedule, or go back to Schedule Details.",
        values: submittedValues(formData),
      };
    }

    const added = extras.added > 0 ? `&added=${extras.added}` : "";
    redirect(`${schedulePath(savedId)}?success=updated${added}`);
  }

  if (primary.effective_from <= existing.effective_from) {
    // No live period exists yet under the current version — update in
    // place rather than versioning into an invalid closed row.
    const { error } = await supabase.from("schedules").update(primary).eq("id", id);

    if (error) {
      console.error(`[schedules] Could not update schedule ${id}:`, error.code, error.message);
      return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
    }

    return finish(id, [id]);
  }

  // Versioning: close the current row the day before the change, then
  // insert the new version. PostgREST offers no multi-statement
  // transaction here, so an insert failure after a successful close is
  // compensated by reverting the close rather than left half-applied.
  const closesAt = subtractOneDayUTC(primary.effective_from);

  const { error: closeError } = await supabase
    .from("schedules")
    .update({ effective_until: closesAt })
    .eq("id", id);

  if (closeError) {
    console.error(`[schedules] Could not close schedule ${id} for versioning:`, closeError.code, closeError.message);
    return { error: "Could not update the schedule. Try again.", values: submittedValues(formData) };
  }

  // The new version continues the same series the row it supersedes
  // belongs to (0013_schedule_assignment.sql) — never a new one, or every
  // student schedule assignment and every past class_sessions row pointing
  // at the old version would stop matching the moment this edit lands.
  const { data: newRow, error: insertError } = await supabase
    .from("schedules")
    .insert({ ...primary, series_id: existing.series_id })
    .select("id")
    .single();

  if (insertError) {
    await supabase.from("schedules").update({ effective_until: existing.effective_until }).eq("id", id);
    console.error(`[schedules] Could not insert new version for schedule ${id}:`, insertError.code, insertError.message);
    return { error: "Could not save the schedule changes. Try again.", values: submittedValues(formData) };
  }

  return finish(newRow.id, [id, newRow.id]);
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

/**
 * What deleting this schedule would do, for the Delete Schedule dialog.
 * Read-only — see `getScheduleDeleteImpact`. The dialog opens on this; the
 * delete itself re-checks on the server and does not trust it.
 */
export async function previewScheduleDelete(id) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not check the schedule. Try again." };
  }

  try {
    const impact = await getScheduleDeleteImpact(id);
    if (!impact) return { error: "This schedule no longer exists." };
    return { impact };
  } catch {
    return { error: "Could not check the schedule. Try again." };
  }
}

/**
 * Deletes an unused schedule (01-product.md §7 "Deleting and correcting an
 * unused schedule"). Everything that matters happens inside the
 * `delete_unused_schedule` database function: it locks the schedule and its
 * series, re-checks that no class session references it, that it is the only
 * version, and that no schedule assignment has started, then deletes it with
 * its unstarted assignments and its empty series — all in one transaction. So
 * a session materialized after the dialog opened is refused here, not
 * deleted; the foreign keys (ON DELETE RESTRICT) are the backstop behind that.
 *
 * Deactivate (`deactivateSchedule`) stays the lifecycle action for a schedule
 * that has been used.
 *
 * @returns {Promise<{ success: string } | { error: string, blocked?: true, blockReason?: string }>}
 */
export async function deleteSchedule(id) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not delete the schedule. Try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_unused_schedule", { p_schedule_id: id });

  if (error) {
    if (NOT_UNUSED_ERROR_CODES.has(error.code)) {
      const blockReason = blockReasonFromError(error);
      return {
        error: `Schedule can't be deleted. ${describeBlockReason(blockReason)}`,
        blocked: true,
        blockReason,
      };
    }
    if (error.code === "P0002") {
      return { error: "This schedule no longer exists." };
    }
    console.error(`[schedules] Could not delete schedule ${id}:`, error.code, error.message);
    return { error: "Could not delete the schedule. Try again." };
  }

  revalidateScheduleViews(data?.batch_id, []);
  // Session lists and the attendance screens project occurrences from schedules.
  revalidatePath("/attendance");
  return { success: "Schedule deleted." };
}
