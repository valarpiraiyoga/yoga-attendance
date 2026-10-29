// Run with `npm test` (Node's built-in test runner).
//
// Attendance -> session cards AND table rows: the same hover effect as the other list cards - the card lifts with a stronger
// shadow, gets a steady brand border and a slow arc runs round it - from the shared `EntityCard animatedBorder` (cards) and
// `.card-border-animated-row` + `AnimatedBorder` (table rows), not a new animation. With no explicit layout the page shows the
// cards below `lg` and the TABLE from `lg` up, so both carry the effect. Both are the one `SessionCardItem` / `SessionTable` in
// Today's Sessions, All Sessions (every date) and the timeline, so filtered and searched results get it too. The effect is
// decorative and never takes the pointer, so the Take Attendance button and the menu are unaffected.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const card = code("../../app/attendance/session-card-item.js");
const table = code("../../app/attendance/session-table.js");
const batchTable = code("../../app/batches/batch-table.js");
const css = source("../../app/globals.css");

test("the session card opts in to the shared animated border, exactly as the other list cards do", () => {
  assert.match(card, /<EntityCard\s+animatedBorder\s+className=\{cn\(menuOpen && "border-brand\/40 bg-brand\/5"\)\}/);
  // The same opt-in the Students, Batches, Memberships, Documents and Instructors cards use.
  for (const path of ["students/student-card-item.js", "batches/batch-card-item.js", "memberships/membership-card-item.js", "documents/document-card-item.js", "settings/instructors/instructor-card-item.js"]) {
    assert.match(code(`../../app/${path}`), /<EntityCard\s+animatedBorder\b/, path);
  }
});

