// Run with `npm test` (Node's built-in test runner).
//
// Student Details → Recent Attendance calendar, the pure rules: the month in the URL, the days shown, each day's state (only
// recorded marks are Present / Absent; Not Enrolled from the enrollment dates; nothing recorded otherwise) and the batch tabs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttendanceStrip,
  calendarBatches,
  calendarDays,
  enrolledOn,
  monthBounds,
  monthLabel,
  parseCalendarMonth,
  pickCalendarBatch,
  shiftMonth,
} from "./attendance-calendar.js";

test("months: shift across years, bounds include leap days, labels in words", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(monthLabel("2026-10"), "October 2026");
});

test("the URL month: valid past months kept; missing, invalid or future months fall back to the current month", () => {
  assert.equal(parseCalendarMonth("2026-09", "2026-10-16"), "2026-09");
  assert.equal(parseCalendarMonth(undefined, "2026-10-16"), "2026-10");
  assert.equal(parseCalendarMonth("2026-13", "2026-10-16"), "2026-10");
  assert.equal(parseCalendarMonth("2026-11", "2026-10-16"), "2026-10");
});

test("days: a past month is complete; the current month stops at today; weekdays are the calendar's, not the viewer's", () => {
  assert.equal(calendarDays("2026-09", "2026-10-16").length, 30);
  const october = calendarDays("2026-10", "2026-10-16");
  assert.equal(october.length, 16);
  assert.deepEqual(october[0], { date: "2026-10-01", day: 1, weekday: "Thu" });
  assert.deepEqual(october.at(-1), { date: "2026-10-16", day: 16, weekday: "Fri" });
});

test("enrollment periods: inclusive start and end; an open end runs on", () => {
  const periods = [{ start: "2026-10-05", end: "2026-10-10" }, { start: "2026-10-14", end: null }];
  assert.equal(enrolledOn("2026-10-04", periods), false);
  assert.equal(enrolledOn("2026-10-05", periods), true);
  assert.equal(enrolledOn("2026-10-10", periods), true);
  assert.equal(enrolledOn("2026-10-12", periods), false);
  assert.equal(enrolledOn("2026-10-30", periods), true);
});

test("day states: recorded marks are Present / Absent (both = mixed); otherwise Not Enrolled or nothing recorded", () => {
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-06",
    periods: [{ start: "2026-10-03", end: null }],
    records: [
      { date: "2026-10-03", status: "present" },
      { date: "2026-10-04", status: "absent" },
      { date: "2026-10-05", status: "present" },
      { date: "2026-10-05", status: "absent" },
      // A mark outside the enrollment dates is still shown - a recorded mark is never hidden.
      { date: "2026-10-01", status: "present" },
    ],
  });
  assert.deepEqual(days.map((day) => [day.date, day.status]), [
    ["2026-10-01", "present"],
    ["2026-10-02", "not_enrolled"],
    ["2026-10-03", "present"],
    ["2026-10-04", "absent"],
    ["2026-10-05", "mixed"],
    ["2026-10-06", "no_record"],
  ]);
});

test("missing data is never Present or Absent; unknown statuses are ignored", () => {
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-02",
    periods: [{ start: "2026-09-01", end: null }],
    records: [{ date: "2026-10-01", status: "unmarked" }],
  });
  assert.deepEqual(days.map((day) => day.status), ["no_record", "no_record"]);
});

test("batch tabs: one per batch (all its enrollments' periods), active first, then by name; the URL picks one", () => {
  const batches = calendarBatches([
    { batch_id: "b2", status: "inactive", effective_start_date: "2026-01-01", effective_end_date: "2026-03-31", batches: { name: "Zen" } },
    { batch_id: "b1", status: "active", effective_start_date: "2026-05-01", effective_end_date: null, batches: { name: "Hatha" } },
    { batch_id: "b2", status: "active", effective_start_date: "2026-06-01", effective_end_date: null, batches: { name: "Zen" } },
    { batch_id: "b3", status: "inactive", effective_start_date: "2026-01-01", effective_end_date: "2026-02-01", batches: { name: "Aerial" } },
  ]);
  assert.deepEqual(batches.map((batch) => batch.id), ["b1", "b2", "b3"]);
  assert.equal(batches.find((batch) => batch.id === "b2").periods.length, 2);
  assert.equal(pickCalendarBatch(batches, "b3").id, "b3");
  assert.equal(pickCalendarBatch(batches, "nope").id, "b1");
  assert.equal(pickCalendarBatch([], "b1"), null);
});

