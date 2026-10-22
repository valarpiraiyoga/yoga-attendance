// Pure helpers for the day-wise schedule picker (Add / Edit Batch Enrollment): weekday grouping and the time-range colour grouping.

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** The identity of a time range: identical start and end times share it, whatever the day or instructor. */
export function timeRangeKey(schedule) {
  return `${schedule.start_time ?? ""}-${schedule.end_time ?? ""}`;
}

/**
 * Monday to Sunday, each with its schedules ordered by start time, then end time, then instructor name (a stable order).
 * Every weekday is returned, with an empty list when it has no schedule. Schedules are never merged, even with identical times.
 *
 * @param {{ series_id: string, day_of_week: string, start_time: string, end_time: string, instructors?: { full_name?: string }|null }[]} schedules
 */
export function groupSchedulesByDay(schedules) {
  const byDay = new Map(WEEKDAYS.map((day) => [day, []]));
  for (const schedule of schedules ?? []) byDay.get(schedule.day_of_week)?.push(schedule);
  const name = (schedule) => schedule.instructors?.full_name ?? "";
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        (a.end_time ?? "").localeCompare(b.end_time ?? "") ||
        name(a).localeCompare(name(b)),
    );
  }
  return WEEKDAYS.map((day) => ({ day, schedules: byDay.get(day) }));
}

/**
 * A deterministic colour slot for every distinct time range: the ranges, ordered by start then end time, take slots 0, 1, 2...
 * (wrapping at `slots`). The same time range therefore always has the same slot - on every weekday, for every instructor.
 *
 * @returns {Map<string, number>} time-range key -> slot
 */
export function timeRangeSlots(schedules, slots) {
  const ranges = [...new Set((schedules ?? []).map(timeRangeKey))].sort();
  return new Map(ranges.map((key, index) => [key, index % slots]));
}

// Light chips for the time ranges, from the semantic tokens the Badge already uses (text on a 10% tint of the same colour).
// The colour only groups identical time ranges; the times (and instructors) are always written out.
export const TIME_RANGE_CHIPS = [
  "bg-info/10 text-info",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-brand/10 text-brand",
  "bg-danger/10 text-danger",
  "bg-neutral/15 text-text-secondary",
];
