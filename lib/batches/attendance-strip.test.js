// Run with `npm test` (Node's built-in test runner).
//
// Batch Details' attendance strip, the pure core: a recorded day (counts summed over its sessions, zero attendance still a recorded
// day), a scheduled day with nothing recorded, and a day with no class.

import test from "node:test";
import assert from "node:assert/strict";
import { buildBatchAttendanceStrip, scheduleOccursOn, selectedDateOf, weekdayOf } from "./attendance-strip.js";

// 2026-10-12 is a Monday.
const MONDAY_SCHEDULE = { day_of_week: "monday", effective_from: "2026-01-01", effective_until: null };
const session = (date, present, absent) => ({ session_date: date, presentCount: present, absentCount: absent });

test("weekdays come from the date itself", () => {
  assert.equal(weekdayOf("2026-10-12"), "monday");
  assert.equal(weekdayOf("2026-10-18"), "sunday");
});

test("a schedule occurs on its weekday within its effective dates only", () => {
  assert.equal(scheduleOccursOn(MONDAY_SCHEDULE, "2026-10-12"), true);
  assert.equal(scheduleOccursOn(MONDAY_SCHEDULE, "2026-10-13"), false);
  assert.equal(scheduleOccursOn({ ...MONDAY_SCHEDULE, effective_until: "2026-10-05" }, "2026-10-12"), false);
  assert.equal(scheduleOccursOn({ ...MONDAY_SCHEDULE, effective_from: "2026-10-19" }, "2026-10-12"), false);
});

test("recorded: counts are summed over a day's sessions; zero attendance is still a recorded day", () => {
  const days = buildBatchAttendanceStrip({
    month: "2026-10",
    today: "2026-10-20",
    sessions: [session("2026-10-12", 3, 1), session("2026-10-12", 2, 0), session("2026-10-19", 0, 0)],
    schedules: [MONDAY_SCHEDULE],
  });
  const by = (date) => days.find((day) => day.date === date);
  assert.deepEqual([by("2026-10-12").kind, by("2026-10-12").present, by("2026-10-12").absent], ["recorded", 5, 1]);
  assert.deepEqual([by("2026-10-19").kind, by("2026-10-19").present, by("2026-10-19").absent], ["recorded", 0, 0]);
});

test("no_record vs no_class: a scheduled day with nothing recorded is not 'no class', and no class never shows counts", () => {
  const days = buildBatchAttendanceStrip({ month: "2026-10", today: "2026-10-20", sessions: [], schedules: [MONDAY_SCHEDULE] });
  const by = (date) => days.find((day) => day.date === date);
  assert.equal(by("2026-10-05").kind, "no_record");
  assert.equal(by("2026-10-06").kind, "no_class");
  assert.equal(by("2026-10-06").present, 0);
});

test("the current month stops at today; a past month shows every day", () => {
  assert.equal(buildBatchAttendanceStrip({ month: "2026-10", today: "2026-10-20", sessions: [], schedules: [] }).length, 20);
  assert.equal(buildBatchAttendanceStrip({ month: "2026-09", today: "2026-10-20", sessions: [], schedules: [] }).length, 30);
});

test("the selected card is today when it is shown, else the last day shown", () => {
  const current = buildBatchAttendanceStrip({ month: "2026-10", today: "2026-10-20", sessions: [], schedules: [] });
  assert.equal(selectedDateOf(current, "2026-10-20"), "2026-10-20");
  const past = buildBatchAttendanceStrip({ month: "2026-09", today: "2026-10-20", sessions: [], schedules: [] });
  assert.equal(selectedDateOf(past, "2026-10-20"), "2026-09-30");
  assert.equal(selectedDateOf([], "2026-10-20"), null);
});