// ---- class dates ------------------------------------------------------------------------------------------------------------

import { batchAssignments, classDatesOf } from "./attendance-calendar.js";

// A schedule version: its weekday and effective period - the rule `scheduleOccursOnDate` applies (a fake of it, here).
const WEEKDAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
const occursOn = (schedule, date) =>
  date >= schedule.effective_from &&
  (!schedule.effective_until || date <= schedule.effective_until) &&
  new Date(`${date}T00:00:00Z`).getUTCDay() === WEEKDAY[schedule.day_of_week];

// Advanced Yoga: Monday, Wednesday and Friday series (one schedule version each).
const SCHEDULES = [
  { id: "v-mon", series_id: "s-mon", day_of_week: "monday", effective_from: "2026-01-01", effective_until: null },
  { id: "v-wed", series_id: "s-wed", day_of_week: "wednesday", effective_from: "2026-01-01", effective_until: null },
  { id: "v-fri", series_id: "s-fri", day_of_week: "friday", effective_from: "2026-01-01", effective_until: null },
];
const ALL_SERIES = ["s-mon", "s-wed", "s-fri"].map((seriesId) => ({ seriesId, start: "2026-01-01", end: null }));
const base = {
  from: "2026-10-01",
  to: "2026-10-31",
  last: "2026-10-16",
  enrollmentPeriods: [{ start: "2026-01-01", end: null }],
  assignments: ALL_SERIES,
  schedules: SCHEDULES,
  sessions: [],
  occursOn,
};

test("class dates: only the batch's Monday, Wednesday and Friday dates of the month (up to today)", () => {
  const dates = classDatesOf(base);
  assert.deepEqual(dates, ["2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16"]);
  assert.ok(dates.every((date) => [1, 3, 5].includes(new Date(`${date}T00:00:00Z`).getUTCDay())));
});

test("class dates: a past month is complete; a later month is not shown past today", () => {
  assert.equal(classDatesOf({ ...base, from: "2026-09-01", to: "2026-09-30" }).length, 13);
  assert.deepEqual(classDatesOf({ ...base, from: "2026-11-01", to: "2026-11-30" }), []);
});

test("class dates: only the series the student is assigned to, inside each assignment's own period", () => {
  const dates = classDatesOf({
    ...base,
    assignments: [
      { seriesId: "s-mon", start: "2026-01-01", end: null },
      { seriesId: "s-fri", start: "2026-10-08", end: "2026-10-12" },
    ],
  });
  assert.deepEqual(dates, ["2026-10-05", "2026-10-09", "2026-10-12"]);
});

test("class dates: the enrollment's start and end dates are respected", () => {
  const dates = classDatesOf({ ...base, enrollmentPeriods: [{ start: "2026-10-05", end: "2026-10-09" }] });
  assert.deepEqual(dates, ["2026-10-05", "2026-10-07", "2026-10-09"]);
});

test("class dates: a materialized session is authoritative - cancelled and holiday sessions are not class dates and are not re-projected", () => {
  const dates = classDatesOf({
    ...base,
    sessions: [
      { schedule_id: "v-wed", session_date: "2026-10-07", status: "cancelled" },
      { schedule_id: "v-fri", session_date: "2026-10-09", status: "holiday" },
      { schedule_id: "v-mon", session_date: "2026-10-12", status: "completed" },
    ],
  });
  assert.ok(!dates.includes("2026-10-07"));
  assert.ok(!dates.includes("2026-10-09"));
  assert.ok(dates.includes("2026-10-12"));
  assert.deepEqual(dates, ["2026-10-02", "2026-10-05", "2026-10-12", "2026-10-14", "2026-10-16"]);
});

