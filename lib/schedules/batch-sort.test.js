// Run with `npm test` (Node's built-in test runner).
//
// Schedule List View: batch groups sorted by name ("Batch (A-Z)" / "(Z-A)")
// and the "or day" part of the search ("Search by batch name, instructor or
// day"). Both are pure helpers in lib/schedules/validation.js.

import test from "node:test";
import assert from "node:assert/strict";
import { daysMatchingTerm, sortBatchGroups } from "./validation.js";

const group = (name) => ({ batchId: name ?? "none", batch: name ? { name } : null, schedules: [] });

test("sortBatchGroups orders by batch name A-Z and Z-A, case-insensitively", () => {
  const groups = [group("prenatal Yoga"), group("Advanced Yoga"), group("Children Yoga")];

  assert.deepEqual(
    sortBatchGroups(groups, "asc").map((item) => item.batch.name),
    ["Advanced Yoga", "Children Yoga", "prenatal Yoga"]
  );
  assert.deepEqual(
    sortBatchGroups(groups, "desc").map((item) => item.batch.name),
    ["prenatal Yoga", "Children Yoga", "Advanced Yoga"]
  );
});

test("sortBatchGroups sorts numbers naturally and puts a nameless group last", () => {
  const groups = [group("Batch 10"), group(null), group("Batch 2")];

  assert.deepEqual(
    sortBatchGroups(groups, "asc").map((item) => item.batch?.name ?? null),
    ["Batch 2", "Batch 10", null]
  );
  assert.deepEqual(
    sortBatchGroups(groups, "desc").map((item) => item.batch?.name ?? null),
    ["Batch 10", "Batch 2", null]
  );
});

test("sortBatchGroups leaves groups untouched for any other sort", () => {
  const groups = [group("B"), group("A")];
  assert.equal(sortBatchGroups(groups, null), groups);
  assert.equal(sortBatchGroups(groups, undefined), groups);
});

test("sortBatchGroups does not mutate its input or drop groups", () => {
  const groups = [group("B"), group("A")];
  const sorted = sortBatchGroups(groups, "asc");
  assert.deepEqual(groups.map((item) => item.batch.name), ["B", "A"]);
  assert.equal(sorted.length, 2);
});

test("daysMatchingTerm matches a day by three or more leading letters", () => {
  assert.deepEqual(daysMatchingTerm("mon"), ["monday"]);
  assert.deepEqual(daysMatchingTerm("Monday"), ["monday"]);
  assert.deepEqual(daysMatchingTerm(" TUE "), ["tuesday"]);
  assert.deepEqual(daysMatchingTerm("sat"), ["saturday"]);
});

test("daysMatchingTerm ignores short or unrelated terms", () => {
  assert.deepEqual(daysMatchingTerm("mo"), []);
  assert.deepEqual(daysMatchingTerm("yoga"), []);
  assert.deepEqual(daysMatchingTerm(""), []);
  assert.deepEqual(daysMatchingTerm(undefined), []);
});
