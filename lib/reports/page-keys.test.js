// Run with `npm test` (Node's built-in test runner).
//
// Each report page renders its filters and its results as SIBLINGS (both are
// children of <ReportTabs>), each keyed on the same filter values so they
// remount when the filters change. Two siblings must never share a key - React
// warns "Encountered two children with the same key" and can then duplicate or
// drop one of them - so each key carries its role ("filters:" / "results:").

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["../../app/reports/page.js", "../../app/reports/batch/page.js", "../../app/reports/summary/page.js"];

for (const path of PAGES) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const keys = [...source.matchAll(/key=\{`([^`]*)`\}/g)].map((match) => match[1]);

  test(`${path.replace("../../app/", "")}: the filters and the results have different keys`, () => {
    assert.equal(keys.length, 2, "one key on the filters, one on the results boundary");
    assert.equal(new Set(keys).size, keys.length, `duplicate sibling keys: ${keys.join(" | ")}`);
  });

  test(`${path.replace("../../app/", "")}: each key names its role and still follows the filter values`, () => {
    const roles = keys.map((key) => key.split(":")[0]).sort();
    assert.deepEqual(roles, ["filters", "results"]);
    // Same filter values after the role prefix, so a filter change still remounts both.
    const values = keys.map((key) => key.slice(key.indexOf(":") + 1));
    assert.equal(values[0], values[1]);
  });
}
