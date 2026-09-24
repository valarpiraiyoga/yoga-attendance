// Run with `npm test` (Node's built-in test runner).
//
// Batch Identity: the colour palette (stable keys, safe default), the batch
// colour in the form validator, and the identity reaching the schedule cards.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BATCH_COLORS,
  BATCH_COLOR_KEYS,
  DEFAULT_BATCH_COLOR,
  getBatchColor,
  isBatchColor,
  listBatchColors,
} from "./identity.js";
import { validateBatchInput } from "./validation.js";
import { groupSchedulesByBatch } from "../schedules/validation.js";

const VALID = { name: "Hatha Yoga", code: "hyg", category: "", description: "" };

// ---- palette ------------------------------------------------------------

test("the palette is the ten curated colours, keyed by stable names", () => {
  assert.deepEqual(BATCH_COLOR_KEYS, [
    "teal", "blue", "indigo", "purple", "pink", "orange", "amber", "green", "red", "slate",
  ]);
});

test("the default colour is teal, and is in the palette", () => {
  assert.equal(DEFAULT_BATCH_COLOR, "teal");
  assert.ok(isBatchColor(DEFAULT_BATCH_COLOR));
});

test("a palette entry is a label plus static classes - never a raw colour value", () => {
  for (const [key, entry] of Object.entries(BATCH_COLORS)) {
    assert.ok(entry.label && entry.dot && entry.tile && entry.edge && entry.wash && entry.border, key);
    for (const value of Object.values(entry)) {
      assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, `${key} carries a raw colour`);
    }
    // Each entry uses its own colour tokens, so no two keys can look alike.
    assert.match(entry.dot, new RegExp(`batch-${key}\\b`));
  }
});

test("isBatchColor accepts only palette keys", () => {
  assert.equal(isBatchColor("blue"), true);
  for (const bad of ["Blue", "#0f8b87", "", "chartreuse", "toString", "__proto__", null, undefined, 7]) {
    assert.equal(isBatchColor(bad), false, String(bad));
  }
});

test("getBatchColor falls back to teal for a missing or unknown key", () => {
  assert.equal(getBatchColor("purple").label, "Purple");
  assert.equal(getBatchColor(undefined), BATCH_COLORS.teal);
  assert.equal(getBatchColor(null), BATCH_COLORS.teal);
  assert.equal(getBatchColor("removed-colour"), BATCH_COLORS.teal);
});

test("listBatchColors returns every entry, in palette order, with its key", () => {
  const list = listBatchColors();
  assert.deepEqual(list.map((item) => item.key), BATCH_COLOR_KEYS);
  assert.equal(list[1].label, "Blue");
});

test("the database check constraint lists exactly the palette keys", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0023_batch_identity.sql", import.meta.url), "utf8");
  const check = sql.match(/check \(batch_color in \(([^)]*)\)\)/s);
  assert.ok(check, "the migration has a batch_color check");
  const keys = [...check[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(keys, BATCH_COLOR_KEYS);
});

test("the migration defaults existing batches to teal and adds an optional image URL", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0023_batch_identity.sql", import.meta.url), "utf8");
  assert.match(sql, /batch_color text not null default 'teal'/);
  assert.match(sql, /batch_image_url text;/);
});

// ---- validation ---------------------------------------------------------

test("a batch without a colour gets the default teal", () => {
  const result = validateBatchInput(VALID);
  assert.equal(result.success, true);
  assert.equal(result.data.batch_color, "teal");
});

test("a blank colour (an older form, or an untouched field) also defaults to teal", () => {
  assert.equal(validateBatchInput({ ...VALID, batch_color: "" }).data.batch_color, "teal");
  assert.equal(validateBatchInput({ ...VALID, batch_color: "   " }).data.batch_color, "teal");
  assert.equal(validateBatchInput({ ...VALID, batch_color: null }).data.batch_color, "teal");
});

test("every palette key is accepted and saved as itself", () => {
  for (const key of BATCH_COLOR_KEYS) {
    const result = validateBatchInput({ ...VALID, batch_color: key });
    assert.equal(result.success, true, key);
    assert.equal(result.data.batch_color, key);
  }
});

test("a colour that is not in the palette is rejected on the colour field", () => {
  for (const bad of ["#ff0000", "Teal", "neon", "teal; background:red"]) {
    const result = validateBatchInput({ ...VALID, batch_color: bad });
    assert.equal(result.success, false, bad);
    assert.equal(result.errors.batch_color, "Choose a color from the list.");
  }
});

test("a bad colour does not hide other field errors, and vice versa", () => {
  const result = validateBatchInput({ name: "", code: "", batch_color: "neon" });
  assert.equal(result.success, false);
  assert.ok(result.errors.name && result.errors.code && result.errors.batch_color);
});

test("the other fields are still normalised as before", () => {
  const { data } = validateBatchInput({ ...VALID, name: "  Hatha Yoga ", batch_color: "blue" });
  assert.deepEqual(data, {
    name: "Hatha Yoga",
    code: "HYG",
    category: null,
    description: null,
    batch_color: "blue",
  });
});

// ---- identity reaches the Schedule cards ---------------------------------

test("schedule grouping keeps each batch's colour and image for the cards", () => {
  const batch = { id: "b1", name: "Hatha", code: "HYG", batch_color: "indigo", batch_image_url: "https://x/y.png" };
  const groups = groupSchedulesByBatch([
    { id: "s1", batch_id: "b1", day_of_week: "monday", start_time: "06:00", batches: batch },
    { id: "s2", batch_id: "b1", day_of_week: "tuesday", start_time: "06:00", batches: batch },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].batch.batch_color, "indigo");
  assert.equal(groups[0].batch.batch_image_url, "https://x/y.png");
  assert.equal(getBatchColor(groups[0].batch.batch_color).label, "Indigo");
});

test("a batch that predates Batch Identity renders with the default teal", () => {
  const legacy = { id: "b2", name: "Old", code: "OLD" };
  assert.equal(getBatchColor(legacy.batch_color), BATCH_COLORS.teal);
});

// ---- queries return the identity -----------------------------------------

test("the Batches and Schedule queries select the identity columns", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const batches = read("./data.js");
  const schedules = read("../schedules/data.js");

  // list + detail + picker options
  assert.match(batches, /LIST_COLUMNS = "[^"]*batch_color, batch_image_url/);
  assert.match(batches, /DETAIL_COLUMNS =\s*"[^"]*batch_color, batch_image_url/);
  assert.match(batches, /\.select\("id, name, code, batch_color, batch_image_url"\)/);
  // schedule cards, list and group headers share one joined-batch selection
  assert.match(schedules, /batches\([^)]*batch_color, batch_image_url\)/);
});
