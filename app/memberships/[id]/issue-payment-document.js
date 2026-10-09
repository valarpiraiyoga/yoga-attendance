"use client";

import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { issuePaymentDocument } from "@/lib/invoices/actions";

/**
 * Issue Document (V1 Tax Adjustment, Step 4) - the one document of a recorded payment: a tax invoice
 * from the invoice sequence when the payment chose one, else a payment receipt from its own sequence.
 * The kind was decided when the payment was recorded; this only confirms and issues it. The database
 * picks the number, takes the snapshot and refuses a second document for the same payment.
 *
 * Mirrors the Issue Receipt dialog: the button opens the confirmation, and the action runs from
 * Confirm inside `startTransition`; on success the page re-renders with the document's number.
 */
export default function IssuePaymentDocument({ membershipId, paymentId, issueTaxInvoice, paymentLabel, student, membership }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const kind = issueTaxInvoice ? "tax invoice" : "payment receipt";

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) setError(null);
  }

  function runIssue() {
    startTransition(async () => {
      const result = await issuePaymentDocument(membershipId, paymentId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      handleOpenChange(false);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Issue document for ${paymentLabel}`}>
        <FileText className="size-4" aria-hidden="true" />
        Issue Document
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={issueTaxInvoice ? "Issue tax invoice" : "Issue payment receipt"}
        context={<StudentContext student={student} membership={membership} />}
        description={
          issueTaxInvoice
            ? `A tax invoice will be issued for ${paymentLabel}, numbered from the invoice sequence.`
            : `A payment receipt will be issued for ${paymentLabel}, numbered from the payment receipt sequence. It does not use an invoice number.`
        }
        confirmLabel={`Issue ${kind}`}
        pendingLabel="Issuing…"
        isPending={isPending}
        onConfirm={runIssue}
      >
        {error ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
