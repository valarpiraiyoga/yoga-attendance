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
export function getInvoiceSectionState({ membership, invoice }) {
  const hasInvoice = Boolean(invoice);
  const canIssue = !hasInvoice && membership?.payment_status === "paid";
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

/**
 * The read-only Payment Date line under Payment Status on the membership form.
 * `paymentStatus` is the form's CURRENT selection.
 *
 *   locked         — an invoice exists: the date cannot change;
 *   not-applicable — the selection is not Paid;
 *   recorded / missing — already Paid: its date, or none;
 *   on-save        — becoming Paid: the database records the date when saved.
 *
 * The form never sends a payment date; this line is information, not a control.
 *
 * @param {{ paymentStatus: string, membership?: object|null, hasInvoice?: boolean }} input
 * @returns {{ kind: "locked"|"not-applicable"|"recorded"|"missing"|"on-save", date: string|null }}
 */
export function getFormPaymentDateState({ paymentStatus, membership, hasInvoice = false }) {
  if (hasInvoice) return { kind: "locked", date: membership?.payment_date ?? null };
  if (paymentStatus !== "paid") return { kind: "not-applicable", date: null };
  if (membership?.payment_status === "paid") {
    return membership.payment_date
      ? { kind: "recorded", date: membership.payment_date }
      : { kind: "missing", date: null };
  }
  return { kind: "on-save", date: null };
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
