import { formatDate } from "../format.js";

/**
 * Phase 16A step 6 - the enrollment effective-date rule (04-development-plan.md "Enrollment effective-date business rule";
 * 01-product.md section 4 "Enrollment effective date and recorded attendance").
 *
 * A change to when an enrollment or its schedules take effect cannot land on a date on which the student already has recorded
 * class-session attendance: the date is date-only, so a change effective on D and a session already attended on D cannot be
 * ordered against each other. The Admin is asked to choose a later date. It protects against NEW same-day conflicts; the saved
 * eligibility snapshot (migration 0015) is what keeps already-recorded history immutable.
 *
 * Scope: the student's attendance in ANY batch or series on that date (not only the batch being changed), dated class-session
 * attendance only (the `attendance` table - class-count attendance is not session-based and is not checked). It applies to a
 * start-date change, a new enrollment's start date, and the schedule/batch effective date; not to end dates, status or
 * instructor changes. Read-only; the Supabase client is passed in so it is testable without a server.
 */

/** The field-level message. `date` is YYYY-MM-DD. */
export function attendanceConflictMessage(date) {
  return `This student already has attendance recorded on ${formatDate(date)}. Choose a later effective date.`;
}

/**
 * Whether the student has any recorded class-session attendance on `date`.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} studentId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{ conflict: boolean, failed: boolean }>} `failed` when the lookup itself errored: the caller must not write.
 */
export async function findAttendanceOnDate(supabase, studentId, date) {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, class_sessions!inner(session_date)")
    .eq("student_id", studentId)
    .eq("class_sessions.session_date", date)
    .limit(1);

  if (error) {
    console.error(`[enrollments] Could not check attendance for student ${studentId} on ${date}:`, error.code, error.message);
    return { conflict: false, failed: true };
  }

  return { conflict: (data ?? []).length > 0, failed: false };
}
