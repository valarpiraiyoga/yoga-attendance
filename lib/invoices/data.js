import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchInvoice, fetchInvoiceForMembership, fetchPaymentDocumentHistory } from "@/lib/invoices/invoice-core";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { centreDateOf } from "@/lib/class-sessions/validation";
import { fetchPaymentMethods } from "@/lib/memberships/payments-core";

/**
 * Data Access Layer for reading Invoices (V1 Invoice / Receipt Enhancement;
 * supabase/migrations/0026_invoices.sql).
 *
 * Invoices are Admin-only. RLS already restricts the table to admins, so an
 * Instructor's query would simply return nothing — but unlike the other data
 * modules these functions also require the Admin role themselves, so an invoice
 * can never be read on a path that forgot to guard its page. `requireRole` is
 * cached per request, so a page that has already called it pays nothing extra.
 */

/**
 * The invoice issued for a membership, or null if it has none.
 *
 * @param {string} membershipId
 */
export async function getInvoiceForMembership(membershipId) {
  await requireRole(ROLES.ADMIN);
  return fetchInvoiceForMembership(await createClient(), membershipId);
}

/**
 * An invoice by its own id, or null if it does not exist.
 *
 * @param {string} invoiceId
 */
export async function getInvoice(invoiceId) {
  await requireRole(ROLES.ADMIN);
  return fetchInvoice(await createClient(), invoiceId);
}

/**
 * A payment's own document (V1 Tax Adjustment, Step 4; migration 0036) - only when it belongs to the
 * given membership and documents a payment. Null otherwise, so a page or route is a plain not-found.
 *
 * @param {string} membershipId
 * @param {string} documentId
 */
export async function getPaymentDocument(membershipId, documentId) {
  await requireRole(ROLES.ADMIN);
  const supabase = await createClient();
  const document = await fetchInvoice(supabase, documentId);
  if (!document || document.membership_id !== membershipId || !document.payment_id) return null;
  // The methods the payment was made with (Step 5): shown on the document, never part of the stored snapshot.
  // Its correction history (Step 6): every document of the payment, and the centre date each was cancelled on.
  const [methods, history, timeZone] = await Promise.all([
    fetchPaymentMethods(supabase, document.payment_id),
    fetchPaymentDocumentHistory(supabase, document.payment_id),
    getCenterTimezone(),
  ]);
  const cancelledOn = (row) => (row.cancelled_at ? centreDateOf(row.cancelled_at, timeZone) : null);
  return {
    ...document,
    payment_methods: methods,
    cancelled_on: cancelledOn(document),
    history: history.map((row) => ({ ...row, cancelled_on: cancelledOn(row) })),
  };
}
