// Run with `npm test` (Node's built-in test runner).
//
// The day-wise schedule picker of Add / Edit Batch Enrollment: Monday-to-Sunday grouping, every schedule its own row, the same
// colour for the same time range, and the accordion that only shows or hides (never changes the selection).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WEEKDAYS, groupSchedulesByDay, timeRangeKey, timeRangeSlots } from "./schedule-picker-core.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const s = (series_id, day_of_week, start_time, end_time, name) => ({ series_id, day_of_week, start_time, end_time, instructors: { full_name: name } });
const SCHEDULES = [
  s("a", "tuesday", "06:00:00", "07:00:00", "Kannan"),
  s("b", "monday", "17:00:00", "19:00:00", "Meena"),
  s("c", "monday", "06:00:00", "07:00:00", "Subha"),
  s("d", "monday", "06:00:00", "07:00:00", "Kannan"),
  s("e", "monday", "07:00:00", "08:00:00", "Ravi"),
  s("f", "monday", "17:00:00", "19:00:00", "Arun"),
];

test("every weekday, Monday to Sunday, with its schedules in time then instructor order", () => {
  const days = groupSchedulesByDay(SCHEDULES);
  assert.deepEqual(days.map((d) => d.day), WEEKDAYS);
  assert.deepEqual(days[0].schedules.map((x) => x.series_id), ["d", "c", "e", "f", "b"]);
  assert.deepEqual(days[1].schedules.map((x) => x.series_id), ["a"]);
  assert.deepEqual(days[6].schedules, []);
});

test("schedules with identical times stay separate rows (never merged)", () => {
  const monday = groupSchedulesByDay(SCHEDULES)[0].schedules;
  assert.equal(monday.filter((x) => timeRangeKey(x) === "06:00:00-07:00:00").length, 2);
  assert.equal(monday.length, 5);
});

test("the same time range has the same colour slot on every day and for every instructor; different ranges differ", () => {
  const slots = timeRangeSlots(SCHEDULES, 6);
  const slot = (id) => slots.get(timeRangeKey(SCHEDULES.find((x) => x.series_id === id)));
  assert.equal(slot("a"), slot("c"));
  assert.equal(slot("c"), slot("d"));
  assert.equal(slot("b"), slot("f"));
  assert.equal(new Set([slot("c"), slot("e"), slot("b")]).size, 3);
  assert.deepEqual([...timeRangeSlots(SCHEDULES, 6)], [...timeRangeSlots([...SCHEDULES].reverse(), 6)], "deterministic whatever the input order");
});

test("colour slots wrap rather than run out", () => {
  const many = Array.from({ length: 8 }, (_, i) => s(`x${i}`, "monday", `${String(6 + i).padStart(2, "0")}:00:00`, `${String(7 + i).padStart(2, "0")}:00:00`, "I"));
  assert.ok([...timeRangeSlots(many, 6).values()].every((slot) => slot >= 0 && slot < 6));
});

test("picker: independent checkboxes, all days open by default, the header only toggles visibility", () => {
  const picker = read("app/students/[id]/enrollments/schedule-picker.js");
  assert.match(picker, /useState\(\(\) => new Set\(\)\)/, "no day starts closed");
  assert.match(picker, /name="schedule_series_ids"/);
  assert.match(picker, /onChange=\{\(\) => onToggle\(schedule\.series_id\)\}/, "one checkbox per schedule");
  assert.match(picker, /hidden=\{!open\}/, "collapsing hides the rows but keeps the checkboxes in the form");
  assert.match(picker, /aria-expanded=\{open\}/);
  assert.doesNotMatch(picker, /selectedSeriesIds\.(add|delete)|onToggle\(day|checked=\{\s*list\./, "a day header never changes a selection");
});

test("form: the picker replaces the flat list, with a selected count and the required markers; the rules are unchanged", () => {
  const form = read("app/students/[id]/enrollments/enrollment-form.js");
  assert.match(form, /<SchedulePicker/);
  assert.match(form, /\{selectedSeriesIds\.size\} selected/);
  assert.match(form, /validateScheduleSelection\(\[\.\.\.selectedSeriesIds\]\)/);
  assert.match(form, /Select Schedule\(s\)/);
});

test("day header: the weekday name with a count chip (\"5 classes\", \"1 class\"), still only a show/hide button", () => {
  const picker = read("app/students/[id]/enrollments/schedule-picker.js");
  assert.match(picker, /\{list\.length\} \{list\.length === 1 \? "class" : "classes"\}/);
  const header = picker.slice(picker.indexOf("<button"), picker.indexOf("</button>"));
  assert.ok(header.includes("DAY_LABELS[day]") && header.includes("list.length"), "inside the clickable header");
});
