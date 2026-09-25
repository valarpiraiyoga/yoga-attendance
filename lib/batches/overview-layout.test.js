// Run with `npm test` (Node's built-in test runner).
//
// Batch Details' Overview: the header and its four tabs stay; the summary cards are short values
// (nothing wraps), the schedule is a Monday-to-Sunday week rather than a tall table, and there is
// no empty "Additional Information" panel repeating the description the header already shows.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = "../../app/batches/[id]";
const source = (path) => readFileSync(new URL(`${dir}/${path}`, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("the tabs stay: the header still carries Overview, Students, Schedules and Attendance", () => {
  const header = code("batch-header.js");
  for (const label of ["Overview", "Students", "Schedules", "Attendance"]) {
    assert.ok(header.includes(`label: "${label}"`), label);
  }
  assert.match(header, /<Tabs as="link" items=\{tabs\}/);
  assert.match(code("page.js"), /<BatchHeader batch=\{batch\} active="overview">/);
});

test("four short summary cards: students, weekly classes, time, instructor", () => {
  const page = code("page.js");
  const cards = page.slice(page.indexOf("<StatTileGroup"), page.indexOf("</StatTileGroup>"));
  assert.equal((cards.match(/<StatTile\b/g) ?? []).length, 4);
  for (const label of ["Students Enrolled", "Weekly Classes", "Time", "Instructor"]) {
    assert.ok(cards.includes(`label="${label}"`), label);
  }
  // The day list ("Mon, Tue, Wed, ...") no longer sits in a card: it wrapped and stretched the icon box.
  assert.ok(!cards.includes("summary.days"), "the day list is the weekly schedule's job");
  assert.match(cards, /Across \$\{dayCount\}/);
});

test("the schedule is a week: one row per weekday with time pills, and 'No class' for an empty day", () => {
  const week = code("weekly-schedule-overview.js");
  assert.match(week, /DAYS_OF_WEEK\.map\(/);
  assert.match(week, /No class/);
  assert.match(week, /formatTimeRange\(schedule\.start_time, schedule\.end_time\)/);
  // An instructor's photo only appears when the classes have more than one teacher.
  assert.match(week, /showInstructor = instructorNames\.size > 1/);
  // Add Schedule and View Full Schedule are still one click away.
  assert.match(week, /\/schedule\/new\?batch=\$\{batchId\}/);
  assert.match(week, /\/batches\/\$\{batchId\}\/schedules/);
  const page = code("page.js");
  assert.match(page, /<WeeklyScheduleOverview\s+batchId=\{batch\.id\}\s+schedules=\{currentSchedules\}/);
});

test("Additional Information is gone (the description is in the header) and the layout is Weekly | Students, then Recent Attendance", () => {
  const page = code("page.js");
  assert.doesNotMatch(page, /Additional Information|FieldRow/);
  const at = (needle) => page.indexOf(needle);
  assert.ok(at("<WeeklyScheduleOverview") < at('title="Students"') && at('title="Students"') < at('title="Recent Attendance"'));
  assert.match(page, /xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.match(code("batch-header.js"), /batch\.description/, "the description is shown in the header");
});

test("the save confirmation is the standard toast", () => {
  const page = code("page.js");
  assert.match(page, /<FlashToast message=\{message\} \/>/);
  assert.doesNotMatch(page, /border-success\/30 bg-success\/5/);
});
