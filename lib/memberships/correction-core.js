/**
 * Pure rules of the audited correction of a package-linked membership (V1 Fee Structure, FS-8; migration 0050). Kept apart from the
 * "use server" file (which may export only async functions) so they are tested without a server.
 *
 * The database (`preview_membership_correction`, `correct_membership_terms`) is the authority: it prices the correction exactly as a
 * new membership is priced, refuses a final fee that is not above 0 or is below the payments recorded, requires the revised final
 * fee to be confirmed, and records the values before and after. These rules give the Admin the same answers before anything is sent,
 * reuse the creation form's own validation for the package, duration, start date, pricing mode, custom fee and individual discount,
 * and turn the database's answers into something the screen shows.
 */

import { validatePackageMembershipInput } from "../packages/membership-creation.js";
import { matchKnownPackageError } from "../packages/service-core.js";

export const CORRECTION_FAILED_MESSAGE = "Could not correct the membership. Try again.";
export const CORRECTION_REASON_MESSAGE = "Enter a reason of 3 to 500 characters.";
export const CORRECTION_REASON_MAX = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export const isUuid = (value) => UUID_PATTERN.test(String(value ?? ""));

/** The submitted fields of a correction, the same names and meaning as a new package membership's (no end date, no notes). */
export const CORRECTION_FIELDS = Object.freeze([
  "package_id",
  "duration_option",
  "custom_months",
  "start_date",
  "pricing_mode",
  "individual_discount_type",
  "individual_discount_value",
  "individual_discount_reason",
  "individual_discount_note",
  "custom_fee",
  "custom_fee_reason",
]);

const clean = (value) => String(value ?? "").trim();
// A money or numeric field compared by value ("1500", "1500.00" and " 1500 " are one number); blank stays blank.
const number = (value) => {
  const text = clean(value);
  if (text === "") return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : text;
};

/**
 * The editable terms of a package-linked membership as the Edit Membership form starts with them (all strings), from the stored
 * membership: its package, duration, start date, pricing mode, individual discount and Custom Fee Plan.
 */
export function currentTermsOf(membership) {
  return {
    package_id: membership.package_id ?? "",
    duration_option: membership.kind === "duration" ? (membership.plan ?? "") : "",
    custom_months: membership.plan === "custom" && membership.duration_months ? String(membership.duration_months) : "",
    start_date: membership.start_date ?? "",
    pricing_mode: membership.pricing_mode ?? "standard",
    individual_discount_type: membership.individual_discount_type ?? "none",
    individual_discount_value: membership.individual_discount_value != null ? String(membership.individual_discount_value) : "",
    individual_discount_reason: membership.individual_discount_reason_code ?? "",
    individual_discount_note: membership.individual_discount_note ?? "",
    custom_fee: membership.pricing_mode === "custom_fee_plan" ? String(membership.amount) : "",
    custom_fee_reason: membership.custom_fee_reason ?? "",
  };
}

/**
 * The submitted fields of a correction from the form's values: the duration only for a duration package, the individual discount
 * only in standard pricing and the custom fee only in a Custom Fee Plan (what is not applicable is blank, never sent).
 */
export function rawCorrectionInput(values, kind) {
  const custom = values.pricing_mode === "custom_fee_plan";
  const discounted = !custom && values.individual_discount_type && values.individual_discount_type !== "none";
  const duration = kind === "duration";
  return {
    package_id: values.package_id ?? "",
    duration_option: duration ? (values.duration_option ?? "") : "",
    custom_months: duration && values.duration_option === "custom" ? (values.custom_months ?? "") : "",
    start_date: values.start_date ?? "",
    pricing_mode: values.pricing_mode ?? "standard",
    individual_discount_type: discounted ? values.individual_discount_type : "",
    individual_discount_value: discounted ? (values.individual_discount_value ?? "") : "",
    individual_discount_reason: discounted ? (values.individual_discount_reason ?? "") : "",
    individual_discount_note: discounted ? (values.individual_discount_note ?? "") : "",
    custom_fee: custom ? (values.custom_fee ?? "") : "",
    custom_fee_reason: custom ? (values.custom_fee_reason ?? "") : "",
  };
}

