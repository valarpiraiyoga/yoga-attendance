// How a student's current schedules for ONE batch enrollment are laid out on Student Details -> Batch Enrollments: Time | Instructor | Days.
// Presentation-level grouping of the schedule assignments the page already reads (no new query, no time arithmetic): every distinct time slot
// is one group; inside it each instructor is one row with the days that instructor teaches that slot. Pure: no imports, so `npm test` loads it.

const NO_INSTRUCTOR = "none";

/** The restrained set of tints a time slot's block cycles through, one per slot (Student Details and the enrollment review). */
export const SLOT_TONES = ["bg-info/10 text-info", "bg-success/10 text-success", "bg-warning/10 text-warning", "bg-brand-accent/10 text-brand-accent"];

/**
 * @param {{ id: string, schedule: { day_of_week: string, start_time: string, end_time: string, instructors?: { id?: string, full_name?: string, photo_url?: string|null }|null }|null }[]} assignments
 *   the enrollment's current assignments, already in week order (Monday first) - the order the days keep inside a row.
 * @returns {{ key: string, startTime: string, endTime: string, instructorCount: number,
 *   rows: { key: string, instructor: { id?: string, full_name: string, photo_url?: string|null }|null, days: string[] }[] }[]}
 *   time slots earliest first; instructors in the order they first appear; an assignment whose schedule cannot be found is left out
 *   (the page reports it separately).
 */
export function groupSchedulesByTimeSlot(assignments) {
  const slots = new Map();

  for (const assignment of assignments ?? []) {
    const schedule = assignment?.schedule;
    if (!schedule) continue;

    const slotKey = `${schedule.start_time}|${schedule.end_time}`;
    const slot = slots.get(slotKey) ?? { key: slotKey, startTime: schedule.start_time, endTime: schedule.end_time, rows: new Map() };
    slots.set(slotKey, slot);

    const instructor = schedule.instructors?.full_name ? schedule.instructors : null;
    const rowKey = instructor ? (instructor.id ?? instructor.full_name) : NO_INSTRUCTOR;
    const row = slot.rows.get(rowKey) ?? { key: rowKey, instructor, days: [] };
    slot.rows.set(rowKey, row);
    if (!row.days.includes(schedule.day_of_week)) row.days.push(schedule.day_of_week);
  }

  return [...slots.values()]
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.endTime).localeCompare(String(b.endTime)))
    .map((slot) => {
      const rows = [...slot.rows.values()];
      return { key: slot.key, startTime: slot.startTime, endTime: slot.endTime, instructorCount: rows.filter((row) => row.instructor).length, rows };
    });
}

/** "1 instructor", "2 instructors", and "No instructor" for a slot with none. */
export function instructorCountLabel(count) {
  if (!count) return "No instructor";
  return count === 1 ? "1 instructor" : `${count} instructors`;
}
