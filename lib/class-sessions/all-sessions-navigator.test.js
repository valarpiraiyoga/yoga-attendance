// Run with `npm test` (Node's built-in test runner).
//
// Attendance -> All Sessions keeps the month calendar in its date navigator but no longer shows the "Sessions by date" list card
// under it, and Attendance History no longer shows its "Quick dates" list. Checked as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("All Sessions passes no quick dates, so the navigator renders no 'Sessions by date' card", () => {
  const page = read("app/attendance/page.js");
  assert.ok(!page.includes("Sessions by date"));
  assert.match(page, /<DateNavigator[\s\S]*?quickDates=\{\[\]\}[\s\S]*?\/>/);
  // The navigator itself only draws the list when there is something to list.
  assert.ok(read("components/layout/DateNavigator.js").includes("{quickDates.length > 0 ? ("));
  // The month calendar is still fed by the same navigation read.
  assert.match(page, /monthDays=\{navigation\.monthDays\}/);
});

test("Attendance History has no Quick dates list either", () => {
  const history = read("app/attendance-history/page.js");
  assert.match(history, /<DateNavigator[\s\S]*?quickDates=\{\[\]\}/);
  assert.ok(!history.includes("Quick dates:") && !/quickDates=\{quickDates\}/.test(history));
});