test("class dates: a materialized session outlives a later schedule change (its version no longer occurs there)", () => {
  const ended = SCHEDULES.map((schedule) => (schedule.id === "v-mon" ? { ...schedule, effective_until: "2026-09-30" } : schedule));
  const without = classDatesOf({ ...base, schedules: ended });
  assert.ok(!without.includes("2026-10-05"), "the ended Monday schedule no longer projects");
  const held = classDatesOf({ ...base, schedules: ended, sessions: [{ schedule_id: "v-mon", session_date: "2026-10-05", status: "completed" }] });
  assert.ok(held.includes("2026-10-05"), "but a session actually held stays a class date");
});

test("class dates: a session of a series the student is not assigned to is not theirs", () => {
  const dates = classDatesOf({
    ...base,
    assignments: [{ seriesId: "s-mon", start: "2026-01-01", end: null }],
    sessions: [{ schedule_id: "v-wed", session_date: "2026-10-07", status: "completed" }],
  });
  assert.ok(!dates.includes("2026-10-07"));
});

test("batch assignments: the assignments of every enrollment in the batch, none from another batch", () => {
  const enrollments = [{ id: "e1", batch_id: "b1" }, { id: "e2", batch_id: "b2" }];
  const byId = new Map([
    ["e1", [{ schedule_series_id: "s-mon", effective_start_date: "2026-01-01", effective_end_date: null }]],
    ["e2", [{ schedule_series_id: "s-x", effective_start_date: "2026-01-01", effective_end_date: "2026-02-01" }]],
  ]);
  assert.deepEqual(batchAssignments(enrollments, byId, "b1"), [{ seriesId: "s-mon", start: "2026-01-01", end: null }]);
  assert.deepEqual(batchAssignments(enrollments, byId, "b3"), []);
});

test("the strip shows only the class dates (plus any recorded mark); a class date with no mark is 'no record', never Present or Absent", () => {
  const classDates = classDatesOf(base);
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-16",
    periods: [{ start: "2026-01-01", end: null }],
    classDates,
    records: [
      { date: "2026-10-02", status: "present" },
      { date: "2026-10-05", status: "absent" },
      // A mark on a day that is not a class date (a make-up class) is still shown.
      { date: "2026-10-06", status: "present" },
    ],
  });
  assert.deepEqual(days.map((day) => [day.date, day.status]), [
    ["2026-10-02", "present"],
    ["2026-10-05", "absent"],
    ["2026-10-06", "present"],
    ["2026-10-07", "no_record"],
    ["2026-10-09", "no_record"],
    ["2026-10-12", "no_record"],
    ["2026-10-14", "no_record"],
    ["2026-10-16", "no_record"],
  ]);
});

test("a month with no class dates has an empty strip (the panel says so)", () => {
  assert.deepEqual(buildAttendanceStrip({ month: "2026-10", today: "2026-10-16", periods: [], records: [], classDates: [] }), []);
});

// ---- instructors ----------------------------------------------------------------------------------------------------------

import { classOccurrencesOf, instructorOf, instructorsByDate } from "./attendance-calendar.js";

const KAVYA = { id: "i-kavya", full_name: "Kavya R", photo_url: "https://example.test/kavya.jpg" };
const THEJESH = { id: "i-thejesh", full_name: "Thejesh K", photo_url: null };

const withInstructor = (schedule, instructors) => ({ ...schedule, instructors });

test("instructor: an embed (object or one-item array) becomes a person; nothing becomes null - never invented", () => {
  assert.deepEqual(instructorOf(KAVYA), { id: "i-kavya", name: "Kavya R", photoUrl: "https://example.test/kavya.jpg" });
  assert.deepEqual(instructorOf([THEJESH]), { id: "i-thejesh", name: "Thejesh K", photoUrl: null });
  assert.equal(instructorOf(null), null);
  assert.equal(instructorOf({}), null);
});

test("each class carries ITS instructor: a held session's own, else the schedule's it follows", () => {
  const occurrences = classOccurrencesOf({
    ...base,
    schedules: SCHEDULES.map((schedule) => withInstructor(schedule, THEJESH)),
    // Wednesday 7 Oct was actually held by Kavya (a substitute) - the session's snapshot wins over the schedule's instructor.
    sessions: [{ schedule_id: "v-wed", session_date: "2026-10-07", status: "completed", instructors: KAVYA }],
  });
  const on = (date) => occurrences.filter((occurrence) => occurrence.date === date).map((occurrence) => occurrence.instructor?.name);
  assert.deepEqual(on("2026-10-07"), ["Kavya R"]);
  assert.deepEqual(on("2026-10-09"), ["Thejesh K"], "a projected class uses its schedule's instructor");
});

