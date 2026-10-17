/**
 * Student Details → Recent Attendance calendar - the pure half: the month in the URL, the days of a month on the centre's
 * calendar, and each day's state for one batch. No Next.js, no Supabase; tested without a server.
 *
 * A day's state comes only from stored data:
 *   - present / absent   the student's recorded attendance on a session of that batch that day (both = "mixed", e.g. a morning
 *                        and an evening class with different marks);
 *   - not_enrolled       no recorded attendance, and no enrollment of the student in that batch covers the day;
 *   - no_record          enrolled that day, but nothing recorded (no class, a cancelled/holiday session, or not marked) -
 *                        never shown as Present or Absent.
 * Recorded attendance always wins over the enrollment dates, so a mark is never hidden.
 *
 * Dates are "YYYY-MM-DD" strings on the centre's calendar (the same strings the database stores), so comparisons are plain
 * string comparisons and weekdays are computed in UTC from the date itself - the viewer's time zone never moves a day.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DAY_STATUS = {
  present: { label: "Present" },
  absent: { label: "Absent" },
  mixed: { label: "Present and absent" },
  not_enrolled: { label: "Not enrolled" },
  no_record: { label: "No attendance recorded" },
};

/** "2026-10" for "2026-10-16". */
export function monthOf(date) {
  return String(date).slice(0, 7);
}

