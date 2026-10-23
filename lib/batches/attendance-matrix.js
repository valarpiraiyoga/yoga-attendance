// Batch Details' Attendance Summary matrix: the attendance strip's facts per SESSION - a row per time slot and instructor, a column per day of the
// month. A cell is exactly one of the strip's three states for that slot and instructor on that day (see attendance-strip.js):
//   recorded   the completed session's Present and Absent counts (summed if there are several; a class with zero attendance is recorded 0 / 0);
//   no_record  a schedule of that slot and instructor falls on that day but no completed session exists - never shown as zero attendance;
//   no_class   nothing of that slot and instructor is scheduled that day.
// Pure: no Next.js, no Supabase; the same `report_session_facts` rows and schedules the strip reads.

import { calendarDays } from "../students/attendance-calendar.js";
import { scheduleOccursOn } from "./attendance-strip.js";

const slotKeyOf = (start, end) => `${start ?? ""}-${end ?? ""}`;
const instructorKeyOf = (instructor) => (instructor ? (instructor.id ?? instructor.full_name) : "none");

/**
 * @param {{ month: string, today: string,
 *   sessions: { session_date: string, start_time: string, end_time: string, instructor: { id?: string, full_name: string }|null, presentCount: number, absentCount: number }[],
 *   schedules: { day_of_week: string, start_time: string, end_time: string, effective_from: string, effective_until: string|null, instructors?: { id?: string, full_name: string, photo_url?: string|null }|null }[] }} input
 * @returns {{ days: { date: string, day: number, weekday: string }[],
 *   slots: { key: string, startTime: string, endTime: string, instructorCount: number,
 *     rows: { key: string, instructor: object|null, cells: { date: string, kind: "recorded"|"no_record"|"no_class", present: number, absent: number }[] }[] }[] }}
 *   Time slots earliest first; instructors in the order they first appear (sessions, then schedules). A slot or instructor with nothing in the
 *   month (no session, no schedule on any shown day) has no row. An instructor's photo, when the batch's schedules carry it, is on `instructor`.
 */
export function buildAttendanceMatrix({ month, today, sessions, schedules }) {
  const days = calendarDays(month, today);
  const shown = new Set(days.map((day) => day.date));
  const people = new Map();
  for (const schedule of schedules ?? []) {
    if (schedule.instructors) people.set(instructorKeyOf(schedule.instructors), schedule.instructors);
  }

  const slots = new Map();
  const rowOf = (start, end, instructor) => {
    const slotKey = slotKeyOf(start, end);
    const slot = slots.get(slotKey) ?? { key: slotKey, startTime: start, endTime: end, rows: new Map() };
    slots.set(slotKey, slot);
    const key = instructorKeyOf(instructor);
    if (!slot.rows.has(key)) {
      slot.rows.set(key, { key, instructor: instructor ? (people.get(key) ?? instructor) : null, recorded: new Map(), scheduled: [] });
    }
    return slot.rows.get(key);
  };

  for (const session of sessions ?? []) {
    if (!shown.has(session.session_date)) continue;
    const row = rowOf(session.start_time, session.end_time, session.instructor);
    const entry = row.recorded.get(session.session_date) ?? { present: 0, absent: 0 };
    entry.present += session.presentCount ?? 0;
    entry.absent += session.absentCount ?? 0;
    row.recorded.set(session.session_date, entry);
  }
  for (const schedule of schedules ?? []) {
    if (!days.some((day) => scheduleOccursOn(schedule, day.date))) continue;
    rowOf(schedule.start_time, schedule.end_time, schedule.instructors?.full_name ? schedule.instructors : null).scheduled.push(schedule);
  }

  const ordered = [...slots.values()]
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.endTime).localeCompare(String(b.endTime)))
    .map((slot) => {
      const rows = [...slot.rows.values()].map((row) => ({
        key: row.key,
        instructor: row.instructor,
        cells: days.map((day) => {
          const recorded = row.recorded.get(day.date);
          if (recorded) return { date: day.date, kind: "recorded", present: recorded.present, absent: recorded.absent };
          const scheduled = row.scheduled.some((schedule) => scheduleOccursOn(schedule, day.date));
          return { date: day.date, kind: scheduled ? "no_record" : "no_class", present: 0, absent: 0 };
        }),
      }));
      return { key: slot.key, startTime: slot.startTime, endTime: slot.endTime, instructorCount: rows.filter((row) => row.instructor).length, rows };
    });

  return { days, slots: ordered };
}
