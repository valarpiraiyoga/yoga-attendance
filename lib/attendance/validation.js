/**
 * Validation and derivation for Attendance (Phase 15 — foundation slice).
 * Plain functions, no schema library — consistent with the rest of the
 * project.
 *
 * There is no field-by-field form validator here the way most feature
 * areas have one: this slice builds no form. `validateAttendanceMarks`
 * shape-checks the payload a later Take Attendance UI will submit;
 * `computeAttendanceSummary` is the pure derivation the Attendance Summary
 * panel will read from once it exists.
 */

// The only two persisted statuses (01-product.md §8: "V1 supports only:
// Present, Absent"). Unmarked is never in this list — it is the absence of
// a row (supabase/migrations/0011_attendance.sql), not a third value.
export const ATTENDANCE_STATUSES = ["present", "absent"];

/**
 * Shape-validates a batch of attendance marks before they reach
 * `save_session_attendance` (supabase/migrations/0011_attendance.sql) —
 * that function is the authoritative check (eligibility, session state),
 * this is just "is this a well-formed list of {student_id, status}
 * objects" so a malformed submission fails fast with a clear message
 * rather than an opaque database error.
 *
 * @param {unknown} marks - Expected: `{ student_id: string, status: "present"|"absent" }[]`.
 * @returns {{ success: true, data: { student_id: string, status: string }[] } | { success: false, error: string }}
 */
export function validateAttendanceMarks(marks) {
  if (!Array.isArray(marks)) {
    return { success: false, error: "Attendance marks must be a list." };
  }

  const data = [];
  const seen = new Set();

  for (const mark of marks) {
    const studentId = String(mark?.student_id ?? "").trim();
    const status = String(mark?.status ?? "").trim();

    if (!studentId) {
      return { success: false, error: "Every mark must reference a student." };
    }

    if (!ATTENDANCE_STATUSES.includes(status)) {
      return { success: false, error: "Attendance status must be Present or Absent." };
    }

    if (seen.has(studentId)) {
      return { success: false, error: "Each student can only be marked once." };
    }
    seen.add(studentId);

    data.push({ student_id: studentId, status });
  }

  return { success: true, data };
}

/**
 * Eligible / Present / Absent / Unmarked counts and the attendance
 * percentage (01-product.md §8 "Summary"; approved decision D4).
 * Percentage is Present ÷ Eligible × 100 — not Present ÷ Marked, so a
 * session with several unmarked students correctly shows a lower
 * percentage rather than looking complete.
 *
 * Zero eligible students is handled safely (D4): percentage is 0, not
 * `NaN` from a division by zero.
 *
 * @param {number} eligibleCount
 * @param {{ status: "present"|"absent" }[]} marks - Existing attendance rows for the session.
 * @returns {{ eligibleCount: number, presentCount: number, absentCount: number, unmarkedCount: number, percentage: number }}
 */
export function computeAttendanceSummary(eligibleCount, marks) {
  const presentCount = marks.filter((mark) => mark.status === "present").length;
  const absentCount = marks.filter((mark) => mark.status === "absent").length;
  const unmarkedCount = Math.max(0, eligibleCount - marks.length);
  const percentage = eligibleCount > 0 ? Math.round((presentCount / eligibleCount) * 100) : 0;

  return { eligibleCount, presentCount, absentCount, unmarkedCount, percentage };
}
