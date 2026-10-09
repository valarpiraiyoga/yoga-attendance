/**
 * What the Membership screens show about payment date and invoice, decided in
 * one pure place (no React, no Next.js) so the page, the form and the Issue
 * Invoice dialog agree and the decisions can be tested.
 *
 * This is PRESENTATION only. The database is the authority for every rule: it
 * defaults the payment date when a membership becomes Paid, rejects a future
 * date, locks the date and the Paid status once an invoice exists, numbers the
 * invoice and takes the snapshot. Nothing here calculates a date, a number or
 * tax; it decides which of the database's facts to show, and which action to
 * offer (an action the database would refuse anyway is simply not offered).
 */

import { formatDate } from "../format.js";

/** How `invoices.document_title` reads on screen. */
export const DOCUMENT_TITLE_LABEL = {
  invoice: "Invoice",
  receipt: "Receipt",
  // V1 Tax Adjustment: the non-tax document of a payment, from its own sequence.
  payment_receipt: "Payment Receipt",
};

/**
 * The payment date of a membership that has no invoice (or the state of it).
 *   not-applicable — not Paid, so there is no payment date;
 *   missing        — Paid but no date recorded (a membership that was Paid before
 *                    payment dates existed; never back-filled);
 *   recorded       — Paid with its date.
 *
 * @param {{ payment_status?: string, payment_date?: string|null }} membership
 * @returns {{ kind: "not-applicable"|"missing"|"recorded", date: string|null }}
 */
export function getPaymentDateState(membership) {
  if (membership?.payment_status !== "paid") return { kind: "not-applicable", date: null };
  if (!membership.payment_date) return { kind: "missing", date: null };
  return { kind: "recorded", date: membership.payment_date };
}

/**
 * The invoice section of Membership Details.
 *
 *  - an invoice exists: show ITS values (never derived from the membership) and
 *    offer no Issue Invoice — there can be only one;
 *  - Paid, no invoice: offer Issue Invoice. `needsPaymentDate` is true when the
 *    membership has no payment date, so the Admin must confirm one; when it has
 *    one the existing date is used and the Admin is not asked to replace it;
 *  - Pending, no invoice: nothing to issue.
 *
 * @param {{ membership: object, invoice: object|null|undefined }} input
 */
export function getInvoiceSectionState({ membership, invoice, hasPayments = false }) {
  const hasInvoice = Boolean(invoice);
  // A membership with recorded payments is documented per payment (0036), never at membership level.
  const canIssue = !hasInvoice && !hasPayments && membership?.payment_status === "paid";
  const paymentDate = hasInvoice
    ? { kind: "recorded", date: invoice.payment_date }
    : getPaymentDateState(membership);

  return {
    hasInvoice,
    canIssue,
    needsPaymentDate: canIssue && !membership.payment_date,
    paymentDate,
  };
}

/** Why a payment cannot be given a document of its own (0039). */
export const PAYMENT_DOCUMENT_BLOCKED_MESSAGE = "A membership invoice already exists for this membership.";

/**
 * Whether a payment without a document can be given one. A membership that already has a membership-level
 * document (the invoice of Membership Details) is documented once, there: a second document for its payments
 * would put the same money on two documents. The database refuses it too (0039); this only avoids offering it.
 * A payment that already has a document is unaffected: it is shown and linked as before.
 *
 * @param {{ hasMembershipInvoice?: boolean }} input
 */
export function canIssuePaymentDocument({ hasMembershipInvoice = false } = {}) {
  return !hasMembershipInvoice;
}

/**
 * The words for a payment-date state.
 *
 * @param {{ kind: string, date: string|null }} state
 * @param {(value: string|null) => string} [format]
 */
export function paymentDateText(state, format = formatDate) {
  switch (state.kind) {
    case "recorded":
      return format(state.date);
    case "locked":
      return state.date
        ? `${format(state.date)} — locked once the invoice is issued`
        : "Locked once the invoice is issued";
    case "missing":
      return "Not recorded";
    case "on-save":
      return "Recorded when the membership is saved as Paid";
    default:
      return "Not applicable while payment is Pending";
  }
}

/**
 * What the Issue Invoice dialog sends. The payment date is sent ONLY when the
 * membership has none — the Admin's explicit, confirmed date (blank is refused
 * here, never defaulted to today). When the membership already has one it is
 * not sent at all: the database uses the existing date, and the Admin is not
 * asked to replace it. The invoice date is optional; blank lets the database
 * default it.
 *
 * @param {{ needsPaymentDate: boolean, paymentDate?: string, invoiceDate?: string }} input
 * @returns {{ errors: Record<string, string> } | { input: { paymentDate: string|null, invoiceDate: string|null } }}
 */
export function prepareIssueInvoiceInput({ needsPaymentDate, paymentDate = "", invoiceDate = "" }) {
  const confirmed = String(paymentDate).trim();

  if (needsPaymentDate && !confirmed) {
    return { errors: { payment_date: "Confirm the payment date to issue this invoice." } };
  }

  return {
    input: {
      paymentDate: needsPaymentDate ? confirmed : null,
      invoiceDate: String(invoiceDate).trim() || null,
    },
  };
}
