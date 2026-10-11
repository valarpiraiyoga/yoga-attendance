// Run with `npm test` (Node's built-in test runner).
//
// Phase 4 of Class Count Attendance: creating, editing and renewing class-count memberships, and showing them. Class-count
// memberships have a class total and an optional end date (no end date = no expiry). These tests cover the validation
// (and that a duration membership validates and saves exactly as before), the used / left helper, the document period,
// and - from source, the project's way for code that cannot be rendered under node:test - the form, the actions, the
// renewal, the data columns and the screens.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEMBERSHIP_PLANS, validateMembershipInput } from "./validation.js";
import { classCountOf, classCountText } from "./class-count.js";
import { buildInvoiceDocument } from "../invoices/invoice-document.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- validation: duration memberships exactly as before ---------------------------------------------------------------------------

const DURATION = { plan: "monthly", start_date: "2026-09-01", end_date: "2026-09-30", amount: "1500", notes: "  hi  " };

test("a duration membership validates and normalizes exactly as before - with or without a kind", () => {
  const expected = { success: true, data: { plan: "monthly", start_date: "2026-09-01", end_date: "2026-09-30", amount: 1500, notes: "hi" } };
  assert.deepEqual(validateMembershipInput(DURATION), expected);
  assert.deepEqual(validateMembershipInput({ ...DURATION, kind: "duration" }), expected);
  assert.deepEqual(validateMembershipInput({ ...DURATION, kind: "" }), expected);
  // A class total is ignored for a duration membership (the database refuses one, so none is ever sent).
  assert.deepEqual(validateMembershipInput({ ...DURATION, total_classes: "10" }), expected);
  assert.equal(MEMBERSHIP_PLANS.includes("class_count"), false, "the duration plans are the five, unchanged");
});

test("a duration membership still needs a plan and an end date, with the same messages", () => {
  const missing = validateMembershipInput({ start_date: "2026-09-01", amount: "10" });
  assert.deepEqual(missing, { success: false, errors: { plan: "Select a plan.", end_date: "End date is required." } });
  assert.equal(validateMembershipInput({ ...DURATION, plan: "class_count" }).errors.plan, "Select a valid plan.", "class_count is not a duration plan");
  assert.equal(validateMembershipInput({ ...DURATION, end_date: "2026-08-31" }).errors.end_date, "End date cannot be before the start date.");
  assert.equal(validateMembershipInput({ ...DURATION, amount: "0" }).errors.amount, "Enter a valid amount greater than 0.");
});

// ---- validation: class-count memberships --------------------------------------------------------------------------------------------

const CLASS_COUNT = { kind: "class_count", start_date: "2026-09-01", end_date: "", total_classes: "10", amount: "2000", notes: "" };

test("a class-count membership has the class_count plan, a class total and, with no end date, no expiry", () => {
  assert.deepEqual(validateMembershipInput(CLASS_COUNT), {
    success: true,
    data: { kind: "class_count", plan: "class_count", start_date: "2026-09-01", end_date: null, total_classes: 10, amount: 2000, notes: null },
  });
  // A plan sent with it is ignored: it is always the class_count plan.
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, plan: "monthly" }).data.plan, "class_count");
});

test("a class-count membership may have a fixed validity: an end date on or after the start", () => {
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, end_date: "2026-12-31" }).data.end_date, "2026-12-31");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, end_date: "2026-09-01" }).data.end_date, "2026-09-01", "a same-day end is allowed");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, end_date: "2026-08-31" }).errors.end_date, "End date cannot be before the start date.");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, end_date: "31/12/2026" }).errors.end_date, "Enter a valid end date.");
});

test("the class total is a whole number of at least 1, with no other limit", () => {
  const message = "Enter a whole number of classes of at least 1.";
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, total_classes: "" }).errors.total_classes, "Enter the number of classes.");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, total_classes: undefined }).errors.total_classes, "Enter the number of classes.");
  for (const bad of ["0", "-3", "1.5", "ten", "1e2", "10 classes"]) {
    assert.equal(validateMembershipInput({ ...CLASS_COUNT, total_classes: bad }).errors.total_classes, message, bad);
  }
  // No ceiling is added here: any positive whole number is accepted (the project documents no limit).
  for (const good of ["1", " 12 ", "10000", "250000"]) {
    assert.equal(validateMembershipInput({ ...CLASS_COUNT, total_classes: good }).data.total_classes, Number(good.trim()), good);
  }
});

