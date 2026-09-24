// Run with `npm test` (Node's built-in test runner — no extra dependency).
//
// A batch can have several recurring schedules — several days, and several
// times on the same day. Every Batch view (Overview, Schedules tab, card, table)
// must read the same current schedule set, on the centre's calendar date
// (Asia/Kolkata), and its summaries must not drop a schedule.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  batchToday,
  currentSchedulesOf,
  deriveBatchDisplayStatus,
  isCurrentSchedule,
  summarizeCurrentSchedules,
} from "./summary.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SEP_22_0342_IST = new Date("2026-09-21T22:12:00Z"); // 03:42 IST Sep 22 — UTC is still Sep 21
const TODAY = "2026-09-22";

let nextId = 1;
const schedule = (day_of_week, start_time, end_time, extra = {}) => ({
  id: `s${nextId++}`,
  status: "active",
  effective_from: "2026-09-01",
  effective_until: null,
  instructors: { id: "i1", full_name: "Kannan Thangavel" },
  day_of_week,
  start_time,
  end_time,
  ...extra,
});

// Hatha Yoga General as reported: Mon–Fri 6–7 AM, plus Tue and Wed 7–8 AM.
const hathaSchedules = () => [
  schedule("wednesday", "07:00:00", "08:00:00", { effective_from: "2026-09-21" }),
  schedule("tuesday", "07:00:00", "08:00:00", { effective_from: "2026-09-21" }),
  schedule("friday", "06:00:00", "07:00:00"),
  schedule("thursday", "06:00:00", "07:00:00"),
  schedule("wednesday", "06:00:00", "07:00:00"),
  schedule("tuesday", "06:00:00", "07:00:00"),
  schedule("monday", "06:00:00", "07:00:00"),
];

const slots = (list) => list.map((s) => `${s.day_of_week} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`);

test("the centre date, not the UTC date, is the batch schedules' 'today'", () => {
  assert.equal(SEP_22_0342_IST.toISOString().slice(0, 10), "2026-09-21");
  assert.equal(batchToday(SEP_22_0342_IST), "2026-09-22");
});

test("CASE 1: a batch with one schedule", () => {
  const current = currentSchedulesOf([schedule("monday", "06:00:00", "07:00:00")], TODAY);
  assert.equal(current.length, 1);
  const summary = summarizeCurrentSchedules(current);
  assert.equal(summary.hasSchedule, true);
  assert.equal(summary.days, "Mon");
  assert.equal(summary.time, "6:00 AM – 7:00 AM");
  assert.equal(summary.timeSlots, 1);
  assert.equal(summary.count, 1);
  assert.equal(summary.countLabel, null);
  assert.equal(summary.timeSummary, "6:00 AM – 7:00 AM"); // no needless "1 schedule"
});

test("CASE 2: schedules on different days at one time keep every day", () => {
  const current = currentSchedulesOf(
    ["friday", "monday", "wednesday"].map((day) => schedule(day, "06:00:00", "07:00:00")),
    TODAY
  );
  assert.deepEqual(slots(current), ["monday 06:00-07:00", "wednesday 06:00-07:00", "friday 06:00-07:00"]);
  const summary = summarizeCurrentSchedules(current);
  assert.equal(summary.days, "Mon, Wed, Fri");
  assert.equal(summary.time, "6:00 AM – 7:00 AM");
  assert.equal(summary.timeSlots, 1, "three days are still one time slot");
  assert.equal(summary.countLabel, "3 schedules");
  assert.equal(summary.timeSummary, "6:00 AM – 7:00 AM · 3 schedules");
});

test("CASE 3: two schedules on the same day at different times are both kept", () => {
  const current = currentSchedulesOf(
    [schedule("tuesday", "07:00:00", "08:00:00"), schedule("tuesday", "06:00:00", "07:00:00")],
    TODAY
  );
  assert.deepEqual(slots(current), ["tuesday 06:00-07:00", "tuesday 07:00-08:00"]);

  const summary = summarizeCurrentSchedules(current);
  assert.equal(summary.days, "Tue");
  assert.equal(summary.count, 2);
  // Adjacent records are separate classes: never merged into one 6–8 range.
  assert.equal(summary.time, "2 time slots");
  assert.equal(summary.timeSlots, 2);
  assert.equal(summary.countLabel, "2 schedules");
  assert.equal(summary.timeSummary, "2 time slots · 2 schedules");
  assert.match(summary.detail, /Tue 6:00 AM – 7:00 AM/);
  assert.match(summary.detail, /Tue 7:00 AM – 8:00 AM/);
});

test("same-day schedules with a gap are two time slots", () => {
  const summary = summarizeCurrentSchedules(
    currentSchedulesOf([schedule("tuesday", "06:00:00", "07:00:00"), schedule("tuesday", "18:00:00", "19:00:00")], TODAY)
  );
  assert.equal(summary.timeSummary, "2 time slots · 2 schedules");
  assert.equal(summary.count, 2);
});

test("CASE 4: a schedule effective today (centre date) is current, even while UTC is still yesterday", () => {
  const s = schedule("wednesday", "07:00:00", "08:00:00", { effective_from: "2026-09-22" });
  const utcToday = SEP_22_0342_IST.toISOString().slice(0, 10);
  assert.equal(isCurrentSchedule(s, utcToday), false, "the old UTC reading hid it");
  assert.equal(isCurrentSchedule(s, batchToday(SEP_22_0342_IST)), true);
  assert.equal(currentSchedulesOf([s], batchToday(SEP_22_0342_IST)).length, 1);
});

