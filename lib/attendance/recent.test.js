// Run with `npm test` (Node's built-in test runner).
//
// Student Details' "Recent Attendance" used to be a static placeholder that never
// read any data, so recorded attendance never appeared there. It now reads the
// student's own per-session attendance facts (the Student Attendance report's
// `report_session_facts` projection) for the last 90 days up to the CENTRE's today.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECENT_ATTENDANCE_DAYS,
  RECENT_ATTENDANCE_ROWS,
  recentAttendanceRange,
  selectRecentAttendance,
} from "./recent.js";
import { addDaysUTC } from "../schedules/validation.js";
import { todayInCentreTimezone } from "../class-sessions/validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// One row of what `getStudentAttendanceReport` returns for a student.
const fact = (overrides = {}) => ({
  id: "cs-1",
  session_date: "2026-09-24",
  start_time: "06:00:00",
  end_time: "07:00:00",
  batch: { id: "b1", name: "Hatha Yoga General", code: "HYG" },
  instructor: { id: "i1", full_name: "Kannan Thangavel" },
  status: "present",
  ...overrides,
});

test("a recorded Present for the Sep 24 session is what Recent Attendance shows", () => {
  const rows = selectRecentAttendance([fact()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_date, "2026-09-24");
  assert.equal(rows[0].status, "present");
  assert.equal(rows[0].batch.code, "HYG");
});

test("Present and Absent records are shown; an unmarked session is not attendance", () => {
  const rows = selectRecentAttendance([
    fact({ id: "a", status: "present" }),
    fact({ id: "b", session_date: "2026-09-23", status: "absent" }),
    fact({ id: "c", session_date: "2026-09-22", status: "unmarked" }),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});

test("newest first (date, then start time), limited to the latest rows", () => {
  const sessions = [
    fact({ id: "old", session_date: "2026-09-01" }),
    fact({ id: "late", session_date: "2026-09-24", start_time: "18:00:00" }),
    fact({ id: "early", session_date: "2026-09-24", start_time: "06:00:00" }),
    ...Array.from({ length: 8 }, (_, i) => fact({ id: `x${i}`, session_date: `2026-08-${10 + i}` })),
  ];
  const rows = selectRecentAttendance(sessions);
  assert.equal(rows.length, RECENT_ATTENDANCE_ROWS);
  assert.deepEqual(rows.slice(0, 2).map((row) => row.id), ["late", "early"]);
});

test("nothing recorded gives an empty list, never a fabricated row", () => {
  assert.deepEqual(selectRecentAttendance([]), []);
  assert.deepEqual(selectRecentAttendance(null), []);
  assert.deepEqual(selectRecentAttendance([fact({ status: "unmarked" })]), []);
});

test("the window ends on the centre's today, so a session marked today is inside it", () => {
  const range = recentAttendanceRange("2026-09-24", addDaysUTC);
  assert.equal(range.dateTo, "2026-09-24");
  assert.equal(range.dateFrom, addDaysUTC("2026-09-24", -RECENT_ATTENDANCE_DAYS));
  assert.ok("2026-09-24" >= range.dateFrom && "2026-09-24" <= range.dateTo);
});

test("the window follows the centre's date, not the UTC date", () => {
  // 20:00 UTC on 23 Sep is already 24 Sep at the Kolkata centre: the Sep 24 session is in range.
  const now = new Date("2026-09-23T20:00:00Z");
  const today = todayInCentreTimezone(now, "Asia/Kolkata");
  assert.equal(today, "2026-09-24");
  assert.equal(recentAttendanceRange(today, addDaysUTC).dateTo, "2026-09-24");
  // ...and for a New York centre the same instant is still the 23rd.
  assert.equal(recentAttendanceRange(todayInCentreTimezone(now, "America/New_York"), addDaysUTC).dateTo, "2026-09-23");
});

test("the loader reads THIS student's attendance through the report projection", () => {
  const data = source("../reports/data.js");
  assert.match(data, /export async function getRecentStudentAttendance\(studentId, today\)/);
  assert.match(data, /getStudentAttendanceReport\(\{ studentId, dateFrom, dateTo \}\)/);
  // The report call hands the student to the database projection (p_student_id).
  assert.match(data, /p_student_id: studentId \|\| null/);
});

test("Student Details reads it with the centre's date instead of a static placeholder", () => {
  const page = source("../../app/students/[id]/page.js");
  assert.match(page, /getRecentStudentAttendance\(studentId, today\)/);
  assert.match(page, /loadRecentAttendance\(id, today\)/);
  assert.match(page, /const today = await getCentreToday\(\)/);
  assert.match(page, /recentAttendance\.map\(/);
});
