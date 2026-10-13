// Run with `npm test` (Node's built-in test runner).
//
// FS-6 step 1: creating a package-linked membership. The validation, the preview that checks "Record Payment Now" against
// the fee the database is expected to resolve, and the order of the writes are tested directly, with the real payment
// code and the real `create_membership_from_package` call shape (only the Supabase client is faked). The database
// stays the authority for pricing and dates; nothing here claims it agrees beyond the shared example below. The action
// itself needs a server, so its wiring is pinned as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWithInitialPayment } from "../memberships/initial-payment.js";
import {
  createPackageMembershipRecord,
  PACKAGE_MEMBERSHIP_FIELDS,
  packageMembershipInputOf,
  preparePackageMembership,
  previewFinalFeePaise,
  previewStandardPrice,
  validatePackageMembershipInput,
} from "./membership-creation.js";
import { fetchActivePackages, fetchPackageForPricing, matchKnownPackageError } from "./service-core.js";

const TODAY = "2026-10-13";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const form = (fields) => ({ get: (name) => fields[name] ?? null });

// The example of the 0048 behaviour script (P1): 1500 x 3 months, a fixed 300 package discount, 10% of the remainder.
const PACKAGE = {
  id: "pkg-1",
  name: "Yoga Monthly",
  kind: "duration",
  status: "active",
  total_classes: null,
  options: ["monthly", "quarterly", "half_yearly", "annual", "custom"],
  feeEntries: [
    { effective_from: "2026-07-05", currency: "INR", monthly_fee: 1000, price: null, cancelled_at: null, package_fee_entry_discounts: [] },
    {
      effective_from: "2026-10-03",
      currency: "INR",
      monthly_fee: 1500,
      price: null,
      cancelled_at: null,
      package_fee_entry_discounts: [
        { duration_option: "quarterly", discount_type: "fixed", fixed_amount: 300, percent_value: null },
        { duration_option: "half_yearly", discount_type: "percent", fixed_amount: null, percent_value: 10 },
      ],
    },
  ],
};
const CLASS_PACKAGE = {
  id: "pkg-2",
  name: "Eight Classes",
  kind: "class_count",
  status: "active",
  total_classes: 8,
  options: [],
  feeEntries: [{ effective_from: "2026-10-03", currency: "INR", monthly_fee: null, price: 2000, cancelled_at: null, package_fee_entry_discounts: [] }],
};

const QUARTERLY = {
  package_id: "pkg-1",
  duration_option: "quarterly",
  start_date: "2026-10-08",
  individual_discount_type: "percent",
  individual_discount_value: "10",
  individual_discount_reason: "promotional_offer",
};

const cash = (amount) => ({ method: "cash", amount, referenceId: "", notes: "" });

function fakeSupabase(replies = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const reply = replies[name] ?? { data: null, error: null };
      return typeof reply === "function" ? reply(args) : reply;
    },
  };
}

// ---- reading and validating the form -----------------------------------------------------------------------------------------

test("the form is read field by field, as strings", () => {
  const raw = packageMembershipInputOf(form({ package_id: "pkg-1", start_date: "2026-10-08" }));
  assert.equal(raw.package_id, "pkg-1");
  assert.equal(raw.duration_option, null);
});

test("a duration membership: the option, Custom months, no end date, and the discount with its reason", () => {
  const ok = validatePackageMembershipInput(QUARTERLY, "duration");
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.individualDiscount, { type: "percent", value: "10", reasonCode: "promotional_offer", reasonNote: null });
  assert.equal(ok.data.months, 3);
  assert.equal(ok.data.pricingMode, "standard");

  const custom = validatePackageMembershipInput({ ...QUARTERLY, duration_option: "custom", custom_months: "14" }, "duration");
  assert.equal(custom.data.customMonths, 14);
  assert.equal(validatePackageMembershipInput({ ...QUARTERLY, duration_option: "custom", custom_months: "0" }, "duration").errors.custom_months.length > 0, true);

  const withEnd = validatePackageMembershipInput({ ...QUARTERLY, end_date: "2027-01-07" }, "duration");
  assert.equal(withEnd.errors.end_date, "The end date of a duration package is calculated.");
  assert.equal(validatePackageMembershipInput({ ...QUARTERLY, duration_option: "" }, "duration").success, false);
});

