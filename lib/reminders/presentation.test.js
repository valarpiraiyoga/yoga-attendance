// Run with `npm test` (Node's built-in test runner).
//
// R3 - how reminders appear (02-ux.md "Membership & payment reminders"). The wording and grouping helpers are pure and tested by running them; the
// screens need the Next.js runtime, so - the project's way - their wiring is pinned from source. Browser behaviour is not proved here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expiryReminderText, paymentReminderText, reminderText, remindersByMembership } from "./presentation.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- wording -------------------------------------------------------------------------------------------------------------------------------

test("expiry wording from daysUntilEnd: positive = days until, zero = today, negative = days overdue - singular and plural", () => {
  assert.equal(expiryReminderText(6), "Expires in 6 days");
  assert.equal(expiryReminderText(1), "Expires in 1 day");
  assert.equal(expiryReminderText(0), "Expires today");
  assert.equal(expiryReminderText(-1), "Expired 1 day ago");
  assert.equal(expiryReminderText(-30), "Expired 30 days ago");
  assert.equal(expiryReminderText(undefined), "Expiring");
});

test("payment wording shows the outstanding balance in the membership's own currency", () => {
  assert.equal(paymentReminderText(150000, "INR"), "Balance ₹1,500.00");
  assert.match(paymentReminderText(1999, "USD"), /^Balance \$19\.99$/);
  assert.match(paymentReminderText(150000, null), /^Balance /, "no currency: the default, never an error");
});

test("reminderText reads either reminder type from the data layer; anything else is empty", () => {
  assert.equal(reminderText({ type: "expiry", daysUntilEnd: 0 }), "Expires today");
  assert.equal(reminderText({ type: "payment", balancePaise: 50000, membership: { currency: "INR" } }), "Balance ₹500.00");
  assert.equal(reminderText({ type: "other" }), "");
  assert.equal(reminderText(null), "");
});

test("remindersByMembership: both reminders of one membership side by side, separate memberships separate, nothing for none", () => {
  const grouped = remindersByMembership([
    { type: "expiry", membershipId: "m1", daysUntilEnd: 3, endDate: "2026-11-20" },
    { type: "payment", membershipId: "m1", balancePaise: 100000, membership: { currency: "INR" } },
    { type: "payment", membershipId: "m2", balancePaise: 5000, membership: { currency: "INR" } },
    { type: "unknown", membershipId: "m3" },
    null,
  ]);
  assert.deepEqual(Object.keys(grouped), ["m1", "m2"]);
  assert.deepEqual(grouped.m1, {
    expiry: { daysUntilEnd: 3, endDate: "2026-11-20", text: "Expires in 3 days" },
    payment: { balancePaise: 100000, currency: "INR", text: "Balance ₹1,000.00" },
  });
  assert.deepEqual(grouped.m2, { payment: { balancePaise: 5000, currency: "INR", text: "Balance ₹50.00" } });
  assert.deepEqual(remindersByMembership(null), {});
});

// ---- Dashboard ---------------------------------------------------------------------------------------------------------------------------------

