import { attendedAfterExpiry } from "./expiry-core.js";

/**
 * Class-count attendance as it is SHOWN beside session attendance - Student Details "Recent Attendance" and Attendance History
 * (01-product.md section 8 "Class Count Attendance", History). Pure and import-light, so it is tested without a server.
 *
 * Class-count records are a different kind of record from session attendance: they have no session, batch, instructor or
 * present/absent mark. They are therefore kept in their OWN structures here and are never added to a session list, a session
 * count, an attendance summary or a report. A reversed record stays visible, marked Reversed, and is never valid class usage.
 *
 * A display record: `{ id, kind: "class_count", attendedOn, recordedAt, membershipId, membershipCode, endDate, studentId,
 * studentName, studentCode, status: "recorded"|"reversed", reversal: { reversedAt, reason }|null, afterExpiry }`.
 */

export const ATTENDANCE_TYPE_LABELS = { session: "Session", class_count: "Class count" };
export const CLASS_COUNT_STATUS_LABELS = { recorded: "Recorded", reversed: "Reversed" };

const one = (value) => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * A `class_count_attendance` row (with its embedded reversal, membership and student) as a display record.
 * The "Attendance after current expiry" flag is set only on a non-reversed record dated after the membership's current expiry.
 */
export function classCountRecordFrom(row) {
  const reversal = one(row.class_count_attendance_reversals);
  const membership = one(row.memberships);
  const student = one(row.students);
  const record = {
    id: row.id,
    kind: "class_count",
    attendedOn: row.attended_on,
    recordedAt: row.created_at ?? "",
    membershipId: row.membership_id ?? membership?.id ?? null,
    membershipCode: membership?.membership_code ?? null,
    endDate: membership?.end_date ?? null,
    studentId: row.student_id ?? student?.id ?? null,
    studentName: student?.full_name ?? null,
    studentCode: student?.student_code ?? null,
    reversal: reversal ? { reversedAt: reversal.reversed_at, reason: reversal.reason } : null,
  };
  return {
    ...record,
    status: record.reversal ? "reversed" : "recorded",
    afterExpiry: attendedAfterExpiry(record, record.endDate),
  };
}

/**
 * A row of `list_class_count_attendance_history()` (migration 0052) as a display record - the Instructor's scoped read. It carries
 * no membership or recorder id: the record has no link to Membership Details. The reversal REASON and TIME are present only for an
 * Admin (the function returns them to nobody else), so an Instructor's reversed record is Reversed with `reason: null`.
 */
export function classCountRecordFromHistoryRow(row) {
  const record = {
    id: row.attendance_id,
    kind: "class_count",
    attendedOn: row.attended_on,
    recordedAt: row.recorded_at ?? "",
    membershipId: null,
    membershipCode: row.membership_code ?? null,
    endDate: row.membership_end_date ?? null,
    studentId: row.student_id ?? null,
    studentName: row.student_name ?? null,
    studentCode: row.student_code ?? null,
    reversal: row.reversed ? { reversedAt: row.reversed_at ?? null, reason: row.reversal_reason ?? null } : null,
  };
  return {
    ...record,
    status: record.reversal ? "reversed" : "recorded",
    afterExpiry: attendedAfterExpiry(record, record.endDate),
  };
}

/** The classes that count as USED: reversed records never do. */
export function validClassUse(records) {
  return (records ?? []).filter((record) => !record.reversal).length;
}

const byNewest = (a, b) => b.attendedOn.localeCompare(a.attendedOn) || String(b.recordedAt).localeCompare(String(a.recordedAt));

