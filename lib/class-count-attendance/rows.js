import { classCountOf } from "../memberships/class-count.js";

/**
 * The rows of the Class Count Attendance tab, in one shape whichever read they came from:
 *
 * `{ membershipId, membershipCode, studentId, fullName, studentCode, photoUrl, startDate, endDate, total, used, remaining }`
 *
 * (`endDate` is null for a membership with no expiry).
 */

/** A row of `list_class_count_eligible()` (migration 0043): a class can be recorded for it today. */
export function eligibleRowFrom(row) {
  return {
    membershipId: row.membership_id,
    membershipCode: row.membership_code,
    studentId: row.student_id,
    fullName: row.full_name,
    studentCode: row.student_code,
    photoUrl: null,
    startDate: row.start_date,
    endDate: row.end_date,
    total: row.total_classes,
    used: row.classes_used,
    remaining: row.classes_remaining,
  };
}

/**
 * The class-count memberships to offer a Renew action for: each active student's LATEST class-count membership,
 * when its classes are all used. A student who has already renewed has a later membership, so the used-up one is no
 * longer offered; a cancelled membership is never offered. Pure: the caller reads the memberships.
 *
 * @param {{
 *   id: string, membership_code: string, student_id: string, start_date: string, end_date: string|null,
 *   total_classes: number, class_count_attendance?: { count: number }[],
 *   students: { id: string, full_name: string, student_code: string, photo_url: string|null, status: string }|null,
 * }[]} memberships - non-cancelled class-count memberships.
 */
export function pickClassesToRenew(memberships) {
  const latestByStudent = new Map();
  for (const membership of memberships) {
    const current = latestByStudent.get(membership.student_id);
    const later =
      !current ||
      membership.start_date > current.start_date ||
      (membership.start_date === current.start_date && membership.id > current.id);
    if (later) latestByStudent.set(membership.student_id, membership);
  }

  const rows = [];
  for (const membership of latestByStudent.values()) {
    const student = membership.students;
    if (!student || student.status !== "active") continue;
    const count = classCountOf({ kind: "class_count", total_classes: membership.total_classes }, membership.class_count_attendance);
    if (count.remaining > 0) continue;
    rows.push({
      membershipId: membership.id,
      membershipCode: membership.membership_code,
      studentId: student.id,
      fullName: student.full_name,
      studentCode: student.student_code,
      photoUrl: student.photo_url ?? null,
      startDate: membership.start_date,
      endDate: membership.end_date,
      total: count.total,
      used: count.used,
      remaining: 0,
    });
  }

  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.membershipCode.localeCompare(b.membershipCode));
}
