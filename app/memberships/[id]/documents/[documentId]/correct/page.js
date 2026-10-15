import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { centreDateOf } from "@/lib/class-sessions/validation";
import { getCorrectionContext } from "@/lib/invoices/data";
import { correctableFields } from "@/lib/invoices/document-correction";
import { formatInvoiceNumberOf } from "@/lib/invoices/invoice-number";
import { DOCUMENT_TITLE_LABEL } from "@/lib/invoices/membership-invoice";
import { getMembership } from "@/lib/memberships/data";
import CorrectionForm from "@/app/memberships/[id]/documents/[documentId]/correct/correction-form";

/** A saved payment method in the shape the payment fields edit. */
const rowOf = (method) => ({
  method: method.method,
  amount: String(method.amount),
  referenceId: method.reference_id ?? "",
  notes: method.notes ?? "",
});

/**
 * Correct & Reissue (migration 0055): the dedicated correction page of an ISSUED payment document. It replaces the earlier
 * reason-only dialog. The Admin corrects the customer and business details, the invoice date and the payment's methods, reviews
 * the recalculated document, gives the reason and confirms; the database then cancels this document, corrects the payment and
 * issues the replacement (a new number from the same series) in one transaction.
 *
 * This page only lays the screen out: everything it shows is read from the stored document, its payment and its membership, and
 * the form's server actions do the validation, the recalculation and the writing. A document that is already cancelled has
 * nothing to correct and goes back to its own page.
 */
export default async function CorrectPaymentDocumentPage({ params }) {
  // Authorization boundary - see app/memberships/layout.js. The actions and the database check it again.
  await requireRole(ROLES.ADMIN);

  const { id, documentId } = await params;
  const context = await getCorrectionContext(id, documentId);

  if (!context) {
    notFound();
  }

  const { document, payment, membership: paymentMembership } = context;
  const documentPath = `/memberships/${id}/documents/${documentId}`;

  if (document.status !== "issued") {
    redirect(documentPath);
  }

  const [membership, timeZone] = await Promise.all([getMembership(id), getCenterTimezone()]);
  if (!membership) {
    notFound();
  }

  const title = DOCUMENT_TITLE_LABEL[document.document_title] ?? document.document_title;
  const number = formatInvoiceNumberOf(document);
  const initialDetails = Object.fromEntries(correctableFields(document.document_series).map((field) => [field, document[field] ?? ""]));

  return (
    <>
      <PageHeader
        compact
        back={{ href: documentPath, label: `Back to ${title}` }}
        title={`Correct ${title} ${number}`}
        description="Correct the details, review the replacement, then reissue. The original is kept, cancelled, with its number."
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-6">
          <CorrectionForm
            membershipId={id}
            documentId={documentId}
            series={document.document_series}
            title={title}
            number={number}
            currency={paymentMembership.currency}
            today={centreDateOf(new Date(), timeZone)}
            originalInvoiceDate={document.invoice_date}
            paymentDate={payment.payment_date}
            initialDetails={initialDetails}
            initialRows={payment.methods.map(rowOf)}
            paymentAmountPaise={context.paymentAmountPaise}
            membershipAmountPaise={context.membershipAmountPaise}
            otherPaymentsPaise={context.otherPaymentsPaise}
            availablePaise={context.availablePaise}
            student={membership.students}
            membership={{ code: membership.membership_code, plan: membership.package_name ?? document.description }}
          />
        </div>
      </div>
    </>
  );
}