// The terms that matter, normalised so that only a real difference counts (formatting, a blank, "none" and "" are the same).
function termsKey(values) {
  const mode = clean(values.pricing_mode) || "standard";
  const option = clean(values.duration_option);
  const key = {
    package_id: clean(values.package_id),
    duration_option: option,
    custom_months: option === "custom" ? number(values.custom_months) : "",
    start_date: clean(values.start_date),
    mode,
  };
  if (mode === "custom_fee_plan") return { ...key, custom_fee: number(values.custom_fee), custom_fee_reason: clean(values.custom_fee_reason) };
  const type = clean(values.individual_discount_type);
  const discounted = type !== "" && type !== "none";
  return {
    ...key,
    discount_type: discounted ? type : "",
    discount_value: discounted ? number(values.individual_discount_value) : "",
    discount_reason: discounted ? clean(values.individual_discount_reason) : "",
    discount_note: discounted ? clean(values.individual_discount_note) : "",
  };
}

/**
 * Whether the submitted fields change a PROTECTED term of the membership - its package, duration, start date, pricing mode, custom
 * fee, individual discount - compared with the membership's current terms (`currentTermsOf`). Only then is the Edit Membership save
 * a correction (revised price shown, a reason, the revised fee confirmed); a change of the notes alone is an ordinary save. The
 * server decides this from the stored membership; the form asks the same question only to choose which steps to show.
 */
export function protectedTermsChanged(current, raw) {
  return JSON.stringify(termsKey(current ?? {})) !== JSON.stringify(termsKey(raw ?? {}));
}

/** The reason of a correction: trimmed, 3 to 500 characters. */
export function validateCorrectionReason(value) {
  const reason = String(value ?? "").replace(/^\s+|\s+$/g, "");
  if (reason.length < 3 || reason.length > CORRECTION_REASON_MAX) return { success: false, error: CORRECTION_REASON_MESSAGE };
  return { success: true, data: reason };
}

/**
 * Validates the correction's fields against the chosen package's type, with the creation form's own rules. An expiry is never part
 * of a correction (a class-count expiry changes only through the audited expiry edit), and nothing is priced here.
 *
 * @param {Record<string, unknown>} raw - the fields named in `CORRECTION_FIELDS`.
 * @param {"duration"|"class_count"|null} kind - the chosen package's type, or null when it was not found.
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateCorrectionInput(raw = {}, kind = null) {
  const result = validatePackageMembershipInput(
    { ...raw, end_date: "", notes: "", custom_fee_confirmed: "on" },
    kind
  );
  if (!result.success) {
    // The creation form's confirmation checkbox does not exist here: the revised final fee is confirmed in the review step.
    const errors = { ...result.errors };
    delete errors.custom_fee_confirmed;
    return Object.keys(errors).length > 0 ? { success: false, errors } : { success: false, errors: { package_id: "Check the fields." } };
  }
  return { success: true, data: result.data };
}

/** The arguments of the two database functions for validated data. */
export function correctionRpcParams(membershipId, data) {
  return {
    p_membership_id: membershipId,
    p_package_id: data.packageId,
    p_duration_option: data.durationOption ?? null,
    p_custom_months: data.customMonths ?? null,
    p_start_date: data.startDate,
    p_individual_type: data.individualDiscount?.type ?? null,
    p_individual_value: data.individualDiscount?.value ?? null,
    p_reason_code: data.individualDiscount?.reasonCode ?? null,
    p_reason_note: data.individualDiscount?.reasonNote ?? null,
    p_pricing_mode: data.pricingMode ?? "standard",
    p_custom_fee: data.customFee ?? null,
    p_custom_reason: data.customReason ?? null,
  };
}

/** The revised final fee the Admin confirmed, as a number with at most two decimals, or null. */
export function parseConfirmedFee(value) {
  const text = String(value ?? "").trim();
  if (!MONEY_PATTERN.test(text)) return null;
  const amount = Number(text);
  return amount > 0 ? amount : null;
}

// The database's own messages for a correction (migration 0050), shown as it wrote them; each with the field it belongs to.
const CORRECTION_ERRORS = [
  ["42501", /^Not authorized\.$/, null, "You do not have permission to correct a membership."],
  ["P0002", /^Membership not found\.$/, null, "Membership not found."],
  ["22023", /^Enter a reason of 3 to 500 characters\.$/, "reason", CORRECTION_REASON_MESSAGE],
  ["22023", /^Nothing would change\.$/, null, "Nothing would change. Change the package, duration, start date or price first."],
  ["22023", /^Confirm the revised final fee/, "confirm", null],
  ["22023", /^The final fee is now /, "confirm", null],
  ["22023", /^The final fee \(.*\) cannot be below the payments already recorded/, "finalFee", null],
  ["22023", /^(Only a package-linked membership|A correction cannot change the type|The start date cannot be after the expiry|The package allows|A class has been recorded before)/, null, null],
  ["55000", /^A cancelled membership cannot be corrected\.$/, null, "A cancelled membership cannot be corrected."],
  ["55000", /^The fee that applies is in .* A correction never changes the currency/, "startDate", null],
  ["55006", /^A correction cannot change the student/, null, null],
];

