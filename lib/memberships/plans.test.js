// Run with `npm test` (Node's built-in test runner).
//
// Membership plans: Monthly, Quarterly, Half Yearly, Annual, Custom duration. The plan values, the
// end-date rule (the same calendar-month rule Monthly and Quarterly already use), validation, the
// places that list plans, and migration 0031 (which widens the two plan CHECKs and words the new
// plans on receipts). There is no database in the unit run, so the migration is pinned from its text.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { MEMBERSHIP_PLANS, calculateMembershipEndDate, validateMembershipInput } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (path) => source(path).replace(/\r\n/g, "\n");
const sqlCode = (path) => sql(path).replace(/^\s*--.*$/gm, "");

// ---- the plan values ------------------------------------------------------------------------------

test("the plans, in order: monthly, quarterly, half_yearly, annual, custom", () => {
  assert.deepEqual(MEMBERSHIP_PLANS, ["monthly", "quarterly", "half_yearly", "annual", "custom"]);
});

// ---- end dates ----------------------------------------------------------------------------------------

test("Monthly and Quarterly calculate exactly as before", () => {
  assert.equal(calculateMembershipEndDate("monthly", "2026-10-01"), "2026-10-31");
  assert.equal(calculateMembershipEndDate("monthly", "2026-02-01"), "2026-02-28");
  assert.equal(calculateMembershipEndDate("quarterly", "2026-10-01"), "2026-12-31");
  assert.equal(calculateMembershipEndDate("quarterly", "2026-01-15"), "2026-04-14");
});

test("Half Yearly is start + 6 calendar months − 1 day", () => {
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-10-01"), "2027-03-31");
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-01-01"), "2026-06-30");
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-03-15"), "2026-09-14");
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-07-01"), "2026-12-31");
});

test("Annual is start + 12 calendar months − 1 day, leap years included", () => {
  assert.equal(calculateMembershipEndDate("annual", "2026-10-01"), "2027-09-30");
  assert.equal(calculateMembershipEndDate("annual", "2026-01-01"), "2026-12-31");
  assert.equal(calculateMembershipEndDate("annual", "2027-03-01"), "2028-02-29");
  assert.equal(calculateMembershipEndDate("annual", "2028-03-01"), "2029-02-28");
});

test("month-end starts follow the same calendar rule Monthly already has (Date.UTC rolls the missing day forward)", () => {
  // 31 Aug + 6 months has no 31 Feb: it rolls forward exactly as 31 Jan + 1 month does for Monthly.
  assert.equal(calculateMembershipEndDate("monthly", "2026-01-31"), "2026-03-02");
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-08-31"), "2027-03-02");
  assert.equal(calculateMembershipEndDate("annual", "2028-02-29"), "2029-02-28");
});

test("Custom duration is never derived, and an invalid start gives nothing for any plan", () => {
  assert.equal(calculateMembershipEndDate("custom", "2026-10-01"), "");
  for (const plan of MEMBERSHIP_PLANS) {
    assert.equal(calculateMembershipEndDate(plan, ""), "", plan);
    assert.equal(calculateMembershipEndDate(plan, "2026-02-30"), "", plan);
  }
  assert.equal(calculateMembershipEndDate("weekly", "2026-10-01"), "");
});

test("the new plans use the one calculation: no second date system", () => {
  const validation = code("./validation.js");
  assert.equal((validation.match(/addMonthsUTC\(startDate, \d+\)/g) ?? []).length, 4);
  assert.match(validation, /half_yearly[^\n]*subtractOneDayUTC\(addMonthsUTC\(startDate, 6\)\)/);
  assert.match(validation, /annual[^\n]*subtractOneDayUTC\(addMonthsUTC\(startDate, 12\)\)/);
});

// ---- validation -------------------------------------------------------------------------------------------

const input = (plan) => ({ plan, start_date: "2026-10-01", end_date: "2027-03-31", amount: "6000", payment_status: "pending", notes: "" });

