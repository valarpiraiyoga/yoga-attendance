// Run with `npm test` (Node's built-in test runner).
//
// Attendance History's date grouping and month-calendar helpers: pure
// functions, so the grouping order, the centre-date string handling and the
// calendar grid are pinned without a database.

import test from "node:test";
import assert from "node:assert/strict";
import { countSessionsByDate, groupSessionsByDate, isValidDateString } from "./grouping.js";
import { buildMonthGrid, formatMonthLabel, isValidMonth, monthOf, monthRange, shiftMonth } from "./calendar.js";

const session = (id, session_date, start_time) => ({ id, session_date, start_time });

test("groupSessionsByDate keeps date order and sorts a day's sessions by start time", () => {
  const groups = groupSessionsByDate([
    session("a", "2026-09-24", "17:00:00"),
    session("b", "2026-09-24", "06:00:00"),
    session("c", "2026-09-23", "07:00:00"),
  ]);

  assert.deepEqual(
    groups.map((group) => group.date),
    ["2026-09-24", "2026-09-23"]
  );
  assert.deepEqual(
    groups[0].sessions.map((item) => item.id),
    ["b", "a"]
  );
});

test("groupSessionsByDate returns an empty list for no sessions", () => {
  assert.deepEqual(groupSessionsByDate([]), []);
  assert.deepEqual(groupSessionsByDate(undefined), []);
});

test("countSessionsByDate counts per date in first-seen order", () => {
  assert.deepEqual(
    countSessionsByDate([
      { session_date: "2026-09-24" },
      { session_date: "2026-09-24" },
      { session_date: "2026-09-23" },
    ]),
    [
      { date: "2026-09-24", count: 2 },
      { date: "2026-09-23", count: 1 },
    ]
  );
});

test("isValidDateString accepts real dates only", () => {
  assert.equal(isValidDateString("2026-09-24"), true);
  assert.equal(isValidDateString("2026-02-30"), false);
  assert.equal(isValidDateString("2026-9-24"), false);
  assert.equal(isValidDateString(undefined), false);
});

test("month helpers validate, shift across years and report the full range", () => {
  assert.equal(isValidMonth("2026-09"), true);
  assert.equal(isValidMonth("2026-13"), false);
  assert.equal(monthOf("2026-09-24"), "2026-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(monthRange("2026-09"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(formatMonthLabel("2026-09"), "September 2026");
});

test("buildMonthGrid lays September 2026 out Sunday-first in whole weeks", () => {
  const weeks = buildMonthGrid("2026-09");

  assert.ok(weeks.every((week) => week.length === 7));
  // 1 September 2026 is a Tuesday: two leading blanks (Sun, Mon).
  assert.deepEqual(weeks[0].slice(0, 3).map((cell) => cell?.day ?? null), [null, null, 1]);
  const days = weeks.flat().filter(Boolean);
  assert.equal(days.length, 30);
  assert.equal(days[29].date, "2026-09-30");
});
