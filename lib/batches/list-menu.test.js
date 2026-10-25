// Run with `npm test` (Node's built-in test runner).
//
// Batches list (table and cards): the More menu is View Batch and Edit Batch only, each with an icon. The Schedule page's batch cards
// share the menu component and keep View Students / View Schedule. The component is checked as source (no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const menu = code("app/batches/batch-card-menu.js");

test("View Batch and Edit Batch keep their routes and each leads with an icon in the list menu", () => {
  assert.match(menu, /<Link href=\{`\/batches\/\$\{batchId\}`\} \/>\} nativeButton=\{false\}>\s*\{listActions \? <Eye aria-hidden="true" \/> : null\}\s*View Batch/);
  assert.match(menu, /<Link href=\{`\/batches\/\$\{batchId\}\/edit`\} \/>\} nativeButton=\{false\}>\s*\{listActions \? <Pencil aria-hidden="true" \/> : null\}\s*Edit Batch/);
});

test("View Students and View Schedule are left out of the list menu (listActions) and kept for the Schedule page", () => {
  assert.match(menu, /\{listActions \? null : \(\s*<>[\s\S]*View Students[\s\S]*View Schedule[\s\S]*<\/>\s*\)\}/);
  assert.ok(menu.includes("/batches/${batchId}/students") && menu.includes("/batches/${batchId}/schedules"), "the routes still exist for the full menu");
});

test("the table and the cards use the list menu; the Schedule page's cards do not", () => {
  for (const path of ["app/batches/batch-table.js", "app/batches/batch-card-item.js"]) {
    assert.match(code(path), /<BatchCardMenu[^>]*\blistActions\b/, path);
  }
  assert.doesNotMatch(code("app/schedule/schedule-batch-group-card.js"), /listActions/);
});

test("the eye icon button next to the menu still goes to Batch Details", () => {
  for (const path of ["app/batches/batch-table.js", "app/batches/batch-card-item.js"]) {
    const source = code(path);
    assert.ok(source.includes("render={<Link href={`/batches/${batch.id}`} />}") && source.includes("<Eye "), path);
  }
});
