/**
 * Validation for the inputs of package pricing (V1 Fee Structure, FS-1): discounts, the individual discount's reason,
 * and the reason text shared with the Custom Fee Plan.
 *
 * Plain functions, no schema library - consistent with lib/memberships/validation.js. Each validator checks and
 * normalizes: callers get back values ready to calculate with (amounts in whole paise, percentages in basis points).
 */

import { toPaise } from "../memberships/payments-core.js";

/** A discount is a fixed amount or a percentage. */
export const DISCOUNT_TYPES = Object.freeze(["fixed", "percent"]);

/** The reasons an individual discount can be given for (01-product.md §5 "Pricing a membership"). */
export const INDIVIDUAL_DISCOUNT_REASONS = Object.freeze([
  { value: "promotional_offer", label: "Promotional Offer" },
  { value: "returning_member", label: "Returning Member" },
  { value: "special_approval", label: "Special Approval" },
  { value: "other", label: "Other" },
]);

/** A required reason text is trimmed and this many characters long; an optional note has the same maximum. */
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;

/** 100% in basis points (hundredths of a percent). */
export const MAX_PERCENT_BASIS_POINTS = 10000;

const REASON_VALUES = new Set(INDIVIDUAL_DISCOUNT_REASONS.map((reason) => reason.value));
const PERCENT_PATTERN = /^\d+(\.\d{1,2})?$/;

// Characters, not UTF-16 units, like the database's length() on the reason columns (0037, 0045).
function characterCount(text) {
  return Array.from(text).length;
}

/**
 * A required reason text: trimmed, 3 to 500 characters.
 *
 * @param {unknown} value
 * @returns {string|null} the trimmed text, or null when it is missing or outside the allowed length.
 */
export function requiredReasonText(value) {
  const trimmed = String(value ?? "").trim();
  const length = characterCount(trimmed);
  return length >= REASON_MIN_LENGTH && length <= REASON_MAX_LENGTH ? trimmed : null;
}

/**
 * Validates a fixed or percentage discount.
 *
 * @param {{ type?: unknown, value?: unknown }} [input]
 * @returns {{ success: true, data: { type: "fixed", valuePaise: number } | { type: "percent", basisPoints: number } }
 *   | { success: false, errors: { discount: string } }}
 */
export function validateDiscountInput({ type, value } = {}) {
  const trimmedType = String(type ?? "").trim();
  const trimmedValue = String(value ?? "").trim();

  if (trimmedType === "fixed") {
    const valuePaise = toPaise(trimmedValue);
    if (valuePaise === null || valuePaise <= 0) {
      return {
        success: false,
        errors: { discount: "Enter a discount amount greater than 0, with at most two decimal places." },
      };
    }
    return { success: true, data: { type: "fixed", valuePaise } };
  }

  if (trimmedType === "percent") {
    const basisPoints = PERCENT_PATTERN.test(trimmedValue) ? percentToBasisPoints(trimmedValue) : NaN;
    if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0 || basisPoints > MAX_PERCENT_BASIS_POINTS) {
      return {
        success: false,
        errors: { discount: "Enter a percentage greater than 0 and at most 100, with at most two decimal places." },
      };
    }
    return { success: true, data: { type: "percent", basisPoints } };
  }

  return { success: false, errors: { discount: "Select a valid discount type." } };
}

function percentToBasisPoints(text) {
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Validates the reason an individual discount was given for. `other` requires an explanation (trimmed, 3 to 500
 * characters); for the other codes the note is optional, at most 500 characters.
 *
 * @param {{ code?: unknown, note?: unknown }} [input]
 * @returns {{ success: true, data: { code: string, note: string|null } }
 *   | { success: false, errors: { discount_reason?: string, discount_note?: string } }}
 */
export function validateIndividualDiscountReason({ code, note } = {}) {
  const errors = {};
  const trimmedCode = String(code ?? "").trim();
  const trimmedNote = String(note ?? "").trim();

  if (!REASON_VALUES.has(trimmedCode)) {
    errors.discount_reason = "Select a reason for the discount.";
  }

  if (trimmedCode === "other") {
    if (requiredReasonText(trimmedNote) === null) {
      errors.discount_note = `Explain the reason in ${REASON_MIN_LENGTH} to ${REASON_MAX_LENGTH} characters.`;
    }
  } else if (characterCount(trimmedNote) > REASON_MAX_LENGTH) {
    errors.discount_note = `The note can have at most ${REASON_MAX_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: { code: trimmedCode, note: trimmedNote || null } };
}
