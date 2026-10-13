// Run with `npm test` (Node's built-in test runner).
//
// V1 Fee Structure, FS-1 - pricing of package-linked memberships: the fee entry in effect on the start date, the
// standard fee, package and individual discounts with half-up rounding per stage, the limits, and the Custom Fee Plan
// (01-product.md §5 "Packages and Fee Structure"). Amounts are whole paise.

import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscountPaise, priceCustomFeePlan, priceStandardMembership, resolveStandardFeeEntry } from "./pricing.js";
import { resolveDurationMonths } from "./duration.js";
import { validateDiscountInput } from "./validation.js";

const discount = (type, value) => validateDiscountInput({ type, value }).data;
const fixed = (value) => discount("fixed", value);
const percent = (value) => discount("percent", value);

// A duration package's fee entry: ₹1,500 a month, with package discounts for some options.
function durationEntry(packageDiscounts = {}, monthlyFeePaise = 150000) {
  return { effectiveFrom: "2026-01-01", currency: "INR", monthlyFeePaise, packageDiscounts };
}

function priceDuration(option, { customMonths, packageDiscounts, monthlyFeePaise, individualDiscount = null } = {}) {
  const months = resolveDurationMonths(option, customMonths).data;
  return priceStandardMembership({
    kind: "duration",
    entry: durationEntry(packageDiscounts, monthlyFeePaise),
    months,
    individualDiscount,
  });
}

const ALL_DISCOUNTS = {
  monthly: fixed("100"),
  quarterly: fixed("300"),
  half_yearly: percent("10"),
  annual: percent("15"),
};

// ---- calculateDiscountPaise ---------------------------------------------------------------------------------------

test("a fixed discount is its own amount; no discount is 0", () => {
  assert.equal(calculateDiscountPaise(450000, fixed("300")), 30000);
  assert.equal(calculateDiscountPaise(450000, null), 0);
});

test("a percentage discount rounds half up to the paisa", () => {
  assert.equal(calculateDiscountPaise(450000, percent("10")), 45000);
  assert.equal(calculateDiscountPaise(333, percent("50")), 167); // 166.5 → 167
  assert.equal(calculateDiscountPaise(333, percent("49.99")), 166); // 166.4667 → 166
  assert.equal(calculateDiscountPaise(1, percent("50")), 1); // 0.5 → 1
  assert.equal(calculateDiscountPaise(1, percent("49.99")), 0); // 0.4999 → 0
  assert.equal(calculateDiscountPaise(100001, percent("100")), 100001);
});

// ---- standard pricing: the standard options -----------------------------------------------------------------------

test("the approved example: ₹1,500 × 3 − ₹300 package − ₹200 individual = ₹4,000", () => {
  const result = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: fixed("200") });
  assert.deepEqual(result, {
    success: true,
    data: {
      pricingMode: "standard",
      standardFeePaise: 450000,
      packageDiscountSource: "quarterly",
      packageDiscountPaise: 30000,
      individualDiscountPaise: 20000,
      finalFeePaise: 400000,
    },
  });
});

test("Monthly has no package discount, even when one is configured for it", () => {
  const result = priceDuration("monthly", { packageDiscounts: ALL_DISCOUNTS });
  assert.equal(result.data.standardFeePaise, 150000);
  assert.equal(result.data.packageDiscountSource, "monthly");
  assert.equal(result.data.packageDiscountPaise, 0);
  assert.equal(result.data.finalFeePaise, 150000);
});

test("Quarterly, Half Yearly and Annual take their own package discounts against monthly × months", () => {
  assert.deepEqual(
    [priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS }).data, priceDuration("half_yearly", { packageDiscounts: ALL_DISCOUNTS }).data, priceDuration("annual", { packageDiscounts: ALL_DISCOUNTS }).data].map(
      ({ standardFeePaise, packageDiscountSource, packageDiscountPaise, finalFeePaise }) => [
        standardFeePaise,
        packageDiscountSource,
        packageDiscountPaise,
        finalFeePaise,
      ]
    ),
    [
      [450000, "quarterly", 30000, 420000], // fixed ₹300
      [900000, "half_yearly", 90000, 810000], // 10% of ₹9,000
      [1800000, "annual", 270000, 1530000], // 15% of ₹18,000
    ]
  );
});

