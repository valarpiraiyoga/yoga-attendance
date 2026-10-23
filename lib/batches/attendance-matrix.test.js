// Run with `npm test`. The matrix is pure and run directly; the section's wiring is pinned from source (the screen needs the Next.js runtime).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAttendanceMatrix } from "./attendance-matrix.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const KANNAN = { id: "i1", full_name: "Kannan Thangavel", photo_url: "k.jpg" };
const MEERA = { id: "i2", full_name: "Meera S", photo_url: null };
// October 2026: the 5th is a Monday, the 6th a Tuesday.
const SCHEDULES = [
  { day_of_week: "monday", start_time: "06:00:00", end_time: "07:00:00", effective_from: "2026-01-01", effective_until: null, instructors: KANNAN },
  { day_of_week: "tuesday", start_time: "06:00:00", end_time: "07:00:00", effective_from: "2026-01-01", effective_until: null, instructors: MEERA },
];
const session = (date, instructor, present, absent, start = "06:00:00", end = "07:00:00") => ({ session_date: date, start_time: start, end_time: end, instructor, presentCount: present, absentCount: absent });
const base = { month: "2026-10", today: "2026-10-07", schedules: SCHEDULES };

test("a row per time slot and instructor, a column per day shown; recorded, not-recorded and no-class cells are told apart", () => {
  const { days, slots } = buildAttendanceMatrix({ ...base, sessions: [session("2026-10-05", { id: "i1", full_name: "Kannan Thangavel" }, 13, 2)] });
  assert.equal(days.length, 7, "1st to the 7th (today)");
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0].rows.map((row) => row.instructor.full_name), ["Kannan Thangavel", "Meera S"]);
  assert.equal(slots[0].instructorCount, 2);
  const kannan = slots[0].rows[0].cells;
  assert.deepEqual(kannan.find((cell) => cell.date === "2026-10-05"), { date: "2026-10-05", kind: "recorded", present: 13, absent: 2 });
  assert.equal(kannan.find((cell) => cell.date === "2026-10-06").kind, "no_class", "Kannan has no Tuesday class");
  const meera = slots[0].rows[1].cells;
  assert.equal(meera.find((cell) => cell.date === "2026-10-06").kind, "no_record", "scheduled, nothing recorded: never zeros");
  assert.equal(meera.find((cell) => cell.date === "2026-10-05").kind, "no_class");
});

test("a recorded class with zero attendance is recorded 0 / 0, not no class; several sessions in a cell are summed", () => {
  const { slots } = buildAttendanceMatrix({ ...base, sessions: [session("2026-10-05", KANNAN, 0, 0), session("2026-10-05", KANNAN, 3, 1)] });
  assert.deepEqual(slots[0].rows[0].cells.find((cell) => cell.date === "2026-10-05"), { date: "2026-10-05", kind: "recorded", present: 3, absent: 1 });
  const zero = buildAttendanceMatrix({ ...base, sessions: [session("2026-10-05", KANNAN, 0, 0)] });
  assert.equal(zero.slots[0].rows[0].cells.find((cell) => cell.date === "2026-10-05").kind, "recorded");
});

test("slots are earliest first and never merged; the instructor's photo comes from the batch's schedules", () => {
  const { slots } = buildAttendanceMatrix({
    ...base,
    sessions: [session("2026-10-05", { id: "i1", full_name: "Kannan Thangavel" }, 5, 0, "18:00:00", "19:00:00"), session("2026-10-05", { id: "i1", full_name: "Kannan Thangavel" }, 6, 1)],
  });
  assert.deepEqual(slots.map((slot) => slot.key), ["06:00:00-07:00:00", "18:00:00-19:00:00"]);
  assert.equal(slots[0].rows[0].instructor.photo_url, "k.jpg");
});

test("a session outside the shown days, or a month with nothing, makes no row; nobody is invented", () => {
  assert.deepEqual(buildAttendanceMatrix({ month: "2026-10", today: "2026-10-07", schedules: [], sessions: [session("2026-10-20", KANNAN, 1, 1)] }).slots, []);
  assert.deepEqual(buildAttendanceMatrix({ month: "2026-10", today: "2026-10-07", schedules: [], sessions: [] }).slots, []);
});

test("wiring: the section is the Time | Instructor | days matrix with the month links, legend and the existing attendance link", () => {
  const section = code("app/batches/[id]/batch-attendance-strip.js");
  assert.ok(section.includes("buildAttendanceMatrix({ month, today, sessions, schedules })"));
  assert.ok(section.includes('title="Attendance Summary"'));
  assert.ok(section.includes("rowSpan={slot.rows.length}"));
  assert.ok(section.includes("/batches/${batchId}/attendance"), "the existing attendance route");
  assert.ok(section.includes("?attendanceMonth=${target}"), "the month stays in the URL");
  assert.ok(section.includes("!sessions ? ("), "a failed read is said, not shown as zeros");
});
