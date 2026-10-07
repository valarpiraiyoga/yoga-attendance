import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchInvoice, fetchInvoiceForMembership } from "@/lib/invoices/invoice-core";

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
