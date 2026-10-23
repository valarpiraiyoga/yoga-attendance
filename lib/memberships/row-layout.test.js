// Run with `npm test`. The Memberships list rows and cards need the Next.js runtime, so - the project's way - their structure is pinned from source.
// Browser behaviour (the look, the animation) is not proved here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the table's columns: Student, Membership, Plan & Period, Amount & Payment, Time Remaining, Actions - in that order", () => {
  const table = code("app/memberships/membership-table.js");
  const heads = [...table.matchAll(/<TableHead className=\{[^}]*\}(?:\)\})?>([^<]+)<\/TableHead>/g)].map((match) => match[1].replace("&amp;", "&"));
  assert.deepEqual(heads, ["Student", "Membership", "Plan & Period", "Amount & Payment", "Time Remaining", "Actions"]);
});

test("each row: student with phone, membership tile + ID + status, plan and period, amount and payment, time remaining from the existing helpers", () => {
  const table = code("app/memberships/membership-table.js");
  assert.ok(table.includes("formatPhone(student.phone, student.phone_country_code)"));
  assert.ok(table.includes("const remaining = getValidityLabel(validity);"), "the existing validity wording, not a new calculation");
  assert.ok(table.includes('validity.status === "upcoming" ? formatDate(membership.start_date) : formatEndDate(membership.end_date)'));
  assert.ok(table.includes("formatCurrency(membership.amount, membership.currency)"));
  assert.ok(table.includes("<Badge variant={payment.variant}") && table.includes("<Badge variant={status.variant}>{status.label}</Badge>"));
  assert.ok(table.includes("<ReminderIndicators reminders={reminders}"), "reminder indicators are kept");
});

test("actions are unchanged: the red bell replaces the document icon while a reminder applies; the menu always renders", () => {
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    const source = code(path);
    const gate = source.indexOf("{hasReminder(reminders) ? (");
    assert.ok(gate > 0 && gate < source.indexOf("<DocumentIcon") && source.indexOf("<DocumentIcon") < source.indexOf("<MembershipCardMenu"), path);
    assert.equal((source.match(/<ReminderMessageButton/g) ?? []).length, 1, path);
  }
});

test("the shared animated border is on the Memberships rows and cards - and only on the list pages (Students, Memberships, Documents, Batches, Schedule, Instructors, Packages)", () => {
  const table = code("app/memberships/membership-table.js");
  assert.ok(table.includes("card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)]"));
  assert.ok(table.includes("<AnimatedBorder />"));
  assert.match(code("app/memberships/membership-card-item.js"), /<EntityCard\s+animatedBorder\b/);

  const used = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.jsx?$/.test(name) && /animatedBorder|card-border-animated|<AnimatedBorder/.test(code(path))) used.push(path);
    }
  };
  walk("app");
  assert.deepEqual(used.sort(), [
    "app/batches/batch-card-item.js",
    "app/batches/batch-table.js",
    "app/documents/document-card-item.js",
    "app/documents/document-table.js",
    "app/memberships/membership-card-item.js",
    "app/memberships/membership-table.js",
    "app/schedule/schedule-batch-accordion.js",
    "app/schedule/schedule-batch-group-card.js",
    "app/settings/instructors/instructor-card-item.js",
    "app/settings/instructors/instructor-table.js",
    "app/settings/packages/page.js",
    "app/students/student-card-item.js",
    "app/students/student-table.js",
  ]);
});
