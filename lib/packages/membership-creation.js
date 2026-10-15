/**
 * Creating a package-linked membership (V1 Fee Structure, FS-6 step 1): the validation of what the form submits, the
 * preview that lets "Record Payment Now" be checked against the resolved fee BEFORE anything is written, and the call to
 * the database function that creates the membership.
 *
 * The database is authoritative. `create_membership_from_package` (migration 0048) resolves the fee in effect on the start
 * date, calculates the end date, the discounts and the final fee, and refuses what breaks the rules. Everything here that
 * prices is a PREVIEW, used only to give field errors early and to check a first payment against the fee the database is
 * expected to resolve; if the preview and the database ever disagree the database wins, and a payment it refuses is
 * reported as "not recorded" by `createWithInitialPayment` exactly like any other payment failure.
 *
 * Pure: the Supabase client is passed in, so it is tested without a server. The server action (lib/memberships/actions.js)
 * adds the Admin check, the redirects and the revalidation.
 */

import { fromPaise, toPaise } from "../memberships/payments-core.js";
import { parseInitialPayment, validateInitialPayment } from "../memberships/initial-payment.js";
import { resolveDurationMonths } from "./duration.js";
import { priceCustomFeePlan, resolveStandardFeeEntry, priceStandardMembership } from "./pricing.js";
import { validateDiscountInput, validateIndividualDiscountReason } from "./validation.js";
import { createMembershipFromPackageFor } from "./service-core.js";
import { startBeforeJoinDateError } from "../students/join-date.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTES_LENGTH = 1000;
const CONFIRMED_VALUES = new Set(["on", "true", "1", "yes"]);

/** The form fields of a package membership, in the order the form submits them. */
export const PACKAGE_MEMBERSHIP_FIELDS = Object.freeze([
  "package_id",
  "duration_option",
  "custom_months",
  "start_date",
  "end_date",
  "pricing_mode",
  "individual_discount_type",
  "individual_discount_value",
  "individual_discount_reason",
  "individual_discount_note",
  "custom_fee",
  "custom_fee_reason",
  "custom_fee_confirmed",
  "notes",
]);

/** The submitted fields of a package membership form, as strings (also what the form shows again after an error). */
export function packageMembershipInputOf(formData) {
  return Object.fromEntries(PACKAGE_MEMBERSHIP_FIELDS.map((name) => [name, formData.get(name)]));
}

const text = (value) => String(value ?? "").trim();

/**
 * A membership's notes: trimmed, at most 1000 characters, null when empty. The only field of a package-linked membership that
 * can be edited after it is created.
 *
 * @returns {{ success: true, data: string|null } | { success: false, errors: { notes: string } }}
 */
