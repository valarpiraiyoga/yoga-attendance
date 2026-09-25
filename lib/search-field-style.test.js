// Run with `npm test` (Node's built-in test runner).
//
// The search field in a list page's toolbar looks the same on every list page: a white (surface)
// field at the toolbar's 36px control height, not a transparent one that melts into the page.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../app/", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) walk(`${path}/`, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("every list page's toolbar search field is a white 36px field", () => {
  const toolbars = walk(appDir).filter((path) => /-filters\.js$/.test(path) && readFileSync(path, "utf8").includes("<SearchInput"));
  const names = toolbars.map((path) => path.slice(appDir.length).replace(/\\/g, "/")).sort();

  // Students, Batches, Memberships, Schedule, Attendance, Attendance History and Instructors.
  assert.deepEqual(names, [
    "attendance-history/attendance-history-filters.js",
    "attendance/attendance-filters.js",
    "batches/batch-filters.js",
    "memberships/membership-filters.js",
    "schedule/schedule-filters.js",
    "settings/instructors/instructor-filters.js",
    "students/student-filters.js",
  ]);

  for (const path of toolbars) {
    assert.match(readFileSync(path, "utf8"), /inputClassName="h-9 bg-surface"/, path.slice(appDir.length));
  }
});
