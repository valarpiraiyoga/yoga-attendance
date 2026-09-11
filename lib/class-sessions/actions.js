"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, scheduleOccursOnDate } from "@/lib/schedules/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { getMaterializedSession, getSessionOccurrence } from "@/lib/class-sessions/data";
import { deriveDisplayStatus, validateSessionEditInput, validateSessionNote } from "@/lib/class-sessions/validation";

/**
 * Server actions for Class Sessions.
 *
 * `materializeClassSession` is the shared materialize-on-first-touch
 * helper. `updateClassSession` (Flow 06 — Edit This Session) and
 * `markSessionException` (Flow 07 — Cancel/Holiday) are its two callers:
 * both fetch the current occurrence, validate and check eligibility, and
 * only then call `materializeClassSession` — never before, and never when
 * the check fails. Each writes a disjoint set of columns: `updateClassSession`
 * writes instructor/start/end and never `status`; `markSessionException`
 * writes `status`/`note` and never instructor/start/end/date/batch.
 *
 * `materializeClassSession` itself now authorizes admin OR instructor
 * (Phase 15 Instructor Access, Step 3), but that widening is safe for
 * `updateClassSession` and `markSessionException` without touching either
 * of them: both already call `requireRole(ROLES.ADMIN)` themselves before
 * ever reaching `materializeClassSession`, so an instructor is rejected
 * there first, exactly as before. The only thing this step changes is
 * that `materializeClassSession` is now instructor-capable *in isolation* —
 * a later step decides which route/action is allowed to call it as one.
 */

function sessionPath(scheduleId, date) {
  return `/attendance/${scheduleId}/${date}`;
}

// Postgres error codes `materialize_class_session` deliberately raises with a
// user-appropriate meaning (0014_instructor_attendance_access.sql). Anything
// else is an unexpected database error and gets the same generic message the
// admin path uses, rather than leaking a raw SQLSTATE to the UI.
const MATERIALIZE_RPC_ERRORS = new Map([
  // can_access_session said no: signed out, unlinked, deactivated, or — the
  // case this step exists to block — somebody else's occurrence.
  ["42501", "You are not assigned to this session."],
  // Schedule row missing.
  ["P0002", "Could not find that schedule."],
  // Not a genuine occurrence: wrong weekday, or outside the effective period.
  ["22023", "This schedule does not occur on that date."],
]);

/**
 * The instructor half of `materializeClassSession`.
 *
 * Every decision that matters — may this caller touch this session, is this
 * date a real occurrence, what gets snapshotted onto the new row — is made
 * inside the SECURITY DEFINER function, not here. This wrapper only
 * translates SQLSTATEs into the `{ success, error }` shape the admin path
 * already returns.
 */
async function materializeAsInstructor(scheduleId, sessionDate) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("materialize_class_session", {
    p_schedule_id: scheduleId,
    p_session_date: sessionDate,
  });

  if (error) {
    if (MATERIALIZE_RPC_ERRORS.has(error.code)) {
      return { success: false, error: MATERIALIZE_RPC_ERRORS.get(error.code) };
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
 * Two paths, by role (Phase 15 Instructor Access, approved decision Q1 —
 * Option B):
 *
 * - **Admin** — unchanged from Phase 14: look up, then insert directly.
 *   `class_sessions_insert_admin` (0010) permits that insert, so nothing
 *   about an admin's behaviour, error handling or return shape moves.
 * - **Instructor** — the `materialize_class_session` SECURITY DEFINER RPC
 *   (0014_instructor_attendance_access.sql). An instructor has no INSERT
 *   policy on `class_sessions` and deliberately never gets one, so a direct
 *   insert would always fail with 42501 regardless of who owns the session.
 *   The RPC is the authorized write path: it checks `can_access_session`
 *   itself, re-validates the occurrence, snapshots from the schedule rather
 *   than from caller input, and carries the same insert-with-retry
 *   semantics — so ownership is enforced in the database, not here.
 *
 * Both paths return the same row shape, so callers cannot tell them apart.
 *
 * @param {string} scheduleId
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<{ success: true, data: object } | { success: false, error: string }>}
 */
export async function materializeClassSession(scheduleId, sessionDate) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  if (!scheduleId) {
    return { success: false, error: "A schedule is required." };
  }

  if (!isValidDateString(sessionDate)) {
    return { success: false, error: "Enter a valid session date." };
  }

  if (user.role !== ROLES.ADMIN) {
    return materializeAsInstructor(scheduleId, sessionDate);
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

/**
 * Marks a single session Cancelled or Holiday, with an optional note
 * (02-ux.md Flow 07 — "Admin: Cancel / Holiday"; 01-product.md §7A
 * "Cancellation and Holiday"). Called directly from a client component
 * wrapped in `useTransition` (Next.js's documented pattern for invoking a
 * Server Action outside a form), matching
 * app/schedule/[id]/deactivate-schedule.js and
 * app/memberships/[id]/cancel-membership.js — there is no review-page
 * route for this flow, only a dialog.
 *
 * Eligibility is checked against the occurrence's **persisted** status,
 * not the displayed one — deliberately different from
 * `updateClassSession`'s Upcoming-only rule. A `scheduled` session may be
 * marked Cancelled/Holiday whether it currently displays as Upcoming, In
 * Progress, or a clock-derived Completed reading; a session already
 * `completed` (attendance saved, Phase 15), `cancelled` or `holiday` is
 * rejected. This is what keeps "cannot cancel a session with attendance
 * already recorded" true automatically once Phase 15 exists, without this
 * function needing to know anything about attendance.
 *
 * Only `status` and `note` are ever written — never instructor, time,
 * date or batch (that is `updateClassSession`'s, Flow 06's, disjoint
 * column set), and never the recurring schedule. There is no un-cancel:
 * once written, this action cannot be called again for the same
 * occurrence (rejected by the eligibility check above), matching
 * `cancelMembership`'s and `deactivateSchedule`'s one-directional shape.
 *
 * @param {string} scheduleId
 * @param {string} date - "YYYY-MM-DD".
 * @param {"cancelled"|"holiday"} status
 * @param {string} note - Optional; validated by `validateSessionNote`.
 * @returns {Promise<{ success: true } | { error: string }>}
 */
export async function markSessionException(scheduleId, date, status, note) {
  await requireRole(ROLES.ADMIN);

  if (!scheduleId || !isValidDateString(date)) {
    return { error: "Could not update the session. Try again." };
  }

  if (status !== "cancelled" && status !== "holiday") {
    return { error: "Choose Cancelled or Holiday." };
  }

  const noteResult = validateSessionNote(note);
  if (!noteResult.success) {
    return { error: noteResult.errors.note };
  }

  const occurrence = await getSessionOccurrence(scheduleId, date);
  if (!occurrence) {
    return { error: "Could not find that session." };
  }

  if (occurrence.status !== "scheduled") {
    return { error: "This session has already been marked completed, cancelled, or holiday." };
  }

  const materialized = await materializeClassSession(scheduleId, date);
  if (!materialized.success) {
    return { error: materialized.error };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ status, note: noteResult.data })
    .eq("id", materialized.data.id);

  if (error) {
    console.error(`[class-sessions] Could not mark session ${materialized.data.id} as ${status}:`, error.code, error.message);
    return { error: "Could not update the session. Try again." };
  }

  revalidatePath("/attendance");
  revalidatePath(sessionPath(scheduleId, date));
  return { success: true };
}
