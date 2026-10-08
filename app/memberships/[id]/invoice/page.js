import { notFound } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getInvoiceForMembership } from "@/lib/invoices/data";
import { getInvoiceAssetUrls } from "@/lib/invoices/document-data";
import { buildInvoiceDocument } from "@/lib/invoices/invoice-document";
import InvoiceDocument from "@/app/memberships/[id]/invoice/invoice-document";
import PrintInvoiceButton from "@/app/memberships/[id]/invoice/print-invoice-button";

/**
 * Invoice Detail (V1 Invoice / Receipt Enhancement): the STORED invoice for a membership,
 * shown as the document it is. Read-only — editing the number and date is a later step.
 *
 * Everything on the page comes from the invoice record itself. It deliberately does not read
 * the membership, the student, the Center Profile or the Invoice / Receipt Settings: an
 * issued invoice is a historical snapshot, so a later change to any of those must not change
 * what it shows (for example an invoice issued as INV-790 stays INV-790 after the prefix
 * setting changes to YC-). The number is built by the one formatter inside
 * `buildInvoiceDocument`; its logo and signature are shown from the paths the invoice stored.
 *
 * Admin-only (see app/memberships/layout.js for why this is repeated here). A membership with
 * no invoice has nothing to show, so it is a plain not-found, as a missing membership is.
 *
 * Print: `Print` calls `window.print()` on this very page - there is no second print document.
 * The sidebar and header are `print:hidden` (see `AppShell`), so is this page's header (back link,
 * title and the button), and `@page` asks for A4 with a 14mm margin, as the membership receipt does.
 * The document carries its own print rules (see invoice-document.js).
 */
export default async function InvoiceDetailPage({ params }) {
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const invoice = await getInvoiceForMembership(id);

  if (!invoice) {
    notFound();
  }

  const invoiceDocument = buildInvoiceDocument(invoice);
  const { logoUrl, signatureUrl } = await getInvoiceAssetUrls(invoice);

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 14mm; } }`}</style>

      <PageHeader
        compact
        className="print:hidden"
        actions={<PrintInvoiceButton />}
        back={{ href: `/memberships/${id}`, label: "Back to Membership" }}
        title={`${invoiceDocument.title} ${invoiceDocument.number}`}
        description="The stored document, as it was issued."
      />

      <div className="mx-auto w-full max-w-3xl print:max-w-none">
        <InvoiceDocument invoiceDocument={invoiceDocument} logoUrl={logoUrl} signatureUrl={signatureUrl} />
      </div>
    </>
  );
}
