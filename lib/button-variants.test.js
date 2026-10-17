// Run with `npm test` (Node's built-in test runner).
//
// The shared Button's primary and secondary styles (components/ui/button.jsx), and which controls deliberately keep a different
// variant: toolbar/filter controls, pagination, toggles, inline row actions, status and destructive controls.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const button = read("components/ui/button.jsx");

test("primary: solid brand fill with white text; secondary: light brand-blue fill with blue text", () => {
  assert.match(button, /default: "bg-primary text-primary-foreground hover:bg-primary\/80",/);
  assert.match(button, /secondary:\s+"bg-primary\/10 text-primary hover:bg-primary\/15 active:bg-primary\/20 aria-expanded:bg-primary\/15",/);
});

test("primary and secondary share one base: same radius, type, icon size, focus ring and disabled state; sizes are per size, not per variant", () => {
  const base = button.slice(button.indexOf("const buttonVariants = cva("), button.indexOf("variants: {"));
  for (const needle of ["rounded-button", "text-button font-medium", "focus-visible:ring-3", "disabled:opacity-50", "[&_svg:not([class*='size-'])]:size-4"]) {
    assert.ok(base.includes(needle), needle);
  }
  assert.doesNotMatch(button.slice(button.indexOf("variant: {"), button.indexOf("size: {")), /\b(h-\d|px-\d|rounded-)/, "no variant sets its own height, padding or radius");
});

test("Cancel, Back and the supporting links use the secondary style", () => {
  const secondary = [
    "app/students/student-form.js",
    "app/batches/batch-form.js",
    "app/schedule/schedule-form.js",
    "components/ui/confirm-dialog.jsx",
    "components/ui/review-dialog.js",
    "app/dashboard-todays-classes.js",
    "app/students/[id]/attendance-calendar.js",
  ];
  for (const path of secondary) assert.match(read(path), /variant="secondary"/, path);
  assert.match(read("app/students/page.js"), /variant="secondary"[^>]*>[\s\S]*?Clear Filters/);
});

test("the main Add actions of a section are primary", () => {
  const page = read("app/students/[id]/page.js");
  assert.match(page, /<Button size="sm" render=\{<Link href=\{`\/students\/\$\{student\.id\}\/enrollments\/new`\} \/>\} nativeButton=\{false\}>/);
  assert.match(page, /<Button size="sm" render=\{<Link href=\{`\/students\/\$\{student\.id\}\/memberships\/new`\} \/>\} nativeButton=\{false\}>/);
});

test("specialized controls keep their own variant: pagination, toggles, row actions, status and destructive actions", () => {
  for (const path of [
    "components/ui/pagination.js",
    "components/ui/kpi-visibility.js",
    "components/ui/mark-button.js",
    "components/ui/filter-bar/FilterBar.js",
    "app/schedule/weekly-schedule.js",
    "app/students/[id]/student-status-button.js",
    "app/memberships/[id]/documents/[documentId]/cancel-document.js",
    "app/schedule/[id]/deactivate-schedule.js",
    "app/settings/packages/fee-history.js",
    "app/memberships/[id]/payments-panel.js",
  ]) {
    assert.match(read(path), /variant="outline"/, `${path} stays outline`);
    assert.doesNotMatch(read(path), /variant="secondary"/, `${path} is not secondary`);
  }
});
