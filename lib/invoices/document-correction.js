/**
 * Correct & Reissue a payment document (migration 0055) - the pure rules: which details may be corrected, the recalculated
 * document and membership balance for the review step, the validation of what the Admin entered, and the argument list of the
 * database function. No database, no React, no Next.js.
 *
 * THE DATABASE IS THE AUTHORITY. `correct_and_reissue_payment_document` checks every rule again inside one transaction, under the
 * membership lock: the reason, the allowed details, the invoice date, the payment methods, and above all the membership balance
 * (the corrected payment may not exceed the membership amount less its OTHER payments). Everything here is the same rules, applied
 * early so the Admin sees a message instead of a refusal, and so the review can show what the replacement will say. Nothing here
 * issues a number, writes a payment, or changes the student or the centre profile: a corrected customer or business detail exists
 * only on the replacement document.
 *
 * Amounts are whole paise (like lib/memberships/payments-core.js), so sums and the tax are exact.
 */

import { fromPaise, toPaise, validatePaymentInput } from "../memberships/payments-core.js";
import { validateGstin } from "../invoice-settings/gstin.js";

export const CORRECTION_REASON_MAX = 500;
export const CORRECTION_FIELD_MAX = 500;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The customer details a replacement may carry instead of the student's current ones (migration 0055's whitelist). */
export const CUSTOMER_FIELDS = Object.freeze(["customer_name", "customer_phone", "customer_phone_country_code", "customer_email"]);
/** The business details a replacement may carry instead of the centre profile's current ones. */
export const BUSINESS_FIELDS = Object.freeze(["business_name", "business_address", "business_phone", "business_email"]);
/** The GSTIN of a TAX INVOICE: never on a payment receipt. */
export const GSTIN_FIELD = "business_gstin";

const REQUIRED_MESSAGES = Object.freeze({
  customer_name: "Enter the customer name.",
  business_name: "Enter the business name.",
});

/**
 * The details a document of this series may correct, in the order a form shows them.
 *
 * @param {"invoice"|"payment_receipt"|string} series
 * @returns {string[]}
 */
export function correctableFields(series) {
  return series === "invoice" ? [...CUSTOMER_FIELDS, ...BUSINESS_FIELDS, GSTIN_FIELD] : [...CUSTOMER_FIELDS, ...BUSINESS_FIELDS];
}

// ---- the balance a corrected payment may use ----------------------------------------------------------

/** A stored numeric amount ("5000.00" / 5000) in whole paise; 0 when it is not a plain amount. */
export function amountToPaise(value) {
  return toPaise(Number(value).toFixed(2)) ?? 0;
}

/** The total of a membership's payments other than the one being corrected, in paise: its own amount is never counted twice. */
export function sumOtherPaymentsPaise(payments, paymentId) {
  return (payments ?? []).filter((payment) => payment.id !== paymentId).reduce((sum, payment) => sum + amountToPaise(payment.amount), 0);
}

/** The balance a corrected payment may use: the membership amount less its OTHER payments, never below zero. */
export function availableBalancePaise(membershipAmountPaise, otherPaymentsPaise) {
  return Math.max(0, membershipAmountPaise - otherPaymentsPaise);
}

/** A payment's methods in the order they were entered (a copy; the input is not changed). */
export function methodsInOrder(methods) {
  return [...(methods ?? [])].sort((a, b) => a.position - b.position);
}

// ---- the recalculated document ----------------------------------------------------------------------

/**
 * Tax-inclusive tax, the way the database issues a tax invoice: round(amount x rate / (100 + rate), 2), a half rounding up -
 * in whole numbers, so no floating point touches an amount.
 *
 * @param {number} amountPaise
 * @param {number} rateHundredths - the tax rate in hundredths of a percent (18 -> 1800).
 * @returns {{ taxPaise: number, taxablePaise: number }}
 */
export function taxInclusivePaise(amountPaise, rateHundredths) {
  const numerator = BigInt(amountPaise) * BigInt(rateHundredths);
  const denominator = BigInt(10000 + rateHundredths);
  // (2 x numerator + denominator) / (2 x denominator), integer division: a half rounds up.
  const taxPaise = Number((2n * numerator + denominator) / (2n * denominator));
  return { taxPaise, taxablePaise: amountPaise - taxPaise };
}

/**
 * What the replacement and the membership will look like, for the review step. The replacement is issued the way any payment
 * document is: a tax invoice carries tax-inclusive tax at the CURRENT rate when tax is enabled, a payment receipt carries none.
 *
 * @param {{
 *   series: string,
 *   totalPaise: number,
 *   tax: { enabled: boolean, rate: number|string|null, name?: string|null },
 *   membership: { amountPaise: number, otherPaymentsPaise: number },
 * }} input
 */