test("the effect itself is the shared one: the card lifts with a stronger shadow, and the ring is drawn by AnimatedBorder", () => {
  const entityCard = code("../../components/ui/entity-card.js");
  assert.match(entityCard, /animatedBorder && "card-border-animated transition-shadow hover:shadow-lg"/);
  assert.match(entityCard, /\{animatedBorder \? <AnimatedBorder \/> : null\}/);
  // Nothing new was added for Attendance: the only hover, transition or animation classes in the file are the View button's own.
  const motionClasses = [...card.matchAll(/\b(?:hover|transition|animate|duration|ease)[-:][^\s"`}]*/g)].map((match) => match[0]);
  assert.deepEqual(motionClasses, ["hover:bg-brand/10", "hover:text-brand"]);
});

test("the ring is decorative: it never takes the pointer, is hidden from assistive tech and only runs on devices that can hover", () => {
  const ring = code("../../components/ui/animated-border.js");
  assert.match(ring, /<svg aria-hidden="true" focusable="false" className="card-border-ring">/);
  assert.match(css, /\.card-border-ring \{[^}]*pointer-events: none;[^}]*opacity: 0;[^}]*transition: opacity 250ms ease;/);
  assert.match(css, /@media \(hover: hover\) \{\s*\.card-border-animated:hover \.card-border-ring/);
});

test("reduced motion is respected: the arc stops and the border just turns solid brand", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .card-border-ring rect"));
  assert.match(reduced, /\.card-border-ring rect \{\s*animation: none;/);
  assert.match(reduced, /\.card-border-ring-tail \{\s*display: none;/);
  assert.match(reduced, /\.card-border-ring \.card-border-ring-base \{\s*stroke-opacity: 1;/);
});

test("the Take Attendance button, the View button and the menu are untouched and sit outside the ring", () => {
  assert.match(card, /<SessionCardMenu/);
  assert.match(card, /canTake \? <ArrowRight className="size-4" aria-hidden="true" \/> : null/);
  assert.match(card, /className="text-brand hover:bg-brand\/10 hover:text-brand"/);
  // The ring is a sibling drawn by EntityCard before the content; the card's own children never render it.
  assert.doesNotMatch(card, /AnimatedBorder|card-border/);
});

test("every session card gets it: one SessionCardItem serves Today's Sessions, All Sessions and the timeline", () => {
  assert.match(code("../../app/attendance/session-list.js"), /<SessionCardItem key=\{sessionKey\(session\)\}/);
  assert.match(code("../../app/attendance/session-timeline.js"), /<SessionCardItem key=/);
  const cardsFound = ["session-list.js", "session-timeline.js", "page.js"].map((name) => code(`../../app/attendance/${name}`).match(/<EntityCard/g)?.length ?? 0);
  assert.deepEqual(cardsFound, [0, 0, 0], "no other card markup for sessions; they all render SessionCardItem");
});

test("nothing about the card's data or layout changed: summary, status, action and the menu-open tint are as before", () => {
  assert.match(card, /const summary = summarizeSession\(session, today, timeZone\);/);
  assert.match(card, /const canTake = summary\.actionLabel === "Take Attendance";/);
  assert.match(card, /statusPlacement="actions"/);
  assert.match(card, /avatar=\{<StartTimeTile/);
});

const ROW_EFFECT = "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent";

test("the table rows - what a desktop window shows by default - use the shared row pattern, exactly as the Batches rows do", () => {
  const row = table.slice(table.indexOf("function SessionRow"), table.indexOf("<TableCell", table.indexOf("function SessionRow")));
  assert.ok(row.includes(ROW_EFFECT), "the row carries the shared class list");
  assert.match(row, /menuOpen \? SURFACE_OPEN : SURFACE/);
  assert.match(table, /import AnimatedBorder from "@\/components\/ui\/animated-border";/);
  // The ring is the first thing in the FIRST cell, before the session cell - the same place as the Batches row.
  assert.match(table, /<TableCell className=\{cn\(CELL, "py-3 pr-1 pl-2 @xl:pr-2 @xl:pl-3"\)\}>\s*<AnimatedBorder \/>\s*<SessionCell/);
  assert.match(batchTable, /<TableCell className=\{cn\(CELL, "py-3 pr-2 pl-3"\)\}>\s*<AnimatedBorder \/>/);
  assert.ok(batchTable.includes(ROW_EFFECT), "the Batches row uses the very same class list");
  assert.equal((table.match(/<AnimatedBorder \/>/g) ?? []).length, 1, "one ring per row");
});

test("the table's header and empty-state rows get no effect, and the columns, cells and actions are as before", () => {
  assert.equal((table.match(/card-border-animated-row/g) ?? []).length, 1, "only the session rows");
  assert.match(table, /<TableRow className="border-0 hover:bg-transparent">/, "the empty-state row keeps its plain class");
  assert.match(table, /const HEAD_CLASS = "h-10 border-y border-border\/60 bg-brand\/5 px-2 text-small tracking-normal first:rounded-l-lg/);
  assert.match(table, /const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";/);
  assert.match(table, /const ELIGIBLE_ONLY = "hidden @\[38rem\]:table-cell";/);
  assert.match(table, /const ATTENDANCE_ONLY = "hidden @\[46rem\]:table-cell";/);
  // The Take Attendance button and the menu are still the last cell, after the ring, and not part of it.
  assert.match(table, /\{summary\.actionLabel\}\s*<\/Button>\s*<SessionCardMenu/);
  assert.match(table, /canMarkException=\{isAdmin && session\.status === "scheduled"\}/);
});

test("the card and the table both use the one shared effect, whichever layout is shown", () => {
  assert.match(card, /<EntityCard\s+animatedBorder\b/);
  assert.ok(table.includes("card-border-animated-row") && table.includes("<AnimatedBorder />"));
  // Both layouts are rendered by the list and the timeline: cards below lg, the table from lg (or the chosen layout).
  const list = code("../../app/attendance/session-list.js");
  assert.match(list, /layout === "" && "lg:hidden"/);
  assert.match(list, /layout === "" && "hidden lg:block"/);
  assert.match(code("../../components/layout/DateGroupTimeline.js"), /layout === "" && "hidden lg:block"/);
  // And the CSS that draws it for rows is the shared one, with its reduced-motion rules.
  assert.match(css, /\.card-border-animated-row:hover \.card-border-ring rect/);
  assert.match(css, /\.card-border-animated-row > :first-child::after \{[^}]*pointer-events: none;/);
});
