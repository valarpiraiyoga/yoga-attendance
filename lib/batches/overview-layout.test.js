// Run with `npm test` (Node's built-in test runner).
//
// Batch Details' Overview: the header, then the weekly schedule, students and attendance - no KPI summary
// cards; the schedule is a Monday-to-Sunday week rather than a tall table, and there is
// no empty "Additional Information" panel repeating the description the header already shows.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = "../../app/batches/[id]";
const source = (path) => readFileSync(new URL(`${dir}/${path}`, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("no tab bar: Batch Details is the Overview alone, with the Overview content still rendered", () => {
  const header = code("batch-header.js");
  assert.doesNotMatch(header, /Tabs|Batch sections|label: "(Overview|Students|Schedules|Attendance)"/);
  const page = code("page.js");
  assert.match(page, /<BatchHeader batch=\{batch\} active="overview">/);
  for (const part of ["<WeeklyScheduleOverview", "<BatchStudentsSection", "<BatchAttendanceStrip"]) assert.ok(page.includes(part), part);
});

test("the Students, Schedules and Attendance pages still exist, reached from the Overview, and go back to Batch Details", () => {
  for (const sub of ["students", "schedules", "attendance"]) assert.match(code(`${sub}/page.js`), /<BatchHeader batch=\{batch\} active="/, sub);
  assert.match(code("weekly-schedule-overview.js"), /\/batches\/\$\{batchId\}\/schedules/);
  assert.match(code("batch-attendance-strip.js"), /\/batches\/\$\{batchId\}\/attendance/);
  const header = code("batch-header.js");
  assert.ok(header.includes('isOverview ? "Back to Batches" : "Back to Batch Details"'));
});

test("no KPI summary cards: the header is followed directly by the weekly schedule", () => {
  const page = code("page.js");
  assert.doesNotMatch(page, /StatTile|stat-tile|soleInstructor|dayCount/);
  assert.ok(page.indexOf("<FlashToast") < page.indexOf("<WeeklyScheduleOverview"));
  // The Students heading still counts active students (01-product.md §6).
  assert.match(page, /activeCount=\{activeStudentCount\}/);
});

test("the schedule is a week: one row per weekday with time pills, and 'No class' for an empty day", () => {
  const week = code("weekly-schedule-overview.js");
  assert.match(week, /DAYS_OF_WEEK\.map\(/);
  assert.match(week, /No class/);
  assert.match(week, /formatTimeRange\(slot\.start, slot\.end\)/);
  // A time slot is one block: its instructors (photo and name) are listed, stacked, inside it - always, and each day card shows its date.
  assert.match(week, /slotsOfDay\(byDay\.get\(day\) \?\? \[\]\)/);
  assert.match(week, /<Avatar name=\{schedule\.instructors\.full_name\}/);
  assert.match(week, /No scheduled classes for this day\./);
  assert.match(week, /formatDate\(date\)/);
  // Add Schedule and View Full Schedule are still one click away.
  assert.match(week, /\/schedule\/new\?batch=\$\{batchId\}/);
  assert.match(week, /\/batches\/\$\{batchId\}\/schedules/);
  const page = code("page.js");
  assert.match(page, /<WeeklyScheduleOverview\s+batchId=\{batch\.id\}\s+schedules=\{currentSchedules\}/);
});

test("Additional Information is gone (the description is in the header) and the layout is Weekly Schedule, Students, then the Attendance strip", () => {
  const page = code("page.js");
  assert.doesNotMatch(page, /Additional Information|FieldRow/);
  const at = (needle) => page.indexOf(needle);
  assert.ok(at("<WeeklyScheduleOverview") < at("<BatchStudentsSection") && at("<BatchStudentsSection") < at("<BatchAttendanceStrip"));
  assert.match(code("batch-header.js"), /batch\.description/, "the description is shown in the header");
});

test("Weekly Schedule: seven weekday columns, time chips grouped by colour (the same mapping as the enrollment picker)", () => {
  const week = code("weekly-schedule-overview.js");
  assert.match(week, /grid-cols-\[repeat\(auto-fit,minmax\(9\.75rem,1fr\)\)\] gap-2/);
  assert.match(week, /TIME_RANGE_CHIPS\[slots\.get\(slot\.key\) \?\? 0\]/);
  assert.match(week, /View Full Schedule/);
});

test("Students: one collapsible table with search, a status filter and Add Student; the chevron hides the body without losing state", () => {
  const section = code("batch-students-section.js");
  assert.match(section, /^"use client";/);
  assert.match(section, /hidden=\{!open\}/);
  assert.match(section, /aria-expanded=\{open\}/);
  // Grouped by session: Time / Session | # | Student (with its Student ID beneath) | Instructor | Status | Phone | Actions.
  for (const header of ["Time / Session", "#", "Student", "Instructor", "Status", "Phone", "Actions"]) assert.ok(section.includes(`>${header}</TableHead>`), header);
  assert.match(section, /href="\/students\/new"/, "the existing Add Student flow");
  assert.match(section, /enrollment\.status/, "the enrollment's own status");
  assert.match(section, /Edit Enrollment/);
  assert.match(code("page.js"), /<BatchStudentsSection\s+enrollments=\{enrollments\}\s+activeCount=\{activeStudentCount\}/);
});

test("Attendance Summary: the month's sessions from the batch's completed sessions (a Time | Instructor | days matrix); month navigation is in the URL", () => {
  const page = code("page.js");
  assert.match(page, /getBatchAttendanceReport\(\{ batchId, dateFrom: from, dateTo: to \}\)/);
  assert.match(page, /parseCalendarMonth\(rawParams\?\.attendanceMonth, today\)/);
  assert.match(page, /<BatchAttendanceStrip batchId=\{batch\.id\} month=\{month\} today=\{today\} sessions=\{monthSessions\} schedules=\{schedules\} \/>/);
  const strip = code("batch-attendance-strip.js");
  assert.match(strip, /\?attendanceMonth=/);
  assert.match(strip, /No Class/);
  assert.match(strip, /View Details/, "the screenshot's label for the link to the Attendance tab");
  assert.doesNotMatch(strip, /fetch\(|supabase/, "no read of its own");
});

test("the save confirmation is the standard toast", () => {
  const page = code("page.js");
  assert.match(page, /<FlashToast message=\{message\} \/>/);
  assert.doesNotMatch(page, /border-success\/30 bg-success\/5/);
});
