// Run with `npm test` (Node's built-in test runner).
//
// Schedule list (live view) batch header: the time-slot and instructor badges - singular / plural labels, and the shared outline Badge
// with a clock and a user icon (checked as source; the project has no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countedLabel } from "./counted-label.js";

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("singular and plural labels", () => {
  assert.equal(countedLabel(1, "time slot"), "1 time slot");
  assert.equal(countedLabel(2, "time slot"), "2 time slots");
  assert.equal(countedLabel(0, "time slot"), "0 time slots");
  assert.equal(countedLabel(1, "instructor"), "1 instructor");
  assert.equal(countedLabel(3, "instructor"), "3 instructors");
});

test("the batch header shows both counts as outline Badges with a clock and a user icon, from the computed counts", () => {
  const source = code("app/schedule/schedule-batch-accordion.js");
  assert.match(source, /<Badge variant="outline"[^>]*>\s*<Clock [^>]*\/>\s*\{countedLabel\(slotGroups\.length, "time slot"\)\}\s*<\/Badge>/);
  assert.match(source, /<Badge variant="outline"[^>]*>\s*<User [^>]*\/>\s*\{countedLabel\(instructorCount, "instructor"\)\}\s*<\/Badge>/);
  assert.ok(source.includes("const slotGroups = groupByTimeSlot(schedules);"), "counts come from the schedules");
});

test("the badges are tinted from semantic tokens: blue (info) for time slots, violet (brand-accent) for instructors; text stays primary", () => {
  const source = code("app/schedule/schedule-batch-accordion.js");
  assert.match(source, /className="[^"]*border-info\/25 bg-info\/10[^"]*">\s*<Clock className="size-3\.5 text-info"/);
  assert.match(source, /className="[^"]*border-brand-accent\/25 bg-brand-accent\/10[^"]*">\s*<User className="size-3\.5 text-brand-accent"/);
  const header = source.slice(source.indexOf('<Badge variant="outline"'), source.indexOf("sr-only"));
  assert.doesNotMatch(header, /#[0-9a-f]{3,6}/i, "no hex colours");
});

test("regression: the accordion's own `countLabel` string never shadows the helper (it once did: 'countLabel is not a function')", () => {
  const source = code("app/schedule/schedule-batch-accordion.js");
  const imported = [...source.matchAll(/import \{([^}]*)\} from/g)].flatMap((match) => match[1].split(",").map((name) => name.trim()));
  assert.ok(imported.includes("countedLabel"));
  assert.ok(!imported.includes("countLabel"), "nothing imported under the name the component declares locally");
  assert.equal((source.match(/const countLabel =/g) ?? []).length, 1, "the schedule-count string stays the one local countLabel");
  assert.doesNotMatch(source, /\{countLabel\(/, "countLabel is a string, never called");
});

test("the time block fills the full height of the rows it spans (the spanning cell has a definite height for `h-full`)", () => {
  const source = code("app/schedule/schedule-batch-accordion.js");
  assert.match(source, /<TableCell rowSpan=\{rows\.length\} className="h-px [^"]*">\s*<div className=\{cn\("flex h-full /);
});
