/**
 * "Recent Attendance" on Student Details: which of a student's per-session
 * attendance facts to show. Pure (no database, no clock), so it is testable and
 * the one definition of what "recent" means.
 *
 * The facts themselves come from `getStudentAttendanceReport`
 * (`lib/reports/data.js`), the same `report_session_facts` read the Student
 * Attendance report uses - the authoritative `attendance` rows joined to their
 * class sessions - never inferred from a membership or a batch enrollment.
 */

// How far back Recent Attendance looks and how many rows it shows: the same
// window Batch Details' Recent Attendance uses.
export const RECENT_ATTENDANCE_DAYS = 90;
export const RECENT_ATTENDANCE_ROWS = 5;

/**
 * The inclusive date range to read: the last `RECENT_ATTENDANCE_DAYS` up to and
 * including `today`, which is the CENTRE's date (`getCentreToday()`), so a
 * session marked today at the centre is inside the range.
 *
 * @param {string} today - "YYYY-MM-DD", the centre's date.
 * @param {(date: string, days: number) => string} addDays - calendar-date arithmetic (`addDaysUTC`).
 */
export function recentAttendanceRange(today, addDays) {
  return { dateFrom: addDays(today, -RECENT_ATTENDANCE_DAYS), dateTo: today };
}

/**
 * The student's recorded attendance, newest first, limited to
 * `RECENT_ATTENDANCE_ROWS`. Only sessions with a recorded mark (present or
 * absent) are attendance records: a completed session the student was eligible
 * for but nobody marked them in is "unmarked", which is not attendance and is
 * never shown as one.
 *
 * @param {{ id: string, session_date: string, start_time?: string|null, status: string }[]} sessions
 */
export function selectRecentAttendance(sessions) {
  return (sessions ?? [])
    .filter((session) => session.status === "present" || session.status === "absent")
    .sort(
      (a, b) =>
        b.session_date.localeCompare(a.session_date) || (b.start_time ?? "").localeCompare(a.start_time ?? "")
    )
    .slice(0, RECENT_ATTENDANCE_ROWS);
}
