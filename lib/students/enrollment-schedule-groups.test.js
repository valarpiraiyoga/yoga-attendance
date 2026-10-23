// Run with `npm test`. The grouping is pure and run directly; the page wiring is pinned from source (the screen needs the Next.js runtime).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupSchedulesByTimeSlot, instructorCountLabel } from "./enrollment-schedule-groups.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const KANNAN = { id: "i1", full_name: "Kannan Thangavel", photo_url: null };
const SUBHA = { id: "i2", full_name: "Subha Kannan", photo_url: "x.jpg" };
const a = (id, day, start, end, instructors) => ({ id, schedule: { day_of_week: day, start_time: start, end_time: end, instructors } });

test("one group per distinct time slot; one row per instructor with that instructor's days, in the order given", () => {
  const groups = groupSchedulesByTimeSlot([
    a("1", "monday", "06:00:00", "07:00:00", KANNAN),
    a("2", "monday", "06:00:00", "07:00:00", SUBHA),
    a("3", "tuesday", "06:00:00", "07:00:00", KANNAN),
    a("4", "wednesday", "06:00:00", "07:00:00", SUBHA),
    a("5", "thursday", "06:00:00", "07:00:00", KANNAN),
    a("6", "thursday", "07:00:00", "08:00:00", KANNAN),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows.map((row) => [row.instructor.full_name, row.days]), [
    ["Kannan Thangavel", ["monday", "tuesday", "thursday"]],
    ["Subha Kannan", ["monday", "wednesday"]],
  ]);
  assert.equal(groups[0].instructorCount, 2);
  assert.deepEqual(groups[1].rows.map((row) => row.days), [["thursday"]]);
  assert.equal(groups[1].instructorCount, 1);
});

test("slots that differ only by end time, or by start time, are never merged; slots are earliest first", () => {
  const groups = groupSchedulesByTimeSlot([
    a("1", "friday", "19:00:00", "20:00:00", KANNAN),
    a("2", "monday", "10:30:00", "11:30:00", KANNAN),
    a("3", "wednesday", "10:30:00", "12:00:00", KANNAN),
  ]);
  assert.deepEqual(groups.map((group) => `${group.startTime}-${group.endTime}`), ["10:30:00-11:30:00", "10:30:00-12:00:00", "19:00:00-20:00:00"]);
});

test("the same instructor in two different slots appears in each separately; the same day twice in a slot is one chip", () => {
  const groups = groupSchedulesByTimeSlot([a("1", "monday", "06:00:00", "07:00:00", KANNAN), a("2", "monday", "06:00:00", "07:00:00", KANNAN), a("3", "monday", "08:00:00", "09:00:00", KANNAN)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows[0].days, ["monday"]);
});

test("a missing instructor is one 'no instructor' row and is not counted; a missing schedule is left out", () => {
  const groups = groupSchedulesByTimeSlot([a("1", "monday", "06:00:00", "07:00:00", null), a("2", "tuesday", "06:00:00", "07:00:00", null), { id: "3", schedule: null }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].instructorCount, 0);
  assert.deepEqual(groups[0].rows.map((row) => [row.instructor, row.days]), [[null, ["monday", "tuesday"]]]);
  assert.deepEqual(groupSchedulesByTimeSlot(null), []);
  assert.deepEqual(groupSchedulesByTimeSlot([]), []);
});

test("instructor count wording: singular, plural, none", () => {
  assert.equal(instructorCountLabel(1), "1 instructor");
  assert.equal(instructorCountLabel(2), "2 instructors");
  assert.equal(instructorCountLabel(0), "No instructor");
});

test("page: columns are Time | Instructor | Days; the time block spans its instructor rows; existing data and actions are reused", () => {
  const page = read("app/students/[id]/page.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(page, /<th[^>]*>Time<\/th>\s*<th[^>]*>Instructor<\/th>\s*<th[^>]*>Days<\/th>/);
  assert.ok(page.includes("groupSchedulesByTimeSlot(schedules)"));
  assert.ok(page.includes("rowSpan={group.rows.length}"));
  assert.ok(page.includes("instructorCountLabel(group.instructorCount)"));
  assert.ok(page.includes("formatTimeRange(group.startTime, group.endTime)"));
  assert.ok(page.includes("(DAY_LABELS[day] ?? day).slice(0, 3)"));
  assert.ok(page.includes("listScheduleAssignmentsForEnrollment") && page.includes("isScheduleAssignmentActive(assignment, today)"), "same data and filter");
  assert.ok(page.includes("Assigned schedule could not be found") && page.includes("No schedule assigned"));
  assert.ok(page.includes("/enrollments/${enrollment.id}/edit") && page.includes("/enrollments/new"));
});
