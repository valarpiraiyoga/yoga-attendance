import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { scheduleOccursOnDate } from "@/lib/schedules/data";
import { classOccurrencesOf, instructorOf } from "@/lib/students/attendance-calendar";

/**
 * Student Details → Recent Attendance calendar: one student's recorded session attendance in one batch for one month. Read-only;
 * the existing `attendance` and `class_sessions` tables, under the existing Admin-only RLS (Student Details is Admin only, and
 * this function checks the role itself too). Each class session keeps the batch and date it was held with (its snapshot), so a
 * later schedule or enrollment change never moves a mark to another batch or day.
 *
 * Only recorded marks are returned - a day with no row is never turned into Present or Absent here. Each mark carries the
 * instructor of the session it was recorded on (null if none), for the strip's avatars.
 *
 * @param {string} studentId
 * @param {string} batchId
 * @param {{ from: string, to: string }} range - "YYYY-MM-DD", inclusive.
 * @returns {Promise<{ date: string, status: "present"|"absent", instructor: { id: string, name: string, photoUrl: string|null }|null }[]>}
 */
export async function listStudentBatchAttendance(studentId, batchId, { from, to }) {
  await requireRole(ROLES.ADMIN);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attendance")
    .select("status, class_sessions!inner(session_date, batch_id, start_time, end_time, instructors(id, full_name, photo_url))")
    .eq("student_id", studentId)
    .eq("class_sessions.batch_id", batchId)
    .gte("class_sessions.session_date", from)
    .lte("class_sessions.session_date", to);

  if (error) {
    console.error(`[students] Could not load attendance for student ${studentId}, batch ${batchId} (${from}..${to}):`, error.code, error.message);
    throw new Error("Could not load attendance.");
  }

  return (data ?? [])
    .map((row) => {
      const session = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
      return {
        date: session?.session_date ?? null,
        status: row.status,
        startTime: session?.start_time ?? null,
        endTime: session?.end_time ?? null,
        instructor: instructorOf(session?.instructors),
      };
    })
    .filter((row) => row.date && (row.status === "present" || row.status === "absent"));
}

/**
 * The classes the student had in this batch, in a month (see `classOccurrencesOf`): the batch's materialized sessions and
 * schedule versions - read-only, the existing tables, Admin only - combined with the student's enrollment and schedule
 * assignment periods, which the page has already loaded. Each class carries ITS instructor (a held session's own, or its
 * schedule's), embedded in the same two reads - no extra query. Nothing is written, and nothing is inferred from attendance.
 *
 * @param {string} batchId
 * @param {{ from: string, to: string }} range - "YYYY-MM-DD", inclusive.
 * @param {{ today: string, enrollmentPeriods: object[], assignments: object[] }} student
 * @returns {Promise<{ date: string, startTime: string|null, endTime: string|null, instructor: { id: string, name: string, photoUrl: string|null }|null }[]>}
 */
export async function listStudentBatchClassDates(batchId, { from, to }, { today, enrollmentPeriods, assignments }) {
  await requireRole(ROLES.ADMIN);
  const supabase = await createClient();

  const [schedulesResult, sessionsResult] = await Promise.all([
    // Every version of the batch's schedules: a materialized session points at the version it was held under.
    supabase.from("schedules").select("id, series_id, day_of_week, start_time, end_time, effective_from, effective_until, instructors(id, full_name, photo_url)").eq("batch_id", batchId),
    supabase
      .from("class_sessions")
      .select("schedule_id, session_date, status, start_time, end_time, instructors(id, full_name, photo_url)")
      .eq("batch_id", batchId)
      .gte("session_date", from)
      .lte("session_date", to),
  ]);

  const failed = [schedulesResult, sessionsResult].find((result) => result.error);
  if (failed) {
    console.error(`[students] Could not load class dates for batch ${batchId} (${from}..${to}):`, failed.error.code, failed.error.message);
    throw new Error("Could not load class dates.");
  }

  return classOccurrencesOf({
    from,
    to,
    last: today,
    enrollmentPeriods,
    assignments,
    schedules: schedulesResult.data ?? [],
    sessions: sessionsResult.data ?? [],
    occursOn: scheduleOccursOnDate,
  });
}