test("Dashboard: the Reminders panel is read and rendered for an Admin only, and a failed read is the panel's error state", () => {
  const page = code("app/page.js");
  assert.match(page, /isAdmin \? getReminders\(\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
  assert.match(page, /\{isAdmin \? <DashboardReminders result=\{reminders\} centreName=\{centreName\} \/> : null\}/);
});

test("Dashboard panel: one row per reminder (a membership with both appears twice), linking to Membership Details; empty and error states", () => {
  const panel = code("app/dashboard-reminders.js");
  assert.ok(panel.includes("key={`${reminder.membershipId}:${reminder.type}`}"));
  assert.ok(panel.includes("href={`/memberships/${reminder.membershipId}`}"));
  assert.ok(panel.includes("No reminders - every membership is current and paid up."));
  assert.ok(panel.includes("Reminders are not available right now.") && panel.includes('role="alert"'));
  assert.ok(panel.includes("reminder.student.fullName") && panel.includes("reminder.student.studentCode") && panel.includes("membershipLabel(reminder.membership)"));
  assert.ok(panel.includes("formatDate(reminder.endDate)"), "an expiry reminder shows its end date");
  assert.ok(panel.includes('id={REMINDERS_ANCHOR}') && panel.includes('export const REMINDERS_ANCHOR = "reminders";'), "the bell's target");
  assert.ok(!/\b(send|sent|email|whatsapp|sms)\b/i.test(panel), "no wording suggests a message was sent");
});

// ---- Memberships list --------------------------------------------------------------------------------------------------------------------------

test("Memberships list: the page reads the reminders once, groups them per membership, and the list still works if they cannot be read", () => {
  const page = code("app/memberships/page.js");
  assert.ok(page.includes("getReminders().catch(() => null),"));
  assert.ok(page.includes("const reminders = remindersByMembership(reminderResult?.reminders);"));
  assert.match(page, /<MembershipList\s+memberships=\{memberships\}\s+reminders=\{reminders\}/);
  const list = code("app/memberships/membership-list.js");
  assert.ok(list.includes("reminders={reminders[membership.id]}") && list.includes("<MembershipTable memberships={memberships} today={today} reminders={reminders} centreName={centreName} />"));
});

test("rows AND cards show the same indicators, and pass the reminders to the More menu", () => {
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    const source = code(path);
    assert.ok(source.includes("<ReminderIndicators reminders={reminders}"), path);
    assert.ok(source.includes("reminders={reminders}\n            onOpenReminderMessage={() => setReminderOpen(true)}\n            onIssueInvoice"), path);
  }
  const table = code("app/memberships/membership-table.js");
  assert.ok(table.includes("reminders={reminders[membership.id]}"));
});

test("indicators: a red expiry badge and a payment-pending badge, each only when its reminder applies, wrapping rather than widening", () => {
  const indicators = code("app/memberships/reminder-indicators.js");
  assert.ok(indicators.includes("if (!reminders?.expiry && !reminders?.payment) return null;"));
  assert.match(indicators, /\{reminders\.expiry \? \(\s*<Badge variant="danger"/);
  assert.match(indicators, /\{reminders\.payment \? \(\s*<Badge variant="danger"/);
  assert.ok(indicators.includes("flex flex-wrap"));
  assert.ok(indicators.includes("Expiry reminder: ") && indicators.includes("Payment pending: "), "screen-reader context for each badge");
});

test("More menu: the reminders at the top, Record Payment (to Membership Details) for a payment reminder, Renew still there - in-app only", () => {
  const menu = code("app/memberships/membership-card-menu.js");
  const top = menu.indexOf("<DropdownMenuLabel>Reminders</DropdownMenuLabel>");
  assert.ok(top > 0 && top < menu.indexOf("View Membership"));
  assert.ok(menu.includes("{reminders.expiry.text}") && menu.includes("{reminders.payment.text}"));
  assert.match(menu, /\{reminders\.payment \? \(\s*<DropdownMenuItem render=\{<Link href=\{`\/memberships\/\$\{membershipId\}`\} \/>\} nativeButton=\{false\}>\s*Record Payment/);
  assert.ok(menu.includes("Renew Membership"));
  assert.ok(!/Send|WhatsApp|Email|SMS/.test(menu.replace(/\/\/.*$/gm, "")), "no external delivery");
});

// ---- Notification bell ---------------------------------------------------------------------------------------------------------------------------

test("bell: the count is read for an Admin only (never for an Instructor), counts every reminder, and a failure shows no count", () => {
  const shell = code("components/layout/AppShell.js");
  assert.match(shell, /role === ROLES\.ADMIN \? getReminders\(\)\.then\(\(result\) => result\.counts\.total\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
  for (const path of ["components/global/Sidebar.js", "components/global/Header.js", "components/global/MobileMenu.js"]) {
    assert.ok(code(path).includes("reminderCount={reminderCount}"), path);
  }
  const counts = code("lib/reminders/data-core.js");
  assert.ok(counts.includes("counts: { total: reminders.length, expiry: expiry.length, payment: payment.length }"), "each reminder counted: both = 2");
});

test("bell: an Admin's bell opens the Dashboard's Reminders panel with the count; an Instructor's bell is unchanged", () => {
  const row = code("components/global/UtilityRow.js");
  assert.ok(row.includes('const isAdmin = role === "admin";'));
  assert.ok(row.includes("const count = isAdmin && Number.isInteger(reminderCount) && reminderCount > 0 ? reminderCount : 0;"));
  assert.ok(row.includes('render={<Link href="/#reminders" />}'));
  assert.ok(row.includes('{count > 99 ? "99+" : count}'));
  assert.ok(row.includes("aria-label={bellLabel}"));
});

test("getReminders is read once per request (React cache), so the bell, the panel and the list share one read", () => {
  const data = code("lib/reminders/data.js");
  assert.ok(data.includes('import { cache } from "react";'));
  assert.match(data, /export const getReminders = cache\(async \(\) => \{\s*await requireRole\(ROLES\.ADMIN\);/);
});

test("Dashboard: the Balance badge is red (danger token) like the expiry badge; the Memberships list Balance badge is the same red", () => {
  const panel = code("app/dashboard-reminders.js");
  assert.ok(panel.includes('<Badge variant="danger">') && !panel.includes('"warning"'));
  assert.ok(panel.includes("{text}"), "the amount text still comes from reminderText");
  assert.match(code("app/memberships/reminder-indicators.js"), /\{reminders\.payment \? \(\s*<Badge variant="danger"/);
});