test("a class-count membership: no duration, an optional expiry on or after the start", () => {
  const base = { package_id: "pkg-2", start_date: "2026-10-08" };
  assert.deepEqual(validatePackageMembershipInput(base, "class_count").data.endDate, null);
  assert.equal(validatePackageMembershipInput({ ...base, end_date: "2027-01-01" }, "class_count").data.endDate, "2027-01-01");
  assert.equal(validatePackageMembershipInput({ ...base, end_date: "2026-10-07" }, "class_count").errors.end_date, "The expiry date cannot be before the start date.");
  assert.equal(validatePackageMembershipInput({ ...base, duration_option: "monthly" }, "class_count").errors.duration_option, "A class-count package has no duration.");
});

test("an individual discount needs its reason (Other needs an explanation); a missing package or start date is refused", () => {
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_reason: "" }, "duration").errors.discount_reason);
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_reason: "other" }, "duration").errors.discount_note);
  assert.equal(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_reason: "other", individual_discount_note: "Family member" }, "duration").success, true);
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_value: "0" }, "duration").errors.discount);
  assert.equal(validatePackageMembershipInput(QUARTERLY, null).errors.package_id, "Select a package.");
  assert.equal(validatePackageMembershipInput({ ...QUARTERLY, start_date: "2026-02-30" }, "duration").errors.start_date, "Enter a valid start date.");
});

test("a Custom Fee Plan needs the fee, a reason and the explicit confirmation, and takes no discount", () => {
  const plan = { package_id: "pkg-1", duration_option: "monthly", start_date: "2026-10-08", pricing_mode: "custom_fee_plan", custom_fee: "1234.5", custom_fee_reason: "Founding member price", custom_fee_confirmed: "on" };
  const ok = validatePackageMembershipInput(plan, "duration");
  assert.equal(ok.success, true);
  assert.equal(ok.data.customFee, "1234.50");
  assert.equal(ok.data.confirmed, true);
  assert.equal(validatePackageMembershipInput({ ...plan, custom_fee_confirmed: "" }, "duration").errors.custom_fee_confirmed.length > 0, true);
  assert.ok(validatePackageMembershipInput({ ...plan, custom_fee_reason: "ab" }, "duration").errors.custom_fee_reason);
  assert.ok(validatePackageMembershipInput({ ...plan, custom_fee: "0" }, "duration").errors.custom_fee);
  assert.equal(validatePackageMembershipInput({ ...plan, individual_discount_type: "fixed", individual_discount_value: "5" }, "duration").errors.discount, "A Custom Fee Plan takes no discounts.");
  assert.ok(validatePackageMembershipInput({ ...plan, pricing_mode: "weekly" }, "duration").errors.pricing_mode);
});

// ---- the preview, and the first payment checked against it -----------------------------------------------------------------------

test("the preview is the FS-1 calculation of the 0048 example: 4500 - 300 - 10% of 4200 = 3780", () => {
  const { data } = validatePackageMembershipInput(QUARTERLY, "duration");
  assert.deepEqual(previewFinalFeePaise(PACKAGE, data, "INR"), { success: true, finalFeePaise: 378000 });
  // The start date decides the entry: before 3 Oct the older 1000 applies.
  const earlier = validatePackageMembershipInput({ ...QUARTERLY, start_date: "2026-09-01", individual_discount_type: "", individual_discount_value: "", individual_discount_reason: "" }, "duration").data;
  assert.equal(previewFinalFeePaise(PACKAGE, earlier, "INR").finalFeePaise, 300000);
  // No valid standard fee: another currency, or no entry in effect.
  assert.equal(previewFinalFeePaise(PACKAGE, data, "USD").success, false);
  assert.equal(previewFinalFeePaise(PACKAGE, { ...data, startDate: "2026-01-01" }, "INR").success, false);
  const classData = validatePackageMembershipInput({ package_id: "pkg-2", start_date: "2026-10-08" }, "class_count").data;
  assert.equal(previewFinalFeePaise(CLASS_PACKAGE, classData, "INR").finalFeePaise, 200000);
});