export function validateMembershipNotes(value) {
  const notes = text(value);
  if (notes.length > MAX_NOTES_LENGTH) return { success: false, errors: { notes: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.` } };
  return { success: true, data: notes || null };
}

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validates a package membership's submitted fields against its package's type. Nothing is priced here.
 *
 * @param {Record<string, unknown>} raw - from `packageMembershipInputOf`.
 * @param {"duration"|"class_count"|null} kind - the chosen package's type, or null when no package was found.
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validatePackageMembershipInput(raw = {}, kind = null) {
  const errors = {};

  const packageId = text(raw.package_id);
  if (!packageId || !kind) errors.package_id = "Select a package.";

  const startDate = text(raw.start_date);
  if (!isValidDateString(startDate)) errors.start_date = "Enter a valid start date.";

  let durationOption = null;
  let customMonths = null;
  let months = null;
  let endDate = null;
  const rawEnd = text(raw.end_date);

  if (kind === "duration") {
    const resolved = resolveDurationMonths(raw.duration_option, raw.custom_months);
    if (resolved.success) {
      months = resolved.data;
      durationOption = text(raw.duration_option);
      customMonths = durationOption === "custom" ? months : null;
    } else {
      Object.assign(errors, resolved.errors);
    }
    if (rawEnd) errors.end_date = "The end date of a duration package is calculated.";
  } else if (kind === "class_count") {
    if (text(raw.duration_option) || text(raw.custom_months)) {
      errors.duration_option = "A class-count package has no duration.";
    }
    if (rawEnd) {
      if (!isValidDateString(rawEnd)) errors.end_date = "Enter a valid expiry date, or choose No expiry.";
      else if (!errors.start_date && rawEnd < startDate) errors.end_date = "The expiry date cannot be before the start date.";
      else endDate = rawEnd;
    }
  }

  const pricingMode = text(raw.pricing_mode) || "standard";
  if (pricingMode !== "standard" && pricingMode !== "custom_fee_plan") errors.pricing_mode = "Select how the membership is priced.";

  const discountSupplied = [
    raw.individual_discount_type,
    raw.individual_discount_value,
    raw.individual_discount_reason,
    raw.individual_discount_note,
  ].some((value) => text(value) !== "");

  let individualDiscount = null;
  let customFee = null;
  let customReason = null;
  let confirmed = false;

  if (pricingMode === "standard") {
    if (discountSupplied) {
      const discount = validateDiscountInput({ type: raw.individual_discount_type, value: raw.individual_discount_value });
      const reason = validateIndividualDiscountReason({ code: raw.individual_discount_reason, note: raw.individual_discount_note });
      if (!discount.success) Object.assign(errors, discount.errors);
      if (!reason.success) Object.assign(errors, reason.errors);
      if (discount.success && reason.success) {
        individualDiscount = {
          type: text(raw.individual_discount_type),
          value: text(raw.individual_discount_value),
          reasonCode: reason.data.code,
          reasonNote: reason.data.note,
        };
      }
    }
  } else if (pricingMode === "custom_fee_plan") {
    const plan = priceCustomFeePlan({
      amount: raw.custom_fee,
      reason: raw.custom_fee_reason,
      individualDiscount: discountSupplied ? "supplied" : undefined,
    });
    if (plan.success) {
      customFee = fromPaise(plan.data.finalFeePaise);
      customReason = plan.data.reason;
    } else {
      Object.assign(errors, plan.errors);
    }
    confirmed = CONFIRMED_VALUES.has(text(raw.custom_fee_confirmed).toLowerCase());
    if (!confirmed) errors.custom_fee_confirmed = "Confirm the Custom Fee Plan before the membership is created.";
  }

  const notes = text(raw.notes);
  if (notes.length > MAX_NOTES_LENGTH) errors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;

  if (Object.keys(errors).length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      packageId,
      durationOption,
      customMonths,
      months,
      startDate,
      endDate,
      individualDiscount,
      pricingMode,
      customFee,
      customReason,
      confirmed,
      notes: notes || null,
    },
  };
}

// A numeric column as paise, or null: PostgREST returns numeric(10,2) as a JSON number.
function paiseOf(value) {
  if (value === null || value === undefined) return null;
  return toPaise(Number(value).toFixed(2));
}

// A fee entry as the database returns it (snake_case, with its discount rows) in the shape lib/packages/pricing.js reads.
function feeEntryForPricing(entry) {
  const packageDiscounts = {};
  for (const row of entry.package_fee_entry_discounts ?? []) {
    packageDiscounts[row.duration_option] =
      row.discount_type === "percent"
        ? { type: "percent", basisPoints: Math.round(Number(row.percent_value) * 100) }
        : { type: "fixed", valuePaise: paiseOf(row.fixed_amount) };
  }
  return {
    effectiveFrom: entry.effective_from,
    currency: entry.currency,
    cancelled: Boolean(entry.cancelled_at),
    monthlyFeePaise: paiseOf(entry.monthly_fee),
    pricePaise: paiseOf(entry.price),
    packageDiscounts,
  };
}

/**
 * The price the database is expected to resolve for a standard-priced membership, as a breakdown in whole paise - a PREVIEW
 * from the FS-1 pricing rules, for the form and for checking a first payment before the membership exists. Never sent to the
 * database, which resolves and prices on its own.
 *
 * `message` is the reason no standard price applies (no fee in effect on the start date, a fee in another currency, a
 * discount the fee cannot carry), in words the form can show.
 *
 * @param {{ kind: string, feeEntries?: object[] }|null} pkg - from `fetchPackageForPricing` / `fetchActivePackages`.
 * @param {{ startDate: string, months?: number|null, individualDiscount?: { type: string, value: string }|null }} input
 * @param {string} centreCurrency
 * @returns {{ success: true, standardFeePaise: number, packageDiscountPaise: number, packageDiscountSource: string|null,
 *   individualDiscountPaise: number, finalFeePaise: number } | { success: false, message: string }}
 */
export function previewStandardPrice(pkg, { startDate, months = null, individualDiscount = null } = {}, centreCurrency) {
  if (!pkg) return { success: false, message: "Select a package." };

  const resolved = resolveStandardFeeEntry((pkg.feeEntries ?? []).map(feeEntryForPricing), startDate, centreCurrency);
  if (!resolved.success) return { success: false, message: Object.values(resolved.errors)[0] };

  const discount = individualDiscount ? validateDiscountInput({ type: individualDiscount.type, value: individualDiscount.value }) : null;
  if (discount && !discount.success) return { success: false, message: discount.errors.discount };

  const priced = priceStandardMembership({
    kind: pkg.kind,
    entry: resolved.data,
    months: months ?? undefined,
    individualDiscount: discount ? discount.data : null,
  });
  if (!priced.success) return { success: false, message: Object.values(priced.errors)[0] };

  const { standardFeePaise, packageDiscountPaise, packageDiscountSource, individualDiscountPaise, finalFeePaise } = priced.data;
  return { success: true, standardFeePaise, packageDiscountPaise, packageDiscountSource, individualDiscountPaise, finalFeePaise };
}

/**
 * The final agreed fee only, in whole paise (or { success: false }) - used to check a first payment.
 *
 * @param {{ kind: string, feeEntries?: object[] }|null} pkg
 * @param {object} data - the validated data of `validatePackageMembershipInput`.
 * @param {string} centreCurrency
 * @returns {{ success: true, finalFeePaise: number } | { success: false }}
 */
export function previewFinalFeePaise(pkg, data, centreCurrency) {
  if (data.pricingMode === "custom_fee_plan") {
    const paise = toPaise(data.customFee);
    return paise === null ? { success: false } : { success: true, finalFeePaise: paise };
  }
  const preview = previewStandardPrice(pkg, data, centreCurrency);
  return preview.success ? { success: true, finalFeePaise: preview.finalFeePaise } : { success: false };
}

/**
 * Everything that can be checked before anything is written: the submitted fields, the package, and the optional first
 * payment (checked against the previewed final fee; with no preview it is checked by its own rules and the database
 * refuses what does not fit).
 *
 * @param {object} args
 * @param {Record<string, unknown>} args.raw - from `packageMembershipInputOf`.
 * @param {object|null} args.pkg - from `fetchPackageForPricing`, or null.
 * @param {string} args.centreCurrency
 * @param {string} args.today - the centre's today, "YYYY-MM-DD".
 * @param {string|null} args.initialPaymentRaw - the `initial_payment` form field.
 * @param {string|null} [args.joinDate] - the student's join date: the start date cannot be before it (migration 0051 refuses it too).
 * @returns {{ success: true, data: object, payment: object|null }
 *   | { success: false, errors: Record<string, string>, paymentErrors?: Record<string, string> }}
 */
export function preparePackageMembership({ raw, pkg, centreCurrency, today, initialPaymentRaw, joinDate = null }) {
  const validated = validatePackageMembershipInput(raw, pkg?.kind ?? null);
  const errors = validated.success ? {} : { ...validated.errors };

  if (validated.success && joinDate) {
    const joinDateError = startBeforeJoinDateError("membership", validated.data.startDate, joinDate);
    if (joinDateError) errors.start_date = joinDateError;
  }

  if (pkg && pkg.status !== "active") {
    errors.package_id = "This package is deactivated and cannot be chosen for a new membership.";
  }

  const initial = parseInitialPayment(initialPaymentRaw);
  let payment = null;
  let paymentErrors = null;
  if (initial.enabled) {
    const preview = validated.success ? previewFinalFeePaise(pkg, validated.data, centreCurrency) : { success: false };
    const check = validateInitialPayment(initial.input, {
      amount: preview.success ? fromPaise(preview.finalFeePaise) : null,
      today,
    });
    if (check.success) payment = check.data;
    else paymentErrors = check.errors;
  }

  if (Object.keys(errors).length > 0 || paymentErrors) {
    return { success: false, errors, ...(paymentErrors ? { paymentErrors } : {}) };
  }

  return { success: true, data: validated.data, payment };
}

// The field keys of the database errors (lib/packages/service-core.js) in the names the membership form uses.
const FORM_FIELD = {
  startDate: "start_date",
  duration: "duration_option",
  discount: "discount",
  customFee: "custom_fee",
  finalFee: "final_fee",
};

/**
 * Creates the membership through the database function. The shape is what `createWithInitialPayment` expects of its
 * `create` step: `{ id }`, or `{ failure }` carrying the message and the form fields it belongs to.
 *
 * @param {object} supabase
 * @param {string} studentId
 * @param {object} data - the validated data of `validatePackageMembershipInput`.
 * @returns {Promise<{ id: string } | { failure: { error: string, fieldErrors?: Record<string, string> } }>}
 */
export async function createPackageMembershipRecord(supabase, studentId, data) {
  const result = await createMembershipFromPackageFor(supabase, {
    studentId,
    packageId: data.packageId,
    durationOption: data.durationOption,
    customMonths: data.customMonths,
    startDate: data.startDate,
    endDate: data.endDate,
    individualDiscount: data.individualDiscount,
    pricingMode: data.pricingMode,
    customFee: data.customFee,
    customReason: data.customReason,
    confirmed: data.pricingMode === "custom_fee_plan" ? data.confirmed : null,
    notes: data.notes,
  });

  if (result.success) return { id: result.membershipId };

  if (result.fieldErrors) {
    const fieldErrors = Object.fromEntries(
      Object.entries(result.fieldErrors).map(([field, message]) => [FORM_FIELD[field] ?? field, message])
    );
    return { failure: { error: "Check the highlighted fields.", fieldErrors } };
  }
  return { failure: { error: result.error } };
}
