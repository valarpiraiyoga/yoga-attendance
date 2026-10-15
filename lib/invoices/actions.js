"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  cancelPaymentDocumentFor,
  correctAndReissuePaymentDocumentFor,
  correctPaymentDocumentFor,
  evaluateCorrection,
  fetchCorrectionContext,
  fetchInvoice,
  issueInvoiceFor,
  issuePaymentDocumentFor,
  updateInvoiceDetailsFor,
} from "@/lib/invoices/invoice-core";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { centreDateOf } from "@/lib/class-sessions/validation";

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
 * Issues the document of one recorded payment (V1 Tax Adjustment, Step 4): a tax invoice or a payment
 * receipt, as the payment chose. The database decides the series and the number and refuses a second
 * document for the same payment.
 *
 * @param {string} membershipId - for revalidating its pages.
 * @param {string} paymentId
 */
export async function issuePaymentDocument(membershipId, paymentId) {
  await requireRole(ROLES.ADMIN);

  const result = await issuePaymentDocumentFor(await createClient(), paymentId);

  if (result.success) {
    revalidateMembership(membershipId);
  }
  return result;
}

/**
 * Corrects a payment document (V1 Tax Adjustment, Step 6): the database cancels it with the reason and issues
 * its replacement - a new number from the same series - in one transaction. The payment, its methods and the
 * membership are untouched.
 *
 * @param {string} membershipId - for revalidating its pages.
 * @param {string} documentId
 * @param {string} reason
 */
export async function correctPaymentDocument(membershipId, documentId, reason) {
  await requireRole(ROLES.ADMIN);

  const result = await correctPaymentDocumentFor(await createClient(), documentId, reason);

  if (result.success) {
    revalidateMembership(membershipId);
    revalidatePath(`${membershipPath(membershipId)}/documents/${documentId}`);
  }
  return result;
}

/**
 * Cancel Document (migration 0055): cancels one issued payment document with a required reason and issues NO replacement. The
 * payment and the membership are untouched and the payment stays locked.
 *
 * @param {string} membershipId
 * @param {string} documentId
 * @param {string} reason
 */
export async function cancelPaymentDocument(membershipId, documentId, reason) {
  await requireRole(ROLES.ADMIN);

  const result = await cancelPaymentDocumentFor(await createClient(), documentId, reason);

  if (result.success) {
    revalidateMembership(membershipId);
    revalidatePath(`${membershipPath(membershipId)}/documents/${documentId}`);
  }
  return result;
}

/** The centre's date, the one every "not in the future" rule is judged on. */
async function centreToday() {
  return centreDateOf(new Date(), await getCenterTimezone());
}

/**
 * The review step of Correct & Reissue: validates a correction and returns the recalculated document and membership balance
 * - nothing is written. The same rules, the same recalculation and the same data as the confirmation below uses.
 *
 * @param {string} membershipId
 * @param {string} documentId
 * @param {object} input - see `validateCorrectionInput`.
 */
export async function previewPaymentDocumentCorrection(membershipId, documentId, input) {
  await requireRole(ROLES.ADMIN);

  const context = await fetchCorrectionContext(await createClient(), membershipId, documentId);
  if (!context) return { error: "Invoice not found.", code: "P0002" };
  if (context.document.status !== "issued") return { error: "This document has already been cancelled and corrected.", code: "55006" };

  return evaluateCorrection(context, input, await centreToday());
}

/**
 * Correct & Reissue (migration 0055): cancels the document, corrects its payment (amount and methods; the payment date is
 * unchanged) within the membership's remaining balance, and issues the linked replacement in the same series with a new number
 * - one database transaction. Corrected customer / business details exist only on the replacement. On success the replacement's
 * id is returned.
 *
 * @param {string} membershipId
 * @param {string} documentId
 * @param {object} input - the form, plus the reviewed `expectedTotal` / `expectedTax`.
 */
export async function correctAndReissuePaymentDocument(membershipId, documentId, input) {
  await requireRole(ROLES.ADMIN);

  const result = await correctAndReissuePaymentDocumentFor(await createClient(), {
    membershipId,
    documentId,
    input,
    today: await centreToday(),
  });

  if (result.success) {
    revalidateMembership(membershipId);
    revalidatePath(`${membershipPath(membershipId)}/documents/${documentId}`);
    revalidatePath(`${membershipPath(membershipId)}/documents/${result.invoiceId}`);
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