/**
 * The application result for a database error of a correction, or null. Falls back to the package rules' messages (the fee, the
 * duration, the discount, the Custom Fee Plan, the join date, an overlapping membership), which a correction shares with creation.
 *
 * @param {{ code?: string, message?: string }|null|undefined} error
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string }|null}
 */
export function matchCorrectionError(error) {
  const code = error?.code ?? null;
  if (!code) return null;
  const text = error?.message ?? "";
  for (const [knownCode, pattern, field, message] of CORRECTION_ERRORS) {
    if (code === knownCode && pattern.test(text)) {
      const shown = message ?? text;
      return field ? { error: shown, fieldErrors: { [field]: shown }, code } : { error: shown, code };
    }
  }
  return matchKnownPackageError(error);
}

const num = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * The preview the database returned (`preview_membership_correction`) as the screen shows it: the revised terms and price, the
 * breakdown and the payments. Money is a number in the membership's own currency.
 */
export function previewOf(core) {
  return {
    membershipId: core.membership_id,
    kind: core.kind,
    currency: core.currency,
    packageId: core.package_id,
    packageName: core.package_name,
    plan: core.plan,
    totalClasses: num(core.total_classes),
    durationMonths: num(core.duration_months),
    startDate: core.start_date,
    endDate: core.end_date ?? null,
    pricingMode: core.pricing_mode,
    standardFee: num(core.standard_fee),
    packageDiscount: num(core.package_discount),
    individualDiscountAmount: num(core.individual_discount_amount),
    individualDiscountReason: core.individual_discount_reason_code ?? null,
    customFeeReason: core.custom_fee_reason ?? null,
    finalFee: num(core.final_fee),
    currentAmount: num(core.current_amount),
    paidTotal: num(core.paid_total),
    balanceAfter: num(core.balance_after),
  };
}

/** The fields a correction can change, as the history lists them: the audit key, its label and how it is shown. */
export const CORRECTION_CHANGE_FIELDS = Object.freeze([
  { key: "package_name", label: "Package", format: "text" },
  { key: "plan", label: "Duration", format: "plan" },
  { key: "total_classes", label: "Class allowance", format: "number" },
  { key: "start_date", label: "Start date", format: "date" },
  { key: "end_date", label: "End date", format: "date" },
  { key: "pricing_mode", label: "Pricing", format: "mode" },
  { key: "standard_fee", label: "Standard fee", format: "money" },
  { key: "package_discount", label: "Package discount", format: "money" },
  { key: "individual_discount_amount", label: "Individual discount", format: "money" },
  { key: "custom_fee_reason", label: "Custom Fee Plan reason", format: "text" },
  { key: "amount", label: "Final agreed fee", format: "money" },
  { key: "payment_status", label: "Payment status", format: "status" },
]);

/**
 * One row of the correction history for the screen: who, when, why, and what changed (only the fields whose value differs between
 * the stored before and after). `nameOf` resolves the user ID to a label (an Admin, "Unknown user" - never guessed).
 */
export function correctionHistoryRowFrom(row, nameOf) {
  const before = row.old_values ?? {};
  const after = row.new_values ?? {};
  const changes = CORRECTION_CHANGE_FIELDS.filter((field) => (before[field.key] ?? null) !== (after[field.key] ?? null)).map((field) => ({
    key: field.key,
    label: field.label,
    format: field.format,
    from: before[field.key] ?? null,
    to: after[field.key] ?? null,
  }));
  return {
    id: row.id,
    correctedAt: row.corrected_at,
    correctedBy: nameOf(row.corrected_by),
    reason: row.reason,
    currency: after.currency ?? before.currency ?? null,
    oldAmount: num(row.old_amount),
    newAmount: num(row.new_amount),
    paymentsTotal: num(row.payments_total),
    oldPaymentStatus: row.old_payment_status,
    newPaymentStatus: row.new_payment_status,
    changes,
  };
}