test("Record Payment Now is checked against the resolved fee before anything is written", () => {
  const args = (methods) => ({
    raw: QUARTERLY,
    pkg: PACKAGE,
    centreCurrency: "INR",
    today: TODAY,
    initialPaymentRaw: JSON.stringify({ paymentDate: TODAY, methods, issueTaxInvoice: false }),
  });

  const full = preparePackageMembership(args([cash("3780")]));
  assert.equal(full.success, true);
  assert.equal(full.payment.methods[0].amount, "3780.00");

  const over = preparePackageMembership(args([cash("3780.01")]));
  assert.equal(over.success, false);
  assert.ok(over.paymentErrors && Object.keys(over.paymentErrors).length > 0, "a payment above the resolved fee is refused");

  const none = preparePackageMembership({ ...args([]), initialPaymentRaw: null });
  assert.deepEqual([none.success, none.payment], [true, null]);
});

test("with no fee to preview the payment is checked by its own rules, and the database refuses what does not fit", () => {
  const result = preparePackageMembership({
    raw: QUARTERLY,
    pkg: { ...PACKAGE, feeEntries: [] },
    centreCurrency: "INR",
    today: TODAY,
    initialPaymentRaw: JSON.stringify({ paymentDate: TODAY, methods: [cash("100")], issueTaxInvoice: false }),
  });
  assert.equal(result.success, true);
  assert.equal(result.payment.methods[0].amount, "100.00");
});

test("a deactivated or missing package is refused before anything is written", () => {
  const inactive = preparePackageMembership({ raw: QUARTERLY, pkg: { ...PACKAGE, status: "inactive" }, centreCurrency: "INR", today: TODAY, initialPaymentRaw: null });
  assert.equal(inactive.errors.package_id, "This package is deactivated and cannot be chosen for a new membership.");
  const missing = preparePackageMembership({ raw: QUARTERLY, pkg: null, centreCurrency: "INR", today: TODAY, initialPaymentRaw: null });
  assert.equal(missing.errors.package_id, "Select a package.");
});

// ---- the database call and the order of the writes --------------------------------------------------------------------------------------

test("the membership is created by create_membership_from_package with the validated fields, never an amount", async () => {
  const supabase = fakeSupabase({ create_membership_from_package: { data: "mem-1", error: null } });
  const { data } = validatePackageMembershipInput(QUARTERLY, "duration");
  assert.deepEqual(await createPackageMembershipRecord(supabase, "student-1", data), { id: "mem-1" });
  const [call] = supabase.calls;
  assert.equal(call.name, "create_membership_from_package");
  assert.deepEqual(call.args, {
    p_student_id: "student-1",
    p_package_id: "pkg-1",
    p_duration_option: "quarterly",
    p_custom_months: null,
    p_start_date: "2026-10-08",
    p_end_date: null,
    p_individual_type: "percent",
    p_individual_value: "10",
    p_reason_code: "promotional_offer",
    p_reason_note: null,
    p_pricing_mode: "standard",
    p_custom_fee: null,
    p_custom_reason: null,
    p_confirmed: null,
    p_notes: null,
  });
  assert.equal(Object.keys(call.args).some((key) => /amount|end_date_calc|final/.test(key)), false);
});

test("the database's refusals come back on the form's fields, an overlap included", async () => {
  const { data } = validatePackageMembershipInput(QUARTERLY, "duration");
  const refuse = (code, message) => fakeSupabase({ create_membership_from_package: { data: null, error: { code, message } } });

  const noFee = await createPackageMembershipRecord(refuse("55000", "No fee applies to this package on the start date. Schedule a fee, or use a Custom Fee Plan."), "s", data);
  assert.deepEqual(noFee.failure.fieldErrors, { start_date: "No fee applies to this package on the start date. Schedule a fee, or use a Custom Fee Plan." });
  assert.equal(noFee.failure.error, "Check the highlighted fields.");

  const overlap = await createPackageMembershipRecord(refuse("23P01", 'conflicting key value violates exclusion constraint "memberships_no_overlap_per_student"'), "s", data);
  assert.deepEqual(overlap.failure.fieldErrors, { start_date: "This student already has a membership covering part of this period." });

  const discount = await createPackageMembershipRecord(refuse("22023", "The discounts together cannot be more than the standard fee."), "s", data);
  assert.deepEqual(Object.keys(discount.failure.fieldErrors), ["discount"]);

  const unknown = await createPackageMembershipRecord(refuse("XX000", "boom"), "s", data);
  assert.deepEqual(unknown, { failure: { error: "Could not create the membership. Try again." } });
});

