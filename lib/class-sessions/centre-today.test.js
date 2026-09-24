// Run with `npm test` (Node's built-in test runner).
//
// The Weekly Schedule's "Today" (its highlighted day and the default week) is
// the centre's business date, `todayInCentreTimezone` (Asia/Kolkata, UTC+5:30),
// not the UTC date. The two disagree for the first 5h30m of every centre day
// (18:30-24:00 UTC), which is exactly when the old UTC-based logic highlighted
// yesterday.

import test from "node:test";
import assert from "node:assert/strict";
import { todayInCentreTimezone } from "./validation.js";

test("the centre date runs ahead of UTC after 18:30 UTC", () => {
  // 20:00 UTC on 23 Sep is 01:30 on 24 Sep in Kolkata.
  const now = new Date("2026-09-23T20:00:00Z");
  assert.equal(now.toISOString().slice(0, 10), "2026-09-23");
  assert.equal(todayInCentreTimezone(now), "2026-09-24");
});

test("the centre date matches UTC earlier in the UTC day", () => {
  assert.equal(todayInCentreTimezone(new Date("2026-09-24T10:00:00Z")), "2026-09-24");
});

test("the boundary is 18:30 UTC (midnight in Kolkata)", () => {
  assert.equal(todayInCentreTimezone(new Date("2026-09-23T18:29:00Z")), "2026-09-23");
  assert.equal(todayInCentreTimezone(new Date("2026-09-23T18:30:00Z")), "2026-09-24");
});

test("a week starting on a UTC-Sunday resolves to the centre's Monday", () => {
  // Sun 20 Sep 2026, 19:00 UTC is already Mon 21 Sep in Kolkata.
  assert.equal(todayInCentreTimezone(new Date("2026-09-20T19:00:00Z")), "2026-09-21");
});
