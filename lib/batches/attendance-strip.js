// Pure core of Batch Details' attendance strip: one card per day of a month, from the batch's completed sessions (the same
// `report_session_facts` rows the Batch Attendance report reads) and its schedules. No Next.js, no Supabase.
//
// A day is exactly one of:
//   recorded   one or more completed sessions of this batch that day: the Present and Absent counts, summed over those sessions
//              (a class with zero attendance is a recorded day showing 0 and 0 - it is not "No Class");
//   no_record  a schedule of this batch falls on that weekday and date, but no completed session exists (not marked, cancelled,
//              holiday): never shown as zero attendance;
//   no_class   nothing is scheduled that day.

import { calendarDays } from "../students/attendance-calendar.js";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "monday" for "2026-10-12" (computed in UTC from the date itself, so no time zone moves it). */
export function weekdayOf(date) {
  return WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Whether a schedule (day_of_week, effective_from, effective_until|null) falls on the date. */
export function scheduleOccursOn(schedule, date) {
  return (
    schedule.day_of_week === weekdayOf(date) &&
    schedule.effective_from <= date &&
    (!schedule.effective_until || date <= schedule.effective_until)
  );
}

/**
 * @param {{ month: string, today: string, sessions: { session_date: string, presentCount: number, absentCount: number }[],
 *           schedules: { day_of_week: string, effective_from: string, effective_until: string|null }[] }} input
 * @returns {{ date: string, day: number, weekday: string, kind: "recorded"|"no_record"|"no_class", present: number, absent: number }[]}
 */
export function buildBatchAttendanceStrip({ month, today, sessions, schedules }) {
  const byDate = new Map();
  for (const session of sessions ?? []) {
    const entry = byDate.get(session.session_date) ?? { present: 0, absent: 0 };
    entry.present += session.presentCount ?? 0;
    entry.absent += session.absentCount ?? 0;
    byDate.set(session.session_date, entry);
  }

  return calendarDays(month, today).map((day) => {
    const recorded = byDate.get(day.date);
    if (recorded) return { ...day, kind: "recorded", present: recorded.present, absent: recorded.absent };
    const scheduled = (schedules ?? []).some((schedule) => scheduleOccursOn(schedule, day.date));
    return { ...day, kind: scheduled ? "no_record" : "no_class", present: 0, absent: 0 };
  });
}

/** The card to highlight and scroll to: today when it is in the month, otherwise the month's last shown day. */
export function selectedDateOf(days, today) {
  if (days.some((day) => day.date === today)) return today;
  return days.length > 0 ? days[days.length - 1].date : null;
}
