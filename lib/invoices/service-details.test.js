// Run with `npm test` (Node's built-in test runner).
//
// V1 Membership service details (migration 0033): the pure presentation module. The stored
// snapshot is structured data (lower-case day names, "HH:MM" times); these tests pin how it is turned
// into the lines a document prints, and that nothing presentational is ever needed in storage.

import test from "node:test";
import assert from "node:assert/strict";
import { buildServiceDetails, scheduleLines } from "./service-details.js";

const slot = (day_of_week, start_time = "08:15", end_time = "09:15") => ({ day_of_week, start_time, end_time });
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => slot(day));
const batch = (name, slots, extra = {}) => ({ batch_id: `id-${name}`, name, code: name.slice(0, 3).toUpperCase(), slots, ...extra });
const details = (...batches) => ({ version: 1, as_of: "2026-11-01", batches });

// ---- day grouping ------------------------------------------------------------------------------

test("Monday to Friday at one time reads Mon–Fri", () => {
  assert.deepEqual(scheduleLines(WEEKDAYS), ["Mon–Fri · 8:15 AM–9:15 AM"]);
});

test("Monday, Wednesday and Friday are listed, not ranged", () => {
  assert.deepEqual(scheduleLines([slot("monday"), slot("wednesday"), slot("friday")]), ["Mon, Wed, Fri · 8:15 AM–9:15 AM"]);
});

test("a single day", () => {
  assert.deepEqual(scheduleLines([slot("saturday", "07:00", "08:00")]), ["Sat · 7:00 AM–8:00 AM"]);
});

test("two consecutive days are listed, not ranged", () => {
  assert.deepEqual(scheduleLines([slot("tuesday"), slot("wednesday")]), ["Tue, Wed · 8:15 AM–9:15 AM"]);
});

test("three consecutive days are a range, and a run beside a lone day keeps both", () => {
  assert.deepEqual(scheduleLines([slot("tuesday"), slot("wednesday"), slot("thursday")]), ["Tue–Thu · 8:15 AM–9:15 AM"]);
  assert.deepEqual(scheduleLines([slot("monday"), slot("tuesday"), slot("wednesday"), slot("friday")]), ["Mon–Wed, Fri · 8:15 AM–9:15 AM"]);
});

test("different times give one line per time group, the earliest day first", () => {
  assert.deepEqual(scheduleLines([...WEEKDAYS, slot("saturday", "07:00", "08:00")]), ["Mon–Fri · 8:15 AM–9:15 AM", "Sat · 7:00 AM–8:00 AM"]);
  // The same weekdays in a second time are not merged into the first.
  assert.deepEqual(
    scheduleLines([slot("monday", "06:00", "07:00"), slot("monday", "18:00", "19:00"), slot("tuesday", "06:00", "07:00")]),
    ["Mon, Tue · 6:00 AM–7:00 AM", "Mon · 6:00 PM–7:00 PM"],
  );
});

test("the afternoon times use PM and midday/midnight read 12", () => {
  assert.deepEqual(scheduleLines([slot("sunday", "12:00", "13:30")]), ["Sun · 12:00 PM–1:30 PM"]);
});

// ---- ordering and purity --------------------------------------------------------------------------

test("slots given out of order come out Monday to Sunday", () => {
  const shuffled = [slot("sunday"), slot("friday"), slot("monday"), slot("wednesday"), slot("tuesday"), slot("thursday"), slot("saturday")];
  assert.deepEqual(scheduleLines(shuffled), ["Mon–Sun · 8:15 AM–9:15 AM"]);
  assert.deepEqual(scheduleLines(shuffled), scheduleLines([...shuffled].reverse()), "the order of the input does not matter");
});

test("the input is never mutated", () => {
  const input = details(batch("Hatha", [slot("friday"), slot("monday")]), batch("Yin", [slot("saturday", "07:00", "08:00")]));
  const before = JSON.stringify(input);
  buildServiceDetails(input);
  scheduleLines(input.batches[0].slots);
  assert.equal(JSON.stringify(input), before);
});

test("a duplicated day is shown once", () => {
  assert.deepEqual(scheduleLines([slot("monday"), slot("monday")]), ["Mon · 8:15 AM–9:15 AM"]);
});

// ---- missing and unusable data -----------------------------------------------------------------

test("NULL, undefined and empty data give nothing to add", () => {
  for (const value of [null, undefined, {}, { version: 1, batches: [] }, { version: 1, batches: "x" }, "x", 5]) {
    assert.equal(buildServiceDetails(value), null, JSON.stringify(value));
  }
  assert.deepEqual(scheduleLines(null), []);
  assert.deepEqual(scheduleLines([]), []);
});

test("a batch without a usable name is left out, and a slot with an unknown day or no time is ignored", () => {
  assert.equal(buildServiceDetails(details({ batch_id: "x", name: "  ", slots: [slot("monday")] })), null);
  assert.deepEqual(scheduleLines([slot("someday"), { day_of_week: "monday", start_time: null, end_time: "09:00" }, slot("tuesday")]), ["Tue · 8:15 AM–9:15 AM"]);
});

// ---- one record versus several ----------------------------------------------------------------------

test("one batch is compact: the batch name and its schedule lines, no numbering", () => {
  assert.deepEqual(buildServiceDetails(details(batch("Hatha Yoga Intermediate", WEEKDAYS))), {
    lead: "Hatha Yoga Intermediate",
    schedule: ["Mon–Fri · 8:15 AM–9:15 AM"],
    table: null,
  });
});

test("one batch without a slot shows its name alone, with no invented schedule", () => {
  assert.deepEqual(buildServiceDetails(details(batch("Hatha", []))), { lead: "Hatha", schedule: [], table: null });
  assert.deepEqual(buildServiceDetails(details({ batch_id: "x", name: "Hatha", code: "H" })), { lead: "Hatha", schedule: [], table: null });
});

test("several batches give a Sl. No. list, numbered from the array order", () => {
  const model = buildServiceDetails(
    details(batch("Hatha Yoga Intermediate", WEEKDAYS), batch("Hatha Yoga", [slot("saturday", "07:00", "08:00")]), batch("Restorative", [])),
  );
  assert.equal(model.lead, null);
  assert.deepEqual(model.schedule, []);
  assert.deepEqual(model.table, [
    { number: 1, batch: "Hatha Yoga Intermediate", schedule: ["Mon–Fri · 8:15 AM–9:15 AM"] },
    { number: 2, batch: "Hatha Yoga", schedule: ["Sat · 7:00 AM–8:00 AM"] },
    { number: 3, batch: "Restorative", schedule: [] },
  ]);
});

test("the batch order is the stored order (the database sorts it); the module does not re-sort", () => {
  const model = buildServiceDetails(details(batch("Zen", [slot("monday")]), batch("Alpha", [slot("monday")])));
  assert.deepEqual(model.table.map((row) => row.batch), ["Zen", "Alpha"]);
});

test("nothing presentational is needed in the stored data: no numbers, labels or ranges are read from it", () => {
  const stored = details(batch("Hatha", WEEKDAYS));
  assert.deepEqual(Object.keys(stored).sort(), ["as_of", "batches", "version"]);
  assert.deepEqual(Object.keys(stored.batches[0]).sort(), ["batch_id", "code", "name", "slots"]);
  assert.deepEqual(Object.keys(stored.batches[0].slots[0]).sort(), ["day_of_week", "end_time", "start_time"]);
  assert.doesNotMatch(JSON.stringify(stored), /Mon|AM|PM|Sl\./);
});
