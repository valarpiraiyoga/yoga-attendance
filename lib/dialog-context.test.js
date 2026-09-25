// Run with `npm test` (Node's built-in test runner).
//
// Every popup that acts on a record opens with a context card saying which record it is about
// (a student, a schedule, a session), so the person always knows where they are and what the
// question below will change.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const appDir = `${root}app/`;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) walk(`${path}/`, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const read = (path) => readFileSync(path, "utf8");
const app = (path) => read(appDir + path);
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const count = (source, pattern) => (source.match(pattern) ?? []).length;

test("both dialog shells have a context slot between the header and the content", () => {
  const confirm = stripComments(read(`${root}components/ui/confirm-dialog.jsx`));
  assert.match(confirm, /\n  context,\n/);
  assert.ok(confirm.indexOf("{context}") > confirm.indexOf("</DialogHeader>"), "under the title and description");
  assert.ok(confirm.indexOf("{context}") < confirm.indexOf("{children}"), "before the review content");

  const review = stripComments(read(`${root}components/ui/review-dialog.js`));
  assert.match(review, /\n  context,\n/);
  assert.ok(review.indexOf("{context}") < review.indexOf("{children ? ("), "before the details panel");
});

test("every popup in the app passes a context card", () => {
  const files = walk(appDir).filter((path) => /<(ConfirmDialog|ReviewDialog)\b/.test(stripComments(read(path))));
  assert.ok(files.length >= 10, "found the popups");

  const missing = [];
  for (const path of files) {
    const source = stripComments(read(path));
    const dialogs = count(source, /<(ConfirmDialog|ReviewDialog)\b/g);
    // A dialog-level slot: `context={<Card ... />}` or `context={context}` - not a card's own inner `context` prop.
    const contexts = count(source, /\n\s+context=\{\s*(?:<|context\})/g);
    if (dialogs !== contexts) missing.push(`${path.slice(appDir.length)}: ${dialogs} dialog(s), ${contexts} context(s)`);
  }
  assert.deepEqual(missing, []);
});

test("each kind of record has one context card, reused by every popup about it", () => {
  const byKind = {
    student: [
      ["students/[id]/student-status-button.js", /<StudentContext student=\{student\} \/>/],
      ["students/[id]/enrollments/enrollment-review-dialog.js", /<StudentContext student=\{student\} \/>/],
      ["memberships/membership-form.js", /<StudentContext student=\{student\} \/>/],
      ["memberships/[id]/cancel-membership.js", /<StudentContext student=\{student\} membership=\{membership\} \/>/],
    ],
    schedule: [
      ["schedule/[id]/deactivate-schedule.js", /<ScheduleContext context=\{scheduleContext\} \/>/],
      ["schedule/delete-schedule-dialog.js", /<ScheduleContext context=\{scheduleContext\} \/>/],
      ["schedule/schedule-form.js", /<ScheduleContext\s+context=\{scheduleContextOf\(schedule, /],
      ["schedule/weekly-schedule-card.js", /<ScheduleContext context=\{scheduleContextOf\(schedule\)\} \/>/],
    ],
    session: [
      ["attendance/[scheduleId]/[date]/mark-session.js", /<SessionContext context=\{sessionContext\} \/>/],
      ["attendance/[scheduleId]/[date]/attendance-panel.js", /<SessionContext context=\{sessionContextOf\(session\)\} \/>/],
      ["attendance/session-form.js", /<SessionContext context=\{sessionContextOf\(session\)\} \/>/],
    ],
  };
  for (const [kind, entries] of Object.entries(byKind)) {
    for (const [path, pattern] of entries) {
      assert.match(stripComments(app(path)), pattern, `${kind}: ${path}`);
    }
  }

  // The three domain cards are built on the one generic card, so they look alike.
  for (const path of [`${root}components/ui/student-context.js`, `${appDir}schedule/schedule-context.js`, `${appDir}attendance/session-context.js`]) {
    assert.match(read(path), /import ContextCard from "@\/components\/ui\/context-card"/, path);
  }
});

test("the schedule popups say which schedule: every entry point supplies its context", () => {
  for (const path of ["schedule/[id]/schedule-header.js", "batches/[id]/batch-schedule-row.js", "schedule/schedule-batch-accordion.js"]) {
    assert.match(app(path), /scheduleContext=\{scheduleContextOf\(/, path);
  }
  assert.match(app("schedule/schedule-card-menu.js"), /scheduleContext=\{scheduleContext\}/);
});

test("the student popups get only the few fields they show, not the whole record", () => {
  const minimal = /student=\{\{ full_name: student\.full_name, student_code: student\.student_code, photo_url: student\.photo_url \}\}/;
  for (const path of [
    "students/[id]/page.js",
    "students/[id]/enrollments/new/page.js",
    "students/[id]/enrollments/[enrollmentId]/edit/page.js",
  ]) {
    assert.match(app(path), minimal, path);
  }
  assert.match(app("students/[id]/enrollments/enrollment-form.js"), /student=\{student\}/);
});