test("a standard option with no package discount configured has none", () => {
  const result = priceDuration("half_yearly", { packageDiscounts: { quarterly: fixed("300") } });
  assert.equal(result.data.packageDiscountPaise, 0);
  assert.equal(result.data.finalFeePaise, 900000);
  assert.equal(priceDuration("annual", { packageDiscounts: undefined }).data.packageDiscountPaise, 0);
});

// ---- standard pricing: Custom durations ---------------------------------------------------------------------------

test("Custom 2, 5, 7, 10, 12 and 13 months use the largest standard duration not exceeding them", () => {
  const expected = [
    [2, 300000, "monthly", 0], // Monthly: no package discount
    [5, 750000, "quarterly", 30000], // fixed ₹300
    [7, 1050000, "half_yearly", 105000], // 10% of ₹10,500
    [10, 1500000, "half_yearly", 150000], // 10% of ₹15,000
    [12, 1800000, "annual", 270000], // 15% of ₹18,000
    [13, 1950000, "annual", 292500], // 15% of ₹19,500
  ];
  for (const [months, standard, source, packageDiscountPaise] of expected) {
    const result = priceDuration("custom", { customMonths: String(months), packageDiscounts: ALL_DISCOUNTS });
    assert.equal(result.success, true, `${months} months`);
    assert.equal(result.data.standardFeePaise, standard, `${months} months standard fee`);
    assert.equal(result.data.packageDiscountSource, source, `${months} months source`);
    assert.equal(result.data.packageDiscountPaise, packageDiscountPaise, `${months} months package discount`);
    assert.equal(result.data.finalFeePaise, standard - packageDiscountPaise);
  }
});

test("Custom takes no package discount when the mapped duration has none configured - no other is searched", () => {
  // 5 months maps to Quarterly; Half Yearly and Monthly discounts exist but are never used instead.
  const result = priceDuration("custom", {
    customMonths: "5",
    packageDiscounts: { monthly: fixed("100"), half_yearly: percent("10"), annual: percent("15") },
  });
  assert.equal(result.data.packageDiscountSource, "quarterly");
  assert.equal(result.data.packageDiscountPaise, 0);
  assert.equal(result.data.finalFeePaise, 750000);
});

// ---- standard pricing: individual discounts and rounding ----------------------------------------------------------

test("the individual percentage is calculated on the fee remaining after the package discount", () => {
  // ₹9,000 − 10% (₹900) = ₹8,100; 10% of ₹8,100 = ₹810 (not 10% of ₹9,000).
  const result = priceDuration("half_yearly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: percent("10") });
  assert.equal(result.data.packageDiscountPaise, 90000);
  assert.equal(result.data.individualDiscountPaise, 81000);
  assert.equal(result.data.finalFeePaise, 729000);
});

test("fixed package with percentage individual, and percentage package with fixed individual", () => {
  const a = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: percent("5") });
  assert.deepEqual([a.data.packageDiscountPaise, a.data.individualDiscountPaise, a.data.finalFeePaise], [30000, 21000, 399000]);
  const b = priceDuration("annual", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: fixed("530") });
  assert.deepEqual([b.data.packageDiscountPaise, b.data.individualDiscountPaise, b.data.finalFeePaise], [270000, 53000, 1477000]);
});

test("each discount stage is rounded half up before the next is calculated", () => {
  // ₹333.33 a month × 3 = ₹999.99. Package 10% = 99.999 → ₹100.00. Remaining ₹899.99.
  // Individual 10% of ₹899.99 = 89.999 → ₹90.00. Final ₹809.99.
  const result = priceDuration("quarterly", {
    monthlyFeePaise: 33333,
    packageDiscounts: { quarterly: percent("10") },
    individualDiscount: percent("10"),
  });
  assert.deepEqual(result.data, {
    pricingMode: "standard",
    standardFeePaise: 99999,
    packageDiscountSource: "quarterly",
    packageDiscountPaise: 10000,
    individualDiscountPaise: 9000,
    finalFeePaise: 80999,
  });
});