test("every plan is accepted, and an unknown one is refused with the plan message", () => {
  for (const plan of MEMBERSHIP_PLANS) {
    const result = validateMembershipInput(input(plan));
    assert.equal(result.success, true, plan);
    assert.equal(result.data.plan, plan);
  }
  const unknown = validateMembershipInput(input("weekly"));
  assert.equal(unknown.success, false);
  assert.ok(unknown.errors.plan);
  assert.equal(validateMembershipInput(input("")).success, false);
  assert.equal(validateMembershipInput(input("Half Yearly")).success, false, "the stored value is half_yearly, never the label");
});

// ---- where plans are listed ---------------------------------------------------------------------------------

const LABELS = ["Monthly", "Quarterly", "Half Yearly", "Annual", "Custom duration"];

test("the membership form's Plan dropdown lists the five plans in order, unchanged otherwise", () => {
  const form = code("../../app/memberships/membership-form.js");
  const block = form.match(/const PLAN_OPTIONS = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...block.matchAll(/value: "(\w+)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]]), [
    ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half Yearly"], ["annual", "Annual"], ["custom", "Custom duration"],
  ]);
  // The end date is derived for every plan but Custom, by the one function; Create and Edit share this form.
  assert.match(form, /calculateMembershipEndDate\(nextPlan, nextStartDate\)/);
  assert.match(form, /\{plan === "custom" \? "Enter the membership's end date\." : "Calculated from Plan and Start Date — editable\."\}/);
});

test("Create, Edit and Renew all use the form / calculation", () => {
  for (const path of ["../../app/memberships/new/page.js", "../../app/memberships/[id]/edit/page.js", "../../app/memberships/[id]/renew/page.js"]) {
    if (existsSync(new URL(path, import.meta.url))) assert.match(source(path), /MembershipForm|calculateMembershipEndDate/, path);
  }
  assert.match(code("../../app/memberships/[id]/renew/page.js"), /calculateMembershipEndDate\(previous\.plan, defaultStartDate\) \|\| defaultStartDate/);
});

test("the list filter, the plan labels, the list route and the enrollment step all know the new plans", () => {
  const filters = code("../../app/memberships/membership-filters.js").match(/const PLAN_OPTIONS = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...filters.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["All Plans", ...LABELS]);
  const status = code("../status.js").match(/export const PLAN = \{([\s\S]*?)\};/)[1];
  assert.deepEqual([...status.matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]), [
    ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half Yearly"], ["annual", "Annual"], ["custom", "Custom duration"],
  ]);
  assert.match(code("../../app/memberships/page.js"), /const PLANS = \["monthly", "quarterly", "half_yearly", "annual", "custom"\];/);
  assert.match(code("../../app/students/[id]/enrollments/new/page.js"), /half_yearly: "Half Yearly", annual: "Annual"/);
});

test("no screen still assumes exactly three plans", () => {
  const files = readdirSync(new URL("../../app/", import.meta.url), { recursive: true }).map(String).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f));
  for (const file of files) {
    const text = code(`../../app/${file.replaceAll("\\", "/")}`);
    assert.doesNotMatch(text, /\["monthly", "quarterly", "custom"\]|"monthly" \| "quarterly" \| "custom"/, file);
    assert.doesNotMatch(text, /monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration"/, file);
  }
});

// ---- migration 0031 ----------------------------------------------------------------------------------------------

const M31 = "../../supabase/migrations/0031_membership_plans.sql";
const M30 = "../../supabase/migrations/0030_invoice_membership_sync.sql";
const C31 = sqlCode(M31);

function functionOf(text, name) {
  const start = text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf("\n$$;", text.indexOf("as $$", start)) + 4);
}

test("0031 follows 0030 and changes no data", () => {
  const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  // Anchored on 0031 itself, so later migrations do not move the pin.
  assert.equal(files[files.indexOf("0031_membership_plans.sql") - 1], "0030_invoice_membership_sync.sql");
  // (Outside the two receipt functions, which are 0030's and write receipts only when called.)
  const outsideFunctions = C31.replace(/create or replace function[\s\S]*?\n\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(insert\s+into|delete\s+from|truncate)\b/i);
  assert.doesNotMatch(outsideFunctions, /\bupdate\s+public\./i);
  assert.doesNotMatch(C31, /\bdrop\s+(table|column|trigger|function|index)\b/i);
  assert.doesNotMatch(C31, /create table|create trigger|create policy|\bgrant\b/i);
});

