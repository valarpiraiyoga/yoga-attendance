// Run with `npm test` (Node's built-in test runner).
//
// Documents register KPI tiles: the center-wide figures (Total, Issued, Cancelled, Issued Value). The query runs against a fake
// query builder that records every call; the tiles and the page wiring are pinned from source - the project's way for screens.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchDocumentSummary, sumIssuedValue } from "./list-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) =>
  source(path)
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function fakeSupabase(results) {
  const calls = [];
  const queue = [...results];
  const builder = {
    from: (table) => (calls.push(["from", table]), builder),
    select: (...args) => (calls.push(["select", ...args]), builder),
    eq: (...args) => (calls.push(["eq", ...args]), builder),
    order: (...args) => (calls.push(["order", ...args]), builder),
    range: (...args) => (calls.push(["range", ...args]), Promise.resolve(queue.shift())),
    then: (resolve, reject) => Promise.resolve(queue.shift()).then(resolve, reject),
  };
  return { supabase: builder, calls };
}

const counts = (total, issued, cancelled) => [
  { count: total, error: null },
  { count: issued, error: null },
  { count: cancelled, error: null },
];

// ---- adding up ----------------------------------------------------------------------------------------------------------

test("issued value: added in paise, so decimals never drift", () => {
  const rows = [
    { total_amount: "0.10", currency: "INR" },
    { total_amount: "0.20", currency: "INR" },
    { total_amount: 1500, currency: "INR" },
  ];
  assert.deepEqual(sumIssuedValue(rows), [{ currency: "INR", amount: 1500.3 }]);
});

test("issued value: currencies are never added together; the largest comes first", () => {
  const rows = [
    { total_amount: 100, currency: "USD" },
    { total_amount: 2000, currency: "INR" },
    { total_amount: 50, currency: "USD" },
  ];
  assert.deepEqual(sumIssuedValue(rows), [
    { currency: "INR", amount: 2000 },
    { currency: "USD", amount: 150 },
  ]);
});

test("issued value: no issued documents is an empty list", () => {
  assert.deepEqual(sumIssuedValue([]), []);
});

// ---- the query ----------------------------------------------------------------------------------------------------------

test("summary: total, issued and cancelled are head counts on invoices; the value reads issued documents only", async () => {
  const { supabase, calls } = fakeSupabase([
    ...counts(5, 3, 2),
    { data: [{ total_amount: 1000, currency: "INR" }, { total_amount: 500, currency: "INR" }, { total_amount: 250, currency: "INR" }], error: null },
  ]);
  const summary = await fetchDocumentSummary(supabase);

  assert.deepEqual(summary, { total: 5, issued: 3, cancelled: 2, issuedValue: [{ currency: "INR", amount: 1750 }] });
  assert.ok(calls.filter((c) => c[0] === "from").every((c) => c[1] === "invoices"));
  assert.equal(calls.filter((c) => c[0] === "select" && c[2]?.head === true && c[2]?.count === "exact").length, 3);
  assert.deepEqual(calls.filter((c) => c[0] === "eq"), [
    ["eq", "status", "issued"],
    ["eq", "status", "cancelled"],
    ["eq", "status", "issued"],
  ]);
  assert.deepEqual(calls.find((c) => c[0] === "select" && c[1] === "total_amount, currency"), ["select", "total_amount, currency"]);
});

test("summary: cancelled documents never reach the value (the amounts read is filtered to issued)", async () => {
  const { supabase, calls } = fakeSupabase([...counts(2, 1, 1), { data: [{ total_amount: 100, currency: "INR" }], error: null }]);
  await fetchDocumentSummary(supabase);
  const amountsRead = calls.slice(calls.findIndex((c) => c[0] === "select" && c[1] === "total_amount, currency"));
  assert.ok(amountsRead.some((c) => c[0] === "eq" && c[1] === "status" && c[2] === "issued"));
  assert.ok(!amountsRead.some((c) => c[0] === "eq" && c[2] === "cancelled"));
});

test("summary: the value is read in batches until a short batch, so a large register is never cut off", async () => {
  const batch = (n) => ({ data: Array.from({ length: n }, () => ({ total_amount: 1, currency: "INR" })), error: null });
  const { supabase, calls } = fakeSupabase([...counts(5, 5, 0), batch(2), batch(2), batch(1)]);
  const summary = await fetchDocumentSummary(supabase, 2);
  assert.deepEqual(calls.filter((c) => c[0] === "range"), [
    ["range", 0, 1],
    ["range", 2, 3],
    ["range", 4, 5],
  ]);
  assert.deepEqual(summary.issuedValue, [{ currency: "INR", amount: 5 }]);
});

test("summary: an empty register is all zeros", async () => {
  const { supabase } = fakeSupabase([...counts(0, 0, 0), { data: [], error: null }]);
  assert.deepEqual(await fetchDocumentSummary(supabase), { total: 0, issued: 0, cancelled: 0, issuedValue: [] });
});

test("summary: a failed count or a failed read surfaces as a plain message", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const failedCount = fakeSupabase([{ count: null, error: { code: "42501", message: "denied" } }, ...counts(0, 0, 0).slice(1)]);
    await assert.rejects(fetchDocumentSummary(failedCount.supabase), /Could not load the document summary\./);
    const failedRead = fakeSupabase([...counts(1, 1, 0), { data: null, error: { code: "57014", message: "timeout" } }]);
    await assert.rejects(fetchDocumentSummary(failedRead.supabase), /Could not load the document summary\./);
  } finally {
    console.error = original;
  }
});

test("summary: read-only - no write and no rpc", async () => {
  const { supabase, calls } = fakeSupabase([...counts(0, 0, 0), { data: [], error: null }]);
  await fetchDocumentSummary(supabase);
  assert.ok(!calls.some((c) => ["insert", "update", "delete", "upsert", "rpc"].includes(c[0])));
});

// ---- the tiles and the wiring ---------------------------------------------------------------------------------------------

const TILES = code("../../app/documents/document-summary.js");
const PAGE = code("../../app/documents/page.js");

test("tiles: the four approved labels, on the shared KPI tile, and never a revenue or payments label", () => {
  for (const label of ["Total Documents", "Issued", "Cancelled", "Issued Value"]) {
    assert.match(TILES, new RegExp(`label="${label}"`));
  }
  assert.match(TILES, /from "@\/components\/ui\/stat-tile"/);
  assert.match(TILES, /<StatTileGroup/);
  assert.doesNotMatch(TILES, /revenue|collected|payments/i);
});

test("tiles: a failed summary shows a dash instead of taking the page down", () => {
  assert.match(TILES, /summary \? summary\.total : UNAVAILABLE/);
  assert.match(PAGE, /getDocumentSummary\(\)\.catch\(\(error\) => \{\s+unstable_rethrow\(error\);\s+return null;/);
});

test("page: the tiles sit above the toolbar, and the summary is Admin only like the list", () => {
  assert.ok(PAGE.indexOf("<DocumentSummary") > 0);
  assert.ok(PAGE.indexOf("<DocumentSummary") < PAGE.indexOf("<DocumentFilters"));
  const data = code("./data.js");
  const getSummary = data.slice(data.indexOf("export async function getDocumentSummary"));
  assert.match(getSummary, /^export async function getDocumentSummary\(\) \{\s+await requireRole\(ROLES\.ADMIN\);/);
});
