// Run with `npm test` (Node's built-in test runner).
//
// Schedule Details is one page in the same shape as Session Details: the compact strip, a header
// card about WHEN the class happens, four summary cards that add information, then the content
// itself (upcoming sessions and the recurring pattern) instead of tabs.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const dir = "../../app/schedule/[id]";
const source = (path) => readFileSync(new URL(`${dir}/${path}`, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("there are no tabs: the old tabs component is gone and the page shows the content itself", () => {
  assert.equal(existsSync(new URL(`${dir}/schedule-details-tabs.js`, import.meta.url)), false);
  const page = code("page.js");
  assert.doesNotMatch(page, /Tabs|ScheduleDetailsTabs/);
  assert.match(page, /<UpcomingSessionsPanel scheduleId=\{schedule\.id\} sessions=\{upcomingSessions\} \/>/);
  assert.match(page, /<SchedulePatternCard schedule=\{schedule\} \/>/);
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/schedule", label: "Back to Schedule" \}\}/);
  assert.match(page, /<FlashToast message=\{message\} \/>/);
  // strip, header, cards, content - in that order
  const at = (needle) => page.indexOf(needle);
  assert.ok(at("<PageHeader") < at("<ScheduleHeader") && at("<ScheduleHeader") < at("<ScheduleSummary") && at("<ScheduleSummary") < at("<UpcomingSessionsPanel"));
});

test("the header card is about when the class happens, in the Session Details shape", () => {
  const header = code("schedule-header.js");
  const card = header.slice(header.indexOf("export default function ScheduleHeader"), header.indexOf("export function ScheduleSummary"));
  assert.match(card, /avatar=\{<StartTimeTile startTime=\{schedule\.start_time\} label=\{timeLabel\} \/>\}/);
  assert.match(card, /Every \{dayLabel\}/, "the day is the heading");
  // start time large, end time small, the batch code a small mark in the heading
  assert.match(card, /\{formatTime\(schedule\.start_time\)\}\s*<span className="text-section-title[^"]*"> – \{formatTime\(schedule\.end_time\)\}<\/span>/);
  assert.match(card, /\{batchCode \? \(/);
  assert.match(card, /decorative=\{false\}\s+wash/);
  // batch and instructor under the heading; the two actions are unchanged
  assert.ok(card.includes("batchName") && card.includes("instructorName"));
  assert.match(card, /Edit Schedule/);
  assert.match(card, /<DeactivateSchedule/);
  assert.doesNotMatch(card, /Code: /, "the code is in the heading, not repeated");
});

test("the summary cards add information instead of repeating the header", () => {
  const header = code("schedule-header.js");
  const summary = header.slice(header.indexOf("export function ScheduleSummary"));
  assert.equal((summary.match(/<StatTile\b/g) ?? []).length, 4);
  for (const label of ["Frequency", "Duration", "Effective From", "Next Session"]) {
    assert.ok(summary.includes(`label="${label}"`), label);
  }
  for (const repeated of ['label="Status"', 'label="Day"', 'label="Time"', 'label="Instructor"']) {
    assert.ok(!summary.includes(repeated), `${repeated} is in the header already`);
  }
  assert.match(summary, /upcomingSessions\[0\] \?\? null/, "the next session comes from the projection");
  assert.match(summary, /"Open-ended"/);
});

test("the recurring pattern is a picture: a Monday-to-Sunday strip with the schedule's day filled", () => {
  const card = code("schedule-pattern-card.js");
  assert.match(card, /DAYS_OF_WEEK\.map\(/);
  assert.match(card, /day === schedule\.day_of_week/);
  assert.match(card, /border-brand bg-brand text-surface/);
  assert.match(card, /aria-current=\{occurs \? "true" : undefined\}/);
  assert.match(card, /sr-only/, "the strip reads in words too");
  assert.match(card, /Every \{dayLabel\}, \{timeLabel\}/);
});

test("the upcoming sessions keep their per-row Edit Session action and empty state", () => {
  const panel = code("upcoming-sessions-panel.js");
  assert.match(panel, /No upcoming sessions/);
  assert.match(panel, /<EditSessionAction scheduleId=\{scheduleId\} session=\{session\} \/>/);
  assert.doesNotMatch(panel, /"use client"|useState/, "nothing here needs the client any more");
});
