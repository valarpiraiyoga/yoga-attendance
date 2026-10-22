// Run with `npm test` (Node's built-in test runner).
//
// Schedule capacity on the application side (S2): places are counted per schedule series with the database's own rule (migration
// 0060), on the centre's date, read in pages. Nothing on the application side reads a batch capacity any more.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_SCHEDULE_CAPACITY,
  OCCUPANCY_PAGE_SIZE,
  countOccupiedPlacesBySeries,
  fetchScheduleCapacities,
  fetchSeriesAssignments,
  isOccupyingAssignment,
  scheduleCapacity,
} from "./capacity.js";
import { todayInCentreTimezone } from "../class-sessions/validation.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TODAY = "2026-10-22";
const as = (series, end, enrollmentStatus = "active", enrollmentEnd = null) => ({
  schedule_series_id: series,
  effective_end_date: end,
  enrollment: { status: enrollmentStatus, effective_end_date: enrollmentEnd },
});

// ---- isOccupyingAssignment ----------------------------------------------------------------------------------------------

test("an open assignment of an active, open enrollment takes a place", () => {
  assert.equal(isOccupyingAssignment(as("x", null), TODAY), true);
});

test("the assignment's end date: ending today takes a place, ending yesterday does not", () => {
  assert.equal(isOccupyingAssignment(as("x", "2026-10-22"), TODAY), true);
  assert.equal(isOccupyingAssignment(as("x", "2026-10-21"), TODAY), false);
  assert.equal(isOccupyingAssignment(as("x", "2027-03-31"), TODAY), true);
});

test("the enrollment's end date: ending today keeps the place, ending yesterday frees it", () => {
  assert.equal(isOccupyingAssignment(as("x", null, "active", "2026-10-22"), TODAY), true);
  assert.equal(isOccupyingAssignment(as("x", null, "active", "2026-10-21"), TODAY), false);
});

test("an inactive enrollment takes no place, whatever the dates", () => {
  assert.equal(isOccupyingAssignment(as("x", null, "inactive"), TODAY), false);
  assert.equal(isOccupyingAssignment(as("x", "2027-01-01", "inactive", "2027-01-01"), TODAY), false);
});

test("a future-dated assignment already takes its place (start dates play no part)", () => {
  assert.equal(isOccupyingAssignment({ ...as("x", null), effective_start_date: "2027-01-01" }, TODAY), true);
  assert.equal(
    isOccupyingAssignment({ ...as("x", null), enrollment: { status: "active", effective_start_date: "2027-01-01", effective_end_date: null } }, TODAY),
    true,
  );
});

test("an inactive student's otherwise qualifying assignment still takes a place (the student's status plays no part)", () => {
  assert.equal(isOccupyingAssignment({ ...as("x", null), enrollment: { status: "active", effective_end_date: null, students: { status: "inactive" } } }, TODAY), true);
});

test("an assignment without its enrollment, or no assignment at all, takes nothing", () => {
  assert.equal(isOccupyingAssignment({ schedule_series_id: "x", effective_end_date: null, enrollment: null }, TODAY), false);
  assert.equal(isOccupyingAssignment(null, TODAY), false);
  assert.equal(isOccupyingAssignment(undefined, TODAY), false);
});

test("the boundary moves with the centre's date, not the UTC date", () => {
  // 2026-10-21T19:00:00Z is already 00:30 on 22 October in Asia/Kolkata.
  const today = todayInCentreTimezone(new Date("2026-10-21T19:00:00Z"), "Asia/Kolkata");
  assert.equal(today, "2026-10-22");
  assert.equal(isOccupyingAssignment(as("x", "2026-10-21"), today), false);
  assert.equal(isOccupyingAssignment(as("x", "2026-10-22"), today), true);
});

// ---- countOccupiedPlacesBySeries ----------------------------------------------------------------------------------------

