"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, scheduleOccursOnDate } from "@/lib/schedules/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { getMaterializedSession, getSessionOccurrence } from "@/lib/class-sessions/data";
import { deriveDisplayStatus, validateSessionEditInput } from "@/lib/class-sessions/validation";

/**
 * Server actions for Class Sessions.
 *
 * `materializeClassSession` is the shared materialize-on-first-touch
 * helper. `updateClassSession` (Flow 06 — Edit This Session) is its first
 * real caller: it fetches the current occurrence, validates and compares
 * the edit, and only then calls `materializeClassSession` — never before,
 * and never when nothing actually changed. Cancel/Holiday (Flow 07) is
 * still later Phase 14 UI work and will call `materializeClassSession` the
 * same way once built.
 */

function sessionPath(scheduleId, date) {
  return `/attendance/${scheduleId}/${date}`;
}

/**
 * Materialize-on-first-touch (01-product.md §7A "Projection and
 * Materialization"): ensures a `class_sessions` row exists for one
 * occurrence of a schedule, creating it as `scheduled` if it does not, and
 * returning the existing row unchanged if it already does. Never produces a
 * duplicate — checked before inserting, and backstopped by
 * `class_sessions_schedule_date_unique` (0010_class_sessions.sql) against a
 * concurrent caller doing the same thing at the same moment.
 *
 * Rejects a date that is not a genuine occurrence of the schedule
 * (`scheduleOccursOnDate`, lib/schedules/data.js) — the same day-of-week
 * and effective-period rule the Weekly Schedule grid already applies, reused
 * rather than reimplemented. This is also what naturally enforces
 * 01-product.md §7A "Inactive or Ended Schedules": a date past a
 * deactivated schedule's `effective_until` is not a valid occurrence, so it
 * can never be materialized, without needing a separate status check.
 *
 * The materialized row snapshots the schedule's current batch, instructor,
 * and time — from that moment on, nothing about the schedule can change
 * this row (§7A "Snapshot and Historical Integrity").
 *
 * @param {string} scheduleId
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<{ success: true, data: object } | { success: false, error: string }>}
 */
export async function materializeClassSession(scheduleId, sessionDate) {
  await requireRole(ROLES.ADMIN);

  if (!scheduleId) {
    return { success: false, error: "A schedule is required." };
  }

  if (!isValidDateString(sessionDate)) {
    return { success: false, error: "Enter a valid session date." };
  }

  const existing = await getMaterializedSession(scheduleId, sessionDate);
  if (existing) {
    return { success: true, data: existing };
  }

  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    return { success: false, error: "Could not find that schedule." };
  }

  if (!scheduleOccursOnDate(schedule, sessionDate)) {
    return { success: false, error: "This schedule does not occur on that date." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({
      schedule_id: schedule.id,
      batch_id: schedule.batches.id,
      instructor_id: schedule.instructors.id,
      session_date: sessionDate,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      status: "scheduled",
    })
    .select("id, schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status, note, created_at, updated_at")
    .single();

  if (error) {
    // 23505: unique_violation on class_sessions_schedule_date_unique — a
    // concurrent call materialized this exact occurrence between the
    // lookup above and this insert. That caller's row is just as valid as
    // the one this call would have created, so fetch and return it instead
    // of surfacing a conflict — materialize-on-first-touch means "ensure
    // it exists", not "I must be the one who created it".
    if (error.code === "23505") {
      const winner = await getMaterializedSession(scheduleId, sessionDate);
      if (winner) {
        return { success: true, data: winner };
      }
    }

    console.error(
      `[class-sessions] Could not materialize session for schedule ${scheduleId} on ${sessionDate}:`,
      error.code,
      error.message
    );
    return { success: false, error: "Could not create the class session. Try again." };
  }

  return { success: true, data };
}

/**
 * Edits a single class session's instructor and/or time (02-ux.md Flow 06 —
 * "Admin: Change One Specific Session"). The recurring schedule is never
 * touched: this only ever writes to `class_sessions`, and only the three
 * editable columns (`instructor_id`, `start_time`, `end_time`) — `status`
 * is never part of the update.
 *
 * Three checks happen in order, all against the occurrence freshly read at
 * submit time (never trusted from an earlier page load, since time has
 * passed and status is time-derived):
 *
 * 1. The occurrence must exist (`getSessionOccurrence` — a genuine
 *    schedule/date combination, materialized or projected).
 * 2. It must currently display as `upcoming` (approved Phase 14 decision —
 *    editable status is Upcoming only). Enforced here regardless of
 *    whether the UI already hides the action for any other status.
 * 3. The submitted values must actually differ from the occurrence's
 *    current instructor/start/end — a no-op save must not materialize or
 *    write anything at all, matching "viewing never writes" even though
 *    this is technically inside an edit action.
 *
 * Only once all three pass does this call `materializeClassSession`
 * (unchanged) to guarantee a row exists, then update that row. A projected
 * occurrence therefore only ever becomes a real row *because* something
 * about it changed — never merely because the admin opened the edit form.
 *
 * @param {string} scheduleId
 * @param {string} date - "YYYY-MM-DD".
 * @param {object} _prevState - Previous `useActionState` state (unused; required by the hook's signature).
 * @param {FormData} formData
 */
export async function updateClassSession(scheduleId, date, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!scheduleId || !isValidDateString(date)) {
    return { error: "Could not update the session. Try again." };
  }

  const result = validateSessionEditInput({
    instructor_id: formData.get("instructor_id"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
    };
  }

  const occurrence = await getSessionOccurrence(scheduleId, date);
  if (!occurrence) {
    return { error: "Could not find that session." };
  }

  if (deriveDisplayStatus(occurrence) !== "upcoming") {
    return { error: "Only upcoming sessions can be edited." };
  }

  // Native <input type="time"> submits "HH:MM"; a stored `time` column can
  // come back as "HH:MM:SS" — normalize both sides to the same precision
  // before comparing, or a real no-op would look like a change.
  const hasChange =
    result.data.instructor_id !== occurrence.instructor_id ||
    result.data.start_time !== occurrence.start_time.slice(0, 5) ||
    result.data.end_time !== occurrence.end_time.slice(0, 5);

  if (!hasChange) {
    redirect(`${sessionPath(scheduleId, date)}?success=unchanged`);
  }

  const materialized = await materializeClassSession(scheduleId, date);
  if (!materialized.success) {
    return { error: materialized.error };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({
      instructor_id: result.data.instructor_id,
      start_time: result.data.start_time,
      end_time: result.data.end_time,
    })
    .eq("id", materialized.data.id);

  if (error) {
    console.error(`[class-sessions] Could not update session ${materialized.data.id}:`, error.code, error.message);
    return { error: "Could not update the session. Try again." };
  }

  revalidatePath("/attendance");
  revalidatePath(sessionPath(scheduleId, date));
  redirect(`${sessionPath(scheduleId, date)}?success=updated`);
}
