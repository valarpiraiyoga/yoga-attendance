/**
 * The recorded pricing of a package-linked membership, for Membership Details (V1 Fee Structure, FS-6).
 *
 * Reads the SNAPSHOT stored on the membership row when it was created (migration 0048: the package name, the duration, the
 * standard fee, the package discount, the individual discount and its reason, the final agreed fee, and for a Custom Fee Plan
 * its reason and confirmation time). It takes the membership alone: nothing here looks at the current package, its fees or its
 * discounts, so a later change to any of them can never change what a membership shows, and nothing is recalculated.
 *
 * Pure and relative-import only, so it is tested without a server.
 */

import { INDIVIDUAL_DISCOUNT_REASONS } from "./validation.js";

const number = (value) => (value === null || value === undefined ? null : Number(value));

function reasonLabel(code) {
  return INDIVIDUAL_DISCOUNT_REASONS.find((reason) => reason.value === code)?.label ?? code ?? null;
}

/**
 * @param {object} membership - a row of `getMembership` (the stored columns).
 * @returns {null | {
 *   mode: "standard" | "custom_fee_plan", packageName: string, kind: string, plan: string, durationMonths: number|null,
 *   totalClasses: number|null, startDate: string, endDate: string|null, currency: string, finalFee: number,
 *   standardFee: number|null, packageDiscount: number|null,
 *   individual: { type: string, value: number, amount: number, reason: string|null, note: string|null } | null,
 *   customReason: string|null, confirmedAt: string|null
 * }} null for a membership that is not package-linked (a legacy membership has no recorded breakdown).
 */
export function pricingSnapshotOf(membership) {
  if (!membership?.package_id || !membership.pricing_mode) return null;

  const custom = membership.pricing_mode === "custom_fee_plan";

  return {
    mode: custom ? "custom_fee_plan" : "standard",
    packageName: membership.package_name,
    kind: membership.kind,
    plan: membership.plan,
    durationMonths: membership.duration_months ?? null,
    totalClasses: membership.total_classes ?? null,
    startDate: membership.start_date,
    endDate: membership.end_date ?? null,
    currency: membership.currency,
    finalFee: Number(membership.amount),
    // A Custom Fee Plan has none of these: its agreed fee is the final fee and no discount applies to it.
    standardFee: custom ? null : number(membership.standard_fee),
    packageDiscount: custom ? null : number(membership.package_discount),
    individual:
      !custom && membership.individual_discount_type
        ? {
            type: membership.individual_discount_type,
            value: Number(membership.individual_discount_value),
            amount: Number(membership.individual_discount_amount),
            reason: reasonLabel(membership.individual_discount_reason_code),
            note: membership.individual_discount_note ?? null,
          }
        : null,
    customReason: custom ? (membership.custom_fee_reason ?? null) : null,
    confirmedAt: custom ? (membership.custom_fee_confirmed_at ?? null) : null,
  };
}
