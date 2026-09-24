// Run with `npm test` (Node's built-in test runner).
//
// `formatTimeParts` feeds the Attendance session card's start-time tile; it
// must agree with `formatTime` (the same 12-hour rules, midnight = 12 AM,
// noon = 12 PM) so the tile and the "6:00 AM – 7:00 AM" row never disagree.

import test from "node:test";
import assert from "node:assert/strict";
import { formatTime, formatTimeParts, formatTimeRangeCompact, formatTimeRangeCompactParts } from "./format.js";

test("formatTimeParts splits a 24-hour time into time and period", () => {
  assert.deepEqual(formatTimeParts("06:00"), { time: "6:00", period: "AM" });
  assert.deepEqual(formatTimeParts("17:30"), { time: "5:30", period: "PM" });
  assert.deepEqual(formatTimeParts("00:05"), { time: "12:05", period: "AM" });
  assert.deepEqual(formatTimeParts("12:00"), { time: "12:00", period: "PM" });
  assert.deepEqual(formatTimeParts("19:00:00"), { time: "7:00", period: "PM" });
});

test("formatTimeParts agrees with formatTime", () => {
  for (const value of ["06:00", "17:30", "00:05", "12:00", "23:59"]) {
    const { time, period } = formatTimeParts(value);
    assert.equal(`${time} ${period}`, formatTime(value));
  }
});

test("formatTimeParts handles an empty value", () => {
  assert.deepEqual(formatTimeParts(""), { time: "—", period: "" });
});

test("formatTimeRangeCompact states the period once and drops :00", () => {
  assert.equal(formatTimeRangeCompact("06:00", "07:00"), "6–7 AM");
  assert.equal(formatTimeRangeCompact("17:30:00", "18:30:00"), "5:30–6:30 PM");
  assert.equal(formatTimeRangeCompact("06:30", "08:00"), "6:30–8 AM");
});

test("formatTimeRangeCompact keeps both periods across noon", () => {
  assert.equal(formatTimeRangeCompact("11:00", "13:00"), "11 AM–1 PM");
});

test("formatTimeRangeCompactParts splits the range from its shared period", () => {
  assert.deepEqual(formatTimeRangeCompactParts("06:30", "07:30"), ["6:30\u20137:30", "AM"]);
  assert.deepEqual(formatTimeRangeCompactParts("06:00", "07:00"), ["6\u20137", "AM"]);
  assert.deepEqual(formatTimeRangeCompactParts("11:00", "13:00"), ["11 AM\u2013", "1 PM"]);
});

test("formatTimeRangeCompactParts reads the same as formatTimeRangeCompact", () => {
  for (const [start, end] of [["06:00", "07:00"], ["06:30", "07:30"], ["17:30", "18:30"]]) {
    assert.equal(formatTimeRangeCompactParts(start, end).join(" "), formatTimeRangeCompact(start, end));
  }
});
