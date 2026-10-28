// Run with `npm test` (Node's built-in test runner).
//
// Schedule -> Time Slots: the six time controls of a slot (Start and End: hour, minute, AM/PM) are on a white field - the
// `surface` token - instead of showing the slot card's tint through them. They all come from the one shared `TimeSelect`, so
// every slot, including one added with "Add Time", gets the same field. Only the background changed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const timeSelect = code("../../components/ui/time-select.js");
const form = code("../../app/schedule/schedule-form.js");

test("the hour, minute and AM/PM dropdowns each use the surface token (white) on top of the shared SelectTrigger", () => {
  const triggers = timeSelect.match(/<SelectTrigger[^>]*>/g) ?? [];
  assert.equal(triggers.length, 3, "hour, minute and AM/PM");
  for (const trigger of triggers) assert.match(trigger, /className="w-full min-w-0 bg-surface"/, trigger);
  assert.match(timeSelect, /<SelectTrigger id=\{id\} className="w-full min-w-0 bg-surface" aria-label=\{`\$\{label\} hour`\}/);
  assert.match(timeSelect, /aria-label=\{`\$\{label\} minutes`\} aria-invalid=\{invalid\}>\s*<SelectValue placeholder="Min"/);
  assert.match(timeSelect, /aria-label=\{`\$\{label\} AM or PM`\}/);
  // The token is white, and no raw colour was introduced.
  assert.match(source("../../app/globals.css"), /--surface:\s*#ffffff;/i);
  assert.doesNotMatch(timeSelect, /#[0-9a-f]{3,8}\b|bg-white/i);
});

test("the Custom minute field - the minute control once 'Custom…' is chosen - is white too", () => {
  assert.match(timeSelect, /className="w-full min-w-0 bg-surface pr-8 text-center"/);
});

test("the shared SelectTrigger is transparent by default and takes a passed className last, so bg-surface replaces it", () => {
  const select = source("../../components/ui/select.jsx");
  assert.match(select, /rounded-input border border-input bg-transparent/);
  assert.match(select, /cn\(\s*"[^"]*",\s*className\s*\)/);
});

test("only the background was added: size, border, radius, arrows, text, placeholders and the grid are as they were", () => {
  // The extra class is the only difference from the previous classes.
  assert.equal((timeSelect.match(/bg-surface/g) ?? []).length, 4, "three triggers and the custom minute field");
  assert.match(timeSelect, /<div role="group" aria-label=\{label\} className="grid grid-cols-3 gap-2">/);
  assert.match(timeSelect, /<SelectValue placeholder="Hr" \/>/);
  assert.match(timeSelect, /<SelectValue placeholder="Min" \/>/);
  assert.match(timeSelect, /<SelectValue placeholder="AM\/PM" \/>/);
  assert.doesNotMatch(timeSelect, /<SelectTrigger[^>]*className="[^"]*\b(h-|px-|py-|border|rounded|text-)/);
});

test("the time behaviour is unchanged: the picker still parses, fills the minute and submits one HH:MM", () => {
  assert.match(timeSelect, /if \(field === "hour" && !updated\.minute\) updated\.minute = "00";/);
  assert.match(timeSelect, /<input type="hidden" name=\{name\} value=\{toTime\(parts\)\} \/>/);
  assert.match(timeSelect, /onValueChange=\{\(next\) => update\("hour", next\)\}/);
  assert.match(timeSelect, /onValueChange=\{\(next\) => update\("period", next\)\}/);
});

test("every time slot uses this one TimeSelect - the first, each added one, and the edit form - with no styling of its own", () => {
  const uses = form.match(/<TimeSelect\b[\s\S]*?\/>/g) ?? [];
  assert.equal(uses.length, 4, "start and end for a new schedule's slots, and for the edit form");
  for (const use of uses) assert.doesNotMatch(use, /className|bg-/, "the background comes from TimeSelect itself");
  // Slots are rendered from state, so one added with Add Time is the same component.
  assert.match(form, /timeSlots\.map\(\(slot, index\) => \(/);
  assert.match(form, /onClick=\{addTimeSlot\}/);
});

test("the Schedule form's other fields are untouched: the batch and instructor selects and the slot card keep their styling", () => {
  assert.match(form, /<SelectTrigger id="batch_id" aria-invalid=\{Boolean\(fieldErrors\.batch_id\)\}>/);
  assert.match(form, /<SelectTrigger id="instructor_id" aria-invalid=\{Boolean\(fieldErrors\.instructor_id\)\}>/);
  assert.match(form, /className="flex flex-col gap-3 rounded-lg border border-border bg-background\/60 p-3 sm:flex-row sm:items-start"/);
});