test("the amount, start date and notes rules are the same for both kinds, and an unknown kind is refused", () => {
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, amount: "" }).errors.amount, "Amount is required.");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, start_date: "" }).errors.start_date, "Start date is required.");
  assert.equal(validateMembershipInput({ ...CLASS_COUNT, notes: "x".repeat(1001) }).errors.notes, "Notes must be 1000 characters or fewer.");
  assert.equal(validateMembershipInput({ ...DURATION, kind: "package" }).errors.kind, "Select a valid membership type.");
});

// ---- classes used and left ------------------------------------------------------------------------------------------------------------

test("classes used and left come from the total and the recorded count - never below zero, never for a duration membership", () => {
  assert.equal(classCountOf({ kind: "duration", total_classes: null }, [{ count: 3 }]), null);
  assert.deepEqual(classCountOf({ kind: "class_count", total_classes: 10 }, [{ count: 3 }]), { total: 10, used: 3, remaining: 7 });
  assert.deepEqual(classCountOf({ kind: "class_count", total_classes: 10 }, []), { total: 10, used: 0, remaining: 10 });
  assert.deepEqual(classCountOf({ kind: "class_count", total_classes: 10 }, undefined), { total: 10, used: 0, remaining: 10 });
  assert.equal(classCountOf({ kind: "class_count", total_classes: 2 }, [{ count: 5 }]).remaining, 0, "never negative");
  assert.equal(classCountText({ total: 10, used: 3, remaining: 7 }), "7 of 10 classes left");
  assert.equal(classCountText({ total: 1, used: 0, remaining: 1 }), "1 of 1 class left");
  assert.equal(classCountText({ total: 10, used: 10, remaining: 0 }), "0 of 10 classes left");
});

// ---- documents --------------------------------------------------------------------------------------------------------------------------

const INVOICE = {
  invoice_number: 790, invoice_prefix: "INV-", invoice_date: "2026-10-07", payment_date: "2026-10-05", document_title: "invoice",
  description: "Monthly Membership", plan: "monthly", period_start: "2026-10-01", period_end: "2026-10-31", currency: "INR",
  total_amount: 1180, tax_enabled: true, tax_name: "GST", tax_rate: 18, taxable_amount: 1000, tax_amount: 180,
  customer_name: "Asha Rao", customer_code: "YC-000012", customer_phone: "9876543210", customer_phone_country_code: "+91", customer_email: null,
  business_name: "Sri Yoga Center", business_address: "12 Temple Road", business_phone: null, business_email: null, business_logo_path: null,
  terms: null, signatory_name: null, signatory_designation: null, signature_path: null, status: "issued",
};

test("a document for a membership with no expiry shows its start date and No expiry; a duration document is unchanged", () => {
  const duration = buildInvoiceDocument(INVOICE);
  assert.equal(duration.line.period, "Oct 01, 2026 – Oct 31, 2026");
  const open = buildInvoiceDocument({ ...INVOICE, description: "Class Count Membership", plan: "class_count", period_end: null });
  assert.equal(open.line.description, "Class Count Membership");
  assert.equal(open.line.period, "Oct 01, 2026 – No expiry");
  const fixed = buildInvoiceDocument({ ...INVOICE, description: "Class Count Membership", plan: "class_count", period_end: "2026-12-31" });
  assert.equal(fixed.line.period, "Oct 01, 2026 – Dec 31, 2026");
});

// ---- the actions --------------------------------------------------------------------------------------------------------------------------