test("create, then the payment through the existing record_membership_payment, in that order and once", async () => {
  const supabase = fakeSupabase({
    create_membership_from_package: { data: "mem-1", error: null },
    record_membership_payment: { data: "payment-1", error: null },
  });
  const prepared = preparePackageMembership({
    raw: QUARTERLY,
    pkg: PACKAGE,
    centreCurrency: "INR",
    today: TODAY,
    initialPaymentRaw: JSON.stringify({ paymentDate: TODAY, methods: [cash("3780")], issueTaxInvoice: true }),
  });
  const outcome = await createWithInitialPayment({
    supabase,
    payment: prepared.payment,
    create: () => createPackageMembershipRecord(supabase, "student-1", prepared.data),
  });
  assert.deepEqual(outcome, { id: "mem-1", payment: { recorded: true, paymentId: "payment-1" } });
  assert.deepEqual(supabase.calls.map((call) => call.name), ["create_membership_from_package", "record_membership_payment"]);
  assert.equal(supabase.calls[1].args.p_membership_id, "mem-1");
});

test("a refused membership attempts no payment; a refused payment leaves the membership, reported as not recorded", async () => {
  const { data } = validatePackageMembershipInput(QUARTERLY, "duration");
  const payment = { paymentDate: TODAY, methods: [{ method: "cash", amount: "100.00", referenceId: null, notes: null }], issueTaxInvoice: null };

  const refused = fakeSupabase({ create_membership_from_package: { data: null, error: { code: "55006", message: "This package is deactivated and cannot be chosen for a new membership." } } });
  const failed = await createWithInitialPayment({ supabase: refused, payment, create: () => createPackageMembershipRecord(refused, "s", data) });
  assert.ok(failed.failure);
  assert.deepEqual(refused.calls.map((call) => call.name), ["create_membership_from_package"]);

  const unpaid = fakeSupabase({
    create_membership_from_package: { data: "mem-1", error: null },
    record_membership_payment: { data: null, error: { code: "22023", message: "The payment cannot be more than the outstanding balance." } },
  });
  const saved = await createWithInitialPayment({ supabase: unpaid, payment, create: () => createPackageMembershipRecord(unpaid, "s", data) });
  assert.equal(saved.id, "mem-1");
  assert.equal(saved.payment.recorded, false);
});

// ---- the package picker's data --------------------------------------------------------------------------------------------------------

