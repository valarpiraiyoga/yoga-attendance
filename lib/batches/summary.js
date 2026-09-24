// Relative imports (not "@/…") so `npm test` can load this module under plain Node.
import { DAYS_OF_WEEK, DAY_LABELS } from "../schedules/validation.js";
import { formatTimeRange } from "../format.js";
import { todayInCentreTimezone } from "../class-sessions/validation.js";

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

/**
 * "Today" for a batch's schedules: the centre's calendar date (Asia/Kolkata),
 * never the server's UTC date. Between 00:00 and 05:30 IST the UTC date is
 * still yesterday, which hid a schedule effective "today" from every Batch
 * view that filters on it.
 *
 * @param {Date} [now] - overridable for testing.
 * @returns {string} "YYYY-MM-DD"
 */
export function batchToday(now = new Date()) {
  return todayInCentreTimezone(now);
}

/** A schedule is current when it is active and today falls in its effective period. */
export function isCurrentSchedule(schedule, today) {
  return (
    schedule.status === "active" &&
    schedule.effective_from <= today &&
    (!schedule.effective_until || schedule.effective_until >= today)
  );
}

const DAY_INDEX = Object.fromEntries(DAYS_OF_WEEK.map((day, index) => [day, index]));

/**
 * The batch's current schedules — every row that `isCurrentSchedule` accepts
 * on `today`, none dropped, sorted Monday → Sunday and then by start time so
 * two classes on the same day stay adjacent. THE one definition of "the
 * batch's current schedules": the Overview schedule preview, its summary
 * tiles, and the Batches card and table all read this same set (the Schedules
 * tab lists every schedule row, current or not).
 *
 * @param {object[]} schedules - every schedule row of the batch, any status
 * @param {string} today - `YYYY-MM-DD`, normally `batchToday()`
 * @returns {object[]}
 */
export function currentSchedulesOf(schedules, today) {
  return (schedules ?? [])
    .filter((schedule) => isCurrentSchedule(schedule, today))
    .sort(
      (a, b) =>
        (DAY_INDEX[a.day_of_week] ?? 7) - (DAY_INDEX[b.day_of_week] ?? 7) ||
        String(a.start_time).localeCompare(String(b.start_time)) ||
        String(a.end_time).localeCompare(String(b.end_time))
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
 * schedules only. Order-independent; nothing is dropped:
 *   - days:       weekdays Mon→Sun, "Mon, Wed, Fri"
 *   - time:       the time range when every schedule shares one, else the number of distinct
 *                 time slots ("2 time slots"). Separate schedule records are never merged
 *                 into one range — back-to-back 6–7 and 7–8 are two slots, not one 2-hour class
 *   - instructor: the name when there is one, else the number of instructors ("2 instructors")
 *   - timeSlots:  how many DISTINCT time ranges the current schedules use (days are not slots)
 *   - count / countLabel: how many schedule RECORDS there are; `countLabel` ("7 schedules") is `null` for one
 *   - timeSummary: `time` and `countLabel` as one line — "6:00 AM – 7:00 AM · 5 schedules",
 *                 "2 time slots · 7 schedules", or just the range for a single schedule
 *   - detail:     every schedule on its own line ("Tue 6:00 AM – 7:00 AM"), for a tooltip
 * With no current schedule: `{ hasSchedule: false }`.
 *
 * @param {{ day_of_week: string, start_time: string, end_time: string, instructors?: { id: string, full_name: string }|null }[]} currentSchedules
 */
export function summarizeCurrentSchedules(currentSchedules) {
  if (!currentSchedules || currentSchedules.length === 0) {
    return {
      hasSchedule: false,
      days: "—",
      time: "No current schedule",
      timeSummary: "No current schedule",
      instructor: "—",
      timeSlots: 0,
      count: 0,
      countLabel: null,
      detail: "",
    };
  }

  const ordered = [...currentSchedules].sort(
    (a, b) =>
      (DAY_INDEX[a.day_of_week] ?? 7) - (DAY_INDEX[b.day_of_week] ?? 7) ||
      String(a.start_time).localeCompare(String(b.start_time))
  );

  const dayKeys = DAYS_OF_WEEK.filter((day) => ordered.some((s) => s.day_of_week === day));
  const days = dayKeys.map((day) => DAY_LABELS[day].slice(0, 3)).join(", ");

  const count = ordered.length;
  const timeSlots = countTimeSlots(ordered);
  const time =
    timeSlots === 1 ? formatTimeRange(ordered[0].start_time, ordered[0].end_time) : `${timeSlots} time slots`;
  const countLabel = count > 1 ? `${count} schedules` : null;

  const instructorNames = new Map();
  for (const schedule of ordered) {
    if (schedule.instructors) instructorNames.set(schedule.instructors.id, schedule.instructors.full_name);
  }
  const instructor =
    instructorNames.size === 0
      ? "—"
      : instructorNames.size === 1
        ? [...instructorNames.values()][0]
        : `${instructorNames.size} instructors`;

  const detail = ordered
    .map((s) => `${DAY_LABELS[s.day_of_week]?.slice(0, 3) ?? s.day_of_week} ${formatTimeRange(s.start_time, s.end_time)}`)
    .join("\n");

  return {
    hasSchedule: true,
    days,
    time,
    timeSummary: countLabel ? `${time} · ${countLabel}` : time,
    instructor,
    timeSlots,
    count,
    countLabel,
    detail,
  };
}

// Distinct time ranges among the schedules — exact start/end pairs, never merged or
// inferred from an earliest/latest time (adjacent records may be separate classes).
function countTimeSlots(schedules) {
  const hhmm = (value) => String(value).slice(0, 5);
  return new Set(schedules.map((s) => `${hhmm(s.start_time)}|${hhmm(s.end_time)}`)).size;
}

/** "12 students" / "1 student". */
export function formatStudentCount(count) {
  return `${count} ${count === 1 ? "student" : "students"}`;
}