test("rounding half up at an exact half paisa, at each stage", () => {
  // Individual stage: price 333 paise, 50% = 166.5 → 167; final 166.
  const individualOnly = priceStandardMembership({
    kind: "class_count",
    entry: { pricePaise: 333 },
    individualDiscount: percent("50"),
  });
  assert.deepEqual(
    [individualOnly.data.packageDiscountPaise, individualOnly.data.individualDiscountPaise, individualOnly.data.finalFeePaise],
    [0, 167, 166]
  );

  // Package stage: 111 × 3 = 333; package 50% = 166.5 → 167; remaining 166; individual 50% = 83 exactly; final 83.
  const bothStages = priceStandardMembership({
    kind: "duration",
    entry: { monthlyFeePaise: 111, packageDiscounts: { quarterly: percent("50") } },
    months: 3,
    individualDiscount: percent("50"),
  });
  assert.deepEqual(
    [bothStages.data.packageDiscountPaise, bothStages.data.individualDiscountPaise, bothStages.data.finalFeePaise],
    [167, 83, 83]
  );
});

// ---- standard pricing: limits -------------------------------------------------------------------------------------

test("discounts equal to the standard fee are refused: the final fee would be 0", () => {
  const byIndividual = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: fixed("4200") });
  assert.deepEqual(byIndividual, { success: false, errors: { final_fee: "The final agreed fee must be greater than 0." } });
  const byPercent = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: percent("100") });
  assert.deepEqual(byPercent.errors, { final_fee: "The final agreed fee must be greater than 0." });
  const byPackage = priceDuration("quarterly", { packageDiscounts: { quarterly: percent("100") } });
  assert.deepEqual(byPackage.errors, { final_fee: "The final agreed fee must be greater than 0." });
});

test("discounts together greater than the standard fee are refused", () => {
  const result = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: fixed("4200.01") });
  assert.deepEqual(result, {
    success: false,
    errors: { individual_discount: "The discounts together cannot exceed the standard fee." },
  });
});

test("a package discount greater than the standard fee is refused", () => {
  const result = priceDuration("quarterly", { packageDiscounts: { quarterly: fixed("4500.01") } });
  assert.deepEqual(result, {
    success: false,
    errors: { package_discount: "The package discount cannot exceed the standard fee." },
  });
});

test("a final standard fee of ₹0.01 is accepted", () => {
  const result = priceDuration("quarterly", { packageDiscounts: ALL_DISCOUNTS, individualDiscount: fixed("4199.99") });
  assert.equal(result.success, true);
  assert.equal(result.data.finalFeePaise, 1);
});

test("invalid discounts and inputs are refused", () => {
  assert.deepEqual(priceDuration("quarterly", { packageDiscounts: { quarterly: { type: "fixed", valuePaise: 0 } } }).errors, {
    package_discount: "The package discount configured for this duration is not valid.",
  });
  assert.deepEqual(priceDuration("quarterly", { packageDiscounts: { quarterly: { type: "percent", basisPoints: 10001 } } }).errors, {
    package_discount: "The package discount configured for this duration is not valid.",
  });
  assert.deepEqual(priceDuration("quarterly", { individualDiscount: { type: "fixed", valuePaise: -100 } }).errors, {
    individual_discount: "Enter a valid individual discount.",
  });
  assert.deepEqual(priceDuration("quarterly", { individualDiscount: { type: "percent", basisPoints: 12.5 } }).errors, {
    individual_discount: "Enter a valid individual discount.",
  });
  assert.deepEqual(priceStandardMembership({ kind: "duration", entry: durationEntry(), months: 0 }).errors, {
    months: "The duration must be a whole number of months.",
  });
  assert.deepEqual(priceStandardMembership({ kind: "duration", entry: { monthlyFeePaise: 0 }, months: 1 }).errors, {
    fee: "The fee in effect has no valid monthly base fee.",
  });
  assert.deepEqual(priceStandardMembership({ kind: "weekly", entry: durationEntry(), months: 1 }).errors, {
    kind: "Select a valid package type.",
  });
  assert.equal(priceStandardMembership().success, false);
});

