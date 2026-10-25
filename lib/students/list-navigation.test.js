// Run with `npm test` (Node's built-in test runner).
//
// Students list: the student's name is a plain link to Student Details (table and cards), and there is no Quick View.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = ["student-table.js", "student-card-item.js", "student-card-menu.js", "student-list.js"].map((name) => `app/students/${name}`);

test("the student's name links to Student Details in the table and the cards", () => {
  for (const path of ["app/students/student-table.js", "app/students/student-card-item.js"]) {
    assert.match(code(path), /<Link href=\{`\/students\/\$\{student\.id\}`\}[^>]*>\s*\{student\.full_name\}\s*<\/Link>/, path);
  }
});

test("Quick View is gone from the Students list and its menu", () => {
  for (const path of FILES) assert.doesNotMatch(code(path), /Quick ?View|quick-view|onQuickView/i, path);
  assert.doesNotMatch(code("app/students/student-card-menu.js"), /Quick/);
});

test("an eye icon beside the More menu links to Student Details with an accessible label and tooltip", () => {
  for (const path of ["app/students/student-table.js", "app/students/student-card-item.js"]) {
    assert.ok(code(path).includes("<StudentViewButton student={student} />"), path);
  }
  const button = code("app/students/student-view-button.js");
  assert.ok(button.includes("href={`/students/${student.id}`}"));
  assert.ok(button.includes("aria-label={`View student details for ${student.full_name}`}"));
  assert.ok(button.includes('title="View student details"'));
  assert.ok(button.includes("<Eye "));
});

// The list's menu is the `listActions` branch of the shared menu; the Student Details header keeps the full one.
const listMenu = () => {
  const menu = code("app/students/student-card-menu.js");
  const start = menu.indexOf("{listActions ? (");
  // The branch ends with the disabled Renew Membership item (no membership).
  return menu.slice(start, menu.indexOf("Renew Membership", menu.indexOf("<DropdownMenuItem disabled>", start)) + "Renew Membership".length);
};

test("the list's More menu is exactly View, Edit, a divider, Add Membership and Renew Membership - in that order, with icons", () => {
  const menu = listMenu();
  const labels = [...menu.matchAll(/^\s+(View Student|Edit Student|Add Membership|Renew Membership|View Membership|Add Batch|Edit Batch)$/gm)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 4), ["View Student", "Edit Student", "Add Membership", "Renew Membership"]);
  assert.equal(new Set(labels).size, 4, "nothing else");
  assert.equal((menu.match(/<DropdownMenuSeparator \/>/g) ?? []).length, 1);
  assert.ok(menu.indexOf("Edit Student") < menu.indexOf("<DropdownMenuSeparator />") && menu.indexOf("<DropdownMenuSeparator />") < menu.indexOf("Add Membership"));
  for (const icon of ["<Eye ", "<Pencil ", "<CreditCard ", "<RefreshCw "]) assert.ok(menu.includes(icon), icon);
  assert.doesNotMatch(menu, /View Membership|Add Batch|Edit Batch|Quick/);
});

test("the menu actions use the existing routes", () => {
  const menu = listMenu();
  assert.ok(menu.includes("href={`/students/${studentId}`}"));
  assert.ok(menu.includes("href={`/students/${studentId}/edit`}"));
  assert.ok(menu.includes("href={`/students/${studentId}/memberships/new`}"));
  assert.ok(menu.includes("href={`/memberships/${membershipId}/renew`}"));
  assert.match(menu, /<DropdownMenuItem disabled>\s*<RefreshCw[^>]*\/>\s*Renew Membership/, "no membership: Renew is disabled, like the old View Membership");
});

test("the table and the cards use the short menu; Student Details keeps the full one", () => {
  for (const path of ["app/students/student-table.js", "app/students/student-card-item.js"]) assert.match(code(path), /<StudentCardMenu[^>]*\blistActions\b/s, path);
  assert.doesNotMatch(code("app/students/[id]/student-header.js"), /listActions/);
});
