// Run with `npm test` (Node's built-in test runner).
//
// V1 Fee Structure, FS-1 - validation of package-pricing inputs: fixed and percentage discounts, the individual
// discount's reason, and the required reason text (01-product.md §5 "Pricing a membership").

import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOUNT_TYPES,
  INDIVIDUAL_DISCOUNT_REASONS,
  requiredReasonText,
  validateDiscountInput,
  validateIndividualDiscountReason,
} from "./validation.js";

const FIXED_ERROR = "Enter a discount amount greater than 0, with at most two decimal places.";
const PERCENT_ERROR = "Enter a percentage greater than 0 and at most 100, with at most two decimal places.";

// ---- validateDiscountInput ----------------------------------------------------------------------------------------

test("the discount types are fixed and percent", () => {
  assert.deepEqual(DISCOUNT_TYPES, ["fixed", "percent"]);
});

test("a fixed discount becomes whole paise", () => {
  assert.deepEqual(validateDiscountInput({ type: "fixed", value: "300" }), {
    success: true,
    data: { type: "fixed", valuePaise: 30000 },
  });
  assert.deepEqual(validateDiscountInput({ type: "fixed", value: " 0.01 " }).data, { type: "fixed", valuePaise: 1 });
  assert.deepEqual(validateDiscountInput({ type: "fixed", value: "199.5" }).data, { type: "fixed", valuePaise: 19950 });
});

test("a fixed discount must be greater than 0 with at most two decimals", () => {
  for (const value of ["0", "0.00", "-5", "1.005", "abc", "", null, undefined, "1,000", "₹300"]) {
    assert.deepEqual(validateDiscountInput({ type: "fixed", value }), {
      success: false,
      errors: { discount: FIXED_ERROR },
    }, `value ${JSON.stringify(value)}`);
  }
});

test("a percentage discount becomes basis points", () => {
  assert.deepEqual(validateDiscountInput({ type: "percent", value: "10" }).data, { type: "percent", basisPoints: 1000 });
  assert.deepEqual(validateDiscountInput({ type: "percent", value: "12.5" }).data, { type: "percent", basisPoints: 1250 });
  assert.deepEqual(validateDiscountInput({ type: "percent", value: "0.01" }).data, { type: "percent", basisPoints: 1 });
  assert.deepEqual(validateDiscountInput({ type: "percent", value: "100" }).data, { type: "percent", basisPoints: 10000 });
  assert.deepEqual(validateDiscountInput({ type: "percent", value: "100.00" }).data, { type: "percent", basisPoints: 10000 });
});

test("a percentage must be greater than 0, at most 100, with at most two decimals", () => {
  for (const value of ["0", "0.00", "100.01", "101", "-1", "12.345", "abc", "", null, "10%"]) {
    assert.deepEqual(validateDiscountInput({ type: "percent", value }), {
      success: false,
      errors: { discount: PERCENT_ERROR },
    }, `value ${JSON.stringify(value)}`);
  }
});

test("an unknown discount type is refused", () => {
  for (const type of ["amount", "Fixed", "", null, undefined]) {
    assert.deepEqual(validateDiscountInput({ type, value: "10" }), {
      success: false,
      errors: { discount: "Select a valid discount type." },
    });
  }
  assert.equal(validateDiscountInput().success, false);
});

// ---- requiredReasonText -------------------------------------------------------------------------------------------

test("a required reason is trimmed and 3 to 500 characters", () => {
  assert.equal(requiredReasonText("  Festival offer  "), "Festival offer");
  assert.equal(requiredReasonText("abc"), "abc");
  assert.equal(requiredReasonText("a".repeat(500)), "a".repeat(500));
  assert.equal(requiredReasonText("ab"), null);
  assert.equal(requiredReasonText("   ab   "), null);
  assert.equal(requiredReasonText("a".repeat(501)), null);
  assert.equal(requiredReasonText(""), null);
  assert.equal(requiredReasonText(null), null);
});

test("reason length counts characters, not UTF-16 units", () => {
  // Three emoji are three characters (six UTF-16 units).
  assert.equal(requiredReasonText("🙂🙂🙂"), "🙂🙂🙂");
  assert.equal(requiredReasonText("🙂".repeat(500)), "🙂".repeat(500));
  assert.equal(requiredReasonText("🙂".repeat(501)), null);
});

// ---- validateIndividualDiscountReason ---------------------------------------------------------------------------------

test("the individual discount reasons are the four approved codes", () => {
  assert.deepEqual(INDIVIDUAL_DISCOUNT_REASONS.map((reason) => reason.value), [
    "promotional_offer",
    "returning_member",
    "special_approval",
    "other",
  ]);
  assert.deepEqual(INDIVIDUAL_DISCOUNT_REASONS.map((reason) => reason.label), [
    "Promotional Offer",
    "Returning Member",
    "Special Approval",
    "Other",
  ]);
});

test("a listed reason needs no note; an optional note is trimmed and kept", () => {
  assert.deepEqual(validateIndividualDiscountReason({ code: "promotional_offer" }), {
    success: true,
    data: { code: "promotional_offer", note: null },
  });
  assert.deepEqual(validateIndividualDiscountReason({ code: "returning_member", note: "  Back after a year " }).data, {
    code: "returning_member",
    note: "Back after a year",
  });
  assert.deepEqual(validateIndividualDiscountReason({ code: "special_approval", note: "ok" }).data, {
    code: "special_approval",
    note: "ok",
  });
});

test("an optional note can have at most 500 characters", () => {
  assert.equal(validateIndividualDiscountReason({ code: "special_approval", note: "a".repeat(500) }).success, true);
  assert.deepEqual(validateIndividualDiscountReason({ code: "special_approval", note: "a".repeat(501) }), {
    success: false,
    errors: { discount_note: "The note can have at most 500 characters." },
  });
});

test("Other requires an explanation of 3 to 500 characters", () => {
  assert.deepEqual(validateIndividualDiscountReason({ code: "other", note: "  Staff family  " }).data, {
    code: "other",
    note: "Staff family",
  });
  for (const note of [undefined, "", "  ", "ab", "a".repeat(501)]) {
    assert.deepEqual(validateIndividualDiscountReason({ code: "other", note }), {
      success: false,
      errors: { discount_note: "Explain the reason in 3 to 500 characters." },
    }, `note ${JSON.stringify(note)}`);
  }
});

test("a missing or unknown reason code is refused", () => {
  for (const code of [undefined, "", "loyalty", "Other"]) {
    const result = validateIndividualDiscountReason({ code });
    assert.equal(result.success, false);
    assert.equal(result.errors.discount_reason, "Select a reason for the discount.");
  }
});
