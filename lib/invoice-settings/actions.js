"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { saveInvoiceSettings } from "@/lib/invoice-settings/settings-core";
import { readSignatureFromForm } from "@/lib/invoice-settings/signature";

/**
 * Server action for the Invoice / Receipt Settings (V1 Invoice / Receipt
 * Enhancement, Phase 3).
 *
 * Mirrors `lib/center-profile/actions.js`'s `updateCenterProfile`:
 * `requireRole(ROLES.ADMIN)` runs first — RLS and the column-level grant also
 * enforce it in the database — and only validated, whitelisted columns ever
 * reach it. Everything else (the starting number being locked once an invoice
 * exists, the tax constraints, the counter) is the database's, and
 * `saveInvoiceSettings` (settings-core.js) maps its answers.
 *
 * The signature arrives in the same multipart submission (`photo` /
 * `remove_photo`) and goes to the private `invoice-assets` bucket
 * (signature.js) — not the public profile-photo storage. A replaced or removed
 * signature is never deleted from storage: issued invoices may reference it.
 *
 * Settings affect FUTURE invoices only; an issued invoice keeps its own copy.
 * No `id` parameter: there is exactly one settings row, keyed by `singleton`.
 */

const INVOICE_SETTINGS_PATH = "/settings/invoice-receipt";

function submittedInput(formData) {
  return {
    document_title: formData.get("document_title"),
    starting_invoice_number: formData.get("starting_invoice_number"),
    invoice_prefix: formData.get("invoice_prefix"),
    payment_receipt_starting_number: formData.get("payment_receipt_starting_number") ?? undefined,
    payment_receipt_prefix: formData.get("payment_receipt_prefix") ?? undefined,
    tax_enabled: formData.get("tax_enabled"),
    tax_name: formData.get("tax_name"),
    tax_rate: formData.get("tax_rate"),
    terms: formData.get("terms"),
    signatory_name: formData.get("signatory_name"),
    signatory_designation: formData.get("signatory_designation"),
  };
}

// React resets every uncontrolled field to its `defaultValue` on each form
// action, regardless of outcome — so a failed submission hands its values back.
function submittedValues(formData) {
  return submittedInput(formData);
}

export async function updateInvoiceSettings(_prevState, formData) {
  await requireRole(ROLES.ADMIN);

  const supabase = await createClient();
  const result = await saveInvoiceSettings(supabase, {
    input: submittedInput(formData),
    signature: readSignatureFromForm(formData),
  });

  if (!result.success) {
    return { error: result.error, fieldErrors: result.fieldErrors, values: submittedValues(formData) };
  }

  revalidatePath(INVOICE_SETTINGS_PATH);
  redirect(`${INVOICE_SETTINGS_PATH}?success=updated`);
}