test("class dates are unchanged by the instructor data", () => {
  const plain = classDatesOf(base);
  const rich = classDatesOf({ ...base, schedules: SCHEDULES.map((schedule) => withInstructor(schedule, THEJESH)) });
  assert.deepEqual(rich, plain);
});

test("no instructor data means no instructor (null), not the batch's or anyone's", () => {
  const occurrences = classOccurrencesOf(base);
  assert.ok(occurrences.length > 0);
  assert.ok(occurrences.every((occurrence) => occurrence.instructor === null));
});

test("instructors by date: one entry per person, the make-up class's instructor included, stable order", () => {
  const byDate = instructorsByDate(
    [
      { date: "2026-10-07", instructor: instructorOf(THEJESH) },
      { date: "2026-10-07", instructor: instructorOf(KAVYA) },
      { date: "2026-10-07", instructor: instructorOf(KAVYA) },
      { date: "2026-10-09", instructor: null },
    ],
    [{ date: "2026-10-06", status: "present", instructor: instructorOf(KAVYA) }],
  );
  assert.deepEqual(byDate["2026-10-07"].map((person) => person.name), ["Kavya R", "Thejesh K"]);
  assert.deepEqual(byDate["2026-10-06"].map((person) => person.name), ["Kavya R"]);
  assert.equal(byDate["2026-10-09"], undefined, "a date with no instructor data has none");
});

test("the strip's days carry their instructors; statuses and dates are unchanged", () => {
  const classDates = ["2026-10-07", "2026-10-09"];
  const instructors = { "2026-10-07": [instructorOf(KAVYA)] };
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-16",
    periods: [{ start: "2026-01-01", end: null }],
    classDates,
    instructors,
    records: [{ date: "2026-10-07", status: "present" }],
  });
  assert.deepEqual(days.map((day) => [day.date, day.status]), [["2026-10-07", "present"], ["2026-10-09", "no_record"]]);
  assert.deepEqual(days[0].instructors.map((person) => person.name), ["Kavya R"]);
  assert.deepEqual(days[1].instructors, []);
});

// ---- session details (the tooltip) ------------------------------------------------------------------------------------------

import { sessionsByDate } from "./attendance-calendar.js";

test("each class carries its own start and end time: a held session's, else the schedule's it follows", () => {
  const occurrences = classOccurrencesOf({
    ...base,
    schedules: SCHEDULES.map((schedule) => ({ ...schedule, start_time: "06:00:00", end_time: "07:00:00" })),
    // Wednesday 7 Oct was held at a different time (an edited session): its own times win.
    sessions: [{ schedule_id: "v-wed", session_date: "2026-10-07", status: "completed", start_time: "17:00:00", end_time: "18:00:00" }],
  });
  const times = (date) => occurrences.filter((occurrence) => occurrence.date === date).map((occurrence) => [occurrence.startTime, occurrence.endTime]);
  assert.deepEqual(times("2026-10-07"), [["17:00:00", "18:00:00"]]);
  assert.deepEqual(times("2026-10-09"), [["06:00:00", "07:00:00"]]);
});

test("no time data means no time (null) - never filled in", () => {
  const occurrences = classOccurrencesOf(base);
  assert.ok(occurrences.every((occurrence) => occurrence.startTime === null && occurrence.endTime === null));
});

test("sessions by date: each class once (time + instructor), earliest first; a recorded mark's session is included", () => {
  const kavya = instructorOf(KAVYA);
  const byDate = sessionsByDate(
    [
      { date: "2026-10-07", startTime: "17:00:00", endTime: "18:00:00", instructor: kavya },
      { date: "2026-10-07", startTime: "06:00:00", endTime: "07:00:00", instructor: instructorOf(THEJESH) },
    ],
    [
      // The same held session, seen again through its attendance mark: not listed twice.
      { date: "2026-10-07", status: "present", startTime: "17:00:00", endTime: "18:00:00", instructor: kavya },
      // A make-up class with a mark but no class occurrence.
      { date: "2026-10-06", status: "present", startTime: "09:00:00", endTime: "10:00:00", instructor: kavya },
    ],
  );
  assert.deepEqual(byDate["2026-10-07"].map((session) => session.startTime), ["06:00:00", "17:00:00"]);
  assert.equal(byDate["2026-10-06"].length, 1);
});

