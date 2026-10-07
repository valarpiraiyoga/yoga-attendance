// Run with `npm test` (Node's built-in test runner).
//
// Every application page opens with the compact page strip (title, description, and a boxed
// back button on a page reached from another record). The strip bleeds through the shell's
// padding, so it must sit directly in the shell's <main>: no layout may wrap a page in a
// container, and no page may keep the old "back link + big title" block.

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

const files = walk(appDir);
const rel = (path) => path.slice(appDir.length).replace(/\\/g, "/");
const read = (path) => readFileSync(path, "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

// Screens that are not application pages with the shell: sign-in / recovery, and the Dashboard,
// which opens with its own greeting header.
const NO_SHELL = /^(auth\/|login\/|forgot-password\/|reset-password\/|page\.js$)/;

test("no page keeps the old plain back link", () => {
  const offenders = files.filter((path) => /\bArrowLeft\b/.test(read(path))).map(rel);
  assert.deepEqual(offenders, []);
});

test("every application page opens with the compact strip (directly or through its shared header)", () => {
  const SHARED = /<PageHeader|<BatchHeader|<ReviewAttendanceChanges|redirect\(/;
  const SETTINGS_TABS = /^settings\/(center-profile|invoice-receipt|instructors|roles-permissions)\/page\.js$/;
  const pages = files.filter((path) => path.endsWith("/page.js") && !NO_SHELL.test(rel(path)));
  assert.ok(pages.length > 30, "found the pages");

  const missing = pages
    .filter((path) => !SETTINGS_TABS.test(rel(path)))
    .filter((path) => !SHARED.test(stripComments(read(path))))
    .map(rel);
  assert.deepEqual(missing, []);
});

test("a page reached from another record has a boxed back button in its strip", () => {
  const withBack = [
    "students/new/page.js",
    "students/[id]/page.js",
    "students/[id]/edit/page.js",
    "students/[id]/enrollments/new/page.js",
    "students/[id]/enrollments/[enrollmentId]/edit/page.js",
    "students/[id]/memberships/new/page.js",
    "memberships/new/page.js",
    "memberships/[id]/page.js",
    "memberships/[id]/edit/page.js",
    "memberships/[id]/renew/page.js",
    "memberships/[id]/receipt/page.js",
    "batches/new/page.js",
    "batches/[id]/batch-header.js",
    "batches/[id]/edit/page.js",
    "schedule/new/page.js",
    "schedule/[id]/page.js",
    "schedule/[id]/edit/page.js",
    "attendance/[scheduleId]/[date]/page.js",
    "attendance/[scheduleId]/[date]/details/page.js",
    "attendance/[scheduleId]/[date]/edit/page.js",
    "attendance-history/[scheduleId]/[date]/page.js",
    "attendance-history/[scheduleId]/[date]/edit/page.js",
    "attendance-history/[scheduleId]/[date]/review/review-attendance-changes.js",
    "settings/instructors/new/page.js",
    "settings/instructors/[id]/edit/page.js",
    "students/guided-complete.js",
  ];
  for (const path of withBack) {
    assert.match(read(appDir + path), /<PageHeader\s+compact[\s\S]*?back=\{\{ href:/, path);
  }
});

test("no nested layout wraps its pages in a container, so the strip can reach the edges", () => {
  const layouts = files.filter((path) => path.endsWith("/layout.js"));
  const offenders = layouts
    .filter((path) => !/AppShell/.test(read(path))) // the section shells hold no container either, checked below
    .filter((path) => /<Container\b/.test(stripComments(read(path))))
    .map(rel);
  assert.deepEqual(offenders, []);

  // The shells themselves add none either (a page or the Settings chrome places its own).
  for (const path of layouts.filter((p) => /AppShell/.test(read(p)))) {
    assert.doesNotMatch(stripComments(read(path)), /<Container\b/, rel(path));
  }
});

test("Settings shows its strip and tabs only on the four tab pages; Add / Edit Instructor bring their own", () => {
  const chrome = read(`${appDir}settings/settings-chrome.js`);
  assert.match(chrome, /TAB_PAGES = \[\s*"\/settings\/center-profile",\s*"\/settings\/invoice-receipt",\s*"\/settings\/instructors",\s*"\/settings\/roles-permissions",?\s*\]/);
  assert.match(chrome, /if \(!TAB_PAGES\.includes\(pathname\)\) return children;/);
  assert.match(stripComments(read(`${appDir}settings/layout.js`)), /<SettingsChrome>\{children\}<\/SettingsChrome>/);
});

test("the receipt's strip does not print", () => {
  const receipt = read(`${appDir}memberships/[id]/receipt/page.js`);
  assert.match(receipt, /<PageHeader\s+compact\s+className="print:hidden"/);
});
