// Run with `npm test` (Node's built-in test runner).
//
// Batch Details' Active Students (01-product.md §6 "Active Students"): one definition and one count for the summary card and the Students heading.
// The count is a pure function, tested by running it; how the page and the section use it is pinned from source (they need the Next.js runtime).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countActiveEnrollments, isActiveEnrollment } from "./active-students.js";

const dir = "../../app/batches/[id]";
const code = (path) =>
  readFileSync(new URL(`${dir}/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const enrollment = (status, id = status) => ({ id, status, students: { full_name: `Student ${id}` } });

test("only an enrollment whose status is active counts", () => {
  assert.equal(isActiveEnrollment(enrollment("active")), true);
  assert.equal(isActiveEnrollment(enrollment("inactive")), false);
  assert.equal(isActiveEnrollment({}), false);
  assert.equal(isActiveEnrollment(null), false);
  assert.equal(isActiveEnrollment(undefined), false);
});

test("the count is the number of active enrollments: inactive ones are left out", () => {
  const list = [enrollment("active", "1"), enrollment("inactive", "2"), enrollment("active", "3"), enrollment("inactive", "4"), enrollment("inactive", "5")];
  assert.equal(countActiveEnrollments(list), 2);
  assert.equal(list.length, 5, "all five stay in the list the table shows");
});

test("an empty, all-inactive or missing list counts zero", () => {
  assert.equal(countActiveEnrollments([]), 0);
  assert.equal(countActiveEnrollments([enrollment("inactive", "1"), enrollment("inactive", "2")]), 0);
  assert.equal(countActiveEnrollments(null), 0);
  assert.equal(countActiveEnrollments(undefined), 0);
});

test("the count is always taken from the whole list, so a search or status filter (which narrows only the rows shown) cannot change it", () => {
  const all = [enrollment("active", "1"), enrollment("inactive", "2"), enrollment("active", "3")];
  const shownAfterInactiveFilter = all.filter((row) => row.status === "inactive");
  assert.equal(countActiveEnrollments(all), 2);
  assert.equal(countActiveEnrollments(shownAfterInactiveFilter), 0, "which is why the page counts the full list and passes the number down");
});

test("the Students heading shows the active-student count, computed once from the full list", () => {
  const page = code("page.js");
  // One count, computed once from the full list ...
  assert.equal((page.match(/countActiveEnrollments\(/g) ?? []).length, 1);
  assert.match(page, /const activeStudentCount = countActiveEnrollments\(enrollments\);/);
  // ... (the KPI summary cards are gone from Batch Details) ...
  assert.doesNotMatch(page, /<StatTile|label="Active Students"/);
  assert.ok(!page.includes("Students Enrolled"), "the old label is gone");
  // ... and handed to the Students section, whose heading shows it.
  assert.match(page, /<BatchStudentsSection\s+enrollments=\{enrollments\}\s+activeCount=\{activeStudentCount\}/);
  const section = code("batch-students-section.js");
  assert.match(section, /export default function BatchStudentsSection\(\{ enrollments, activeCount, assignments = null, schedules = \[\] \}\)/);
  assert.ok(section.includes("title={`Active Students (${activeCount})`}"));
});

test("the section does not count for itself, and still lists every enrollment and filters only the rows", () => {
  const section = code("batch-students-section.js");
  assert.ok(!section.includes("${enrollments.length}"), "no count of its own is shown (enrollments.length only decides the empty state)");
  assert.ok(!/title=\{`Students \(/.test(section), "the old heading is gone");
  assert.match(section, /const visible = useMemo\(\(\) => \{[\s\S]*enrollments\.filter\(/, "the rows are the filtered full list");
  assert.ok(section.includes('<Badge variant={status.variant}>{status.label}</Badge>'), "each row keeps its own status badge (Inactive stays marked)");
  assert.ok(section.includes("groupStudentsBySession({ enrollments: visible, assignments, schedules })"), "rows are the filtered enrollments, active and inactive, grouped by session");
});
