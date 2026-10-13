import { formatCurrency } from "@/lib/currencies";
import { feeEntryStatus } from "@/lib/packages/service-core";

/**
 * Display wording for packages and fees (V1 Fee Structure, FS-4). Pure: no database, no dates read from the clock - the
 * caller passes the centre's `today`.
 */

export const DURATION_LABELS = Object.freeze({
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half Yearly",
  annual: "Annual",
  custom: "Custom",
});

export const KIND_LABELS = Object.freeze({ duration: "Duration-based", class_count: "Class count" });

export const EVENT_LABELS = Object.freeze({
  package_created: "Package created",
  details_updated: "Details updated",
  terms_updated: "Terms updated",
  package_activated: "Package activated",
  package_deactivated: "Package deactivated",
  fee_scheduled: "Fee scheduled",
  fee_edited: "Scheduled fee edited",
  fee_cancelled: "Fee cancelled",
  fee_corrected: "Fee corrected",
});

export const FEE_STATUS_LABELS = Object.freeze({ in_effect: "In effect", scheduled: "Scheduled", cancelled: "Cancelled" });
export const FEE_STATUS_VARIANTS = Object.freeze({ in_effect: "success", scheduled: "info", cancelled: "neutral" });

/** The amount of a fee entry: the monthly base fee of a duration package, the price of a class-count package. */
export function feeAmount(entry) {
  return entry.monthly_fee ?? entry.price;
}

/** "₹1,500.00 / month" or "₹3,000.00". */
export function formatFee(entry) {
  const amount = formatCurrency(feeAmount(entry), entry.currency);
  return entry.monthly_fee != null ? `${amount} / month` : amount;
}

/** "₹300.00 off" or "10% off". */
export function formatDiscount(discount) {
  return discount.discount_type === "percent"
    ? `${Number(discount.percent_value)}% off`
    : `${formatCurrency(discount.fixed_amount)} off`;
}

const DISCOUNT_ORDER = ["quarterly", "half_yearly", "annual"];

/** A fee entry's discounts in a fixed order. */
export function sortedDiscounts(entry) {
  return [...(entry.package_fee_entry_discounts ?? [])].sort(
    (a, b) => DISCOUNT_ORDER.indexOf(a.duration_option) - DISCOUNT_ORDER.indexOf(b.duration_option)
  );
}

/** The fee entry in effect today: the live entry with the latest effective date on or before today, or null. */
export function currentFeeEntry(entries, today) {
  return (
    [...(entries ?? [])]
      .filter((entry) => feeEntryStatus(entry, today) === "in_effect")
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
  );
}

/** The next scheduled entry, or null. */
export function nextScheduledEntry(entries, today) {
  return (
    [...(entries ?? [])]
      .filter((entry) => feeEntryStatus(entry, today) === "scheduled")
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null
  );
}

/** "Monthly, Quarterly" or "12 classes". */
export function termsSummary(pkg) {
  if (pkg.kind === "class_count") return `${pkg.total_classes} ${pkg.total_classes === 1 ? "class" : "classes"}`;
  return DURATION_OPTIONS_ORDER.filter((option) => pkg.options.includes(option))
    .map((option) => DURATION_LABELS[option])
    .join(", ");
}

const DURATION_OPTIONS_ORDER = ["monthly", "quarterly", "half_yearly", "annual", "custom"];
export { DURATION_OPTIONS_ORDER };