test("places are counted per series, one per qualifying assignment", () => {
  const occupied = countOccupiedPlacesBySeries(
    [
      as("x", null), // takes a place
      as("x", "2026-10-22"), // ends today: takes a place
      as("x", "2026-10-21"), // ended yesterday
      as("x", null, "inactive"), // enrollment inactive
      as("x", null, "active", "2026-10-01"), // enrollment ended
      as("y", null), // another series
    ],
    TODAY,
  );
  assert.equal(occupied.get("x"), 2);
  assert.equal(occupied.get("y"), 1);
  assert.equal(occupied.has("z"), false);
});

test("an enrollment with several schedules takes one place in each of those series", () => {
  const enrollment = { status: "active", effective_end_date: null };
  const occupied = countOccupiedPlacesBySeries(
    [
      { schedule_series_id: "mon-6am", effective_end_date: null, enrollment },
      { schedule_series_id: "mon-5pm", effective_end_date: null, enrollment },
      { schedule_series_id: "fri-5pm", effective_end_date: null, enrollment },
    ],
    TODAY,
  );
  assert.deepEqual([...occupied], [["mon-6am", 1], ["mon-5pm", 1], ["fri-5pm", 1]]);
});

test("a schedule change effective in the future counts toward both series until the old assignment has ended", () => {
  const enrollment = { status: "active", effective_end_date: null };
  const occupied = countOccupiedPlacesBySeries(
    [
      { schedule_series_id: "old", effective_end_date: "2026-10-28", enrollment }, // closed the day before the change
      { schedule_series_id: "new", effective_end_date: null, effective_start_date: "2026-10-29", enrollment },
    ],
    TODAY,
  );
  assert.equal(occupied.get("old"), 1);
  assert.equal(occupied.get("new"), 1);
});

test("no assignments, or none loaded, count nothing", () => {
  assert.equal(countOccupiedPlacesBySeries([], TODAY).size, 0);
  assert.equal(countOccupiedPlacesBySeries(null, TODAY).size, 0);
});

// ---- scheduleCapacity ----------------------------------------------------------------------------------------------------

test("unlimited (NULL capacity): never full, no places-left number, labelled with the places taken", () => {
  assert.deepEqual(scheduleCapacity(null, 10), { capacity: null, occupied: 10, isUnlimited: true, available: null, isFull: false, label: "10" });
  assert.deepEqual(scheduleCapacity(undefined, 0), { capacity: null, occupied: 0, isUnlimited: true, available: null, isFull: false, label: "0" });
});

test("empty, available and full schedules", () => {
  assert.deepEqual(scheduleCapacity(20, 0), { capacity: 20, occupied: 0, isUnlimited: false, available: 20, isFull: false, label: "0 / 20" });
  assert.deepEqual(scheduleCapacity(20, 19), { capacity: 20, occupied: 19, isUnlimited: false, available: 1, isFull: false, label: "19 / 20" });
  assert.deepEqual(scheduleCapacity(20, 20), { capacity: 20, occupied: 20, isUnlimited: false, available: 0, isFull: true, label: "20 / 20" });
  assert.deepEqual(scheduleCapacity(1, 1), { capacity: 1, occupied: 1, isUnlimited: false, available: 0, isFull: true, label: "1 / 1" });
});

test("over capacity (only if the checks were bypassed) still reads as full, never a negative number of places", () => {
  assert.deepEqual(scheduleCapacity(3, 5), { capacity: 3, occupied: 5, isUnlimited: false, available: 0, isFull: true, label: "5 / 3" });
});

test("a missing or invalid count of places reads as 0", () => {
  assert.equal(scheduleCapacity(5, undefined).occupied, 0);
  assert.equal(scheduleCapacity(5, NaN).occupied, 0);
  assert.equal(scheduleCapacity(5, -2).occupied, 0);
});

// ---- the read, with a fake Supabase client ------------------------------------------------------------------------------

