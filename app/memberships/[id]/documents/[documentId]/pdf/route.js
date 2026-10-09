import "server-only";

import { requireRole, ROLES } from "@/lib/auth/dal";
import { getPaymentDocument } from "@/lib/invoices/data";
import { getInvoiceAssetUrls } from "@/lib/invoices/document-data";
import { loadInvoicePdfImages } from "@/lib/invoices/pdf/images";
import { handleInvoicePdfRequest } from "@/lib/invoices/pdf/pdf-request";
import { renderInvoicePdf } from "@/lib/invoices/pdf/render";

// React-PDF and the bundled font files need Node.js (not the Edge runtime).
export const runtime = "nodejs";

/**
 * GET /memberships/[id]/documents/[documentId]/pdf - a payment's document (0036) as a downloadable PDF,
 * through the same flow as the membership-level receipt's PDF (handleInvoicePdfRequest). Admin-only,
 * asserted first; the document must belong to this membership and document a payment.
 */
export async function GET(_request, { params }) {
  const { id, documentId } = await params;

  return handleInvoicePdfRequest(id, {
    requireAdmin: () => requireRole(ROLES.ADMIN),
    getInvoice: (membershipId) => getPaymentDocument(membershipId, documentId),
    getAssetUrls: getInvoiceAssetUrls,
    loadImages: loadInvoicePdfImages,
    render: renderInvoicePdf,
  });
}