test("the picker reads the active packages with their fee entries and discounts; one package for pricing, active or not", async () => {
  let query = null;
  const chain = (rows) => {
    const builder = {
      select: (columns) => { query = { columns }; return builder; },
      eq: (column, value) => { query = { ...query, column, value }; return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  const row = { id: "pkg-1", name: "Yoga", kind: "duration", status: "active", package_duration_options: [{ duration_option: "quarterly" }, { duration_option: "monthly" }], package_fee_entries: [{ id: "e1", package_fee_entry_discounts: [] }] };

  const list = await fetchActivePackages({ from: () => chain([row]) });
  assert.deepEqual(query.column, "status");
  assert.equal(query.value, "active");
  assert.match(query.columns, /package_fee_entry_discounts\(/);
  assert.deepEqual(list[0].options, ["monthly", "quarterly"]);
  assert.equal(list[0].feeEntries.length, 1);

  const one = await fetchPackageForPricing({ from: () => chain([row]) }, "pkg-1");
  assert.equal(query.column, "id");
  assert.equal(one.feeEntries[0].id, "e1");
  assert.equal(await fetchPackageForPricing({ from: () => chain([]) }, "nope"), null);
});

test("an exclusion violation is a known package error on the start date", () => {
  const known = matchKnownPackageError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "memberships_no_overlap_per_student"' });
  assert.equal(known.fieldErrors.startDate, "This student already has a membership covering part of this period.");
});

// ---- the action's wiring (it needs a server, so it is pinned as source) ------------------------------------------------------------------

test("the action is Admin-only, creates through the database function, and reuses the first-payment flow", () => {
  const actions = source("../memberships/actions.js");
  const body = actions.slice(actions.indexOf("export async function createPackageMembership("), actions.indexOf("export async function updateMembership("));
  assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") > 0);
  assert.ok(body.indexOf("await requireRole(ROLES.ADMIN);") < body.indexOf("createClient()"), "the Admin check comes first");
  assert.match(body, /createWithInitialPayment\(/);
  assert.match(body, /createPackageMembershipRecord\(supabase, studentId, prepared\.data\)/);
  assert.match(body, /redirectAfterCreate\(context, studentId, outcome\.id\)/);
  assert.match(body, /PAYMENT_NOT_RECORDED_NOTICE/);
  assert.doesNotMatch(body, /\.from\("memberships"\)|record_membership_payment|recordPaymentFor/, "no second membership write or payment implementation");

  // The legacy create path is unchanged: it still inserts the membership itself.
  const legacy = actions.slice(actions.indexOf("export async function createMembership("), actions.indexOf("/**\n * Creates a package-linked membership"));
  assert.match(legacy, /\.from\("memberships"\)/);
  assert.doesNotMatch(legacy, /createPackageMembershipRecord|create_membership_from_package/);
});

test("the picker data is an Admin-only server read", () => {
  const data = source("./data.js");
  assert.match(data, /export async function getActivePackages\(\) \{\s*await requireRole\(ROLES\.ADMIN\);\s*return fetchActivePackages\(await createClient\(\)\);/);
});

// ---- FS-6 step 2: the form --------------------------------------------------------------------------------------------------------------

const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the breakdown the form shows: standard fee, package discount, individual discount, final fee - or why no price applies", () => {
  const priced = previewStandardPrice(PACKAGE, { startDate: "2026-10-08", months: 3 }, "INR");
  assert.deepEqual(
    [priced.standardFeePaise, priced.packageDiscountPaise, priced.packageDiscountSource, priced.individualDiscountPaise, priced.finalFeePaise],
    [450000, 30000, "quarterly", 0, 420000]
  );
  // Custom 14 months uses the largest standard duration not exceeding it (annual - none configured here), Custom 2 months none.
  assert.equal(previewStandardPrice(PACKAGE, { startDate: "2026-10-08", months: 2 }, "INR").packageDiscountPaise, 0);
  assert.equal(previewStandardPrice(PACKAGE, { startDate: "2026-10-08", months: 14 }, "INR").packageDiscountSource, "annual");
  assert.match(previewStandardPrice(PACKAGE, { startDate: "2026-01-01", months: 3 }, "INR").message, /No standard fee is in effect/);
  assert.match(previewStandardPrice(PACKAGE, { startDate: "2026-10-08", months: 3 }, "USD").message, /not the centre's currency/);
  assert.equal(previewStandardPrice(null, { startDate: "2026-10-08", months: 3 }, "INR").success, false);
});

test("the package form sends no price, end date or amount; an invalid price cannot be saved; the fee is confirmed in Review", () => {
  const form = code("../../app/memberships/package-membership-form.js");
  // What is submitted: the package, duration, months, start date, the expiry of a class-count package, the discount or Custom
  // Fee Plan inputs, the notes and the pricing mode (plus the payment field). The radio groups only switch the form.
  const submitted = [...form.matchAll(/\bname="([a-z_]+)"/g)].map((m) => m[1]);
  assert.doesNotMatch(form, /name="(expiry_mode|pricing_choice)"/, "the switching radios submit nothing");
  assert.deepEqual(
    [...new Set(submitted)].sort(),
    [
      "custom_fee", "custom_fee_confirmed", "custom_fee_reason", "custom_months", "duration_option", "end_date",
      "individual_discount_note", "individual_discount_reason", "individual_discount_type", "individual_discount_value",
      "notes", "package_id", "pricing_mode", "start_date",
    ]
  );
  // Every submitted name is a field of PACKAGE_MEMBERSHIP_FIELDS, and no price or amount is ever submitted.
  for (const name of new Set(submitted)) assert.ok(PACKAGE_MEMBERSHIP_FIELDS.includes(name), name);
  assert.doesNotMatch(form, /name="(amount|standard_fee|final_fee|package_discount)"/);
  // end_date is only the optional expiry of a class-count package, never the calculated end date of a duration package.
  assert.ok(form.indexOf('name="end_date"') > form.indexOf("isClassCount ? ("), "the end_date input belongs to the class-count expiry");
  assert.match(form, /expiryChosen \? \(\s*<div[^]*?name="end_date"/);
  // The end date is displayed read-only.
  assert.match(form, /id="end_date_display" value=\{[^}]*\} readOnly/);
  // Saving needs a valid price and end date; Review opens only then, and its confirm button names the final fee.
  assert.match(form, /const canSave = Boolean\(pkg\) && datesReady && priceOk;/);
  assert.match(form, /disabled=\{isPending \|\| !canSave\}/);
  assert.match(form, /Confirm \$\{formatCurrency\(fromPaise\(review\.finalPaise\), currency\)\} & Save/);
  // The existing payment section and notice flow are reused, checked against the previewed fee.
  assert.match(form, /fieldName=\{INITIAL_PAYMENT_FIELD\}/);
  assert.match(form, /validateInitialPayment\(payment\.input, \{ amount: fromPaise\(finalPaise\), today \}\)/);
});

test("package mode is offered only where packages and the action are given; every other form is the unchanged legacy form", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.match(form, /function LegacyMembershipForm\(\{/);
  assert.match(form, /Boolean\(packageAction\) && !membership && Array\.isArray\(packages\) && packages\.length > 0/);
  assert.match(form, /if \(!offersPackages\) return <LegacyMembershipForm \{\.\.\.props\} \/>;/);
  // The four creation entry points pass them, each with its own context; Edit never does.
  assert.match(code("../../app/memberships/new/page.js"), /packageAction=\{createPackageMembership\.bind\(null, studentId, "standalone"\)\}/);
  assert.match(code("../../app/students/[id]/memberships/new/page.js"), /createPackageMembership\.bind\(null, id, context\)/);
  assert.match(code("../../app/students/[id]/memberships/new/page.js"), /const context = isGuided \? "guided" : "student";/);
  assert.match(code("../../app/memberships/[id]/renew/page.js"), /createPackageMembership\.bind\(null, previous\.student_id, "renewal"\)/);
  assert.doesNotMatch(code("../../app/memberships/[id]/edit/page.js"), /packageAction|createPackageMembership|getActivePackages/);
});

// ---- FS-6 step 3: class-count packages, the individual discount and the Custom Fee Plan --------------------------------------------------

const repeat = (character, count) => character.repeat(count);

test("the individual discount reason: Other needs a trimmed 3 to 500 character explanation; the others need none", () => {
  const input = (reason, note) => ({ ...QUARTERLY, individual_discount_reason: reason, individual_discount_note: note });
  for (const code of ["promotional_offer", "returning_member", "special_approval"]) {
    assert.equal(validatePackageMembershipInput(input(code, ""), "duration").success, true, code);
  }
  assert.ok(validatePackageMembershipInput(input("other", "  ab  "), "duration").errors.discount_note, "two characters once trimmed");
  const three = validatePackageMembershipInput(input("other", "  abc  "), "duration");
  assert.equal(three.data.individualDiscount.reasonNote, "abc", "trimmed");
  assert.equal(validatePackageMembershipInput(input("other", repeat("x", 500)), "duration").success, true);
  assert.ok(validatePackageMembershipInput(input("other", repeat("x", 501)), "duration").errors.discount_note);
  assert.ok(validatePackageMembershipInput(input("bonus", ""), "duration").errors.discount_reason);
  // A fixed amount or a percentage, each with its own limits.
  assert.equal(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_type: "fixed", individual_discount_value: "250.50" }, "duration").success, true);
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_type: "fixed", individual_discount_value: "250.555" }, "duration").errors.discount);
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_value: "100.01" }, "duration").errors.discount);
  assert.ok(validatePackageMembershipInput({ ...QUARTERLY, individual_discount_type: "" }, "duration").errors.discount);
});

