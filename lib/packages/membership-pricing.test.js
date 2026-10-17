// Run with `npm test` (Node's built-in test runner).
//
// FS-6 step 5: the pricing breakdown on Membership Details. The mapping from the stored columns is tested directly - a legacy
// membership, a standard duration membership, a class-count membership and a Custom Fee Plan - and the rendering is pinned as
// source: it shows stored values only and never reads a package, a fee entry or the pricing rules.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pricingSnapshotOf } from "./membership-pricing.js";
import { validateMembershipNotes } from "./membership-creation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const NULLS = {
  package_id: null, package_name: null, duration_months: null, pricing_mode: null, standard_fee: null, package_discount: null,
  individual_discount_type: null, individual_discount_value: null, individual_discount_amount: null,
  individual_discount_reason_code: null, individual_discount_note: null, custom_fee_reason: null, custom_fee_confirmed_at: null,
};

const LEGACY = { ...NULLS, id: "m0", kind: "duration", plan: "monthly", start_date: "2026-01-01", end_date: "2026-01-31", total_classes: null, amount: 1000, currency: "INR" };

const QUARTERLY = {
  ...NULLS, id: "m1", kind: "duration", plan: "quarterly", start_date: "2026-10-08", end_date: "2027-01-07", total_classes: null, amount: "3780.00", currency: "INR",
  package_id: "pkg-1", package_name: "Yoga Monthly", duration_months: 3, pricing_mode: "standard", standard_fee: "4500.00", package_discount: "300.00",
  individual_discount_type: "percent", individual_discount_value: "10.00", individual_discount_amount: "420.00", individual_discount_reason_code: "promotional_offer",
};

const CLASSES = {
  ...NULLS, id: "m2", kind: "class_count", plan: "class_count", start_date: "2026-10-08", end_date: null, total_classes: 8, amount: "1800.00", currency: "INR",
  package_id: "pkg-2", package_name: "Eight Classes", pricing_mode: "standard", standard_fee: "2000.00",
  individual_discount_type: "fixed", individual_discount_value: "200.00", individual_discount_amount: "200.00",
  individual_discount_reason_code: "other", individual_discount_note: "Family member",
};

const CUSTOM = {
  ...NULLS, id: "m3", kind: "duration", plan: "custom", start_date: "2026-10-08", end_date: "2028-01-07", total_classes: null, amount: "1234.50", currency: "INR",
  package_id: "pkg-1", package_name: "Yoga Monthly", duration_months: 15, pricing_mode: "custom_fee_plan",
  custom_fee_reason: "Founding member price", custom_fee_confirmed_at: "2026-10-13T09:30:00+00:00",
};

test("a legacy membership has no recorded breakdown: nothing is mapped and its details stay as they were", () => {
  assert.equal(pricingSnapshotOf(LEGACY), null);
  assert.equal(pricingSnapshotOf(null), null);
  assert.equal(pricingSnapshotOf({ ...LEGACY, package_id: "pkg-1" }), null, "a package without a recorded pricing mode shows nothing invented");
});

test("a standard duration membership: the recorded package, terms, standard fee, discounts with their reason, and final fee", () => {
  const snapshot = pricingSnapshotOf(QUARTERLY);
  assert.deepEqual(
    { ...snapshot, individual: undefined },
    {
      mode: "standard", packageName: "Yoga Monthly", kind: "duration", plan: "quarterly", durationMonths: 3, totalClasses: null,
      startDate: "2026-10-08", endDate: "2027-01-07", currency: "INR", finalFee: 3780, standardFee: 4500, packageDiscount: 300,
      individual: undefined, customReason: null, confirmedAt: null,
    }
  );
  assert.deepEqual(snapshot.individual, { type: "percent", value: 10, amount: 420, reason: "Promotional Offer", note: null });
});

test("a class-count membership: its allowance, no expiry, the price and a discount whose reason is Other with its explanation", () => {
  const snapshot = pricingSnapshotOf(CLASSES);
  assert.deepEqual(
    [snapshot.kind, snapshot.totalClasses, snapshot.endDate, snapshot.standardFee, snapshot.packageDiscount, snapshot.finalFee],
    ["class_count", 8, null, 2000, null, 1800]
  );
  assert.deepEqual(snapshot.individual, { type: "fixed", value: 200, amount: 200, reason: "Other", note: "Family member" });
});

test("a Custom Fee Plan shows its agreed fee and reason, and no standard fee or discounts it never had", () => {
  const snapshot = pricingSnapshotOf({ ...CUSTOM, standard_fee: "9999.00", package_discount: "100.00", individual_discount_type: "fixed", individual_discount_amount: "5.00" });
  assert.equal(snapshot.mode, "custom_fee_plan");
  assert.equal(snapshot.finalFee, 1234.5);
  assert.equal(snapshot.customReason, "Founding member price");
  assert.equal(snapshot.confirmedAt, "2026-10-13T09:30:00+00:00");
  assert.deepEqual([snapshot.standardFee, snapshot.packageDiscount, snapshot.individual], [null, null, null], "even stray columns are not shown");
  assert.equal(snapshot.durationMonths, 15);
});

