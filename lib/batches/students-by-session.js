// How Batch Details lists its students by session: one group per time slot of the batch's CURRENT schedules, each student under the slot(s) their
// current schedule assignments put them in, with that slot's instructor. Presentation-level grouping of data the page already reads - the
// batch's enrollments, their schedule assignments and the batch's schedules - with no new rule: which assignments are current is decided by
// the caller (`isScheduleAssignmentActive`). Pure: no imports, so `npm test` loads it.

export const NO_SESSION_KEY = "no-session";

const slotKey = (schedule) => `${schedule.start_time ?? ""}-${schedule.end_time ?? ""}`;

/**
 * @param {object} input
 * @param {object[]} input.enrollments - the batch's enrollments (already narrowed by the search / status filter, if any).
 * @param {{ batch_enrollment_id: string, schedule_series_id: string }[]|null} input.assignments - the CURRENT schedule assignments of those
 *   enrollments, or null when they could not be read (every student is then listed in one group without a session).
 * @param {object[]} input.schedules - the batch's current schedules (each with `series_id`, `start_time`, `end_time`, `instructors`).
 * @returns {{ key: string, startTime: string|null, endTime: string|null, studentCount: number, instructorCount: number,
 *   rows: { key: string, enrollment: object, instructor: object|null }[] }[]}
 *   slots earliest first, then the students with no current session last. A student in two slots appears under both; in one slot with two
 *   instructors, once per instructor.
 */
export function groupStudentsBySession({ enrollments, assignments, schedules }) {
  const scheduleBySeries = new Map();
  for (const schedule of schedules ?? []) if (schedule.series_id && !scheduleBySeries.has(schedule.series_id)) scheduleBySeries.set(schedule.series_id, schedule);
  // Every day of one series shares its time and instructor; a series is one slot with one instructor.

  const slots = new Map();
  const placed = new Set();

  if (assignments) {
    const byEnrollment = new Map();
    for (const assignment of assignments) {
      const list = byEnrollment.get(assignment.batch_enrollment_id) ?? [];
      list.push(assignment);
      byEnrollment.set(assignment.batch_enrollment_id, list);
    }

    for (const enrollment of enrollments ?? []) {
      for (const assignment of byEnrollment.get(enrollment.id) ?? []) {
        const schedule = scheduleBySeries.get(assignment.schedule_series_id);
        if (!schedule) continue;
        const key = slotKey(schedule);
        const slot = slots.get(key) ?? { key, startTime: schedule.start_time, endTime: schedule.end_time, rows: new Map() };
        slots.set(key, slot);
        const instructor = schedule.instructors?.full_name ? schedule.instructors : null;
        const rowKey = `${enrollment.id}:${instructor ? (instructor.id ?? instructor.full_name) : "none"}`;
        if (!slot.rows.has(rowKey)) slot.rows.set(rowKey, { key: rowKey, enrollment, instructor });
        placed.add(enrollment.id);
      }
    }
  }

  const groups = [...slots.values()]
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.endTime).localeCompare(String(b.endTime)))
    .map((slot) => {
      const rows = [...slot.rows.values()];
      return {
        key: slot.key,
        startTime: slot.startTime,
        endTime: slot.endTime,
        studentCount: new Set(rows.map((row) => row.enrollment.id)).size,
        instructorCount: new Set(rows.filter((row) => row.instructor).map((row) => row.instructor.id ?? row.instructor.full_name)).size,
        rows,
      };
    });

  const unplaced = (enrollments ?? []).filter((enrollment) => !placed.has(enrollment.id));
  if (unplaced.length > 0) {
    groups.push({
      key: NO_SESSION_KEY,
      startTime: null,
      endTime: null,
      studentCount: unplaced.length,
      instructorCount: 0,
      rows: unplaced.map((enrollment) => ({ key: `${enrollment.id}:none`, enrollment, instructor: null })),
    });
  }
  return groups;
}

/** "12 students" / "1 student". */
export function studentCountLabel(count) {
  return count === 1 ? "1 student" : `${count} students`;
}

/** "2 instructors" / "1 instructor" / "No instructor". */
export function instructorCountLabel(count) {
  if (!count) return "No instructor";
  return count === 1 ? "1 instructor" : `${count} instructors`;
}
