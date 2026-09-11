"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { materializeClassSession } from "@/lib/class-sessions/actions";
import { isValidDateString } from "@/lib/schedules/validation";
import { validateAttendanceMarks } from "@/lib/attendance/validation";

/**
 * Server actions for Attendance.
 *
 * `saveSessionAttendance` is this slice's one action, and the third caller
 * of `materializeClassSession` (lib/class-sessions/actions.js, unchanged)
 * alongside Flow 06's `updateClassSession` and Flow 07's
 * `markSessionException` — attendance being recorded is the third
 * documented materialization trigger (01-product.md §7A). Same shape as
 * those two: materialize first (only when needed, since a session with
 * attendance is by definition already materialized after its first save),
 * then perform the actual write — here, the write is the
 * `save_session_attendance` database function
 * (supabase/migrations/0011_attendance.sql), not a plain `.update()`,
 * because saving attendance is a multi-row, multi-step operation that
 * genuinely needs one atomic transaction. See that migration's own
 * "Materialization boundary" comment for why materializing and saving stay
 * two separate calls rather than one, and why that is not a gap this
 * function silently papers over: the database function re-validates
 * everything (session state, date, eligibility) itself, independently of
 * whatever this action already checked.
 *
 * No UI calls this yet — this is the foundation slice. Kept here, not
 * merely designed, so the boundary with `materializeClassSession` is a
 * real, reviewable call rather than a description of one.
 */

// Postgres error codes `save_session_attendance` deliberately raises with a
// user-appropriate message (0011_attendance.sql) — anything else is an
// unexpected database error and gets a generic message instead of a raw
// SQLSTATE leaking to the UI.
const KNOWN_ERROR_CODES = new Set([
  "P0002", // class session not found
  "22023", // cancelled/holiday, future date, ineligible student, invalid status
  "42501", // not authorized
]);

function mapSaveAttendanceError(error) {
  if (KNOWN_ERROR_CODES.has(error.code)) {
    return error.message;
  }

  console.error("[attendance] Could not save attendance:", error.code, error.message);
  return "Could not save attendance. Try again.";
}

/**
 * Saves Present/Absent marks for one class session and completes it
 * (01-product.md §8 "Completion"; §12: "A session's stored status becomes
 * completed only when its attendance is saved").
 *
 * @param {string} scheduleId
 * @param {string} date - "YYYY-MM-DD".
 * @param {{ student_id: string, status: "present"|"absent" }[]} marks - Eligible students absent from this list stay unmarked (approved decision D10 — saving with some or all students unmarked is allowed).
 * @returns {Promise<{ success: true, data: object } | { error: string }>}
 */
export async function saveSessionAttendance(scheduleId, date, marks) {
  // Admin or instructor (Phase 15 Instructor Access). This only answers
  // "may this role record attendance at all" — *whose* session it is stays
  // a database question, asked twice below and never re-implemented here:
  // `materializeClassSession` routes an instructor through the
  // `materialize_class_session` RPC (can_access_session), and
  // `save_session_attendance` re-checks snapshot ownership itself before
  // writing a single mark. Both answer 42501 for another instructor's
  // session, and for an instructor whose record is inactive.
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  if (!scheduleId || !isValidDateString(date)) {
    return { error: "Could not save attendance. Try again." };
  }

  const result = validateAttendanceMarks(marks);
  if (!result.success) {
    return { error: result.error };
  }

  const materialized = await materializeClassSession(scheduleId, date);
  if (!materialized.success) {
    return { error: materialized.error };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_session_attendance", {
    p_class_session_id: materialized.data.id,
    p_marks: result.data,
  });

  if (error) {
    return { error: mapSaveAttendanceError(error) };
  }

  revalidatePath("/attendance");
  revalidatePath(`/attendance/${scheduleId}/${date}`);
  return { success: true, data };
}
