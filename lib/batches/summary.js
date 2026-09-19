import { DAYS_OF_WEEK, DAY_LABELS } from "@/lib/schedules/validation";
import { formatTimeRange } from "@/lib/format";

/**
 * Presentation-side reading of a batch's schedules for the Batches list.
 * Pure functions on values the data layer already carries; nothing here
 * queries or writes anything.
 *
 * A batch has no time, days or instructor of its own — those belong to its
 * schedules (01-product.md §6 "Batch/Schedule Relationship", "Instructor
 * Relationship"), and one batch can have several across days, times and
 * instructors. So the list summarises the batch's *current* schedules.
 */

/** A schedule is current when it is active and today falls in its effective period. */
export function isCurrentSchedule(schedule, today) {
  return (
    schedule.status === "active" &&
    schedule.effective_from <= today &&
    (!schedule.effective_until || schedule.effective_until >= today)
  );
}

/**
 * Display status of a batch — Active / Upcoming / Completed / Inactive.
 * Derived, never stored (the stored `status` is only active | inactive):
 *
 *   1. stored `inactive`                                   → inactive
 *   2. no schedules at all                                 → active (stored status)
 *   3. a schedule is current                               → active
 *   4. else an active schedule starts in the future        → upcoming
 *   5. else (every schedule has ended or been deactivated) → completed
 *
 * @param {"active"|"inactive"} storedStatus
 * @param {{ status: string, effective_from: string, effective_until: string|null }[]} schedules
 *        every schedule row of the batch, any status
 * @param {string} today - `YYYY-MM-DD`
 * @returns {"active"|"upcoming"|"completed"|"inactive"}
 */
export function deriveBatchDisplayStatus(storedStatus, schedules, today) {
  if (storedStatus === "inactive") return "inactive";
  if (!schedules || schedules.length === 0) return "active";
  if (schedules.some((schedule) => isCurrentSchedule(schedule, today))) return "active";
  if (schedules.some((schedule) => schedule.status === "active" && schedule.effective_from > today)) {
    return "upcoming";
  }
  return "completed";
}

/**
 * The Days / Time / Instructor lines for a batch, from its current
 * schedules only.
 *   - days:       weekdays Mon→Sun, "Mon, Wed, Fri"
 *   - time:       the range when every schedule shares one, else "Multiple times"
 *   - instructor: the name when there is one, else "Multiple instructors"
 * With no current schedule: `{ hasSchedule: false }`.
 *
 * @param {{ day_of_week: string, start_time: string, end_time: string, instructors?: { id: string, full_name: string }|null }[]} currentSchedules
 */
export function summarizeCurrentSchedules(currentSchedules) {
  if (!currentSchedules || currentSchedules.length === 0) {
    return { hasSchedule: false, days: "—", time: "No current schedule", instructor: "—" };
  }

  const dayKeys = DAYS_OF_WEEK.filter((day) => currentSchedules.some((s) => s.day_of_week === day));
  const days = dayKeys.map((day) => DAY_LABELS[day].slice(0, 3)).join(", ");

  const ranges = new Set(currentSchedules.map((s) => `${s.start_time}|${s.end_time}`));
  const time =
    ranges.size === 1 ? formatTimeRange(currentSchedules[0].start_time, currentSchedules[0].end_time) : "Multiple times";

  const instructorNames = new Map();
  for (const schedule of currentSchedules) {
    if (schedule.instructors) instructorNames.set(schedule.instructors.id, schedule.instructors.full_name);
  }
  const instructor =
    instructorNames.size === 0
      ? "—"
      : instructorNames.size === 1
        ? [...instructorNames.values()][0]
        : "Multiple instructors";

  return { hasSchedule: true, days, time, instructor };
}

/** "12 students" / "1 student". */
export function formatStudentCount(count) {
  return `${count} ${count === 1 ? "student" : "students"}`;
}
