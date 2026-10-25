// Run with `npm test` (Node's built-in test runner).
//
// Memberships list (table and cards): the More menu has no View Student and no "View Payments" item, every item has an icon, and
// the retained actions keep their routes. The detail page, history rows and Dashboard keep their menus.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { membershipDocumentAction } from "./document-action.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const MENU = code("app/memberships/membership-card-menu.js");
const ITEMS = [...MENU.matchAll(/<DropdownMenuItem\b[\s\S]*?<\/DropdownMenuItem>/g)].map((match) => match[0]);

test("the list menu hides View Student and a View Payments document item", () => {
  assert.match(MENU, /studentId && !listActions \?/, "View Student only outside the list");
  assert.match(MENU, /const showDocumentAction = !hideDocumentAction && !\(listActions && documentAction\.kind === "payments"\)/);
  assert.equal(membershipDocumentAction("m1", "paid", false, true).label, "View Payments", "the label still exists for other surfaces");
});

test("every item in the list menu leads with an icon", () => {
  const retained = ITEMS.filter((item) => !/extraItems/.test(item));
  assert.ok(retained.length >= 7, "Reminder Message, Record Payment, View/Edit/Renew Membership, the document item (two forms), View Student");
  for (const item of retained.filter((entry) => !entry.includes("View Student"))) {
    assert.match(item, /\{icon\(\w+\)\}/, item.slice(0, 120));
  }
  assert.match(MENU, /const icon = \(Icon\) => \(listActions \? <Icon aria-hidden="true" \/> : null\)/);
  for (const name of ["Eye", "Pencil", "RefreshCw", "BellRing", "Wallet", "FileText", "Receipt", "FilePlus"]) assert.match(MENU, new RegExp(`\\b${name}\\b`));
});

test("retained actions keep their routes and handlers", () => {
  assert.ok(MENU.includes("href={`/memberships/${membershipId}`}"));
  assert.ok(MENU.includes("href={`/memberships/${membershipId}/edit`}"));
  assert.ok(MENU.includes("href={`/memberships/${membershipId}/renew`}"));
  assert.ok(MENU.includes("onClick={onIssueInvoice}") && MENU.includes("onClick={onOpenReminderMessage}"));
  assert.ok(MENU.includes("href={documentAction.href}"));
});

test("the table and the cards use the list menu; the detail page, history rows and Dashboard do not", () => {
  for (const path of ["app/memberships/membership-table.js", "app/memberships/membership-card-item.js"]) {
    assert.match(code(path), /<MembershipCardMenu[\s\S]*?\blistActions\b[\s\S]*?\/>/, path);
  }
  for (const path of ["app/memberships/[id]/cancel-membership.js", "app/memberships/[id]/membership-history-row.js", "app/dashboard-reminder-actions.js"]) {
    assert.doesNotMatch(code(path), /listActions/, path);
  }
});

test("payment form summary: the payment total is black, the balance after it red, and every label and value is the same size", () => {
  const fields = code("app/memberships/[id]/payment-fields.js");
  for (const weight of ["font-medium", "font-semibold"]) {
    assert.ok(fields.includes(`<dd className="text-small ${weight} text-text-primary tabular-nums">{money(totalPaise)}</dd>`), `${weight} total is black`);
    assert.ok(fields.includes(`<dd className="text-small ${weight} text-danger tabular-nums">{money(remainingPaise)}</dd>`), `${weight} balance is red`);
  }
  for (const label of ["This payment", "Total Payment", "Balance after this payment"]) {
    assert.ok(fields.includes(`<dt className="text-small text-text-secondary">${label}</dt>`), `${label} label has the same text-small size`);
  }
});
