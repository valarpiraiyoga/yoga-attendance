// Run with `npm test` (Node's built-in test runner).
//
// `formatTimeParts` feeds the Attendance session card's start-time tile; it
// must agree with `formatTime` (the same 12-hour rules, midnight = 12 AM,
// noon = 12 PM) so the tile and the "6:00 AM – 7:00 AM" row never disagree.

import test from "node:test";
import assert from "node:assert/strict";
import { formatTime, formatTimeParts } from "./format.js";

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
