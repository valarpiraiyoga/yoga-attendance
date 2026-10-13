/**
 * Pricing of package-linked memberships (V1 Fee Structure, FS-1): resolving the fee entry in effect on the start
 * date, the standard fee, the package and individual discounts, and the Custom Fee Plan (01-product.md §5
 * "Packages and Fee Structure").
 *
 * Standard pricing: standard fee → package discount (against the standard fee) → individual discount (against the
 * fee remaining after the package discount) → final agreed fee. Each discount is rounded half up to the paisa; the
 * discounts together cannot exceed the standard fee; the final agreed fee must be greater than 0.
 *
 * A Custom Fee Plan's amount IS the final agreed fee: no discount of either kind applies to it.
 *
 * Amounts are whole paise, so every sum is exact. Pure and framework-agnostic; the database stays the authoritative
 * calculation layer once memberships are created from packages.
 */

import { toPaise } from "../memberships/payments-core.js";
import { packageDiscountDurationFor } from "./duration.js";
import { MAX_PERCENT_BASIS_POINTS, requiredReasonText, REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "./validation.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPositivePaise(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// A discount in the shape validateDiscountInput returns.
function isValidDiscount(discount) {
  if (discount?.type === "fixed") return isPositivePaise(discount.valuePaise);
  if (discount?.type === "percent") {
    return Number.isSafeInteger(discount.basisPoints)
      && discount.basisPoints > 0
      && discount.basisPoints <= MAX_PERCENT_BASIS_POINTS;
  }
  return false;
}

function isSupplied(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * A discount amount in paise: a fixed discount is its own amount; a percentage is rounded half up to the paisa,
 * floor((base × basisPoints + 5000) / 10000).
 *
 * @param {number} basePaise - the amount the discount is calculated against.
 * @param {{ type: "fixed", valuePaise: number } | { type: "percent", basisPoints: number } | null} discount
 * @returns {number} whole paise; 0 when there is no discount.
 */
export function calculateDiscountPaise(basePaise, discount) {
  if (!discount) return 0;
  if (discount.type === "fixed") return discount.valuePaise;
  return Math.floor((basePaise * discount.basisPoints + 5000) / 10000);
}

/**
 * The standard fee entry in effect on a membership's start date: the non-cancelled entry with the latest effective
 * date on or before it. An entry in another currency is not a valid standard fee - it is never converted, and an
 * older entry is never used in its place.
 *
 * @param {{ effectiveFrom: string, currency: string, cancelled?: boolean }[]} entries
 * @param {string} startDate - "YYYY-MM-DD".
 * @param {string} centreCurrency - the centre's current ISO 4217 code.
 * @returns {{ success: true, data: object } | { success: false, errors: { start_date?: string, fee?: string } }}
 */
export function resolveStandardFeeEntry(entries, startDate, centreCurrency) {
  const trimmedStart = String(startDate ?? "").trim();
  if (!isValidDateString(trimmedStart)) {
    return { success: false, errors: { start_date: "Enter a valid start date." } };
  }

  const inEffect = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && !entry.cancelled && isValidDateString(entry.effectiveFrom) && entry.effectiveFrom <= trimmedStart
  );

  if (inEffect.length === 0) {
    return { success: false, errors: { fee: "No standard fee is in effect on this start date." } };
  }

  const latestDate = inEffect.reduce((latest, entry) => (entry.effectiveFrom > latest ? entry.effectiveFrom : latest), "");
  const latest = inEffect.filter((entry) => entry.effectiveFrom === latestDate);

  if (latest.length > 1) {
    return {
      success: false,
      errors: { fee: "More than one fee takes effect on the same date, so the fee in effect is ambiguous." },
    };
  }

  const [entry] = latest;
  const entryCurrency = String(entry.currency ?? "").trim().toUpperCase();
  const currentCurrency = String(centreCurrency ?? "").trim().toUpperCase();
  if (!entryCurrency || entryCurrency !== currentCurrency) {
    return {
      success: false,
      errors: {
        fee: `The fee in effect on this start date is in ${entryCurrency || "an unknown currency"}, not the centre's currency (${currentCurrency || "not set"}).`,
      },
    };
  }

  return { success: true, data: entry };
}

/**
 * Standard pricing of a package-linked membership.
 *
 * `packageDiscountSource` is the standard duration whose package discount was looked up (duration packages only;
 * null for class-count). It is `monthly` - and the package discount 0 - for 1 or 2 months, and the discount is also
 * 0 when that duration has none configured; no other duration's discount is used instead.
 *
 * @param {object} input
 * @param {"duration"|"class_count"} input.kind
 * @param {{ monthlyFeePaise?: number, pricePaise?: number, packageDiscounts?: Record<string, object> }} input.entry
 *   the resolved fee entry; `packageDiscounts` holds discounts in the shape validateDiscountInput returns.
 * @param {number} [input.months] - duration packages: the resolved months.
 * @param {object|null} [input.individualDiscount] - a validated discount, or null for none.
 * @returns {{ success: true, data: { pricingMode: "standard", standardFeePaise: number, packageDiscountSource: string|null,
 *   packageDiscountPaise: number, individualDiscountPaise: number, finalFeePaise: number } }
 *   | { success: false, errors: Record<string, string> }}
 */
export function priceStandardMembership({ kind, entry, months, individualDiscount = null } = {}) {
  let standardFeePaise;
  let packageDiscountSource = null;
  let packageDiscount = null;

  if (kind === "duration") {
    if (!Number.isInteger(months) || months < 1) {
      return { success: false, errors: { months: "The duration must be a whole number of months." } };
    }
    if (!isPositivePaise(entry?.monthlyFeePaise)) {
      return { success: false, errors: { fee: "The fee in effect has no valid monthly base fee." } };
    }
    standardFeePaise = entry.monthlyFeePaise * months;
    packageDiscountSource = packageDiscountDurationFor(months);
    // Monthly never has a package discount, even if one were configured.
    const configured = packageDiscountSource === "monthly" ? null : entry.packageDiscounts?.[packageDiscountSource] ?? null;
    if (configured !== null && !isValidDiscount(configured)) {
      return { success: false, errors: { package_discount: "The package discount configured for this duration is not valid." } };
    }
    packageDiscount = configured;
  } else if (kind === "class_count") {
    if (!isPositivePaise(entry?.pricePaise)) {
      return { success: false, errors: { fee: "The fee in effect has no valid price." } };
    }
    standardFeePaise = entry.pricePaise;
  } else {
    return { success: false, errors: { kind: "Select a valid package type." } };
  }

  if (!Number.isSafeInteger(standardFeePaise)) {
    return { success: false, errors: { fee: "The standard fee is too large." } };
  }

  if (individualDiscount !== null && !isValidDiscount(individualDiscount)) {
    return { success: false, errors: { individual_discount: "Enter a valid individual discount." } };
  }

  const packageDiscountPaise = calculateDiscountPaise(standardFeePaise, packageDiscount);
  if (packageDiscountPaise > standardFeePaise) {
    return { success: false, errors: { package_discount: "The package discount cannot exceed the standard fee." } };
  }

  const individualDiscountPaise = calculateDiscountPaise(standardFeePaise - packageDiscountPaise, individualDiscount);
  if (packageDiscountPaise + individualDiscountPaise > standardFeePaise) {
    return { success: false, errors: { individual_discount: "The discounts together cannot exceed the standard fee." } };
  }

  const finalFeePaise = standardFeePaise - packageDiscountPaise - individualDiscountPaise;
  if (finalFeePaise <= 0) {
    return { success: false, errors: { final_fee: "The final agreed fee must be greater than 0." } };
  }

  return {
    success: true,
    data: {
      pricingMode: "standard",
      standardFeePaise,
      packageDiscountSource,
      packageDiscountPaise,
      individualDiscountPaise,
      finalFeePaise,
    },
  };
}

/**
 * A Custom Fee Plan: the entered amount is the final agreed fee. No package or individual discount is applied to
 * it, and supplying either is refused rather than ignored.
 *
 * @param {{ amount?: unknown, reason?: unknown, packageDiscount?: unknown, individualDiscount?: unknown }} [input]
 * @returns {{ success: true, data: { pricingMode: "custom_fee_plan", standardFeePaise: null, packageDiscountSource: null,
 *   packageDiscountPaise: null, individualDiscountPaise: null, finalFeePaise: number, reason: string } }
 *   | { success: false, errors: { custom_fee?: string, custom_fee_reason?: string, discount?: string } }}
 */
export function priceCustomFeePlan({ amount, reason, packageDiscount, individualDiscount } = {}) {
  const errors = {};

  if (isSupplied(packageDiscount) || isSupplied(individualDiscount)) {
    errors.discount = "A Custom Fee Plan takes no discounts.";
  }

  const finalFeePaise = toPaise(amount);
  if (finalFeePaise === null || finalFeePaise <= 0) {
    errors.custom_fee = "Enter the custom agreed fee: an amount greater than 0, with at most two decimal places.";
  }

  const trimmedReason = requiredReasonText(reason);
  if (trimmedReason === null) {
    errors.custom_fee_reason = `Enter the reason for the Custom Fee Plan in ${REASON_MIN_LENGTH} to ${REASON_MAX_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      pricingMode: "custom_fee_plan",
      standardFeePaise: null,
      packageDiscountSource: null,
      packageDiscountPaise: null,
      individualDiscountPaise: null,
      finalFeePaise,
      reason: trimmedReason,
    },
  };
}