/**
 * Student Details "Recent Attendance": the student's recent session attendance and class-count records as ONE newest-first
 * list of at most `limit`, each item tagged by type. Neither input is changed. On the same date a session comes before a
 * class-count record; sessions keep their own later-start-first order, class-count records the later-recorded first.
 *
 * Either source may be `null` (its read failed): the other still shows, and `partial` says so. With both null nothing can be
 * shown (`unavailable`). An empty list is "no attendance", which is different from "could not load".
 *
 * @param {{ sessions: object[]|null, classCount: object[]|null, limit?: number }} input
 * @returns {{ items: { type: "session"|"class_count", key: string, date: string, session?: object, record?: object }[],
 *             partial: boolean, unavailable: boolean }}
 */
export function combineRecentAttendance({ sessions, classCount, limit = 5 }) {
  const unavailable = sessions == null && classCount == null;
  const partial = !unavailable && (sessions == null || classCount == null);

  const items = [
    ...(sessions ?? []).map((session) => ({ type: "session", key: `session-${session.id}`, date: session.session_date, session })),
    ...(classCount ?? []).map((record) => ({ type: "class_count", key: `class-count-${record.id}`, date: record.attendedOn, record })),
  ].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.type !== b.type) return a.type === "session" ? -1 : 1;
    if (a.type === "session") return (b.session.start_time ?? "").localeCompare(a.session.start_time ?? "");
    return String(b.record.recordedAt).localeCompare(String(a.record.recordedAt));
  });

  return { items: items.slice(0, limit), partial, unavailable };
}

/**
 * Whether Attendance History shows class-count records for the current filters: for an Admin or an Instructor (an Instructor's
 * are limited in SQL to their own students), and only when no batch, instructor or Present/Absent filter is active (a class-count
 * record has no batch, instructor or present/absent mark, so those filters hide it). The search term does not hide them: it matches
 * the student name or the membership code, and can only narrow what the viewer may already see.
 */
export function showClassCountInHistory({ isAdmin = false, isInstructor = false, batchId = "", instructorId = "", attendanceStatus = "all" }) {
  return (Boolean(isAdmin) || Boolean(isInstructor)) && !batchId && !instructorId && attendanceStatus === "all";
}

/**
 * Attendance History's date groups with class-count records added: `{ date, sessions, classCount }[]`, newest date first. A date
 * with only class-count records is a group with no sessions. `sessionGroups` is `groupSessionsByDate`'s output and is not changed;
 * the sessions of a group are the very same array, so no session count can move.
 */
export function mergeHistoryGroups(sessionGroups, classCountRecords) {
  const groups = new Map();
  for (const group of sessionGroups ?? []) groups.set(group.date, { date: group.date, sessions: group.sessions, classCount: [] });
  for (const record of [...(classCountRecords ?? [])].sort(byNewest)) {
    const group = groups.get(record.attendedOn) ?? { date: record.attendedOn, sessions: [], classCount: [] };
    group.classCount.push(record);
    groups.set(record.attendedOn, group);
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** "2 Class count" - the class-count part of a date group's header; empty when none. Session labels are never changed. */
export function classCountGroupLabel(count) {
  return count > 0 ? `${count} Class count` : "";
}

/**
 * The calendar days and quick dates of Attendance History with class-count dates added (Admin). `sessionDays` /
 * `classCountDays` are `{ date, count }[]`. Each day keeps its SESSION count in `count`; the class-count number is separate in
 * `classCount`, so a session count never includes a class-count record.
 */
export function mergeNavigationDays(sessionDays, classCountDays) {
  const days = new Map();
  for (const day of sessionDays ?? []) days.set(day.date, { date: day.date, count: day.count, classCount: 0 });
  for (const day of classCountDays ?? []) {
    const existing = days.get(day.date) ?? { date: day.date, count: 0, classCount: 0 };
    days.set(day.date, { ...existing, classCount: day.count });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Collapses records, each carrying an `attended_on`, into `{ date, count }[]` (first-seen order). */
export function countClassCountByDate(rows) {
  const counts = new Map();
  for (const row of rows ?? []) counts.set(row.attended_on, (counts.get(row.attended_on) ?? 0) + 1);
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}
