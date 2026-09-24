// Run with `npm test` (Node's built-in test runner).
//
// Schedule List → Cards view: one card per batch, its schedules as rows
// inside it, instead of one card per schedule record
// (app/schedule/schedule-batch-group-card.js). `groupSchedulesByBatch`
// (lib/schedules/validation.js) is the pure regrouping step this depends on
// — it must never drop, merge or deduplicate a schedule record, must not
// reorder which batch appears first (that stays whatever the existing
// Newest/Oldest-First sort already produced), and must order each batch's
// own rows Monday → Sunday, then start time.

import test from "node:test";
import assert from "node:assert/strict";
import { groupSchedulesByBatch } from "./validation.js";

function schedule(overrides) {
  return {
    id: "s0",
    batch_id: "b0",
    batches: { id: "b0", name: "Batch", code: "BAT", status: "active" },
    day_of_week: "monday",
    start_time: "06:00:00",
    end_time: "07:00:00",
    instructors: { id: "i0", full_name: "Instructor" },
    ...overrides,
  };
}

const CHILDREN_YOGA = { id: "b-cy", name: "Children Yoga", code: "CH", status: "active" };
const HATHA_YOGA = { id: "b-hy", name: "Hatha Yoga General", code: "HYG", status: "active" };

test("a batch with one schedule produces one group with one row", () => {
  const groups = groupSchedulesByBatch([
    schedule({ id: "s1", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "monday" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].batchId, CHILDREN_YOGA.id);
  assert.equal(groups[0].schedules.length, 1);
});

test("a batch with three schedules on different days groups into one card with three rows, none merged", () => {
  const input = [
    schedule({ id: "s-mon", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "monday", start_time: "17:00:00" }),
    schedule({ id: "s-wed", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "wednesday", start_time: "17:00:00" }),
    schedule({ id: "s-fri", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "friday", start_time: "17:00:00" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].schedules.map((s) => s.id),
    ["s-mon", "s-wed", "s-fri"]
  );
});

test("REGRESSION: two schedules on the same day (e.g. Tuesday 6-7 and 7-8) both remain distinct rows, never merged or deduplicated", () => {
  const input = [
    schedule({ id: "s-tue-1", batch_id: HATHA_YOGA.id, batches: HATHA_YOGA, day_of_week: "tuesday", start_time: "06:00:00" }),
    schedule({ id: "s-tue-2", batch_id: HATHA_YOGA.id, batches: HATHA_YOGA, day_of_week: "tuesday", start_time: "07:00:00" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].schedules.length, 2);
  assert.deepEqual(
    groups[0].schedules.map((s) => s.id),
    ["s-tue-1", "s-tue-2"]
  );
});

test("multiple instructors on the same batch are preserved per row, not collapsed to one", () => {
  const input = [
    schedule({ id: "s1", batch_id: "b1", batches: { id: "b1", name: "Batch", code: "B1" }, day_of_week: "monday", instructors: { full_name: "Kannan Thangavel" } }),
    schedule({ id: "s2", batch_id: "b1", batches: { id: "b1", name: "Batch", code: "B1" }, day_of_week: "tuesday", instructors: { full_name: "Priya Sharma" } }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.equal(groups[0].schedules[0].instructors.full_name, "Kannan Thangavel");
  assert.equal(groups[0].schedules[1].instructors.full_name, "Priya Sharma");
});

test("REGRESSION: grouping never drops, merges, or duplicates records — record count is conserved exactly", () => {
  const input = [
    schedule({ id: "s1", batch_id: "b1", batches: { id: "b1", name: "A" } }),
    schedule({ id: "s2", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "tuesday" }),
    schedule({ id: "s3", batch_id: "b2", batches: { id: "b2", name: "B" } }),
    schedule({ id: "s4", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "friday" }),
    schedule({ id: "s5", batch_id: "b3", batches: { id: "b3", name: "C" } }),
  ];
  const groups = groupSchedulesByBatch(input);
  const totalRows = groups.reduce((sum, g) => sum + g.schedules.length, 0);
  assert.equal(totalRows, input.length);

  const idsIn = new Set(input.map((s) => s.id));
  const idsOut = new Set(groups.flatMap((g) => g.schedules.map((s) => s.id)));
  assert.deepEqual(idsOut, idsIn, "every input id appears exactly once across all groups");
});

test("batch (card) order follows first appearance in the input — the caller's existing sort decides it, grouping does not re-sort batches", () => {
  // Simulates "Oldest First" (effective_from ascending) already having put
  // batch B's row before batch A's in the flat, pre-grouped list.
  const input = [
    schedule({ id: "s-b-1", batch_id: "b-B", batches: { id: "b-B", name: "B" }, effective_from: "2026-01-01" }),
    schedule({ id: "s-a-1", batch_id: "b-A", batches: { id: "b-A", name: "A" }, effective_from: "2026-02-01" }),
    schedule({ id: "s-b-2", batch_id: "b-B", batches: { id: "b-B", name: "B" }, day_of_week: "tuesday", effective_from: "2026-01-01" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.deepEqual(
    groups.map((g) => g.batchId),
    ["b-B", "b-A"],
    "B appears first because its schedule appeared first in the already-sorted input"
  );
});

test("within a batch, rows are ordered Monday -> Sunday regardless of input order", () => {
  const input = [
    schedule({ id: "s-fri", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "friday" }),
    schedule({ id: "s-mon", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "monday" }),
    schedule({ id: "s-wed", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "wednesday" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.deepEqual(
    groups[0].schedules.map((s) => s.day_of_week),
    ["monday", "wednesday", "friday"]
  );
});

test("within a batch and day, rows are ordered by start time ascending", () => {
  const input = [
    schedule({ id: "s-late", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "tuesday", start_time: "07:00:00" }),
    schedule({ id: "s-early", batch_id: "b1", batches: { id: "b1", name: "A" }, day_of_week: "tuesday", start_time: "06:00:00" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.deepEqual(
    groups[0].schedules.map((s) => s.id),
    ["s-early", "s-late"]
  );
});

test("a batch with many schedules (e.g. all 6 weekday variants) keeps every one, none truncated", () => {
  const input = [
    "monday",
    "tuesday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ].map((day, index) =>
    schedule({ id: `s${index}`, batch_id: "b1", batches: { id: "b1", name: "Hatha Yoga General" }, day_of_week: day, start_time: index === 2 ? "07:00:00" : "06:00:00" })
  );
  const groups = groupSchedulesByBatch(input);
  assert.equal(groups[0].schedules.length, 6);
});

test("grouping runs on whatever list it's given — already-searched/filtered results group correctly without re-fetching", () => {
  // Simulates the server already having filtered to only "Children Yoga"
  // matches (search-before-group, per the existing search contract).
  const input = [
    schedule({ id: "s1", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "monday" }),
    schedule({ id: "s2", batch_id: CHILDREN_YOGA.id, batches: CHILDREN_YOGA, day_of_week: "wednesday" }),
  ];
  const groups = groupSchedulesByBatch(input);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].batch.name, "Children Yoga");
});

test("an empty list produces no groups (EmptyState territory, not an error)", () => {
  assert.deepEqual(groupSchedulesByBatch([]), []);
});
