"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchInvoice, issueInvoiceFor, updateInvoiceDetailsFor } from "@/lib/invoices/invoice-core";

/**
 * Server actions for Invoices (V1 Invoice / Receipt Enhancement).
 *
 * Mirrors lib/memberships/actions.js: `requireRole(ROLES.ADMIN)` runs first in
 * every action, and the database enforces the same thing again (the invoice
 * functions check `is_admin()`; the table has no client write access).
 * Called directly from a client component wrapped in `useTransition` — Next.js's
 * documented pattern for invoking a Server Action outside a form, as
 * `cancelMembership` does — so they return `{ success }` or `{ error,
 * fieldErrors? }` rather than redirecting.
 *
 * There is NO invoice-number, tax or snapshot logic here. Automatic issuing is
 * the database's own (a Paid membership is invoiced by a trigger once numbering
 * is configured); these are the two explicit actions:
 *   - `issueInvoice`         — for a Paid membership that has no invoice yet,
 *                              typically one that was Paid before invoicing
 *                              existed and so has no payment date to default.
 *   - `updateInvoiceDetails` — the only edit an issued invoice allows: its
 *                              number and date.
 */

function membershipPath(id) {
  return `/memberships/${id}`;
}

function revalidateMembership(membershipId) {
  revalidatePath("/memberships");
  revalidatePath(membershipPath(membershipId));
  revalidatePath(`${membershipPath(membershipId)}/receipt`);
}

/**
 * Issues the invoice for a Paid membership that has none.
 *
 * `paymentDate` — required by the database only when the membership has no
 * payment date yet (one that was Paid before invoicing existed): the Admin
 * confirms it, and it becomes both the membership's and the invoice's payment
 * date. Never invented here or in the database.
 * `invoiceDate` — optional; defaults, in the database, to the payment date.
 *
 * @param {string} membershipId
 * @param {{ paymentDate?: string|null, invoiceDate?: string|null }} [input]
 */
export async function issueInvoice(membershipId, input) {
  await requireRole(ROLES.ADMIN);

  const result = await issueInvoiceFor(await createClient(), membershipId, input);

  if (result.success) {
    revalidateMembership(membershipId);
  }
  return result;
}

/**
 * Edits an issued invoice's number and date — nothing else.
 *
 * @param {string} invoiceId
 * @param {{ invoiceNumber: string|number, invoiceDate: string }} input
 */
export async function updateInvoiceDetails(invoiceId, input) {
  await requireRole(ROLES.ADMIN);

  const supabase = await createClient();
  const result = await updateInvoiceDetailsFor(supabase, invoiceId, input);

  if (result.success) {
    // The function returns nothing; read the invoice back for the page to refresh.
    const invoice = await fetchInvoice(supabase, invoiceId);
    if (invoice) revalidateMembership(invoice.membership_id);
  }
  return result;
}
