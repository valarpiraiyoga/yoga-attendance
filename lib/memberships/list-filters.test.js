// Run with `npm test` (Node's built-in test runner).
//
// FS-6 step 7: the Memberships list Plan filter. A legacy plan still filters on the `plan` column, exactly as before; a package
// filters on `package_id`, so a legacy membership with the same duration plan is never matched. The query is checked with a
// recording fake; the wiring (page, data, filter component) is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPlanFilter, parsePackageFilter, planFilterParams, planFilterValue, PLAN_VALUES } from "./list-filters.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const PACKAGE = "6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6";

function recordingQuery() {
  const calls = [];
  const query = { calls, eq: (column, value) => { calls.push([column, value]); return query; } };
  return query;
}

test("a legacy plan filters on the plan column, as before; \"all\" filters nothing", () => {
  for (const plan of PLAN_VALUES) {
    const query = recordingQuery();
    applyPlanFilter(query, { plan });
    assert.deepEqual(query.calls, [["plan", plan]], plan);
  }
  const none = recordingQuery();
  applyPlanFilter(none, {});
  applyPlanFilter(none, { plan: "all", packageId: "" });
  assert.deepEqual(none.calls, []);
});

test("a package filters on package_id, never on the plan column, so a legacy membership of the same duration is not matched", () => {
  const query = recordingQuery();
  applyPlanFilter(query, { plan: "all", packageId: PACKAGE });
  assert.deepEqual(query.calls, [["package_id", PACKAGE]]);
});

test("the control chooses a plan or a package, never both", () => {
  assert.deepEqual(planFilterParams("quarterly"), { plan: "quarterly", package: null });
  assert.deepEqual(planFilterParams("class_count"), { plan: "class_count", package: null });
  assert.deepEqual(planFilterParams("all"), { plan: null, package: null });
  assert.deepEqual(planFilterParams(`package:${PACKAGE}`), { plan: null, package: PACKAGE });
  assert.deepEqual(planFilterParams("package:not-an-id"), { plan: null, package: null });
  assert.deepEqual(planFilterParams("weekly"), { plan: null, package: null });

  assert.equal(planFilterValue({ plan: "monthly", packageId: "" }), "monthly");
  assert.equal(planFilterValue({ plan: "monthly", packageId: PACKAGE }), `package:${PACKAGE}`, "a package wins over a plan");
  assert.equal(planFilterValue(), "all");
});

test("an invented or malformed package value filters nothing", () => {
  assert.equal(parsePackageFilter(PACKAGE.toUpperCase()), PACKAGE);
  for (const value of [undefined, null, "", "x", `${PACKAGE}'; drop`, ["a"], 42]) assert.equal(parsePackageFilter(value), "", String(value));
});

test("the list: the page reads the package param, the query applies it, and the existing filters are untouched", () => {
  const page = code("../../app/memberships/page.js");
  assert.match(page, /const packageId = parsePackageFilter\(rawParams\.package\);/);
  assert.match(page, /const plan = !packageId && PLANS\.includes\(rawParams\.plan\) \? rawParams\.plan : "all";/);
  assert.match(page, /packageId,\s*paymentStatus,/);
  for (const param of ["rawParams.payment", "rawParams.status", "rawParams.from", "rawParams.to", "rawParams.q", "rawParams.page", "rawParams.sort"]) {
    assert.ok(page.includes(param), param + " is still read");
  }
  const data = code("./data.js");
  assert.match(data, /query = applyPlanFilter\(query, \{ plan, packageId \}\);/);
  assert.doesNotMatch(data, /query\.eq\("plan", plan\)/, "the plan filter now goes through applyPlanFilter, which keeps it");
  assert.match(data, /\.range\(from, to\)/, "pagination is untouched");
  assert.match(data, /query\.or\(orParts\.join/, "search is untouched");
});

test("the filter control keeps every legacy plan option and adds the active packages; the URL gets one of plan or package", () => {
  const filters = code("../../app/memberships/membership-filters.js");
  for (const option of ["All Plans", "Monthly", "Quarterly", "Half Yearly", "Annual", "Custom duration", "Class Count"]) {
    assert.ok(filters.includes(`label: "${option}"`), option + " is unchanged");
  }
  assert.match(filters, /pkg\.status === "active" \|\| pkg\.id === defaultPackageId/, "active packages, and the applied one even if deactivated");
  assert.match(filters, /label: `Package: \$\{pkg\.name\}`/);
  assert.match(filters, /const chosen = planFilterParams\(plan\);/);
  assert.match(filters, /if \(key === "plan"\) params\.delete\("package"\);/, "removing the chip clears both params");
  assert.match(code("../../app/memberships/page.js"), /getPackages\(\)/);
});
