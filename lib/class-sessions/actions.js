"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, scheduleOccursOnDate } from "@/lib/schedules/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { getMaterializedSession } from "@/lib/class-sessions/data";

/**
 * Server actions for Class Sessions.
 *
 * This slice contains exactly one action: materializing a session. There is
 * no Edit This Session or Cancel/Holiday action here — those are later
 * Phase 14 UI work (04-development-plan.md) and neither this file nor
 * lib/class-sessions/validation.js invents a form for them ahead of time.
 * Both, when built, are expected to call `materializeClassSession` first to
 * guarantee a row exists, then update it — materializing itself is neutral
 * about *why* a session needed a row, only that one now does.
 */

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
