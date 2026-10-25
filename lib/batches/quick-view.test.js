// Run with `npm test` (Node's built-in test runner).
//
// Batches list: no Quick View. The batch name is a plain link to Batch Details (table and cards), and the eye icon beside the menu
// goes to the same page. Checked as source (the project has no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_FILES = ["app/batches/batch-table.js", "app/batches/batch-card-item.js", "app/batches/batch-list.js"].filter((path) => existsSync(new URL(`../../${path}`, import.meta.url)));

test("Quick View is gone from the Batches list", () => {
  assert.ok(!existsSync(new URL("../../app/batches/batch-quick-view.js", import.meta.url)));
  for (const path of LIST_FILES) assert.doesNotMatch(code(path), /QuickView|quick-view/, path);
});

test("the batch name links to Batch Details in the table and the cards", () => {
  for (const path of ["app/batches/batch-table.js", "app/batches/batch-card-item.js"]) {
    assert.match(code(path), /<Link href=\{`\/batches\/\$\{batch\.id\}`\}[^>]*>\s*\{batch\.name\}\s*<\/Link>/, path);
  }
});

test("the eye icon beside the menu still goes to Batch Details", () => {
  const table = code("app/batches/batch-table.js");
  assert.ok(table.includes("aria-label={`View batch ${batch.name}`}") && table.includes("render={<Link href={`/batches/${batch.id}`} />}"));
  assert.ok(table.indexOf("<Eye") < table.indexOf("<BatchCardMenu"), "the eye, then the menu");
});
