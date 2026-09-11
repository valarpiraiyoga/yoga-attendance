import "server-only";

import { createClient } from "@/lib/supabase/server";
import { computeAttendanceSummary } from "@/lib/attendance/validation";

/**
 * Data Access Layer for reading Attendance.
 *
 * RLS restricts these queries to admins for this foundation slice (see
 * supabase/migrations/0011_attendance.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 *
 * Eligibility is resolved through `resolve_eligible_students`
 * (0011_attendance.sql, extended by
 * 0012_attendance_eligibility_membership_details.sql to also return the
 * qualifying membership's dates, by 0013_schedule_assignment.sql to also
 * require a schedule assignment on the session's own schedule series, and
 * by 0014_instructor_attendance_access.sql to also return the student's
 * display fields directly and to authorize an instructor for their own
 * session) rather than reimplemented as a PostgREST query here — that
 * function is the single source of the eligibility rule (01-product.md
 * §8), shared with `save_session_attendance`'s own server-side
 * re-validation, so there is exactly one place a change to the
 * eligibility rule has to be made.
 *
 * `listEligibleStudents` reads only this RPC — never a second query
 * against `students` — because `students` has no general SELECT policy
 * for an instructor (Phase 15 Instructor Access): the RPC is
 * `SECURITY DEFINER` and is the only path by which an instructor's own
 * eligible students are ever visible to them.
 */

/**
 * The ids of students eligible for a session on a given batch, schedule
 * and date — active enrollment in that batch covering the date, a
 * schedule assignment covering the date on the session's own schedule
 * series, active membership covering the date, active student (approved
 * decisions D1–D3, Phase 15A). Always evaluated against `sessionDate`,
 * never "today": a past session's eligibility must reflect who qualified
 * on that date, not who qualifies now.
 *
 * @param {string} batchId
 * @param {string} scheduleId - The session's own `schedule_id` (its snapshot version, §7A) — resolved to its schedule series inside the RPC.
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<string[]>}
 */
export async function listEligibleStudentIds(batchId, scheduleId, sessionDate) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("resolve_eligible_students", {
    p_batch_id: batchId,
    p_schedule_id: scheduleId,
    p_session_date: sessionDate,
  });

  if (error) {
    console.error(
      `[attendance] Could not resolve eligible students for batch ${batchId}, schedule ${scheduleId} on ${sessionDate}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load eligible students.");
  }

  return (data ?? []).map((row) => row.student_id);
}

/**
 * The eligible students themselves (name, phone, Student ID, and the
 * qualifying membership's date range), for a session's batch, schedule and
 * date — the Eligible Students tab's data source. Read entirely from
 * `resolve_eligible_students`'s own return columns
 * (0014_instructor_attendance_access.sql), not a second eligibility
 * implementation and not a second query against `students`: the display
 * fields, the membership date range, and the schedule-assignment condition
 * all come straight from that one `SECURITY DEFINER` function — nothing
 * here re-derives or second-guesses any of it.
 *
 * A prior version of this function followed the RPC with a plain
 * `.from("students")` query to fetch these same display fields. That
 * second query is intentionally not present: `students` has no general
 * SELECT policy for an instructor (Phase 15 Instructor Access), so it
 * would silently return an empty list for one, even though the RPC itself
 * had already authorized and resolved their eligible students correctly.
 *
 * @param {string} batchId
 * @param {string} scheduleId - The session's own `schedule_id`.
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<{ id: string, full_name: string, phone: string, student_code: string, membership: { start_date: string, end_date: string } }[]>}
 */
export async function listEligibleStudents(batchId, scheduleId, sessionDate) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("resolve_eligible_students", {
    p_batch_id: batchId,
    p_schedule_id: scheduleId,
    p_session_date: sessionDate,
  });

  if (error) {
    console.error(
      `[attendance] Could not resolve eligible students for batch ${batchId}, schedule ${scheduleId} on ${sessionDate}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load eligible students.");
  }

  return (data ?? [])
    .map((row) => ({
      id: row.student_id,
      full_name: row.full_name,
      phone: row.phone,
      student_code: row.student_code,
      membership: { start_date: row.membership_start_date, end_date: row.membership_end_date },
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * The attendance already recorded for one class session — empty when
 * nothing has been saved yet. A student with no row here is unmarked; this
 * function has no notion of "unmarked" rows to return, by design
 * (0011_attendance.sql).
 *
 * @param {string} classSessionId
 * @returns {Promise<{ student_id: string, status: "present"|"absent" }[]>}
 */
export async function getAttendanceForSession(classSessionId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attendance")
    .select("student_id, status")
    .eq("class_session_id", classSessionId);

  if (error) {
    console.error(`[attendance] Could not load attendance for session ${classSessionId}:`, error.code, error.message);
    throw new Error("Could not load attendance.");
  }

  return data ?? [];
}

/**
 * Eligible/Present/Absent/Unmarked counts and the attendance percentage
 * for one session (01-product.md §8 "Summary") — the Attendance Summary
 * panel's data source once it exists. `classSessionId` is only used to
 * look up already-saved marks; a projected occurrence has none yet and
 * this still returns a safe all-zero/all-unmarked summary rather than
 * requiring the caller to materialize just to preview it.
 *
 * @param {string|null} classSessionId - Null for a not-yet-materialized occurrence.
 * @param {string} batchId
 * @param {string} scheduleId - The session's own `schedule_id`.
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<{ eligibleCount: number, presentCount: number, absentCount: number, unmarkedCount: number, percentage: number }>}
 */
export async function getAttendanceSummary(classSessionId, batchId, scheduleId, sessionDate) {
  const [eligibleIds, marks] = await Promise.all([
    listEligibleStudentIds(batchId, scheduleId, sessionDate),
    classSessionId ? getAttendanceForSession(classSessionId) : Promise.resolve([]),
  ]);

  return computeAttendanceSummary(eligibleIds.length, marks);
}
