import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { getPaymentDocument } from "@/lib/invoices/data";
import { getInvoiceAssetUrls } from "@/lib/invoices/document-data";
import { buildInvoiceDocument } from "@/lib/invoices/invoice-document";
import { formatInvoiceNumberOf } from "@/lib/invoices/invoice-number";
import { DOCUMENT_TITLE_LABEL } from "@/lib/invoices/membership-invoice";
import InvoiceDocument from "@/app/memberships/[id]/invoice/invoice-document";
import PrintInvoiceButton from "@/app/memberships/[id]/invoice/print-invoice-button";
import CorrectDocument from "@/app/memberships/[id]/documents/[documentId]/correct-document";

const labelOf = (row) => `${DOCUMENT_TITLE_LABEL[row.document_title] ?? row.document_title} ${formatInvoiceNumberOf(row)}`;

/**
 * A payment's document (V1 Tax Adjustment, Steps 4-6): the stored tax invoice or payment receipt of one
 * recorded payment, shown with the same document, Print and PDF as the membership-level receipt
 * (app/memberships/[id]/invoice/page.js). It reads only the stored document row, a snapshot that never
 * follows later membership edits, with its payment's methods and correction history.
 *
 * Correction (Step 6): an issued document offers Correct Document, which cancels it and issues its
 * replacement. A cancelled document stays viewable - marked Cancelled with its reason, linked to its
 * replacement - and can be neither edited nor corrected again.
 */
export default async function PaymentDocumentPage({ params }) {
  await requireRole(ROLES.ADMIN);

  const { id, documentId } = await params;
  const document = await getPaymentDocument(id, documentId);

  if (!document) {
    notFound();
  }

  const invoiceDocument = buildInvoiceDocument(document);
  const { logoUrl, signatureUrl } = await getInvoiceAssetUrls(document);
  const isCancelled = document.status === "cancelled";
  const replacement = document.history.find((row) => row.replaces_id === document.id) ?? null;
  const replaced = document.replaces_id ? document.history.find((row) => row.id === document.replaces_id) ?? null : null;
  const documentHref = (row) => `/memberships/${id}/documents/${row.id}`;

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 14mm; } }`}</style>

      <PageHeader
        compact
        className="print:hidden"
        actions={
          <>
            <PrintInvoiceButton />
            <Button
              variant="outline"
              render={<a href={`/memberships/${id}/documents/${documentId}/pdf`} />}
              nativeButton={false}
            >
              <Download className="size-4" aria-hidden="true" />
              Download PDF
            </Button>
            {isCancelled ? null : (
              <CorrectDocument membershipId={id} documentId={document.id} title={invoiceDocument.title} number={invoiceDocument.number} />
            )}
          </>
        }
        back={{ href: `/memberships/${id}`, label: "Back to Membership" }}
        title={`${invoiceDocument.title} ${invoiceDocument.number}`}
        description={
          isCancelled
            ? "Cancelled by a correction. It keeps its number and cannot be changed."
            : "Issued for one payment. It does not change when the membership is edited."
        }
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 print:max-w-none">
        {isCancelled || replaced ? (
          <div
            role="status"
            className={
              isCancelled
                ? "text-body rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-danger print:hidden"
                : "text-body rounded-card border border-border bg-surface px-4 py-3 text-text-primary print:hidden"
            }
          >
            {isCancelled ? (
              <>
                <p className="font-semibold">
                  This document was cancelled{invoiceDocument.cancellation?.date ? ` on ${invoiceDocument.cancellation.date}` : ""}.
                </p>
                {invoiceDocument.cancellation?.reason ? <p className="break-words">Reason: {invoiceDocument.cancellation.reason}</p> : null}
                {replacement ? (
                  <p>
                    Replaced by{" "}
                    <Link href={documentHref(replacement)} className="font-medium text-brand hover:underline">
                      {labelOf(replacement)}
                    </Link>
                    .
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                This document replaces{" "}
                <Link href={documentHref(replaced)} className="font-medium text-brand hover:underline">
                  {labelOf(replaced)}
                </Link>
                , which was cancelled.
              </p>
            )}
          </div>
        ) : null}

        <InvoiceDocument invoiceDocument={invoiceDocument} logoUrl={logoUrl} signatureUrl={signatureUrl} />

        {document.history.length > 1 ? (
          <Panel className="print:hidden">
            <PanelHeader icon={History} title="Correction History" description="Every document issued for this payment, oldest first." className="mb-4" />
            <ol className="flex flex-col gap-3">
              {document.history.map((row) => (
                <li key={row.id} className="text-small flex flex-col gap-0.5 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.id === document.id ? (
                      <span className="font-medium text-text-primary">{labelOf(row)}</span>
                    ) : (
                      <Link href={documentHref(row)} className="font-medium text-brand hover:underline">
                        {labelOf(row)}
                      </Link>
                    )}
                    <Badge variant={row.status === "cancelled" ? "danger" : "success"}>{row.status === "cancelled" ? "Cancelled" : "Issued"}</Badge>
                    {row.id === document.id ? <span className="text-text-secondary">(this document)</span> : null}
                  </div>
                  <p className="text-text-secondary">
                    Dated {formatDate(row.invoice_date)}
                    {row.cancelled_on ? ` · cancelled on ${formatDate(row.cancelled_on)}` : ""}
                  </p>
                  {row.cancellation_reason ? <p className="break-words text-text-primary">Reason: {row.cancellation_reason}</p> : null}
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