/** The month `delta` months away: shiftMonth("2026-01", -1) → "2025-12". */
export function shiftMonth(month, delta) {
  const [, year, mm] = MONTH.exec(month);
  const index = Number(year) * 12 + (Number(mm) - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The URL's month, or the current one. A future month (there is no attendance yet) falls back to the current month. */
export function parseCalendarMonth(raw, today) {
  const current = monthOf(today);
  if (typeof raw !== "string" || !MONTH.test(raw)) return current;
  return raw > current ? current : raw;
}

/** "October 2026". */
export function monthLabel(month) {
  const [, year, mm] = MONTH.exec(month);
  return new Date(Date.UTC(Number(year), Number(mm) - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** First and last day of a month: { from: "2026-10-01", to: "2026-10-31" }. */
export function monthBounds(month) {
  const [, year, mm] = MONTH.exec(month);
  const last = new Date(Date.UTC(Number(year), Number(mm), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The days shown for a month: every day of a past month; the current month up to today (later days have no attendance yet).
 *
 * @returns {{ date: string, day: number, weekday: string }[]}
 */
export function calendarDays(month, today) {
  const { from, to } = monthBounds(month);
  const last = monthOf(today) === month ? today : to;
  const days = [];
  for (let day = 1; ; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date > last || date > to) break;
    const weekday = WEEKDAY_SHORT[new Date(`${date}T00:00:00Z`).getUTCDay()];
    days.push({ date, day, weekday });
  }
  return from <= last ? days : [];
}

/** Whether any enrollment period ({ start, end|null }) covers the date. */
export function enrolledOn(date, periods) {
  return (periods ?? []).some((period) => period.start && period.start <= date && (period.end == null || period.end >= date));
}

/**
 * Each shown day with its state for one batch.
 *
 * With `classDates` (the batch's class dates for this student, see `classDatesOf`) only those days are shown - plus any day that
 * has a recorded mark, so a mark is never hidden. Without it, every day of the month is shown. A state is never inferred from
 * missing data: a class date with no mark is "no_record".
 *
 * @param {{ month: string, today: string, records: { date: string, status: "present"|"absent" }[],
 *           periods: { start: string, end: string|null }[], classDates?: string[],
 *           instructors?: Record<string, object[]>, sessions?: Record<string, object[]> }} input - `instructors`: `instructorsByDate`'s
 *           result; `sessions`: `sessionsByDate`'s.
 * @returns {{ date: string, day: number, weekday: string, status: keyof typeof DAY_STATUS }[]}
 */
export function buildAttendanceStrip({ month, today, records, periods, classDates, instructors, sessions }) {
  const marks = new Map();
  for (const record of records ?? []) {
    if (record.status !== "present" && record.status !== "absent") continue;
    const seen = marks.get(record.date) ?? new Set();
    seen.add(record.status);
    marks.set(record.date, seen);
  }

  const shown = classDates ? new Set([...classDates, ...marks.keys()]) : null;

  return calendarDays(month, today)
    .filter((day) => !shown || shown.has(day.date))
    .map((day) => {
    const seen = marks.get(day.date);
    let status;
    if (seen?.has("present") && seen.has("absent")) status = "mixed";
    else if (seen?.has("present")) status = "present";
    else if (seen?.has("absent")) status = "absent";
    else status = enrolledOn(day.date, periods) ? "no_record" : "not_enrolled";
    return { ...day, status, instructors: instructors?.[day.date] ?? [], sessions: sessions?.[day.date] ?? [] };
    });
}

// ---- the class dates ------------------------------------------------------------------------------------------------------

/** Session statuses that are not an ordinary class date: a cancelled or holiday session is not a class that was held. */
const NOT_A_CLASS = new Set(["cancelled", "holiday"]);

/**
 * The dates on which one student had a class in one batch, in a month - the same session model the Sessions lists use
 * (01-product.md 7A): a MATERIALIZED session row is authoritative (it is a historical fact that outlives schedule edits), and only
 * where there is none does the batch's recurring schedule decide. A date counts only when the student's enrollment in the batch
 * covers it AND one of their schedule assignments (a series, with its own period) covers it AND the class belongs to that series.
 * A cancelled or holiday session is never a class date, and its date is not projected from the schedule either.
 *
 * Pure: `occursOn(schedule, date)` is the schedule's own weekday and effective-period rule (`scheduleOccursOnDate`), passed in.
 *
 * @param {{ from: string, to: string, last?: string,
 *           enrollmentPeriods: { start: string, end: string|null }[],
 *           assignments: { seriesId: string, start: string, end: string|null }[],
 *           schedules: { id: string, series_id: string }[],
 *           sessions: { schedule_id: string, session_date: string, status: string }[],
 *           occursOn: (schedule: object, date: string) => boolean }} input - `last`: the latest date to consider (today).
 * @returns {string[]} Sorted "YYYY-MM-DD".
 */
export function classDatesOf(input) {
  return [...new Set(classOccurrencesOf(input).map((occurrence) => occurrence.date))].sort();
}

/** A person from an `instructors(id, full_name, photo_url)` embed (an object, or a one-item array), or null. */
export function instructorOf(embed) {
  const row = Array.isArray(embed) ? embed[0] : embed;
  return row?.id ? { id: row.id, name: row.full_name ?? "", photoUrl: row.photo_url ?? null } : null;
}

/**
 * The same classes as `classDatesOf`, one entry per class (a date with two classes has two), each with the instructor of THAT
 * class: a materialized session's own instructor (its snapshot - the person who actually held it), or, for a class not yet held
 * in a materialized row, the instructor of the schedule it follows. `instructor` is null when the data carries none - never
 * assumed from the batch.
 *
 * Each class also carries its own start and end time (a held session's, else its schedule's); null when the data has none.
 *
 * @returns {{ date: string, startTime: string|null, endTime: string|null,
 *             instructor: { id: string, name: string, photoUrl: string|null } | null }[]}
 */
export function classOccurrencesOf({ from, to, last, enrollmentPeriods, assignments, schedules, sessions, occursOn }) {
  const end = last && last < to ? last : to;
  const seriesOfSchedule = new Map((schedules ?? []).map((schedule) => [schedule.id, schedule.series_id]));
  const assigned = (date, seriesId) =>
    enrolledOn(date, enrollmentPeriods) &&
    (assignments ?? []).some((a) => a.seriesId === seriesId && a.start <= date && (a.end == null || a.end >= date));

  const occurrences = [];
  const materialized = new Set();

  // Materialized sessions first: they win over the schedule for their (schedule, date), cancelled ones included.
  for (const session of sessions ?? []) {
    materialized.add(`${session.schedule_id}:${session.session_date}`);
    if (NOT_A_CLASS.has(session.status)) continue;
    if (session.session_date < from || session.session_date > end) continue;
    if (assigned(session.session_date, seriesOfSchedule.get(session.schedule_id))) {
      occurrences.push({
        date: session.session_date,
        startTime: session.start_time ?? null,
        endTime: session.end_time ?? null,
        instructor: instructorOf(session.instructors),
      });
    }
  }

  // The rest follow the schedule.
  for (let date = from; date <= end; date = nextDay(date)) {
    for (const schedule of schedules ?? []) {
      if (materialized.has(`${schedule.id}:${date}`)) continue;
      if (!occursOn(schedule, date)) continue;
      if (assigned(date, schedule.series_id)) {
        occurrences.push({
          date,
          startTime: schedule.start_time ?? null,
          endTime: schedule.end_time ?? null,
          instructor: instructorOf(schedule.instructors),
        });
      }
    }
  }

  return occurrences.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The classes of each date, for the tooltip: each one's start and end time, instructor and ITS OWN attendance state - from the
 * date's class occurrences and from every recorded mark's actual session (so a make-up class is described too). A class is one
 * entry, identified by its time and instructor (what a mark carries about the session it was recorded on); its `status` is that
 * class's mark: "present" or "absent", or "no_record" when none was recorded. Two classes on one day are two entries with their
 * own states - they are never merged into one. Earliest first. Nothing is added that the data does not carry.
 *
 * @param {{ date: string, startTime?: string|null, endTime?: string|null, instructor: object|null }[]} occurrences
 * @param {{ date: string, status?: string, startTime?: string|null, endTime?: string|null, instructor?: object|null }[]} records
 * @returns {Record<string, { startTime: string|null, endTime: string|null, instructor: object|null,
 *                            status: "present"|"absent"|"no_record" }[]>}
 */
export function sessionsByDate(occurrences, records) {
  const byDate = {};
  const entryFor = (item) => {
    const candidate = { startTime: item.startTime ?? null, endTime: item.endTime ?? null, instructor: item.instructor ?? null, status: "no_record" };
    const list = (byDate[item.date] ??= []);
    const same = (other) =>
      other.startTime === candidate.startTime && other.endTime === candidate.endTime && other.instructor?.id === candidate.instructor?.id;
    let entry = list.find(same);
    if (!entry) {
      entry = candidate;
      list.push(entry);
    }
    return entry;
  };

  for (const occurrence of occurrences ?? []) {
    if (!occurrence.startTime && !occurrence.endTime && !occurrence.instructor) continue;
    entryFor(occurrence);
  }
  // A recorded mark belongs to the class it was recorded on: it sets that class's state (or adds the class, for a make-up).
  for (const record of records ?? []) {
    if (record.status !== "present" && record.status !== "absent") continue;
    entryFor(record).status = record.status;
  }

  for (const [date, list] of Object.entries(byDate)) {
    if (list.length === 0) delete byDate[date];
    else list.sort((a, b) => String(a.startTime ?? "99").localeCompare(String(b.startTime ?? "99")));
  }
  return byDate;
}

/**
 * The instructors of each date, for the strip's avatars: the instructors of the date's classes plus the instructor of every
 * recorded mark's actual session (so a make-up class shows who held it). One entry per person per date, in a stable order
 * (by name); a date with no instructor data has none - nothing is assumed.
 *
 * @param {{ date: string, instructor: object|null }[]} occurrences
 * @param {{ date: string, instructor?: object|null }[]} records
 * @returns {Record<string, { id: string, name: string, photoUrl: string|null }[]>}
 */
export function instructorsByDate(occurrences, records) {
  const byDate = {};
  const add = (date, instructor) => {
    if (!instructor) return;
    const list = (byDate[date] ??= []);
    if (!list.some((existing) => existing.id === instructor.id)) list.push(instructor);
  };
  for (const occurrence of occurrences ?? []) add(occurrence.date, occurrence.instructor);
  for (const record of records ?? []) add(record.date, record.instructor);
  for (const list of Object.values(byDate)) list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return byDate;
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The student's schedule assignments as `classDatesOf` takes them, for one batch: each assignment of each enrollment in that
 * batch (an enrollment is the page's `listEnrollmentsForStudent` row; its assignments are `listScheduleAssignmentsForEnrollment`).
 *
 * @param {{ id: string, batch_id: string }[]} enrollments
 * @param {Map<string, { schedule_series_id: string, effective_start_date: string, effective_end_date: string|null }[]>} assignmentsByEnrollmentId
 */
export function batchAssignments(enrollments, assignmentsByEnrollmentId, batchId) {
  return (enrollments ?? [])
    .filter((enrollment) => enrollment.batch_id === batchId)
    .flatMap((enrollment) =>
      (assignmentsByEnrollmentId.get(enrollment.id) ?? []).map((assignment) => ({
        seriesId: assignment.schedule_series_id,
        start: assignment.effective_start_date,
        end: assignment.effective_end_date ?? null,
      })),
    );
}

/**
 * The batch tabs: one per batch the student has ever been enrolled in, active enrollments first, then by name; each with its
 * enrollment periods (every enrollment in that batch, active or not).
 *
 * @param {{ batch_id: string, status: string, effective_start_date: string, effective_end_date: string|null,
 *           batches?: { name?: string } }[]} enrollments
 */
export function calendarBatches(enrollments) {
  const byBatch = new Map();
  for (const enrollment of enrollments ?? []) {
    if (!enrollment.batch_id) continue;
    const entry = byBatch.get(enrollment.batch_id) ?? {
      id: enrollment.batch_id,
      name: enrollment.batches?.name ?? "Unknown batch",
      active: false,
      periods: [],
    };
    entry.active = entry.active || enrollment.status === "active";
    entry.periods.push({ start: enrollment.effective_start_date, end: enrollment.effective_end_date ?? null });
    byBatch.set(enrollment.batch_id, entry);
  }
  return [...byBatch.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** The selected tab: the URL's batch when it is one of the student's, else the first. */
export function pickCalendarBatch(batches, raw) {
  return batches.find((batch) => batch.id === raw) ?? batches[0] ?? null;
}