export function previewCorrection({ series, totalPaise, tax, membership }) {
  const taxed = series === "invoice" && tax?.enabled === true;
  const rateHundredths = taxed ? (toPaise(tax?.rate ?? 0) ?? 0) : 0;
  const split = taxed ? taxInclusivePaise(totalPaise, rateHundredths) : null;
  const paidPaise = membership.otherPaymentsPaise + totalPaise;

  return {
    series,
    totalPaise,
    taxed,
    taxRate: taxed ? tax.rate : null,
    taxName: taxed ? (tax.name ?? null) : null,
    taxPaise: split ? split.taxPaise : null,
    taxablePaise: split ? split.taxablePaise : null,
    membership: {
      payablePaise: membership.amountPaise,
      paidPaise,
      balancePaise: Math.max(0, membership.amountPaise - paidPaise),
      // A payment exists, so the membership is never Pending here: the same rule edit_payment applies.
      paymentStatus: paidPaise >= membership.amountPaise ? "paid" : "partially_paid",
    },
  };
}

// ---- validation -----------------------------------------------------------------------------------------

/** Two method lists are the same payment when every row agrees on type, amount, reference and notes, in order. */
export function methodsAreUnchanged(current, entered) {
  if (!Array.isArray(current) || !Array.isArray(entered) || current.length !== entered.length) return false;
  return current.every((row, index) => {
    const other = entered[index];
    return (
      row.method === other.method &&
      toPaise(Number(row.amount).toFixed(2)) === toPaise(other.amount) &&
      (row.reference_id ?? null) === (other.reference_id ?? null) &&
      (row.notes ?? null) === (other.notes ?? null)
    );
  });
}

/**
 * Validates a correction before it is sent. The database checks the same rules again, under the membership lock.
 *
 * `methods` null / undefined leaves the payment as it is; an array replaces its methods (add, remove, edit: type, amount,
 * reference ID, notes). The payment date never changes. `details` holds the form's value for EVERY correctable detail: every
 * one is sent, so a replacement carries exactly what the form showed and never falls back to a different current value.
 *
 * @param {{
 *   reason: string,
 *   invoiceDate?: string|null,
 *   details?: Record<string, string|null|undefined>,
 *   methods?: { method: string, amount: string, referenceId?: string, notes?: string }[]|null,
 * }} input
 * @param {{
 *   series: string,
 *   paymentDate: string,
 *   originalInvoiceDate: string,
 *   today: string,
 *   paymentAmountPaise: number,
 *   currentMethods: { method: string, amount: number|string, reference_id?: string|null, notes?: string|null }[],
 *   availablePaise: number,
 * }} context - `availablePaise` is the membership amount less its OTHER payments: this payment's own amount is not in it.
 * @returns {{ success: true, data: { reason: string, invoiceDate: string|null, overrides: Record<string, string>, methods: object[]|null, totalPaise: number } }
 *   | { success: false, errors: { reason?: string, invoice_date?: string, methods?: string, details: Record<string, string>, rows: Record<number, Record<string, string>> } }}
 */
