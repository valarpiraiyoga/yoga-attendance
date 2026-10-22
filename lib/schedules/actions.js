"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getScheduleDeleteImpact, listSchedulesForInstructor } from "@/lib/schedules/data";
import { getCentreToday } from "@/lib/center-profile/settings";
import { NOT_UNUSED_ERROR_CODES, blockReasonFromError, describeBlockReason } from "@/lib/schedules/usage";
import { scheduleEditChangesOnlyCapacity, validateScheduleCapacity } from "@/lib/schedules/capacity-input";
import { createSeriesRows, setSeriesCapacity } from "@/lib/schedules/capacity-writes";
import { SAVE_SCHEDULE_ERROR_MESSAGE, mapScheduleSaveError } from "@/lib/schedules/save-errors";
import { findInstructorConflict, describeConflict, instructorConflictMessage } from "@/lib/schedules/instructor-conflict";
import { ACTIVATE_ERROR_MESSAGE, EDIT_INACTIVE_MESSAGE, activatedScheduleRow, validateActivation } from "@/lib/schedules/activation";
import {
  validateScheduleInput,
  validateScheduleDays,
  validateTimeSlots,
  isValidDateString,
  subtractOneDayUTC,
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
 *
 * Schedule capacity (V1 Final Improvements, S5; 01-product.md §7 "Schedule
 * Capacity"): the optional Capacity field belongs to the SERIES
 * (`schedule_series.capacity`, migration 0060), never to a `schedules` row, so
 * it is validated apart from `validateScheduleInput` (whose output is spread
 * into `schedules` inserts). Every schedule created by Add Schedule - one per
 * day x time slot - and every schedule an edit also creates on another day
 * (ordinary or direct) starts with the capacity being saved by that same form.
 * A capacity change is not effective-dated and creates no version, so an edit
 * that changes nothing else saves only the capacity (a single update of the
 * edited schedule's own series, by id).
 *
 * Atomic edits (migration 0061): every other Edit Schedule save is ONE database
 * call - `save_schedule_edit` (versioned or in place, with "Also creates") or
 * `save_unused_schedule_edit` (Direct Edit) - that sets the capacity, changes
 * the schedule and creates the extra days in one transaction. If any step is
 * refused or fails, nothing at all is written: the capacity, the version, the
 * extra days. So a failure message always means "not saved", and trying again is
 * safe. The database's refusals (lib/schedules/save-errors.js) are shown on the
 * form; anything else is logged and shown as the generic message.
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
    capacity: formData.get("capacity"),
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
 * Creates one new schedule (each with its own new series) per `rows` entry —
 * Add Schedule's day × time-slot cross product: the series are inserted in one
 * statement and the schedules in another (a brand-new schedule is a brand-new
 * series, and `schedules.series_id` is NOT NULL), each statement covering every
 * row so a multi-row save is never half-written by a failure between rows. The
 * two statements are not one transaction: if the schedules fail after the series
 * were created, only empty series remain - they hold no places and appear
 * nowhere - and the save reports the failure. (Edit Schedule, which also creates
 * schedules on extra days, is a single atomic database call instead.)
 *
 * Every new series starts with `capacity` (null = unlimited): the capacity entered in the Add Schedule form, the same for all of them.
 *
 * @param {{ day_of_week: string, start_time: string, end_time: string }[]} rows
 * @returns {Promise<{ created: { id: string, day_of_week: string }[] } | { error: string }>}
 */
async function insertScheduleRows(supabase, data, rows, capacity = null) {
  const series = await createSeriesRows(supabase, data.batch_id, rows.length, capacity);
  if (series.error) {
    return { error: "Could not save the schedule. Try again." };
  }

  const { data: created, error } = await supabase
    .from("schedules")
    .insert(rows.map((row, index) => ({ ...data, ...row, series_id: series.ids[index] })))
    .select("id, day_of_week");

  if (error) {
    // The instructor gained a conflicting class between the pre-check and this insert (another save won the race): migration 0062's
    // trigger refused the WHOLE insert. The series created above stay empty and inert, as for any other failure here.
    const conflict = instructorConflictMessage(error);
    if (conflict) return { error: conflict };
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

  // One capacity for the whole form (blank = unlimited): every schedule this creates gets it.
  const capacityResult = validateScheduleCapacity(formData.get("capacity"));

  if (!result.success || !daysResult.success || !slotsResult.success || !capacityResult.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: {
        ...(result.success ? null : result.errors),
        ...(daysResult.success ? null : daysResult.errors),
        ...(capacityResult.success ? null : capacityResult.errors),
      },
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

  // The instructor must not already teach at any of these times (01-product.md §7 "Conflicts"). Checked BEFORE any series is created, so a
  // refusal leaves nothing behind. This read is a courtesy: if it cannot be made the save goes on and migration 0062's trigger, the final
  // authority (it also covers two Admins saving at once), refuses a conflict at the insert below.
  let existingForInstructor = null;
  try {
    existingForInstructor = await listSchedulesForInstructor(result.data.instructor_id);
  } catch {
    existingForInstructor = null;
  }
  const clash = findInstructorConflict(rows, result.data, existingForInstructor);
  if (clash) {
    return { error: describeConflict(clash), values: submittedValues(formData) };
  }
  const inserted = await insertScheduleRows(supabase, result.data, rows, capacityResult.data.value);
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

// The capacity-only path: the edited schedule's own series gets the submitted capacity, nothing else being written. Returns { stop } -
// the result to return, with the capacity field's message when the database refused the value - or {} on success.
async function saveOwnCapacity({ supabase, seriesId, capacity, formData }) {
  const change = await setSeriesCapacity(supabase, seriesId, capacity);
  if (change.refused) {
    return {
      stop: { error: "Check the highlighted fields.", fieldErrors: { capacity: change.refused }, values: submittedValues(formData) },
    };
  }
  if (change.failed) {
    return { stop: { error: SAVE_SCHEDULE_ERROR_MESSAGE, values: submittedValues(formData) } };
  }
  return {};
}

// A refused atomic save as an action result: a field error on the form, a message at its top, or - for anything the Admin cannot act on -
// the generic message with the details only logged. The save wrote nothing, so every message may say so (see lib/schedules/save-errors.js).
function refusedSave(error, formData, { direct = false, context }) {
  const mapped = mapScheduleSaveError(error, { direct });
  if (mapped?.field) {
    return { error: "Check the highlighted fields.", fieldErrors: { [mapped.field]: mapped.error }, values: submittedValues(formData) };
  }
  if (mapped?.message) {
    return { error: mapped.message, values: submittedValues(formData) };
  }
  console.error(`[schedules] ${context}:`, error?.code, error?.message);
  return { error: SAVE_SCHEDULE_ERROR_MESSAGE, values: submittedValues(formData) };
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
 *
 * One database call (`save_unused_schedule_edit`, migration 0061) does it all in a
 * single transaction: the capacity (only when the form sent one), the existing
 * `correct_unused_schedule` - which re-checks "unused" under its locks and
 * refuses a schedule that has since gained history - and the extra days, each
 * starting with the capacity being saved. A refusal anywhere writes nothing.
 */
async function correctUnusedSchedule({ supabase, id, existing, result, daysResult, capacity, formData }) {
  const ownDay = daysResult.data.includes(existing.day_of_week) ? existing.day_of_week : daysResult.data[0];
  const extraDays = daysResult.data.filter((day) => day !== ownDay);

  const { data: saved, error } = await supabase.rpc("save_unused_schedule_edit", {
    p_schedule_id: id,
    p_day_of_week: ownDay,
    p_instructor_id: result.data.instructor_id,
    p_start_time: result.data.start_time,
    p_end_time: result.data.end_time,
    p_effective_from: result.data.effective_from,
    p_effective_until: result.data.effective_until,
    p_set_capacity: capacity.provided,
    p_capacity: capacity.value,
    p_extra_days: extraDays,
  });

  if (error) {
    return refusedSave(error, formData, { direct: true, context: `Could not correct schedule ${id}` });
  }

  const added = Number(saved?.added) || 0;
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

  // The stored schedule and its edit mode are read first: whether an edit changes nothing but the capacity (below) is judged against
  // them, and that edit must not be held to the Effective From a real change needs.
  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("schedules")
    .select("batch_id, day_of_week, instructor_id, start_time, end_time, effective_from, effective_until, series_id, status")
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
  const direct = usage.editMode === "direct";

  // The form submits this schedule's own (locked) day plus any extra days the
  // admin ticked. The shared validator checks one day; the set is checked
  // separately, and every other field applies to all of them.
  const daysResult = validateScheduleDays(formData.getAll("day_of_week"));
  // The series' capacity (blank = unlimited). Not part of the schedule version, so not part of `validateScheduleInput`.
  const capacityResult = validateScheduleCapacity(formData.get("capacity"));

  // Only the capacity changed: it applies at once, to this series, with no new version and no effective date.
  if (
    capacityResult.success &&
    capacityResult.data.provided &&
    scheduleEditChangesOnlyCapacity({
      existing,
      submitted: {
        days: formData.getAll("day_of_week"),
        instructor_id: formData.get("instructor_id"),
        start_time: formData.get("start_time"),
        end_time: formData.get("end_time"),
        effective_from: formData.get("effective_from"),
        effective_until: formData.get("effective_until"),
      },
      direct,
    })
  ) {
    const saved = await saveOwnCapacity({ supabase, seriesId: existing.series_id, capacity: capacityResult.data.value, formData });
    if (saved.stop) return saved.stop;

    revalidateScheduleViews(existing.batch_id, [id]);
    redirect(`${schedulePath(id)}?success=updated`);
  }

  const result = validateScheduleInput({
    ...readScheduleInput(formData),
    day_of_week: daysResult.success ? daysResult.data[0] : "",
  });

  if (!result.success || !daysResult.success || !capacityResult.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: {
        ...(result.success ? null : result.errors),
        ...(daysResult.success ? null : daysResult.errors),
        ...(capacityResult.success ? null : capacityResult.errors),
      },
      values: submittedValues(formData),
    };
  }

  if (usage.editMode === "direct") {
    return correctUnusedSchedule({ supabase, id, existing, result, daysResult, capacity: capacityResult.data, formData });
  }

  // An INACTIVE schedule is not edited with an effective date: a new version is created ACTIVE, so the save would reactivate it as a side
  // effect of editing its dates. Activation is its own explicit action (activateSchedule). A capacity-only change (above) and the in-place
  // correction of an unused schedule (which leaves the status alone) are not affected.
  if (existing.status === "inactive") {
    return { error: EDIT_INACTIVE_MESSAGE, values: submittedValues(formData) };
  }

  const today = await getCentreToday();
  if (result.data.effective_from < today) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { effective_from: "Effective from cannot be in the past." },
      values: submittedValues(formData),
    };
  }

  // This schedule keeps its own weekday — it is one recurring class with its
  // own student assignments (a series never changes day). Any other ticked
  // day becomes a NEW schedule with the same values, created in the same
  // transaction.
  const extraDays = daysResult.data.filter((day) => day !== existing.day_of_week);

  // One atomic database call (migration 0061, `save_schedule_edit`): the capacity - only when the form sent one; true with a null value
  // is an explicit "unlimited" - then either an in-place update (the new effective date is on or before the current version's own start:
  // no live period exists to protect) or the close-and-new-version on the SAME series (the current version is closed the day before the
  // change; a new series would detach every student assignment and every past class session), then each extra day with the capacity
  // being saved. Any refusal or failure writes nothing, so there is nothing to put back and a retry is safe.
  const { data: saved, error } = await supabase.rpc("save_schedule_edit", {
    p_schedule_id: id,
    p_instructor_id: result.data.instructor_id,
    p_start_time: result.data.start_time,
    p_end_time: result.data.end_time,
    p_effective_from: result.data.effective_from,
    p_effective_until: result.data.effective_until,
    p_set_capacity: capacityResult.data.provided,
    p_capacity: capacityResult.data.value,
    p_extra_days: extraDays,
  });

  if (error) {
    return refusedSave(error, formData, { context: `Could not update schedule ${id}` });
  }

  const added = Number(saved?.added) || 0;
  const touched = Array.isArray(saved?.ids) && saved.ids.length > 0 ? saved.ids : [id];
  revalidateScheduleViews(existing.batch_id, touched);
  redirect(`${schedulePath(saved?.id ?? id)}?success=updated${added > 0 ? `&added=${added}` : ""}`);
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
    // Setting a LATER end date can give the instructor a class that overlaps another of theirs (migration 0062); an earlier one never can.
    const conflict = instructorConflictMessage(error);
    if (conflict) return { error: conflict };
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
 * Activates an inactive schedule (V1; 01-product.md §7 "Activation"): an explicit action with a new Effective From, never a side effect of
 * editing dates. The inactive row is history and is not touched - no date or status of it, no session, no attendance. A NEW version of the
 * SAME series is inserted instead: the same batch, instructor, day and times, active from the chosen date and open-ended (lib/schedules/
 * activation.js has the rules). The series keeps its capacity and its students' assignments.
 *
 * It is one insert, so it is all-or-nothing, and it is judged by migration 0062's instructor-conflict trigger like any other schedule write:
 * a conflict (including a concurrent save) is refused and shown with the same friendly message. Called from a client component (the
 * Activate dialog), so a refusal is returned as { error }; success redirects to the new version's Schedule Details.
 *
 * @param {string} id - the inactive schedule.
 * @param {string} effectiveFrom - the date the Admin confirmed (ISO).
 */
export async function activateSchedule(id, effectiveFrom) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: ACTIVATE_ERROR_MESSAGE };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("schedules")
    .select("batch_id, instructor_id, day_of_week, start_time, end_time, effective_from, effective_until, status, series_id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: ACTIVATE_ERROR_MESSAGE };
  }

  const { data: versions, error: versionsError } = await supabase
    .from("schedules")
    .select("id, status, effective_until")
    .eq("series_id", existing.series_id)
    .neq("id", id);

  if (versionsError) {
    console.error(`[schedules] Could not read the versions of schedule ${id}:`, versionsError.code, versionsError.message);
    return { error: ACTIVATE_ERROR_MESSAGE };
  }

  const checked = validateActivation(existing, effectiveFrom, await getCentreToday(), versions ?? []);
  if (!checked.success) {
    return { error: checked.error };
  }

  const { data: created, error } = await supabase
    .from("schedules")
    .insert(activatedScheduleRow(existing, checked.data.effective_from))
    .select("id")
    .single();

  if (error || !created) {
    const conflict = instructorConflictMessage(error);
    if (conflict) return { error: conflict };
    console.error(`[schedules] Could not activate schedule ${id}:`, error?.code, error?.message);
    return { error: ACTIVATE_ERROR_MESSAGE };
  }

  revalidateScheduleViews(existing.batch_id, [id, created.id]);
  redirect(`${schedulePath(created.id)}?success=activated`);
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
 * Deletes a schedule version (01-product.md §7 "Unused Schedules"). Everything
 * that matters happens inside the `delete_unused_schedule` database function
 * (0063): it locks the schedule and its series and re-checks that no class
 * session references THIS version and that no later version exists (only the
 * latest can go). If other versions remain only this row is deleted; the
 * series' only version is also checked for started assignments and goes with
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