test("both plan CHECKs are replaced by named ones listing the five plans, in order", () => {
  assert.match(C31, /alter table public\.memberships\s+add constraint memberships_plan_valid\s+check \(plan in \('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'\)\);/);
  assert.match(C31, /alter table public\.invoices\s+add constraint invoices_plan_valid\s+check \(plan in \('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'\)\);/);
  // The old, auto-named ones are found by what they check and dropped first (and only on these two tables).
  assert.match(C31, /conrelid in \('public\.memberships'::regclass, 'public\.invoices'::regclass\)\s+and pg_get_constraintdef\(oid\) like '%plan%'\s+and pg_get_constraintdef\(oid\) like '%monthly%'/);
  assert.ok(C31.indexOf("drop constraint") < C31.indexOf("add constraint memberships_plan_valid"));
  // The old constraints (0008, 0026) listed exactly the three old plans, all of which stay allowed.
  assert.match(sqlCode("../../supabase/migrations/0008_memberships.sql"), /check \(plan in \('monthly', 'quarterly', 'custom'\)\)/);
  assert.match(sqlCode("../../supabase/migrations/0026_invoices.sql"), /check \(plan in \('monthly', 'quarterly', 'custom'\)\)/);
});

test("the two receipt functions are 0030's, with only the two new description lines added", () => {
  const norm = (text) => text.replace(/\n\s*\n/g, "\n");
  for (const name of ["issue_invoice_core", "sync_invoice_from_membership"]) {
    const before = norm(functionOf(sql(M30), name));
    const after = norm(functionOf(sql(M31), name));
    const stripped = after.replace(/^\s*when 'half_yearly' then 'Half Yearly'\n\s*when 'annual' then 'Annual'\n/m, "");
    assert.equal(stripped, before, name);
    assert.match(after, /when 'quarterly' then 'Quarterly'\n\s*when 'half_yearly' then 'Half Yearly'\n\s*when 'annual' then 'Annual'\n\s*else 'Custom duration'/, name);
  }
});

test("the receipt functions keep their access: definer, empty search_path, no client may execute them", () => {
  for (const name of ["issue_invoice_core", "sync_invoice_from_membership"]) {
    assert.match(functionOf(sql(M31), name), /security definer\s+set search_path = ''/, name);
  }
  assert.match(C31, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
  assert.match(C31, /revoke execute on function public\.sync_invoice_from_membership\(uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(C31, /grant execute/i);
});

test("payment, numbering, tax and synchronization rules are not touched by 0031", () => {
  const functions = [...C31.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(functions, ["issue_invoice_core", "sync_invoice_from_membership"]);
  assert.match(functionOf(sql(M31), "issue_invoice_core"), /round\(v_mem\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\)/);
  assert.match(functionOf(sql(M31), "sync_invoice_from_membership"), /round\(v_mem\.amount \* v_inv\.tax_rate \/ \(100 \+ v_inv\.tax_rate\), 2\)/);
});

test("the 0031 verification scripts exist and are safe", () => {
  const structural = sqlCode("../../supabase/verification/verify_0031_membership_plans.sql");
  assert.match(structural, /begin transaction read only;/);
  assert.match(structural, /rollback;\s*$/);
  assert.doesNotMatch(structural, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im);

  const behavior = sqlCode("../../supabase/verification/verify_0031_membership_plans_behavior.sql");
  assert.match(behavior, /^\s*begin;/m);
  assert.match(behavior, /\nrollback;/);
  assert.deepEqual([...behavior.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]), ["students", "memberships", "memberships", "memberships", "memberships"]);
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.invoices\b/i);
  assert.doesNotMatch(behavior, /delete\s+from\s+public\./i);
  assert.match(behavior, /Z1 every pre-existing receipt is byte-for-byte unchanged/);
  for (const scenario of ["P1", "P3", "R1", "R2", "S1", "T1"]) assert.ok(behavior.includes(`'${scenario} `), scenario);
});

// ---- nothing else moved ----------------------------------------------------------------------------------------

test("receipts, payment rules and the document code are untouched by the new plans", () => {
  for (const path of ["../invoices/invoice-core.js", "../invoices/invoice-document.js", "./actions.js"]) {
    assert.doesNotMatch(code(path), /half_yearly|Half Yearly|annual/i, path);
  }
});