test("the Custom Fee Plan reason is trimmed and 3 to 500 characters; confirmation is explicit", () => {
  const plan = { package_id: "pkg-2", start_date: "2026-10-08", pricing_mode: "custom_fee_plan", custom_fee: "900", custom_fee_confirmed: "on" };
  const ok = validatePackageMembershipInput({ ...plan, custom_fee_reason: "  Founding member  " }, "class_count");
  assert.equal(ok.data.customReason, "Founding member");
  assert.equal(validatePackageMembershipInput({ ...plan, custom_fee_reason: repeat("r", 500) }, "class_count").success, true);
  assert.ok(validatePackageMembershipInput({ ...plan, custom_fee_reason: repeat("r", 501) }, "class_count").errors.custom_fee_reason);
  assert.ok(validatePackageMembershipInput({ ...plan, custom_fee_reason: " ab " }, "class_count").errors.custom_fee_reason);
  assert.ok(validatePackageMembershipInput({ ...plan, custom_fee_reason: "Founding member", custom_fee_confirmed: null }, "class_count").errors.custom_fee_confirmed);
  // The discount inputs of standard pricing are refused, not ignored.
  assert.equal(validatePackageMembershipInput({ ...plan, custom_fee_reason: "Founding member", individual_discount_note: "x" }, "class_count").errors.discount, "A Custom Fee Plan takes no discounts.");
});

