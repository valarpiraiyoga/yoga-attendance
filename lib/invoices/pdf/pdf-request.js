import { buildInvoiceDocument } from "../invoice-document.js";

/**
 * The request flow of the invoice PDF endpoint (GET /memberships/[id]/invoice/pdf), with every
 * collaborator passed in so the order of steps can be tested without a server. The route file
 * (app/memberships/[id]/invoice/pdf/route.js) is the thin wrapper that supplies the real ones:
 *
 *   requireAdmin()                       Admin only, FIRST - before any invoice is read
 *   → getInvoice(membershipId)           the existing invoice data layer (the stored invoice row)
 *   → buildInvoiceDocument(invoice)      the one view model the HTML Invoice Detail also uses
 *   → getAssetUrls(invoice)              links made from the paths THAT INVOICE stored
 *   → loadImages(urls)                   the Phase 6.3 loader: bytes, or null when unusable
 *   → render(doc, images)                the Phase 6.3 renderer, with its image fallbacks
 *   → Response(application/pdf)
 *
 * Nothing but the invoice row is read: no membership, student, Center Profile, Invoice / Receipt
 * Settings or Bank Account, so a later change to any of them cannot alter an issued invoice's PDF.
 * The PDF is generated on request and never stored. The asset links stay on the server - only the
 * image bytes inside the PDF leave it.
 */

const NO_STORE = "private, no-store";

/**
 * The download's file name: "Invoice-" and the formatted invoice number (prefix included), for
 * example Invoice-INV-790.pdf - for a Receipt too. Only letters, digits, dot, underscore and hyphen
 * survive, so a stored value can never add a header, a quote or a path.
 */
export function invoicePdfFilename(invoiceDocument) {
  const number = String(invoiceDocument?.number ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return number ? `Invoice-${number}.pdf` : "Invoice.pdf";
}

function plain(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE } });
}

/**
 * @param {string} membershipId
 * @param {{
 *   requireAdmin: () => Promise<unknown>,
 *   getInvoice: (membershipId: string) => Promise<object|null>,
 *   getAssetUrls: (invoice: object) => Promise<{ logoUrl: string|null, signatureUrl: string|null }>,
 *   loadImages: (urls: object) => Promise<{ logo: object|null, signature: object|null }>,
 *   render: (invoiceDocument: object, images: object) => Promise<Buffer>,
 * }} deps
 * @returns {Promise<Response>}
 */
export async function handleInvoicePdfRequest(membershipId, { requireAdmin, getInvoice, getAssetUrls, loadImages, render }) {
  // A refusal (sign-in or home redirect) throws out of here before anything is read.
  await requireAdmin();

  const invoice = await getInvoice(membershipId);
  if (!invoice) return plain("Invoice not found.", 404);

  try {
    const invoiceDocument = buildInvoiceDocument(invoice);
    const images = await loadImages(await getAssetUrls(invoice));
    const pdf = await render(invoiceDocument, images);

    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoicePdfFilename(invoiceDocument)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": NO_STORE,
      },
    });
  } catch (error) {
    // Only the kind of failure is logged: the message of a failed fetch could carry a signed link,
    // and the invoice's contents are never logged.
    console.error("[invoice-pdf] could not generate the PDF:", error?.name ?? "Error");
    return plain("The PDF could not be generated. Try again.", 500);
  }
}
