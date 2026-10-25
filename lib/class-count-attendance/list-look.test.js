// Run with `npm test` (Node's built-in test runner).
//
// Class Count Attendance lists take the shared list-table look of the Students and Memberships lists: rounded row cards on the page
// background under a pale header strip, the large avatar, a membership tile, the classes badge beside "N of M used" over the bar,
// the expiry with a calendar icon, and a count beside each section heading. Checked as source (no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const list = read("app/attendance/class-count/class-count-list.js");
const page = read("app/attendance/class-count/page.js");

test("rows are rounded cards under a pale header strip, like the Students and Memberships tables", () => {
  assert.ok(list.includes('className="border-separate border-spacing-y-2"'));
  assert.ok(list.includes("bg-brand/5") && list.includes("first:rounded-l-card") && list.includes("last:rounded-r-card"));
  // The animated hover border is reserved for the main list pages (lib/memberships test), so these rows stay static.
  assert.ok(!list.includes("AnimatedBorder") && !list.includes("card-border-animated"));
  assert.ok(list.includes('<div className="@container">'), "columns follow the table's own width");
});

test("each row: large avatar, membership tile, classes badge with used count and bar, expiry with a calendar icon", () => {
  assert.ok(list.includes('<Avatar name={row.fullName} src={row.photoUrl} size="lg" />'));
  assert.match(list, /<FileText className="size-5" \/>[\s\S]*\{row\.membershipCode\}/);
  // The classes badge is brand blue while classes are left (amber once used up); the progress bar is green (amber once used up).
  assert.match(list, /<Badge variant=\{renew \? "warning" : "default"\}>\{remainingText\(row\.remaining\)\}<\/Badge>/);
  assert.match(list, /tone=\{renew \? "warning" : "success"\}/);
  assert.match(list, /<CalendarDays [^>]*\/>\s*\{row\.endDate \? `Expires/);
});

test("Membership and Expiry are one column: the code with the expiry beneath it, no separate Expiry column", () => {
  assert.doesNotMatch(list, />Expiry</);
  assert.equal((list.match(/<TableHead\b/g) ?? []).length, 4, "Student, Membership, Classes, Action");
  const cell = list.slice(list.indexOf("{row.membershipCode}"), list.indexOf("remainingText(row.remaining)"));
  assert.match(cell, /\{row\.membershipCode\}[\s\S]*<CalendarDays [^>]*\/>\s*\{row\.endDate \? `Expires \$\{formatDate\(row\.endDate\)\}` : NO_EXPIRY_LABEL\}/);
});

test("the Attendance views control: its own segmented nav from lg (links with icons, aria-current), underline Tabs below lg", () => {
  const toggle = read("app/attendance/attendance-view-toggle.js");
  assert.ok(toggle.includes('<nav aria-label="Attendance views" className={FRAME}>'));
  assert.ok(toggle.includes('aria-current={isActive ? "page" : undefined}'));
  assert.match(toggle, /const FRAME = "[^"]*rounded-card border border-border bg-surface p-1 shadow-xs max-lg:hidden"/);
  assert.match(toggle, /const SEGMENT_ACTIVE = `\$\{SEGMENT\} bg-brand text-surface shadow-sm`/);
  assert.ok(toggle.includes("focus-visible:ring-3"), "a visible keyboard focus ring");
  assert.ok(toggle.includes('<Tabs as="link" items={tabItems} active={active} ariaLabel="Attendance views" className="mb-4 lg:hidden" />'));
  const withoutComments = toggle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(withoutComments, /ViewSwitcher|view-switcher/, "the shared toolbar switcher is not changed or used here");
});

test("each section heading carries its count", () => {
  assert.match(page, /Ready to record\s*<Badge variant="neutral">\{eligible\.length\}<\/Badge>/);
  assert.match(page, /No classes remaining\s*<Badge variant="neutral">\{toRenew\.length\}<\/Badge>/);
});