export function validateCorrectionInput(input, context) {
  const errors = { details: {}, rows: {} };

  // The reason.
  const reason = String(input?.reason ?? "").trim();
  if (!reason) errors.reason = "Enter the reason for the correction.";
  else if (reason.length > CORRECTION_REASON_MAX) errors.reason = `The reason can have at most ${CORRECTION_REASON_MAX} characters.`;

  // The invoice date: blank keeps the original's; another date must be valid under the existing rules.
  const dateText = String(input?.invoiceDate ?? "").trim();
  let invoiceDate = null;
  if (dateText && dateText !== context.originalInvoiceDate) {
    if (!DATE_PATTERN.test(dateText)) errors.invoice_date = "Enter a valid invoice date.";
    else if (dateText < context.paymentDate) errors.invoice_date = "The invoice date cannot be before the payment date.";
    else if (dateText > context.today) errors.invoice_date = "The invoice date cannot be in the future.";
    else invoiceDate = dateText;
  }

  // The customer and business details: all of them, as the form shows them.
  const overrides = {};
  for (const field of correctableFields(context.series)) {
    const raw = String(input?.details?.[field] ?? "").trim();

    if (field === GSTIN_FIELD) {
      const gstin = validateGstin(raw);
      if (!gstin.ok) errors.details[field] = gstin.error;
      else overrides[field] = gstin.value ?? "";
      continue;
    }

    if (REQUIRED_MESSAGES[field] && !raw) errors.details[field] = REQUIRED_MESSAGES[field];
    else if (raw.length > CORRECTION_FIELD_MAX) errors.details[field] = `Use at most ${CORRECTION_FIELD_MAX} characters.`;
    else overrides[field] = raw;
  }

  // The payment: unchanged, or its methods replaced within the membership's remaining balance.
  let methods = null;
  let totalPaise = context.paymentAmountPaise;
  if (input?.methods !== null && input?.methods !== undefined) {
    const payment = validatePaymentInput(
      { paymentDate: context.paymentDate, methods: input.methods },
      { today: context.today, balancePaise: context.availablePaise },
    );
    if (!payment.success) {
      if (payment.errors.methods) errors.methods = payment.errors.methods;
      if (payment.errors.payment_date && !errors.methods) errors.methods = payment.errors.payment_date;
      Object.assign(errors.rows, payment.errors.rows);
    } else if (!methodsAreUnchanged(context.currentMethods, payment.data.methods)) {
      methods = payment.data.methods;
      totalPaise = payment.data.totalPaise;
    }
  }

  const failed = errors.reason || errors.invoice_date || errors.methods || Object.keys(errors.details).length > 0 || Object.keys(errors.rows).length > 0;
  if (failed) return { success: false, errors };

  return { success: true, data: { reason, invoiceDate, overrides, methods, totalPaise } };
}

/** A validation failure as the flat `fieldErrors` map the actions return (row errors travel separately as `rowErrors`). */
export function flattenCorrectionErrors(errors) {
  const fieldErrors = {};
  if (errors.reason) fieldErrors.reason = errors.reason;
  if (errors.invoice_date) fieldErrors.invoice_date = errors.invoice_date;
  if (errors.methods) fieldErrors.methods = errors.methods;
  Object.assign(fieldErrors, errors.details);
  return fieldErrors;
}

// ---- the reviewed document -----------------------------------------------------------------------------------

/**
 * Compares what the Admin reviewed with what the same rules produce now. The reviewed total (and tax, for a taxed document) travel
 * to the database, which refuses a replacement that differs from them.
 *
 * @param {ReturnType<typeof previewCorrection>} preview
 * @param {{ total?: string|number|null, tax?: string|number|null }|null|undefined} reviewed
 * @returns {{ ok: true, expectedTotal: string, expectedTax: string|null } | { ok: false, error: string }}
 */
export function checkReviewed(preview, reviewed) {
  const total = toPaise(reviewed?.total);
  if (total === null) return { ok: false, error: "Review the corrected document before confirming." };

  const taxText = reviewed?.tax === null || reviewed?.tax === undefined || String(reviewed.tax).trim() === "" ? null : toPaise(reviewed.tax);
  const taxMatches = preview.taxed ? taxText === preview.taxPaise : taxText === null;

  if (total !== preview.totalPaise || !taxMatches) {
    return { ok: false, error: "The corrected document changed since you reviewed it. Review it again." };
  }
  return { ok: true, expectedTotal: fromPaise(total), expectedTax: preview.taxed ? fromPaise(preview.taxPaise) : null };
}

/**
 * The argument list of public.correct_and_reissue_payment_document (migration 0055), in the function's own order.
 *
 * Only p_document_id, p_reason and p_expected_total are required. The other four have `default null` in the function, and a
 * null value is OMITTED rather than sent: a JSON null for a jsonb parameter could arrive as the jsonb value 'null' instead of SQL
 * NULL, which the function would read as "a payment change that is not a list". Leaving the key out is the one unambiguous way to
 * say "not given" through PostgREST.
 *
 * @param {string} documentId
 * @param {{ reason: string, invoiceDate: string|null, overrides: Record<string, string>|null, methods: object[]|null }} data - from `validateCorrectionInput`.
 * @param {{ expectedTotal: string, expectedTax: string|null }} reviewed - from `checkReviewed`.
 */
export function buildCorrectionRpcArgs(documentId, data, reviewed) {
  const args = { p_document_id: documentId, p_reason: data.reason };
  if (data.invoiceDate !== null && data.invoiceDate !== undefined) args.p_invoice_date = data.invoiceDate;
  if (data.methods !== null && data.methods !== undefined) args.p_methods = data.methods;
  if (data.overrides !== null && data.overrides !== undefined) args.p_overrides = data.overrides;
  args.p_expected_total = reviewed.expectedTotal;
  if (reviewed.expectedTax !== null && reviewed.expectedTax !== undefined) args.p_expected_tax = reviewed.expectedTax;
  return args;
}