test("the action payloads: a class-count membership with an expiry, one with none, a discount with Other, a Custom Fee Plan", async () => {
  const payload = async (raw, kind) => {
    const supabase = fakeSupabase({ create_membership_from_package: { data: "mem-1", error: null } });
    const validated = validatePackageMembershipInput(raw, kind);
    assert.equal(validated.success, true, JSON.stringify(validated.errors));
    await createPackageMembershipRecord(supabase, "student-1", validated.data);
    return supabase.calls[0].args;
  };

  const withExpiry = await payload({ package_id: "pkg-2", start_date: "2026-10-08", end_date: "2027-01-08" }, "class_count");
  assert.equal(withExpiry.p_end_date, "2027-01-08");
  assert.equal(withExpiry.p_duration_option, null);
  assert.equal(withExpiry.p_custom_months, null);

  const noExpiry = await payload({ package_id: "pkg-2", start_date: "2026-10-08", end_date: "" }, "class_count");
  assert.equal(noExpiry.p_end_date, null);

  const other = await payload({ ...QUARTERLY, individual_discount_type: "fixed", individual_discount_value: "100", individual_discount_reason: "other", individual_discount_note: "  Family member " }, "duration");
  assert.deepEqual(
    [other.p_individual_type, other.p_individual_value, other.p_reason_code, other.p_reason_note, other.p_pricing_mode, other.p_confirmed],
    ["fixed", "100", "other", "Family member", "standard", null]
  );

  const custom = await payload({ package_id: "pkg-2", start_date: "2026-10-08", pricing_mode: "custom_fee_plan", custom_fee: "1234.5", custom_fee_reason: "Founding member price", custom_fee_confirmed: "on" }, "class_count");
  assert.deepEqual(
    [custom.p_pricing_mode, custom.p_custom_fee, custom.p_custom_reason, custom.p_confirmed, custom.p_individual_type, custom.p_individual_value, custom.p_reason_code],
    ["custom_fee_plan", "1234.50", "Founding member price", true, null, null, null]
  );
});

test("a class-count package is priced from its price and a discount; a Custom Fee Plan's first payment is checked against the agreed fee", () => {
  const classData = validatePackageMembershipInput({ package_id: "pkg-2", start_date: "2026-10-08", individual_discount_type: "fixed", individual_discount_value: "250", individual_discount_reason: "special_approval" }, "class_count").data;
  const priced = previewStandardPrice(CLASS_PACKAGE, { startDate: classData.startDate, individualDiscount: classData.individualDiscount }, "INR");
  assert.deepEqual([priced.standardFeePaise, priced.packageDiscountPaise, priced.individualDiscountPaise, priced.finalFeePaise], [200000, 0, 25000, 175000]);
  assert.equal(previewStandardPrice(CLASS_PACKAGE, { startDate: "2026-10-08", individualDiscount: { type: "fixed", value: "2000" } }, "INR").success, false, "a final fee of 0 is not saveable");

  const prepare = (amount) => preparePackageMembership({
    raw: { package_id: "pkg-2", start_date: "2026-10-08", pricing_mode: "custom_fee_plan", custom_fee: "900", custom_fee_reason: "Founding member", custom_fee_confirmed: "on" },
    pkg: { ...CLASS_PACKAGE, feeEntries: [] },
    centreCurrency: "INR",
    today: TODAY,
    initialPaymentRaw: JSON.stringify({ paymentDate: TODAY, methods: [cash(amount)], issueTaxInvoice: false }),
  });
  assert.equal(prepare("900").success, true);
  assert.equal(prepare("900.01").success, false);
});