test("creating sends the kind and class total; only a duration membership runs the overlap pre-check", () => {
  const actions = code("./actions.js");
  const create = actions.slice(actions.indexOf("export async function createMembership("), actions.indexOf("export async function updateMembership("));
  assert.match(create, /validateMembershipInput\(membershipInputOf\(formData, formData\.get\("kind"\)\)\)/);
  assert.match(create, /result\.data\.kind !== "class_count" &&\s*\(await hasOverlappingMembership\(supabase, studentId, result\.data\.start_date, result\.data\.end_date\)\)/);
  assert.match(actions, /\.insert\(\{ \.\.\.result\.data, student_id: studentId, currency: await getCenterCurrency\(\) \}\)/);
  // The form's values are handed back with the kind and class total, so a failed save keeps them.
  assert.match(actions, /kind: formData\.get\("kind"\),\s*plan: formData\.get\("plan"\),/);
  assert.match(actions, /total_classes: formData\.get\("total_classes"\),/);
});

test("editing a class-count membership never writes its plan or kind, and skips the overlap pre-check", () => {
  const actions = code("./actions.js");
  const update = actions.slice(actions.indexOf("export async function updateMembership("), actions.indexOf("export async function cancelMembership("));
  assert.match(update, /const \{ kind: submittedKind, start_date, end_date, total_classes, amount, notes \} = result\.data;/);
  assert.match(update, /const isClassCount = submittedKind === "class_count";/);
  assert.match(update, /!isClassCount &&\s*\(await hasOverlappingMembership\(/);
  assert.match(update, /if \(isClassCount\) \{\s*result\.data = \{ start_date, end_date, total_classes, amount, notes \};\s*\}/);
  // The write itself is the existing one-liner, so a duration edit sends exactly what it always sent.
  assert.match(update, /const \{ error \} = await supabase\.from\("memberships"\)\.update\(result\.data\)\.eq\("id", id\);/);
  assert.doesNotMatch(update, /plan: result|kind: result/);
});

test("the database's history refusals show as field messages, before the invoice rules", () => {
  const actions = code("./actions.js");
  assert.match(actions, /error\.code === "23514" && \/class total cannot be less\/i\.test\(error\.message \?\? ""\)/);
  assert.match(actions, /fieldErrors: \{ total_classes: message \}/);
  assert.ok(actions.indexOf("classCountHistoryResult(error, formData)") < actions.indexOf("invoiceRuleResult(error, formData)", actions.indexOf("classCountHistoryResult(error, formData)")));
});

// ---- the form --------------------------------------------------------------------------------------------------------------------------

test("the form chooses the kind when creating, fixes it when editing or renewing, and keeps the duration form as it was", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.match(form, /const KIND_OPTIONS = \[\s*\{ value: "duration", label: "Duration" \},\s*\{ value: "class_count", label: "Class Count" \},\s*\];/);
  assert.match(form, /const kindLocked = Boolean\(membership\) \|\| lockKind;/);
  assert.match(form, /\{kindLocked \? \(/);
  assert.match(form, /<Label htmlFor="kind-select">Membership type<\/Label>/);
  // The kind and the fixed plan travel with the form (the HTML `hidden` attribute; the form has no type="hidden" input).
  assert.match(form, /<input name="kind" value=\{kind\} readOnly hidden \/>/);
  assert.match(form, /<input name="plan" value="class_count" readOnly hidden \/>/);
  assert.doesNotMatch(form, /type="hidden"/);
  // The class-count fields: the class total, and an optional end date that is never calculated.
  assert.match(form, /name="total_classes"/);
  assert.match(form, /Number of Classes/);
  assert.match(form, /\{isClassCount \? "End Date \(optional\)" : "End Date"\}/);
  assert.match(form, /required=\{!isClassCount\}/);
  assert.match(form, /Leave empty for no expiry\./);
  // The duration plan dropdown and its end-date calculation are untouched.
  assert.deepEqual(
    [...form.match(/const PLAN_OPTIONS = \[([\s\S]*?)\];/)[1].matchAll(/value: "(\w+)"/g)].map((m) => m[1]),
    ["monthly", "quarterly", "half_yearly", "annual", "custom"],
  );
  assert.match(form, /calculateMembershipEndDate\(nextPlan, nextStartDate\)/);
  // The review step shows the class total and says No expiry in place of an empty end date.
  assert.match(form, /endDate: input\.end_date \|\| "No expiry",/);
  assert.match(form, /<ReviewRow icon=\{Hash\} label="Classes">/);
  // Changing a recorded membership's class total below the recorded classes is explained to the Admin.
  assert.match(form, /been recorded, so the total cannot be lower\./);
});

test("Edit passes the recorded count; Renew keeps the kind fixed", () => {
  assert.match(code("../../app/memberships/[id]/edit/page.js"), /classesUsed=\{membership\.class_count\?\.used \?\? 0\}/);
  assert.match(code("../../app/memberships/[id]/renew/page.js"), /\blockKind\b/);
});

// ---- renewal ------------------------------------------------------------------------------------------------------------------------------

test("renewing a class-count membership starts today at the centre, with the class total and amount carried over and no end date", () => {
  const renew = code("../../app/memberships/[id]/renew/page.js");
  assert.match(renew, /previous\.kind === "class_count"/);
  assert.match(renew, /kind: "class_count",\s*plan: "class_count",\s*start_date: await todayDateString\(\),\s*end_date: "",\s*total_classes: previous\.total_classes,\s*amount: startingAmount,/);
  // It never reads a previous end date for it, and the duration branch is the existing one.
  const classCountBranch = renew.slice(renew.indexOf('previous.kind === "class_count"'), renew.indexOf(": (() =>"));
  assert.doesNotMatch(classCountBranch, /previous\.end_date|addOneDayUTC/);
  assert.match(renew, /const defaultStartDate = addOneDayUTC\(previous\.end_date\);/);
  assert.match(renew, /end_date: calculateMembershipEndDate\(previous\.plan, defaultStartDate\) \|\| defaultStartDate,/);
  // The amount is carried over by the existing rule: only when it was priced in the centre's current currency.
  assert.match(renew, /const startingAmount = previous\.currency === currency \? previous\.amount : "";/);
  assert.match(renew, /today=\{await todayDateString\(\)\}/);
});

// ---- data and screens -------------------------------------------------------------------------------------------------------------------------

test("the membership reads carry the kind, class total and recorded count - one embedded count, no new query", () => {
  const data = source("./data.js");
  for (const columns of [data.match(/const LIST_COLUMNS =\s*"([^"]+)"/)[1], data.match(/const DETAIL_COLUMNS =\s*"([^"]+)"/)[1]]) {
    assert.match(columns, /kind, plan, start_date, end_date, total_classes, class_count_attendance\(id, class_count_attendance_reversals\(id\)\), amount/);
  }
  assert.match(data, /membership_code, kind, plan, start_date, end_date, total_classes, class_count_attendance\(id, class_count_attendance_reversals\(id\)\), amount, currency, payment_status, payment_date, cancelled_at, invoices\(id, payment_id\), membership_payments\(id\)"\)/);
  assert.equal((data.match(/class_count: classCountOf\(membership, membership\.class_count_attendance\)/g) ?? []).length, 2, "list and history");
  assert.match(data, /class_count: classCountOf\(membership, classRows\),/, "details");
});

test("the screens show classes used and left for a class-count membership, and are unchanged for a duration one", () => {
  const card = code("../../app/memberships/membership-card-item.js");
  assert.match(card, /\{classCount \? \(\s*<p[^>]*>\{classCountText\(classCount\)\}<\/p>\s*\) : isActive && !validity\.noExpiry \? \(/);
  assert.match(card, /value=\{classCount \? classPercent : validity\.percentUsed\}/);
  assert.match(code("../../app/memberships/membership-table.js"), /membership\.class_count\s*\? ` · \$\{membership\.class_count\.remaining\} of \$\{membership\.class_count\.total\} left`/);
  const details = code("../../app/memberships/[id]/page.js");
  assert.match(details, /classCount\s*\? `\$\{classCount\.remaining\} left`/);
  assert.match(details, /classCount\s*\? classCountText\(classCount\)/);
  assert.match(code("../../app/students/[id]/page.js"), /<DetailRow label="Classes">\{classCountText\(currentMembership\.class_count\)\}<\/DetailRow>/);
  // A duration membership still reads days: the card's days, the details' "used of total days".
  assert.match(card, /\{validity\.daysLeft\} \/ \{validity\.totalDays\} days/);
  assert.match(details, /`\$\{used\} of \$\{validity\.totalDays\} days`/);
});
