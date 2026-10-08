import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { createSignatureUrl } from "@/lib/invoice-settings/signature";
import { PROFILE_PHOTO_BUCKET } from "@/lib/storage/profile-photo-rules";

/**
 * The two images an issued invoice shows, from the PATHS the invoice itself stored when it
 * was issued — never from the current Center Profile logo or Invoice / Receipt Settings
 * signature.
 *
 *   - Logo: the invoice keeps the object path inside the public `profile-photos` bucket
 *     (replaced logo files are retained — migration 0026), so its public URL is built the
 *     same way as every other stored image.
 *   - Signature: the invoice keeps a path in the PRIVATE `invoice-assets` bucket; the
 *     existing signature helper makes the temporary signed link (an expiring link only
 *     lapses — the stored signature does not).
 *
 * Admin-only, like `lib/invoices/data.js`. Either URL is null when the invoice has none
 * (or one cannot be made), and the page simply omits the image.
 *
 * @param {{ business_logo_path?: string|null, signature_path?: string|null }} invoice
 * @returns {Promise<{ logoUrl: string|null, signatureUrl: string|null }>}
 */
export async function getInvoiceAssetUrls(invoice) {
  await requireRole(ROLES.ADMIN);
  const supabase = await createClient();

  const logoUrl = invoice?.business_logo_path
    ? supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(invoice.business_logo_path).data.publicUrl
    : null;
  const signatureUrl = await createSignatureUrl(supabase, invoice?.signature_path);

  return { logoUrl, signatureUrl };
}