// A fake query builder that records the calls; each awaited query (or range) takes the next queued result.
function fakeSupabase(results) {
  const calls = [];
  const queue = [...results];
  const builder = {
    from: (table) => (calls.push(["from", table]), builder),
    select: (...args) => (calls.push(["select", ...args]), builder),
    in: (...args) => (calls.push(["in", ...args]), builder),
    or: (...args) => (calls.push(["or", ...args]), builder),
    eq: (...args) => (calls.push(["eq", ...args]), builder),
    order: (...args) => (calls.push(["order", ...args]), builder),
    range: (...args) => (calls.push(["range", ...args]), Promise.resolve(queue.shift())),
    then: (resolve, reject) => Promise.resolve(queue.shift()).then(resolve, reject),
  };
  return { supabase: builder, calls };
}

const row = (series, end = null, status = "active", enrollmentEnd = null) => ({
  schedule_series_id: series,
  effective_end_date: end,
  batch_enrollments: { status, effective_end_date: enrollmentEnd },
});

test("read: assignments of the series not ended before today, of an active enrollment, ordered for stable paging", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [row("x")], error: null }]);
  const rows = await fetchSeriesAssignments(supabase, ["x", "y"], TODAY);
  assert.deepEqual(calls, [
    ["from", "enrollment_schedules"],
    ["select", "schedule_series_id, effective_end_date, batch_enrollments!inner(status, effective_end_date)"],
    ["in", "schedule_series_id", ["x", "y"]],
    ["or", "effective_end_date.is.null,effective_end_date.gte.2026-10-22"],
    ["eq", "batch_enrollments.status", "active"],
    ["order", "id", { ascending: true }],
    ["range", 0, OCCUPANCY_PAGE_SIZE - 1],
  ]);
  assert.deepEqual(rows, [{ schedule_series_id: "x", effective_end_date: null, enrollment: { status: "active", effective_end_date: null } }]);
});

test("paging: reads page after page until a short page, so a large series is never cut off", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: [row("x"), row("x")], error: null },
    { data: [row("x"), row("y")], error: null },
    { data: [row("y")], error: null },
  ]);
  const rows = await fetchSeriesAssignments(supabase, ["x", "y"], TODAY, 2);
  assert.equal(rows.length, 5);
  assert.deepEqual(calls.filter((c) => c[0] === "range"), [["range", 0, 1], ["range", 2, 3], ["range", 4, 5]]);
});

test("paging: an exact multiple of the page size ends on the following empty page", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: [row("x"), row("x")], error: null },
    { data: [], error: null },
  ]);
  const rows = await fetchSeriesAssignments(supabase, ["x"], TODAY, 2);
  assert.equal(rows.length, 2);
  assert.equal(calls.filter((c) => c[0] === "range").length, 2);
});

test("an array-shaped embedded enrollment is read as its first element", async () => {
  const { supabase } = fakeSupabase([{ data: [{ schedule_series_id: "x", effective_end_date: null, batch_enrollments: [{ status: "active", effective_end_date: null }] }], error: null }]);
  const [assignment] = await fetchSeriesAssignments(supabase, ["x"], TODAY);
  assert.deepEqual(assignment.enrollment, { status: "active", effective_end_date: null });
});

test("no series asks nothing of the database", async () => {
  const { supabase, calls } = fakeSupabase([]);
  assert.deepEqual(await fetchSeriesAssignments(supabase, [], TODAY), []);
  assert.equal((await fetchScheduleCapacities(supabase, [], TODAY)).size, 0);
  assert.equal((await fetchScheduleCapacities(supabase, null, TODAY)).size, 0);
  assert.deepEqual(calls, []);
});