// ---- standard pricing: class-count packages -----------------------------------------------------------------------

test("class-count: the standard fee is the package's own price, with no package discount", () => {
  const result = priceStandardMembership({
    kind: "class_count",
    entry: { effectiveFrom: "2026-01-01", currency: "INR", pricePaise: 250000, packageDiscounts: ALL_DISCOUNTS },
  });
  assert.deepEqual(result.data, {
    pricingMode: "standard",
    standardFeePaise: 250000,
    packageDiscountSource: null,
    packageDiscountPaise: 0,
    individualDiscountPaise: 0,
    finalFeePaise: 250000,
  });
});

test("class-count: an individual discount applies to the price", () => {
  const result = priceStandardMembership({ kind: "class_count", entry: { pricePaise: 250000 }, individualDiscount: percent("20") });
  assert.equal(result.data.individualDiscountPaise, 50000);
  assert.equal(result.data.finalFeePaise, 200000);
  assert.deepEqual(priceStandardMembership({ kind: "class_count", entry: { pricePaise: 0 } }).errors, {
    fee: "The fee in effect has no valid price.",
  });
});

// ---- resolveStandardFeeEntry --------------------------------------------------------------------------------------

const ENTRY_JAN = { id: "jan", effectiveFrom: "2026-01-01", currency: "INR", monthlyFeePaise: 150000 };
const ENTRY_APR = { id: "apr", effectiveFrom: "2026-04-01", currency: "INR", monthlyFeePaise: 160000 };
const ENTRY_JUL = { id: "jul", effectiveFrom: "2026-07-01", currency: "INR", monthlyFeePaise: 170000 };

test("the fee in effect is the latest entry on or before the start date", () => {
  const entries = [ENTRY_JAN, ENTRY_APR, ENTRY_JUL];
  assert.equal(resolveStandardFeeEntry(entries, "2026-01-01", "INR").data.id, "jan");
  assert.equal(resolveStandardFeeEntry(entries, "2026-03-31", "INR").data.id, "jan");
  assert.equal(resolveStandardFeeEntry(entries, "2026-04-01", "INR").data.id, "apr");
  assert.equal(resolveStandardFeeEntry(entries, "2026-06-30", "INR").data.id, "apr");
  assert.equal(resolveStandardFeeEntry(entries, "2027-01-01", "INR").data.id, "jul");
});

test("future entries are ignored and the order of the entries does not matter", () => {
  assert.equal(resolveStandardFeeEntry([ENTRY_JUL, ENTRY_JAN, ENTRY_APR], "2026-05-15", "INR").data.id, "apr");
});

test("cancelled entries are ignored", () => {
  const cancelledApr = { ...ENTRY_APR, cancelled: true };
  assert.equal(resolveStandardFeeEntry([ENTRY_JAN, cancelledApr], "2026-05-15", "INR").data.id, "jan");
  assert.deepEqual(resolveStandardFeeEntry([{ ...ENTRY_JAN, cancelled: true }], "2026-05-15", "INR"), {
    success: false,
    errors: { fee: "No standard fee is in effect on this start date." },
  });
});

test("no entry in effect: a start date before every entry, or no entries at all", () => {
  const missing = { success: false, errors: { fee: "No standard fee is in effect on this start date." } };
  assert.deepEqual(resolveStandardFeeEntry([ENTRY_APR, ENTRY_JUL], "2026-03-31", "INR"), missing);
  assert.deepEqual(resolveStandardFeeEntry([], "2026-03-31", "INR"), missing);
  assert.deepEqual(resolveStandardFeeEntry(null, "2026-03-31", "INR"), missing);
});

test("two entries on the same effective date are ambiguous", () => {
  const twin = { ...ENTRY_APR, id: "apr-2" };
  assert.deepEqual(resolveStandardFeeEntry([ENTRY_JAN, ENTRY_APR, twin], "2026-05-15", "INR"), {
    success: false,
    errors: { fee: "More than one fee takes effect on the same date, so the fee in effect is ambiguous." },
  });
  // A cancelled twin does not make it ambiguous.
  assert.equal(resolveStandardFeeEntry([ENTRY_APR, { ...twin, cancelled: true }], "2026-05-15", "INR").data.id, "apr");
});

