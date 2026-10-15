/**
 * The join-date rules (migration 0051), as the application states them before anything is written. The database is the authority:
 * its triggers refuse the same writes whoever sends them, and `matchKnownJoinDateError` turns their messages into field errors.
 *
 *   - An enrollment's start date and a membership's start date cannot be before the student's join date. Only a NEW start date
 *     is judged: any other edit of an existing record that is already out of range still works.
 *   - A join date cannot be moved LATER than the start of an ACTIVE enrollment or a NON-CANCELLED membership. Moving it earlier
 *     is the supported way to correct an earlier start.
 *
 * Pure and import-free, so it is tested without a server.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "Oct 10, 2026" for a YYYY-MM-DD date (UTC, so the day never moves). */
export function joinDateLabel(value) {
  if (!DATE_PATTERN.test(String(value ?? ""))) return String(value ?? "");
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Whether a start date is being set or changed: a new record (no previous start), or a start different from the stored one. */
export function startDateChanged(previousStart, nextStart) {
  return !previousStart || String(previousStart) !== String(nextStart);
}

/**
 * The message for a start date before the join date, or null.
 *
 * @param {"enrollment"|"membership"} subject
 * @param {string} startDate - "YYYY-MM-DD".
 * @param {string|null|undefined} joinDate - the student's join date; no date, no rule.
 */
export function startBeforeJoinDateError(subject, startDate, joinDate) {
  if (!DATE_PATTERN.test(String(startDate ?? "")) || !DATE_PATTERN.test(String(joinDate ?? ""))) return null;
  if (startDate >= joinDate) return null;
  return `The ${subject} cannot start before the student joined (${joinDateLabel(joinDate)}). Correct the join date in Edit Student first.`;
}

/**
 * The same judgement for a record that already exists: only a CHANGED start date is checked, so an unrelated edit of a record that
 * is already out of range is never refused.
 */
export function changedStartBeforeJoinDateError(subject, { previousStart, nextStart, joinDate }) {
  if (!startDateChanged(previousStart, nextStart)) return null;
  return startBeforeJoinDateError(subject, nextStart, joinDate);
}

/**
 * The message for a join date moved later past live records, or null. Moving earlier, or not at all, is never refused.
 *
 * @param {{ previousJoinDate: string, nextJoinDate: string, enrollmentStarts: string[], membershipStarts: string[] }} input
 *   the starts of the student's ACTIVE enrollments and NON-CANCELLED memberships.
 */
export function joinDateMoveError({ previousJoinDate, nextJoinDate, enrollmentStarts = [], membershipStarts = [] }) {
  if (!DATE_PATTERN.test(String(nextJoinDate ?? "")) || !DATE_PATTERN.test(String(previousJoinDate ?? ""))) return null;
  if (nextJoinDate <= previousJoinDate) return null;
  const earlierEnrollments = enrollmentStarts.filter((start) => start < nextJoinDate);
  const earlierMemberships = membershipStarts.filter((start) => start < nextJoinDate);
  if (earlierEnrollments.length + earlierMemberships.length === 0) return null;
  const earliest = [...earlierEnrollments, ...earlierMemberships].sort()[0];
  return `The join date cannot be moved to ${joinDateLabel(nextJoinDate)} while this student has ${earlierEnrollments.length} active enrollment(s) and ${earlierMemberships.length} membership(s) that start earlier (earliest ${joinDateLabel(earliest)}).`;
}

/**
 * The application result for a database error that belongs to the join-date rules or the start-date cascade, or null.
 *
 * @param {{ code?: string, message?: string }|null|undefined} error
 * @returns {{ error: string, field: string, code: string }|null}
 */
export function matchKnownJoinDateError(error) {
  const code = error?.code ?? null;
  const text = error?.message ?? "";
  if (code === "23514") {
    if (/^The enrollment cannot start before the student joined/.test(text)) return { error: text, field: "effective_start_date", code };
    if (/^The membership cannot start before the student joined/.test(text)) return { error: text, field: "start_date", code };
    if (/^The join date cannot be moved to/.test(text)) return { error: text, field: "join_date", code };
    if (/enrollment_schedules_end_after_start/.test(text)) {
      return {
        error: "A schedule assignment of this enrollment ends before the new start date, so the start date was not changed.",
        field: "effective_start_date",
        code,
      };
    }
  }
  if (code === "23P01" && /enrollment_schedules_no_overlap/.test(text)) {
    return {
      error: "Moving the start date would overlap another schedule assignment of this enrollment, so nothing was changed.",
      field: "effective_start_date",
      code,
    };
  }
  return null;
}

/** "3 schedule assignments moved to the new start date." (singular for one), or "" when none moved. */
export function movedAssignmentsText(count) {
  const moved = Number(count);
  if (!Number.isInteger(moved) || moved < 1) return "";
  return `${moved} schedule ${moved === 1 ? "assignment was" : "assignments were"} moved to the new start date.`;
}
