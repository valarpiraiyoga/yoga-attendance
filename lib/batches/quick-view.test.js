// Run with `npm test`. The Batches list quick view needs the Next.js runtime, so its wiring is pinned from source (the project's way);
// the panel's look and behaviour are not proved here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the batch name opens a right-hand quick view with a View Details button to Batch Details; it reads only the row's own data", () => {
  const view = code("app/batches/batch-quick-view.js");
  assert.match(view, /^"use client";/);
  assert.ok(view.includes('<SheetContent side="right"'));
  assert.ok(view.includes("onClick={() => setOpen(true)}"));
  assert.ok(view.includes("href={`/batches/${batch.id}`}") && view.includes("View Details"));
  assert.doesNotMatch(view, /fetch\(|supabase|"use server"/, "no read or write of its own");
});

test("table rows and cards use the quick view for the name; the table's Actions has the eye icon to Batch Details beside the menu", () => {
  const table = code("app/batches/batch-table.js");
  assert.ok(table.includes("<BatchQuickView batch={batch} />"));
  assert.ok(table.includes("aria-label={`View batch ${batch.name}`}") && table.includes("render={<Link href={`/batches/${batch.id}`} />}"));
  assert.ok(table.indexOf("<Eye") < table.indexOf("<BatchCardMenu"), "the eye, then the menu");
  assert.ok(code("app/batches/batch-card-item.js").includes("title={<BatchQuickView batch={batch} />}"));
});
