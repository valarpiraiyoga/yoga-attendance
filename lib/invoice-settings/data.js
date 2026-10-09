import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchHasIssuedInvoices, fetchHasIssuedPaymentReceipts, fetchInvoiceSettings } from "@/lib/invoice-settings/settings-core";
import { createSignatureUrl } from "@/lib/invoice-settings/signature";

/**
 * Data Access Layer for the Invoice / Receipt Settings (V1 Invoice / Receipt
 * Enhancement; supabase/migrations/0025_payment_date_invoice_settings.sql).
 *
 * Admin-only. RLS already restricts the table, the invoices and the signature
 * bucket to admins, but like `lib/invoices/data.js` these functions also require
 * the Admin role themselves, so the settings can never be read on a path that
 * forgot to guard its page. `requireRole` is cached per request.
 */

/** The settings row (never `next_invoice_number`), or null if it is missing. */
export async function getInvoiceSettings() {
  await requireRole(ROLES.ADMIN);
  return fetchInvoiceSettings(await createClient());
}

/** Whether any invoice has been issued — i.e. the starting number is locked. */
export async function hasAnyInvoice() {
  await requireRole(ROLES.ADMIN);
  return fetchHasIssuedInvoices(await createClient());
}

/** Whether any payment receipt has been issued - i.e. the payment receipt starting number is locked. */
export async function hasAnyPaymentReceipt() {
  await requireRole(ROLES.ADMIN);
  return fetchHasIssuedPaymentReceipts(await createClient());
}

/**
 * A temporary (1-hour) signed URL to show the stored signature, or null when
 * there is none. Only the preview link lapses; the stored signature does not.
 *
 * @param {string|null|undefined} signaturePath
 */
export async function getSignaturePreviewUrl(signaturePath) {
  await requireRole(ROLES.ADMIN);
  return createSignatureUrl(await createClient(), signaturePath);
}