test("an entry in another currency is not a valid standard fee - no conversion, no fallback to an older entry", () => {
  const usdApr = { ...ENTRY_APR, currency: "USD" };
  assert.deepEqual(resolveStandardFeeEntry([ENTRY_JAN, usdApr], "2026-05-15", "INR"), {
    success: false,
    errors: { fee: "The fee in effect on this start date is in USD, not the centre's currency (INR)." },
  });
  // The same entry is valid once the centre's currency matches it (codes compared case-insensitively).
  assert.equal(resolveStandardFeeEntry([ENTRY_JAN, usdApr], "2026-05-15", "usd").data.id, "apr");
});

test("an invalid start date is refused", () => {
  assert.deepEqual(resolveStandardFeeEntry([ENTRY_JAN], "2026-02-30", "INR"), {
    success: false,
    errors: { start_date: "Enter a valid start date." },
  });
});

// ---- priceCustomFeePlan -------------------------------------------------------------------------------------------

test("a Custom Fee Plan's amount is the final agreed fee, with no discount values", () => {
  assert.deepEqual(priceCustomFeePlan({ amount: "3999.50", reason: "  Agreed with the owner  " }), {
    success: true,
    data: {
      pricingMode: "custom_fee_plan",
      standardFeePaise: null,
      packageDiscountSource: null,
      packageDiscountPaise: null,
      individualDiscountPaise: null,
      finalFeePaise: 399950,
      reason: "Agreed with the owner",
    },
  });
  assert.equal(priceCustomFeePlan({ amount: "0.01", reason: "Token fee" }).data.finalFeePaise, 1);
});

test("a Custom Fee Plan refuses package and individual discounts instead of applying them", () => {
  const withPackage = priceCustomFeePlan({ amount: "4000", reason: "Special price", packageDiscount: fixed("300") });
  assert.deepEqual(withPackage, { success: false, errors: { discount: "A Custom Fee Plan takes no discounts." } });
  const withIndividual = priceCustomFeePlan({ amount: "4000", reason: "Special price", individualDiscount: percent("10") });
  assert.deepEqual(withIndividual, { success: false, errors: { discount: "A Custom Fee Plan takes no discounts." } });
  // Absent discounts (undefined, null or empty) are not "supplied".
  assert.equal(priceCustomFeePlan({ amount: "4000", reason: "Special price", packageDiscount: null, individualDiscount: "" }).success, true);
});

test("a Custom Fee Plan needs an amount greater than 0 with at most two decimals", () => {
  for (const amount of ["0", "0.00", "-100", "100.005", "abc", "", null, undefined]) {
    const result = priceCustomFeePlan({ amount, reason: "Special price" });
    assert.equal(result.success, false, `amount ${JSON.stringify(amount)}`);
    assert.equal(
      result.errors.custom_fee,
      "Enter the custom agreed fee: an amount greater than 0, with at most two decimal places."
    );
  }
});

test("a Custom Fee Plan needs a reason of 3 to 500 characters", () => {
  for (const reason of [undefined, "", "   ", "ab", "a".repeat(501)]) {
    const result = priceCustomFeePlan({ amount: "4000", reason });
    assert.deepEqual(result, {
      success: false,
      errors: { custom_fee_reason: "Enter the reason for the Custom Fee Plan in 3 to 500 characters." },
    }, `reason ${JSON.stringify(reason)}`);
  }
});

test("a Custom Fee Plan reports every problem at once", () => {
  assert.deepEqual(priceCustomFeePlan({ amount: "0", reason: "", individualDiscount: fixed("10") }).errors, {
    discount: "A Custom Fee Plan takes no discounts.",
    custom_fee: "Enter the custom agreed fee: an amount greater than 0, with at most two decimal places.",
    custom_fee_reason: "Enter the reason for the Custom Fee Plan in 3 to 500 characters.",
  });
});
