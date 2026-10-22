// Run with `npm test` (Node's built-in test runner).
//
// The writes of schedule capacity (S5), run against a fake Supabase client that records every call: new series carry the capacity,
// and a change names ONE series by id - no other series is touched. The database's own refusals (0060) are not simulated here; what is
// tested is what the application sends and how it reads the answer.

import test from "node:test";
import assert from "node:assert/strict";
import * as writes from "./capacity-writes.js";
import { createSeriesRows, readSeriesCapacity, setSeriesCapacity } from "./capacity-writes.js";

// Each awaited query (or maybeSingle) takes the next queued result; every call is recorded in order.
function fakeSupabase(results) {
  const calls = [];
  const queue = [...results];
  const next = () => Promise.resolve(queue.shift());
  const builder = {
    from: (table) => (calls.push(["from", table]), builder),
    select: (...args) => (calls.push(["select", ...args]), builder),
    insert: (...args) => (calls.push(["insert", ...args]), builder),
    update: (...args) => (calls.push(["update", ...args]), builder),
    eq: (...args) => (calls.push(["eq", ...args]), builder),
    maybeSingle: () => (calls.push(["maybeSingle"]), next()),
    then: (resolve, reject) => next().then(resolve, reject),
  };
  return { supabase: builder, calls, remaining: () => queue.length };
}

const quiet = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

// ---- new series -------------------------------------------------------------------------------------------------------------

test("create: every new series carries the capacity entered - six schedules (3 days x 2 slots) all get 20", async () => {
  const { supabase, calls } = fakeSupabase([{ data: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}` })), error: null }]);
  const result = await createSeriesRows(supabase, "batch-1", 6, 20);

  assert.deepEqual(result, { ids: ["s0", "s1", "s2", "s3", "s4", "s5"] });
  assert.deepEqual(calls[0], ["from", "schedule_series"]);
  const [, rows] = calls[1];
  assert.equal(calls[1][0], "insert");
  assert.equal(rows.length, 6);
  for (const row of rows) assert.deepEqual(row, { batch_id: "batch-1", capacity: 20 });
  assert.deepEqual(calls[2], ["select", "id"]);
});

test("create: no capacity (blank) makes every new series unlimited - an explicit null, never a missing value", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [{ id: "a" }, { id: "b" }], error: null }]);
  await createSeriesRows(supabase, "batch-1", 2, null);
  for (const row of calls[1][1]) assert.deepEqual(row, { batch_id: "batch-1", capacity: null });
});

test("create: it writes new series only - it never updates an existing one", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [{ id: "a" }], error: null }]);
  await createSeriesRows(supabase, "batch-1", 1, 5);
  assert.deepEqual(calls.map((c) => c[0]).filter((name) => name === "update" || name === "eq"), []);
});

test("create: a failure, or the wrong number of rows back, is a plain failure and is logged", async () => {
  for (const response of [{ data: null, error: { code: "X", message: "boom" } }, { data: [{ id: "a" }], error: null }]) {
    const { supabase } = fakeSupabase([response]);
    assert.deepEqual(await quiet(() => createSeriesRows(supabase, "batch-1", 2, 5)), { error: true });
  }
});

// ---- one series' capacity -----------------------------------------------------------------------------------------------------

test("set: the update names exactly one series by id and writes only the capacity", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: { capacity: 20 }, error: null }, // the stored value
    { data: [{ id: "series-A" }], error: null }, // the update
  ]);
  const result = await setSeriesCapacity(supabase, "series-A", 25);

  assert.deepEqual(result, { changed: true, previous: 20 });
  const update = calls.findIndex((c) => c[0] === "update");
  assert.deepEqual(calls[update], ["update", { capacity: 25 }]);
  assert.deepEqual(calls[update + 1], ["eq", "id", "series-A"]);
  // Every call touches schedule_series, and every filter is that one id: no other series is reachable.
  assert.deepEqual([...new Set(calls.filter((c) => c[0] === "from").map((c) => c[1]))], ["schedule_series"]);
  assert.deepEqual(calls.filter((c) => c[0] === "eq"), [["eq", "id", "series-A"], ["eq", "id", "series-A"]]);
});

test("set: removing the limit writes null (unlimited)", async () => {
  const { supabase, calls } = fakeSupabase([{ data: { capacity: 20 }, error: null }, { data: [{ id: "s" }], error: null }]);
  assert.deepEqual(await setSeriesCapacity(supabase, "s", null), { changed: true, previous: 20 });
  assert.deepEqual(calls.find((c) => c[0] === "update"), ["update", { capacity: null }]);
});

test("set: the same capacity writes nothing - not even an update", async () => {
  for (const same of [20, null]) {
    const { supabase, calls } = fakeSupabase([{ data: { capacity: same }, error: null }]);
    assert.deepEqual(await setSeriesCapacity(supabase, "s", same), { changed: false, previous: same });
    assert.equal(calls.some((c) => c[0] === "update"), false);
  }
});

test("set: lowering below the places taken is refused by the database and shown on the capacity field, with the numbers", async () => {
  const { supabase } = fakeSupabase([
    { data: { capacity: 20 }, error: null },
    {
      data: null,
      error: { code: "23514", message: "The capacity cannot be lowered to 5 because 12 places are taken. Set it to 12 or more, or end students' assignments first." },
    },
  ]);
  assert.deepEqual(await setSeriesCapacity(supabase, "s", 5), {
    refused: "Capacity can't be lowered to 5: 12 places are taken now. Set it to 12 or more, or end some students' assignments first.",
  });
});

test("set: any other database error is a plain failure - its wording is never returned", async () => {
  const { supabase } = fakeSupabase([{ data: { capacity: 20 }, error: null }, { data: null, error: { code: "42501", message: "permission denied for table schedule_series" } }]);
  const result = await quiet(() => setSeriesCapacity(supabase, "s", 5));
  assert.deepEqual(result, { failed: true });
});

test("set: an update that touched no row (filtered by row-level security) is a failure, not a silent success", async () => {
  const { supabase } = fakeSupabase([{ data: { capacity: 20 }, error: null }, { data: [], error: null }]);
  assert.deepEqual(await quiet(() => setSeriesCapacity(supabase, "s", 5)), { failed: true });
});

test("set: a capacity that cannot be read is a failure, and nothing is written", async () => {
  for (const response of [{ data: null, error: { code: "42703", message: "column schedule_series.capacity does not exist" } }, { data: null, error: null }]) {
    const { supabase, calls } = fakeSupabase([response]);
    assert.deepEqual(await quiet(() => setSeriesCapacity(supabase, "s", 5)), { failed: true });
    assert.equal(calls.some((c) => c[0] === "update"), false);
  }
});

test("read: the stored capacity (null is unlimited), or a failure", async () => {
  assert.deepEqual(await readSeriesCapacity(fakeSupabase([{ data: { capacity: 12 }, error: null }]).supabase, "s"), { capacity: 12 });
  assert.deepEqual(await readSeriesCapacity(fakeSupabase([{ data: { capacity: null }, error: null }]).supabase, "s"), { capacity: null });
  assert.deepEqual(await quiet(() => readSeriesCapacity(fakeSupabase([{ data: null, error: { code: "X", message: "m" } }]).supabase, "s")), { failed: true });
});

test("only the writes the application still makes are exported: the best-effort restore is gone (0061 makes the edits atomic)", () => {
  assert.deepEqual(Object.keys(writes).sort(), ["createSeriesRows", "readSeriesCapacity", "setSeriesCapacity"]);
});