test("sessions by date: a date with nothing known has no entry; the strip's day then has none", () => {
  assert.deepEqual(sessionsByDate([{ date: "2026-10-09", startTime: null, endTime: null, instructor: null }], []), {});
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-16",
    periods: [{ start: "2026-01-01", end: null }],
    classDates: ["2026-10-09"],
    records: [],
    sessions: {},
  });
  assert.deepEqual(days[0].sessions, []);
});

// ---- each class's own status (the tooltip rows) -------------------------------------------------------------------------------

const MORNING = { date: "2026-10-07", startTime: "06:00:00", endTime: "07:00:00", instructor: instructorOf(THEJESH) };
const EVENING = { date: "2026-10-07", startTime: "17:00:00", endTime: "18:00:00", instructor: instructorOf(THEJESH) };
const markOf = (session, status) => ({ ...session, status });

test("each class has its own state: one Present and one Absent on the same day stay two classes, never one merged status", () => {
  const sessions = sessionsByDate([MORNING, EVENING], [markOf(MORNING, "present"), markOf(EVENING, "absent")])["2026-10-07"];
  assert.deepEqual(sessions.map((session) => [session.startTime, session.status]), [["06:00:00", "present"], ["17:00:00", "absent"]]);
});

test("a class with no mark is 'no record' - never Present or Absent - even when the other class that day is marked", () => {
  const sessions = sessionsByDate([MORNING, EVENING], [markOf(MORNING, "present")])["2026-10-07"];
  assert.deepEqual(sessions.map((session) => session.status), ["present", "no_record"]);
});

test("a class with no marks at all is 'no record'", () => {
  assert.deepEqual(sessionsByDate([MORNING], [])["2026-10-07"].map((session) => session.status), ["no_record"]);
});

test("a make-up class (a mark with no occurrence) is its own row with its mark's state", () => {
  const makeUp = { date: "2026-10-07", startTime: "09:00:00", endTime: "10:00:00", instructor: instructorOf(KAVYA) };
  const sessions = sessionsByDate([MORNING], [markOf(makeUp, "absent")])["2026-10-07"];
  assert.deepEqual(sessions.map((session) => [session.startTime, session.status]), [["06:00:00", "no_record"], ["09:00:00", "absent"]]);
});

test("two different instructors at the same time are two classes, each with its own state", () => {
  const a = { ...MORNING, instructor: instructorOf(THEJESH) };
  const b = { ...MORNING, instructor: instructorOf(KAVYA) };
  const sessions = sessionsByDate([a, b], [markOf(b, "present")])["2026-10-07"];
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((session) => [session.instructor.name, session.status]).sort(), [["Kavya R", "present"], ["Thejesh K", "no_record"]]);
});

test("a mark whose session has no time or instructor data still keeps its state (not dropped)", () => {
  const sessions = sessionsByDate([], [{ date: "2026-10-09", status: "present", startTime: null, endTime: null, instructor: null }])["2026-10-09"];
  assert.deepEqual(sessions, [{ startTime: null, endTime: null, instructor: null, status: "present" }]);
});

test("the day's own status (the card's circle) is unchanged by the per-class states", () => {
  const days = buildAttendanceStrip({
    month: "2026-10",
    today: "2026-10-16",
    periods: [{ start: "2026-01-01", end: null }],
    classDates: ["2026-10-07"],
    records: [markOf(MORNING, "present"), markOf(EVENING, "absent")],
    sessions: sessionsByDate([MORNING, EVENING], [markOf(MORNING, "present"), markOf(EVENING, "absent")]),
  });
  assert.equal(days[0].status, "mixed");
  assert.equal(days[0].sessions.length, 2);
});