test("CASE 5: ended, deactivated and not-yet-started schedules are not current", () => {
  const rows = [
    schedule("monday", "06:00:00", "07:00:00"),
    schedule("monday", "05:00:00", "06:00:00", { effective_until: "2026-09-21" }), // closed the day before
    schedule("tuesday", "06:00:00", "07:00:00", { status: "inactive" }),
    schedule("friday", "06:00:00", "07:00:00", { effective_from: "2026-09-23" }), // starts tomorrow
  ];
  assert.deepEqual(slots(currentSchedulesOf(rows, TODAY)), ["monday 06:00-07:00"]);
  // effective_until is inclusive.
  assert.equal(currentSchedulesOf([schedule("monday", "06:00:00", "07:00:00", { effective_until: TODAY })], TODAY).length, 1);
});

test("CASE 6: Hatha Yoga General — all seven current schedules, in week order, none dropped", () => {
  const rows = [
    ...hathaSchedules(),
    schedule("monday", "05:00:00", "06:00:00", { effective_until: "2026-08-31" }), // an old version
  ];
  const current = currentSchedulesOf(rows, TODAY);
  assert.deepEqual(slots(current), [
    "monday 06:00-07:00",
    "tuesday 06:00-07:00",
    "tuesday 07:00-08:00",
    "wednesday 06:00-07:00",
    "wednesday 07:00-08:00",
    "thursday 06:00-07:00",
    "friday 06:00-07:00",
  ]);

  const summary = summarizeCurrentSchedules(current);
  assert.equal(summary.days, "Mon, Tue, Wed, Thu, Fri");
  assert.equal(summary.time, "2 time slots");
  assert.equal(summary.timeSlots, 2, "days are not time slots");
  assert.equal(summary.count, 7);
  assert.equal(summary.countLabel, "7 schedules");
  assert.equal(summary.timeSummary, "2 time slots · 7 schedules");
  assert.equal(summary.instructor, "Kannan Thangavel");
  assert.equal(summary.detail.split("\n").length, 7);
  assert.equal(deriveBatchDisplayStatus("active", rows, TODAY), "active");
});

test("the summary never depends on input order", () => {
  const forward = summarizeCurrentSchedules(currentSchedulesOf(hathaSchedules(), TODAY));
  const backward = summarizeCurrentSchedules(currentSchedulesOf([...hathaSchedules()].reverse(), TODAY));
  assert.deepEqual(forward, backward);
});

test("time slots are distinct time ranges, counted dynamically", () => {
  const summaryOf = (rows) => summarizeCurrentSchedules(currentSchedulesOf(rows, TODAY));

  // Mon 6–7, Tue 6–7, Wed 7–8, Thu 7–8, Fri 6–7 → 2 slots, 5 schedules (days are not slots).
  const five = summaryOf([
    schedule("monday", "06:00:00", "07:00:00"),
    schedule("tuesday", "06:00:00", "07:00:00"),
    schedule("wednesday", "07:00:00", "08:00:00"),
    schedule("thursday", "07:00:00", "08:00:00"),
    schedule("friday", "06:00:00", "07:00:00"),
  ]);
  assert.equal(five.timeSummary, "2 time slots · 5 schedules");

  // Three different slots across nine schedules.
  const nine = summaryOf(
    ["monday", "tuesday", "wednesday"].flatMap((day) => [
      schedule(day, "06:00:00", "07:00:00"),
      schedule(day, "07:00:00", "08:00:00"),
      schedule(day, "18:00:00", "19:00:00"),
    ])
  );
  assert.equal(nine.timeSlots, 3);
  assert.equal(nine.timeSummary, "3 time slots · 9 schedules");

  // Five days sharing one slot.
  const shared = summaryOf(
    ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => schedule(day, "06:00:00", "07:00:00"))
  );
  assert.equal(shared.timeSummary, "6:00 AM – 7:00 AM · 5 schedules");

  // The same time written "06:00" and "06:00:00" is one slot, not two.
  assert.equal(summaryOf([schedule("monday", "06:00", "07:00"), schedule("friday", "06:00:00", "07:00:00")]).timeSlots, 1);

  // No summary reads "Multiple times" or a merged range.
  for (const item of [five, nine, shared]) assert.ok(!/Multiple times|6:00 AM – 8:00 AM/.test(item.timeSummary));
});

test("no current schedule", () => {
  const summary = summarizeCurrentSchedules(currentSchedulesOf([], TODAY));
  assert.equal(summary.hasSchedule, false);
  assert.equal(summary.count, 0);
});

// ---- Wiring guards: every Batch view reads the same current set on the centre date -------------------------

test("the Batches list data layer derives current schedules and status on the centre date", () => {
  const src = readFileSync(join(ROOT, "lib", "batches", "data.js"), "utf8");
  assert.ok(src.includes("batchToday()"));
  assert.ok(src.includes("currentSchedulesOf(schedules, today)"));
  assert.ok(!/todayDateString/.test(src), "no UTC 'today' left in the batches data layer");
});

test("Batch Overview lists the full current schedule set (no silent slice) on the centre date", () => {
  const src = readFileSync(join(ROOT, "app", "batches", "[id]", "page.js"), "utf8");
  assert.ok(src.includes("currentSchedulesOf(schedules, scheduleToday)"));
  assert.ok(!/slice\(0, 5\)\.map/.test(src), "the schedule preview must not keep its old silent 5-row cut");
  assert.ok(src.includes("currentSchedules.slice(0, SCHEDULE_ROWS)"));
  assert.ok(/Showing \{SCHEDULE_ROWS\} of \{currentSchedules\.length\} current schedules/.test(src), "any cut is announced");
});