test("the mapping reads the membership alone: no package, fee entry or pricing rule can change it", () => {
  const mapper = code("./membership-pricing.js");
  assert.doesNotMatch(mapper, /import[^;]*(pricing|service-core|data|duration)/, "only the reason labels are imported");
  const before = JSON.stringify(pricingSnapshotOf(QUARTERLY));
  // The same stored row maps identically however the package has changed since: there is no input to change.
  assert.equal(JSON.stringify(pricingSnapshotOf({ ...QUARTERLY })), before);
  assert.equal(pricingSnapshotOf.length, 1);
});

test("Membership Details: the panel appears only for a package-linked membership and displays stored values only", () => {
  const page = code("../../app/memberships/[id]/page.js");
  assert.match(page, /const pricing = pricingSnapshotOf\(membership\);/);
  assert.match(page, /\{pricing \? <PricingPanel snapshot=\{pricing\} membershipId=\{membership\.id\} canEdit=\{membership\.status !== "cancelled"\} \/> : null\}/);
  // The panel never reads a package, a fee, or the pricing rules.
  const panel = code("../../app/memberships/[id]/pricing-panel.js");
  assert.doesNotMatch(panel, /lib\/packages\/(data|service-core|pricing|membership-creation)|getPackage|previewStandardPrice|priceStandardMembership/);
  assert.match(panel, /snapshot\.standardFee/);
  assert.match(panel, /snapshot\.finalFee/);
  // A Custom Fee Plan branch shows the reason and no standard fee row.
  const custom = panel.slice(panel.indexOf("isCustomPlan ? ("), panel.indexOf(") : ("));
  assert.match(custom, /snapshot\.customReason/);
  assert.doesNotMatch(custom, /standardFee|packageDiscount|individual/);
  // The detail read adds the stored snapshot columns.
  const data = code("../memberships/data.js");
  for (const column of ["package_name", "pricing_mode", "standard_fee", "package_discount", "individual_discount_reason_code", "custom_fee_reason"]) {
    assert.ok(data.includes(column), column);
  }
});

test("the switching radios are grouped for the arrow keys but belong to no form, so nothing extra is submitted", () => {
  const form = code("../../app/memberships/package-membership-form.js");
  assert.match(form, /<input id=\{id\} type="radio" name=\{group\} form=\{NO_FORM\}/);
  assert.match(form, /const NO_FORM = "package-membership-switches-none"/);
  assert.equal([...form.matchAll(/group="(expiry|pricing)"/g)].length, 4, "both options of both groups");
  // No element carries that id, so the radios have no form owner.
  assert.doesNotMatch(form, /id="package-membership-switches-none"/);
});

// ---- FS-6 step 6: Edit protections --------------------------------------------------------------------------------------------------------------

test("the notes of a package-linked membership: trimmed, up to 1000 characters, empty becomes none", () => {
  assert.deepEqual(validateMembershipNotes("  Paid in cash  "), { success: true, data: "Paid in cash" });
  assert.deepEqual(validateMembershipNotes("   "), { success: true, data: null });
  assert.deepEqual(validateMembershipNotes(null), { success: true, data: null });
  assert.equal(validateMembershipNotes("x".repeat(1000)).success, true);
  assert.equal(validateMembershipNotes("x".repeat(1001)).errors.notes, "Notes must be 1000 characters or fewer.");
});

test("the legacy Edit form keeps every field it had; a package-linked membership is edited in the unified Edit Membership editor", () => {
  // The legacy form is unchanged: Plan, Start Date, End Date, Amount and Notes (and the class total of a class-count membership).
  const legacy = code("../../app/memberships/membership-form.js");
  const body = legacy.slice(legacy.indexOf("function LegacyMembershipForm("), legacy.indexOf("export default function MembershipForm("));
  for (const name of ["plan", "start_date", "end_date", "amount", "notes", "total_classes", "kind"]) {
    assert.ok(body.includes(`name="${name}"`), name + " is still on the legacy form");
  }

  // The shared form no longer special-cases a package membership: the Edit page chooses the editor by the membership's own package.
  assert.doesNotMatch(legacy, /PackageMembershipEditForm|membership\?\.package_id\) return/);
  const page = code("../../app/memberships/[id]/edit/page.js");
  assert.match(page, /const isPackageLinked = Boolean\(membership\.package_id\);/);
  assert.match(page, /isPackageLinked \? \(\s*<PackageMembershipEditor/);
  assert.match(page, /action=\{updateMembership\.bind\(null, id\)\}/, "the legacy form still saves through updateMembership");
});

test("server side: the ordinary action refuses a package membership, the unified save is the only way to change one, and the database guard is the last line", () => {
  const actions = code("../memberships/actions.js");
  assert.doesNotMatch(actions, /updatePackageMembershipNotes/);
  const update = actions.slice(actions.indexOf("export async function updateMembership("), actions.indexOf("export async function cancelMembership("));
  assert.match(update, /if \(existing\.package_id\) \{\s*return \{ error: PACKAGE_MEMBERSHIP_EDIT_MESSAGE/);
  // The legacy path is otherwise the same: it still writes the validated data of the form.
  assert.match(update, /\.update\(result\.data\)\.eq\("id", id\)/);

  const unified = code("../memberships/corrections.js");
  assert.match(unified, /export async function saveMembershipEdit\(/);
  assert.match(unified, /\.update\(\{ notes: notes\.data \}\)\.eq\("id", membershipId\)/, "the only direct write is the notes");

  const migration = source("../../supabase/migrations/0048_package_linked_memberships.sql");
  assert.match(migration, /The package, fee, discounts and terms of a package membership cannot be edited directly\./);
});