test("capacities: each series' capacity against its places taken, the enrollment end date judged by the one rule", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: [{ id: "x", capacity: 2 }, { id: "y", capacity: null }, { id: "z", capacity: 5 }], error: null },
    {
      data: [
        row("x"),
        row("x"),
        row("y"),
        row("y", null, "active", "2026-10-21"), // enrollment ended yesterday: the query cannot see that, the rule does
      ],
      error: null,
    },
  ]);
  const capacities = await fetchScheduleCapacities(supabase, ["x", "y", "z", "x"], TODAY);
  assert.deepEqual(calls.slice(0, 3), [["from", "schedule_series"], ["select", "id, capacity"], ["in", "id", ["x", "y", "z"]]]);
  assert.deepEqual(capacities.get("x"), { capacity: 2, occupied: 2, isUnlimited: false, available: 0, isFull: true, label: "2 / 2" });
  assert.deepEqual(capacities.get("y"), { capacity: null, occupied: 1, isUnlimited: true, available: null, isFull: false, label: "1" });
  assert.deepEqual(capacities.get("z"), { capacity: 5, occupied: 0, isUnlimited: false, available: 5, isFull: false, label: "0 / 5" });
});

test("a failed read surfaces as a plain message", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(fetchSeriesAssignments(fakeSupabase([{ data: null, error: { code: "X", message: "boom" } }]).supabase, ["x"], TODAY), /Could not load schedule capacity\./);
    await assert.rejects(fetchScheduleCapacities(fakeSupabase([{ data: null, error: { code: "X", message: "boom" } }]).supabase, ["x"], TODAY), /Could not load schedule capacity\./);
  } finally {
    console.error = original;
  }
});

// ---- the same rule as migration 0060 -------------------------------------------------------------------------------------

test("MAX_SCHEDULE_CAPACITY is the upper bound of schedule_series_capacity_valid in migration 0060", () => {
  const match = /schedule_series_capacity_valid\s+check \(capacity is null or capacity between 1 and (\d+)\)/.exec(read("../../supabase/migrations/0060_schedule_capacity.sql"));
  assert.ok(match, "the 0060 capacity constraint");
  assert.equal(MAX_SCHEDULE_CAPACITY, Number(match[1]));
});

test("the rule matches 0060's schedule_series_occupied_places, condition for condition", () => {
  const sql = read("../../supabase/migrations/0060_schedule_capacity.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.schedule_series_occupied_places"), sql.indexOf("$$;", sql.indexOf("create or replace function public.schedule_series_occupied_places")));
  assert.match(fn, /\(es\.effective_end_date is null or es\.effective_end_date >= p_today\)/);
  assert.match(fn, /be\.status = 'active'/);
  assert.match(fn, /\(be\.effective_end_date is null or be\.effective_end_date >= p_today\)/);

  const capacity = code("./capacity.js");
  assert.match(capacity, /const isCurrent = \(endDate, today\) => !endDate \|\| endDate >= today;/);
  assert.match(capacity, /if \(!enrollment \|\| enrollment\.status !== "active"\) return false;/);
  assert.match(capacity, /return isCurrent\(assignment\.effective_end_date, today\) && isCurrent\(enrollment\.effective_end_date, today\);/);
  // The student, memberships, payments and attendance are never read; no Next.js or server import.
  assert.doesNotMatch(capacity, /students|membership|payment|attendance|import /i);
});

test("the server wrapper is Admin only and uses the centre's date (getCentreToday), never the UTC date", () => {
  const wrapper = code("./capacity-data.js");
  assert.match(wrapper, /import "server-only";/);
  assert.match(wrapper, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(wrapper, /fetchScheduleCapacities\(await createClient\(\), seriesIds, await getCentreToday\(\)\)/);
  assert.doesNotMatch(wrapper, /new Date\(|toISOString/);
});

// ---- no batch capacity left in the application ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.js$/.test(name) && !/\.test\.js$/.test(name) ? [path] : [];
  });
}

test("no application code reads or computes a batch capacity (0060 removes batches.capacity)", () => {
  const files = ["app", "lib", "components"].flatMap(sourceFiles);
  assert.ok(files.length > 50, "the source tree was read");
  for (const path of files) {
    const text = readFileSync(join(ROOT, path), "utf8");
    assert.doesNotMatch(text, /batches?\.capacity|batchCapacity|capacityInfo|listEnrollmentBatchOptions|MAX_BATCH_CAPACITY|lib\/batches\/capacity/, path);
  }
  const batches = code("../batches/data.js");
  assert.doesNotMatch(batches, /capacity/);
});
