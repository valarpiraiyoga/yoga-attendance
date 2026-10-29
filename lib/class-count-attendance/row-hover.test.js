// Run with `npm test` (Node's built-in test runner).
//
// Attendance -> Class Count Attendance: each membership row of the list (Ready to record, and the renew list, which is the same
// table) has the shared animated-border hover effect of the other list tables - the row lifts with a stronger shadow, gets a steady
// brand border and a slow arc runs round it - from `.card-border-animated-row` and `AnimatedBorder`, not a new animation. Only the
// body rows have it: not the header, and not the empty states. Checked as source (there is no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const list = code("../../app/attendance/class-count/class-count-list.js");
const page = code("../../app/attendance/class-count/page.js");
const batchTable = code("../../app/batches/batch-table.js");
const sessionTable = code("../../app/attendance/session-table.js");
const css = source("../../app/globals.css");

const ROW_EFFECT = "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent";

test("a body row carries the shared row class list - the very one the Batches and Attendance session rows use", () => {
  assert.ok(list.includes(`const ROW = "${ROW_EFFECT}";`), "the row class list");
  assert.ok(batchTable.includes(ROW_EFFECT) && sessionTable.includes(ROW_EFFECT), "identical to the other tables'");
  assert.match(list, /<TableRow key=\{row\.membershipId\} className=\{ROW\}>/);
});

test("the ring is the first thing in the row's first cell (Student), before the avatar, and there is one per row", () => {
  assert.match(list, /<TableCell className=\{CELL\}>\s*<AnimatedBorder \/>\s*<div className="flex min-w-0 items-center gap-3">\s*<Avatar/);
  assert.equal((list.match(/<AnimatedBorder \/>/g) ?? []).length, 1);
  assert.match(list, /import AnimatedBorder from "@\/components\/ui\/animated-border";/);
});

test("the header row and the empty states do not get the effect", () => {
  assert.equal((list.match(/card-border-animated-row/g) ?? []).length, 1, "only the ROW constant");
  assert.match(list, /<TableHeader>\s*<TableRow className="border-0 hover:bg-transparent">/);
  assert.equal((list.match(/className=\{ROW\}/g) ?? []).length, 1, "the body row only");
  // The empty states are separate components outside the table.
  assert.doesNotMatch(page, /AnimatedBorder|card-border-animated/);
  assert.match(page, /<EmptyState size="sm" description="No class-count membership has classes to record today\." \/>/);
});

test("both lists - Ready to record and the renew list - are this table, so both get it", () => {
  assert.match(page, /<ClassCountList rows=\{eligible\} mode="record"/);
  assert.match(page, /<ClassCountList rows=\{toRenew\} mode="renew"/);
  assert.match(list, /\{mode === "renew" \? \(/);
});

test("the columns, cells and content are unchanged: Student, Membership, Classes and Action", () => {
  assert.equal((list.match(/<TableHead\b/g) ?? []).length, 4);
  for (const heading of ["Student", "Membership", "Classes", "Action"]) assert.match(list, new RegExp(`>${heading}</TableHead>`));
  assert.match(list, /const MID_ONLY = "hidden @\[36rem\]:table-cell";/);
  assert.match(list, /const CELL = "border-y border-border bg-surface px-3 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";/);
  assert.match(list, /<Progress\s+value=\{row\.total > 0 \? \(row\.used \/ row\.total\) \* 100 : 0\}/);
  assert.match(list, /\{row\.used\} of \{row\.total\} used/);
  assert.match(list, /\{row\.endDate \? `Expires \$\{formatDate\(row\.endDate\)\}` : NO_EXPIRY_LABEL\}/);
});

test("Record class and Renew keep working: the same button and link, in the last cell, after the ring", () => {
  assert.match(list, /<RecordClassButton\s+today=\{today\}/);
  assert.match(list, /render=\{<Link href=\{`\/memberships\/\$\{row\.membershipId\}\/renew`\} \/>\}/);
  assert.ok(list.indexOf("<AnimatedBorder />") < list.indexOf("<RecordClassButton"));
  // The record dialog and its request handling are in the button's own file and are not touched.
  assert.doesNotMatch(code("../../app/attendance/class-count/record-class-button.js"), /AnimatedBorder|card-border/);
});

test("the effect is the shared one: pointer-inert, hover-only, with the reduced-motion rules", () => {
  assert.match(css, /\.card-border-animated-row:hover \.card-border-ring rect/);
  assert.match(css, /\.card-border-animated-row > :first-child::after \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(hover: hover\) \{[\s\S]*?\.card-border-animated-row:hover > :first-child::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.card-border-ring rect \{\s*animation: none;/);
  assert.match(code("../../components/ui/animated-border.js"), /<svg aria-hidden="true" focusable="false" className="card-border-ring">/);
});

test("the other Attendance layouts keep theirs, and nothing new was added for this table", () => {
  assert.match(code("../../app/attendance/session-card-item.js"), /<EntityCard\s+animatedBorder\b/);
  assert.ok(sessionTable.includes("card-border-animated-row") && sessionTable.includes("<AnimatedBorder />"));
  const motionClasses = [...list.matchAll(/\b(?:transition|animate|duration|ease)[-:][^\s"`}]*/g)].map((match) => match[0]);
  assert.deepEqual(motionClasses, [], "no hover animation, transition or duration of its own");
});
