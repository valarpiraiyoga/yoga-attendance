// Relative import (not "@/…") so `npm test` can load this module under plain Node.
import { DAY_LABELS } from "./validation.js";

/**
 * Whether a schedule is still a correctable configuration or has become part
 * of the historical record — and what that allows (01-product.md §7 "Deleting
 * and correcting an unused schedule").
 *
 * A schedule is UNUSED when, together:
 *   1. no class session references it (any status),
 *   2. its series has exactly one schedule row, and
 *   3. no schedule assignment on the series has started (centre date).
 *
 * An unused schedule can be deleted and can be edited in place. Anything else
 * keeps the versioned edit and the Deactivate lifecycle.
 *
 * The counts come from the database function `schedule_usage`
 * (0021_delete_unused_schedules.sql), which computes them on the centre's
 * date. The write functions `delete_unused_schedule` and
 * `correct_unused_schedule` apply the SAME three conditions again, under
 * locks, in the same transaction as the write — that is the authoritative
 * enforcement. This module only decides what to offer and say; it never
 * writes. (The condition is stated in both places on purpose: the database
 * cannot ask JavaScript, and the UI should not guess.)
 */

/** Why a schedule is not unused, in the order the conditions are checked. */
export const USAGE_BLOCK_REASONS = ["sessions", "versions", "started_assignments"];

/** Postgres SQLSTATEs the write functions raise when the schedule is not unused. */
export const NOT_UNUSED_ERROR_CODES = new Set([
  "22023", // raised by delete_unused_schedule / correct_unused_schedule (DETAIL = reason)
  "23001", // restrict_violation — the foreign-key backstop
  "23503", // foreign_key_violation
]);

/**
 * Maps the `schedule_usage` JSON to camelCase facts.
 *
 * @param {object} row
 */
export function usageFromRpc(row) {
  return {
    scheduleId: row.schedule_id,
    seriesId: row.series_id,
    batchId: row.batch_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    sessionCount: Number(row.session_count) || 0,
    versionCount: Number(row.version_count) || 0,
    startedAssignmentCount: Number(row.started_assignment_count) || 0,
    unstartedAssignmentCount: Number(row.unstarted_assignment_count) || 0,
    affectedStudentCount: Number(row.affected_student_count) || 0,
    unrecordedPastOccurrenceCount: Number(row.unrecorded_past_occurrence_count) || 0,
  };
}

/**
 * The decision for one schedule.
 *
 * @param {ReturnType<typeof usageFromRpc>} facts
 * @returns {{
 *   canDelete: boolean,
 *   blockReason: "sessions"|"versions"|"started_assignments"|null,
 *   editMode: "direct"|"versioned",
 *   sessionCount: number,
 *   versionCount: number,
 *   startedAssignmentCount: number,
 *   unstartedAssignmentCount: number,
 *   affectedStudentCount: number,
 *   unrecordedPastOccurrenceCount: number,
 *   dayOfWeek: string, startTime: string, endTime: string, batchId: string,
 * }}
 */
export function evaluateScheduleUsage(facts) {
  const blockReason =
    facts.sessionCount > 0
      ? "sessions"
      : facts.versionCount > 1
        ? "versions"
        : facts.startedAssignmentCount > 0
          ? "started_assignments"
          : null;

  return {
    canDelete: blockReason === null,
    blockReason,
    // An unused schedule is corrected in place; every other one is versioned.
    editMode: blockReason === null ? "direct" : "versioned",
    sessionCount: facts.sessionCount,
    versionCount: facts.versionCount,
    startedAssignmentCount: facts.startedAssignmentCount,
    unstartedAssignmentCount: facts.unstartedAssignmentCount,
    affectedStudentCount: facts.affectedStudentCount,
    unrecordedPastOccurrenceCount: facts.unrecordedPastOccurrenceCount,
    dayOfWeek: facts.dayOfWeek,
    startTime: facts.startTime,
    endTime: facts.endTime,
    batchId: facts.batchId,
  };
}

/** Why deletion is refused, in the words the blocked dialog and errors use. */
export function describeBlockReason(reason) {
  switch (reason) {
    case "versions":
      return "This schedule has earlier versions that must be preserved.";
    case "started_assignments":
      return "Students have been assigned to this schedule, so it must be preserved.";
    case "sessions":
    default:
      return "This schedule has recorded/materialized session history and must be preserved.";
  }
}

/** The reason carried by a write function's error (`error.details`), else "sessions". */
export function blockReasonFromError(error) {
  const detail = String(error?.details ?? "").trim();
  return USAGE_BLOCK_REASONS.includes(detail) ? detail : "sessions";
}

/** "N students are assigned to this schedule." */
export function describeAffectedStudents(count) {
  return `${count} ${count === 1 ? "student is" : "students are"} assigned to this schedule.`;
}

/** "N past occurrences were never recorded and will no longer appear after this schedule is deleted." */
export function describeUnrecordedPastOccurrences(count) {
  return `${count} past ${count === 1 ? "occurrence was" : "occurrences were"} never recorded and will no longer appear after this schedule is deleted.`;
}

/** "Tuesday" for a stored weekday. */
export function dayLabel(dayOfWeek) {
  return DAY_LABELS[dayOfWeek] ?? dayOfWeek;
}
