/**
 * The document action of a membership - the one action in a membership's actions (the list's icon,
 * the list's and the detail page's overflow menu) that leads to its document. It is decided by the
 * PAYMENT STATUS and whether a receipt has been issued, never by the membership's own status
 * (Upcoming / Active / Expired / Cancelled):
 *
 *   pending                -> "View Due Notice" -> /memberships/[id]/receipt
 *                             (the existing on-demand page, presented as the Payment Due Notice)
 *   paid, receipt exists   -> "View Receipt"    -> /memberships/[id]/invoice
 *                             (the stored receipt - Invoice Detail internally)
 *   paid, no receipt yet   -> "Issue Receipt"   -> no link: it opens the existing Issue Receipt dialog
 *                             (a Paid membership without a receipt has no receipt page - that route is
 *                             a 404 - so it is never linked to)
 *
 * Internal names keep "invoice" (the invoices table, /invoice routes, issue_invoice): only the words a
 * person reads changed.
 *
 * `payment_status` is 'pending', 'partially_paid' or 'paid' in the database (migrations 0008, 0034). Only
 * Paid has a receipt; Pending and Partially Paid (money still owed) read as a due notice, as would any
 * other value - so nothing can be mistaken for a paid receipt.
 *
 * @param {string} membershipId
 * @param {string|null|undefined} paymentStatus - the membership's `payment_status`.
 * @param {boolean} [invoiceExists] - whether the membership has an issued receipt (invoice row).
 * @returns {{ kind: "due-notice"|"receipt"|"issue-receipt", label: string, href: string|null }}
 */
export function membershipDocumentAction(membershipId, paymentStatus, invoiceExists = false, hasPayments = false) {
  if (paymentStatus === "paid") {
    if (invoiceExists) return { kind: "receipt", label: "View Receipt", href: `/memberships/${membershipId}/invoice` };
    // Paid through recorded payments (0036): its documents are per payment, on Membership Details.
    if (hasPayments) return { kind: "payments", label: "View Payments", href: `/memberships/${membershipId}` };
    return { kind: "issue-receipt", label: "Issue Receipt", href: null };
  }
  return { kind: "due-notice", label: "View Due Notice", href: `/memberships/${membershipId}/receipt` };
}

/**
 * Whether the invoices embedded in a membership read (`invoices(id)`) hold one. A membership has at
 * most one invoice (Membership 1 : 0..1 Invoice); the embed arrives as an object, an array, or
 * nothing, depending on how the relationship is read, so all three are accepted.
 */
export function invoiceExistsOf(embedded) {
  // Only the membership-level document counts; a payment's own documents (0036) carry a payment_id.
  const isMembershipLevel = (row) => Boolean(row) && row.payment_id == null;
  return Array.isArray(embedded) ? embedded.some(isMembershipLevel) : isMembershipLevel(embedded);
}
