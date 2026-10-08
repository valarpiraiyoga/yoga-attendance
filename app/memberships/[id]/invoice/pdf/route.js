import "server-only";

import { requireRole, ROLES } from "@/lib/auth/dal";
import { getInvoiceForMembership } from "@/lib/invoices/data";
import { getInvoiceAssetUrls } from "@/lib/invoices/document-data";
import { loadInvoicePdfImages } from "@/lib/invoices/pdf/images";
import { handleInvoicePdfRequest } from "@/lib/invoices/pdf/pdf-request";
import { renderInvoicePdf } from "@/lib/invoices/pdf/render";

// React-PDF and the bundled font files need Node.js (not the Edge runtime).
export const runtime = "nodejs";

/**
 * GET /memberships/[id]/invoice/pdf - the stored invoice for a membership as a downloadable PDF,
 * generated on request and never stored. Admin-only.
 *
 * A route handler is not covered by a page layout's auth check (see app/reports/export/route.js),
 * so the Admin requirement is asserted here, first: a signed-out visitor is sent to sign in and a
 * non-Admin to the home page, exactly as for the Invoice Detail page. The flow itself - invoice
 * row, view model, stored asset links, image bytes, render, response headers - is
 * `handleInvoicePdfRequest` (lib/invoices/pdf/pdf-request.js), which reads nothing but the invoice.
 * The authenticated session client is used throughout; there is no service role.
 */
export async function GET(_request, { params }) {
  const { id } = await params;

  return handleInvoicePdfRequest(id, {
    requireAdmin: () => requireRole(ROLES.ADMIN),
    getInvoice: getInvoiceForMembership,
    getAssetUrls: getInvoiceAssetUrls,
    loadImages: loadInvoicePdfImages,
    render: renderInvoicePdf,
  });
}
