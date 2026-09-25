// Run with `npm test` (Node's built-in test runner).
//
// Dashboard -> Recent Activity: real records only, newest first, timed in the
// centre's own time zone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_LIMIT,
  attendanceActivity,
  describeWhen,
  membershipActivity,
  mergeActivity,
  studentActivity,
} from "./activity.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const KOLKATA = "Asia/Kolkata";
// 10:30 on 24 Sep in Kolkata.
const NOW = new Date("2026-09-24T05:00:00Z");

test("describeWhen says Today / Yesterday / a date, in the centre's time zone", () => {
  assert.equal(describeWhen("2026-09-24T01:00:00Z", NOW, KOLKATA), "Today, 6:30 AM");
  assert.equal(describeWhen("2026-09-23T10:42:00Z", NOW, KOLKATA), "Yesterday, 4:12 PM");
  assert.equal(describeWhen("2026-09-20T04:40:00Z", NOW, KOLKATA), "Sep 20, 10:10 AM");
});

test("the same instant is a different day for a different centre", () => {
  // 20:00 UTC on the 23rd is the 24th (01:30) in Kolkata, but still the 23rd in New York.
  const instant = "2026-09-23T20:00:00Z";
  assert.equal(describeWhen(instant, NOW, KOLKATA), "Today, 1:30 AM");
  assert.equal(describeWhen(instant, NOW, "America/New_York"), "Yesterday, 4:00 PM");
});

test("items from every kind are merged newest first and cut to the limit", () => {
  const items = mergeActivity([
    attendanceActivity({ updated_at: "2026-09-24T01:00:00Z", batches: { name: "Hatha Yoga General" } }),
    studentActivity({ created_at: "2026-09-23T10:00:00Z", full_name: "Anitha S" }),
    membershipActivity({ created_at: "2026-09-23T09:00:00Z", students: { full_name: "Kavish" } }, "Monthly"),
    studentActivity({ created_at: "2026-09-01T10:00:00Z", full_name: "Old One" }),
    studentActivity({ created_at: "2026-08-01T10:00:00Z", full_name: "Older One" }),
  ]);
  assert.equal(items.length, ACTIVITY_LIMIT);
  assert.deepEqual(items.map((item) => item.kind), ["attendance", "student", "membership", "student"]);
  assert.equal(items[0].title, "Attendance marked");
  assert.equal(items[0].detail, "Hatha Yoga General");
});

test("each kind is worded from its own record", () => {
  assert.deepEqual(studentActivity({ created_at: "2026-09-23T10:00:00Z", full_name: "Anitha S" }), {
    kind: "student", at: "2026-09-23T10:00:00Z", title: "New student added", detail: "Anitha S",
  });
  assert.equal(membershipActivity({ created_at: "x", students: { full_name: "Kavish" } }, "Monthly").detail, "Monthly · Kavish");
  assert.equal(membershipActivity({ created_at: "x" }, "Monthly").detail, "Monthly");
});

test("nothing recorded gives an empty list; items without a usable time are dropped", () => {
  assert.deepEqual(mergeActivity([]), []);
  assert.deepEqual(mergeActivity([{ kind: "student", at: null }, { kind: "student", at: "not a date" }, null]), []);
});

test("the Dashboard reads it through one admin-only data function, from real tables", () => {
  const data = source("./data.js");
  for (const table of ['from("class_sessions")', 'from("students")', 'from("memberships")']) assert.ok(data.includes(table), table);
  assert.match(data, /\.eq\("status", "completed"\)/);
  const page = source("../../app/page.js");
  assert.match(page, /isAdmin \? getRecentActivity\(\) : Promise\.resolve\(null\)/);
  assert.match(page, /<DashboardRecentActivity items=\{recentActivity\} timeZone=\{timeZone\} \/>/);
});

test("the class rows take their tile colour from the batch's saved identity", () => {
  const row = source("../../app/dashboard-class-row.js");
  assert.match(row, /getBatchColor\(batch\?\.batch_color\)/);
  assert.doesNotMatch(row, /BATCH_BADGE_TONES|hash/);
});

test("a Dashboard class row sets the end time smaller than the start time", () => {
  const row = readFileSync(new URL("../../app/dashboard-class-row.js", import.meta.url), "utf8");
  assert.match(row, /<p className="whitespace-nowrap">\{formatTime\(session\.start_time\)\}<\/p>/);
  assert.match(row, /<p className="text-small whitespace-nowrap font-medium text-text-secondary">– \{formatTime\(session\.end_time\)\}<\/p>/);
});

test("an Upcoming Dashboard row looks like Today's: date above the time, status beside the instructor", () => {
  const row = readFileSync(new URL("../../app/dashboard-class-row.js", import.meta.url), "utf8");
  const code = row.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // The date sits above the start time in the left column...
  const left = code.slice(code.indexOf('<div className="hidden text-body'), code.indexOf("<BatchCodeTile batch={batch} />"));
  assert.ok(left.indexOf("shortDate(session.session_date)") < left.indexOf("formatTime(session.start_time)"), "date first, then the start time");
  // ...and the meta line is one shape for both lists: the status is inline, not in the right-hand cluster.
  const meta = code.slice(code.indexOf('<div className="mt-1 flex min-w-0 flex-wrap'), code.indexOf("</div>", code.indexOf("<StatusPill status={displayStatus} />")));
  assert.match(meta, /<StatusPill status=\{displayStatus\} \/>/);
  assert.doesNotMatch(code, /showDate \? "flex-col items-start"/);
  const actions = code.slice(code.indexOf('<div className="col-span-2 flex'));
  assert.doesNotMatch(actions, /StatusPill|shortDate|CalendarDays/, "the right-hand cluster is just the action");
  // A phone has no left column, so the date rides at the front of the meta line.
  assert.match(code, /text-small whitespace-nowrap text-text-secondary sm:hidden">/);
});