test("the form: class-count and Custom Fee Plan inputs, no duration or end date for a class-count package, the Review shows what was chosen", () => {
  const form = code("../../app/memberships/package-membership-form.js");
  // A class-count package shows its allowance and an expiry choice, and no duration options or calculated end date.
  assert.match(form, /isClassCount \? \(\s*<div className="flex flex-col gap-1">\s*<Label>Class allowance<\/Label>/);
  assert.match(form, /No expiry/);
  assert.match(form, /\{isClassCount \? null : \(\s*<div className="flex flex-col gap-2">\s*<Label htmlFor="end_date_display">/);
  // The Custom Fee Plan is an explicit choice (never the default), hides the discount controls, and needs its confirmation.
  assert.match(form, /useState\(saved\.pricing_mode === "custom_fee_plan" \? "custom_fee_plan" : "standard"\)/);
  assert.match(form, /\{isCustomPlan \? \(\s*<div className="flex flex-col gap-4 rounded-card border border-border p-4">[^]*?\) : \(\s*<div className="flex flex-col gap-3">[^]*?individual_discount_type_select/);
  assert.match(form, /name="custom_fee_confirmed"/);
  // The discount reason options are the approved four, with Other asking for an explanation.
  assert.match(form, /discountReason === "other" \?/);
  // Review: the type, the dates or classes, the discount with its reason or the Custom Fee Plan reason, the final fee.
  for (const label of ["Type", "Expiry", "Individual discount", "Pricing", "Reason", "Final agreed fee"]) assert.ok(form.includes(`label="${label}"`) || form.includes(`label={review.isClassCount ? "Expiry" : "End date"}`), label);
  assert.match(form, /reasonLabel\(review\.individual\.reasonCode\)/);
  assert.match(form, /review\.customReason/);
  // Only the standalone page passes packages, and the wrapper offers the form for any package type.
  assert.match(code("../../app/memberships/membership-form.js"), /Array\.isArray\(packages\) && packages\.length > 0/);
});

// ---- FS-6 step 4: the remaining entry points ------------------------------------------------------------------------------------------------

test("every entry point reads the same active packages and calls the same action; the legacy action keeps its own binding and redirects", () => {
  for (const page of ["../../app/memberships/new/page.js", "../../app/students/[id]/memberships/new/page.js", "../../app/memberships/[id]/renew/page.js"]) {
    const text = code(page);
    assert.match(text, /getActivePackages\(\)/, page);
    assert.match(text, /createMembership\.bind\(null, /, page + " keeps the legacy binding");
  }
  // Guided step 2 saves directly (no Review) and stays skippable; the same page binds the context for both actions.
  const student = code("../../app/students/[id]/memberships/new/page.js");
  assert.match(student, /requireConfirmation=\{!isGuided\}/);
  assert.match(student, /skipHref=\{isGuided \?/);
  // The action's redirects are those of createMembership, by context.
  const actions = source("../memberships/actions.js");
  const body = actions.slice(actions.indexOf("export async function createPackageMembership("), actions.indexOf("export async function updateMembership("));
  assert.match(body, /redirectAfterCreate\(context, studentId, outcome\.id\)/);
  assert.match(body, /context === "renewal" \? "renewed" : "created"/);
});

test("renewal: the previous membership's type, package, duration and start date carry over; an individual discount never does", () => {
  const renew = code("../../app/memberships/[id]/renew/page.js");
  assert.match(renew, /filter\(\(candidate\) => candidate\.kind === previous\.kind\)/, "a class-count membership is renewed as one");
  assert.match(renew, /defaultMode=\{previous\.package_id \? "package" : "manual"\}/, "a renewal of a legacy membership opens on the legacy form");
  assert.match(renew, /duration_option: previous\.plan/);
  assert.match(renew, /String\(previous\.duration_months\)/);
  assert.doesNotMatch(renew.slice(renew.indexOf("const packageInitialValues")), /individual_discount/);
  // The form starts every renewal with no discount: its initial values carry none.
  const form = code("../../app/memberships/package-membership-form.js");
  assert.match(form, /useState\(saved\.individual_discount_type \|\| "none"\)/);
  assert.doesNotMatch(form, /initialValues\?\.individual_discount/);
  assert.match(code("../memberships/data.js"), /package_id, package_name, duration_months, /, "the read tells a renewal which package the membership came from");
});
