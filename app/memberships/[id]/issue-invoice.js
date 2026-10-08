"use client";

import { useState, useTransition } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import StudentContext from "@/components/ui/student-context";
import { issueInvoice } from "@/lib/invoices/actions";
import { prepareIssueInvoiceInput } from "@/lib/invoices/membership-invoice";

/**
 * Issue Receipt — the explicit action for a Paid membership that has no
 * invoice (typically one that was Paid before invoicing existed). Offered only
 * when `getInvoiceSectionState` says it can be issued; the database refuses
 * anything else regardless.
 *
 * There is ONE dialog, `IssueInvoiceDialog` (controlled: `open` / `onOpenChange`), and it is used
 * from every place that offers the action — the Membership Details button below (`IssueInvoice`)
 * and the Memberships list and menus (app/memberships/membership-issue-invoice.js). It is the single
 * source of the flow: the confirmation, the payment-date rule, the validation, the `issueInvoice`
 * action and its errors.
 *
 * Mirrors app/memberships/[id]/cancel-membership.js: the button only opens the
 * confirmation dialog, and `issueInvoice` (the Phase 1 action, called directly
 * inside `startTransition`) runs only from Confirm. The action revalidates the
 * membership pages, so on success the section re-renders with the invoice.
 *
 * With no recorded payment date (`needsPaymentDate`) the Admin must enter the
 * actual date — it is never defaulted, not even to today. With a date already
 * recorded it is shown and used, and the Admin is not asked to replace it. The
 * invoice date is optional; left blank, the database defaults it. Every rule
 * about those dates (not in the future, not before the payment date) is the
 * database's; its message is shown against the field.
 */
export function IssueInvoiceDialog({ open, onOpenChange, membershipId, needsPaymentDate, paymentDateLabel, student, membership }) {
  const [paymentDate, setPaymentDate] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next) {
    onOpenChange(next);
    if (!next) {
      // Start clean next time: nothing typed or reported before is carried over.
      setPaymentDate("");
      setInvoiceDate("");
      setFieldErrors({});
      setFormError(null);
    }
  }

  function runIssue() {
    const prepared = prepareIssueInvoiceInput({ needsPaymentDate, paymentDate, invoiceDate });
    if (prepared.errors) {
      setFieldErrors(prepared.errors);
      setFormError(null);
      return;
    }

    startTransition(async () => {
      const result = await issueInvoice(membershipId, prepared.input);

      if (result?.error) {
        const errors = result.fieldErrors ?? {};
        setFieldErrors(errors);
        // A message tied to a field shows there; anything else shows as the dialog's own error.
        setFormError(errors.payment_date || errors.invoice_date ? null : result.error);
        return;
      }

      handleOpenChange(false);
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Issue receipt"
      context={<StudentContext student={student} membership={membership} />}
      description={
        needsPaymentDate
          ? "This membership is Paid but has no recorded payment date. Enter the date it was actually paid — it is not filled in for you."
          : `The recorded payment date (${paymentDateLabel}) will be used for the receipt.`
      }
      confirmLabel="Issue Receipt"
      pendingLabel="Issuing…"
      isPending={isPending}
      onConfirm={runIssue}
    >
      <div className="flex flex-col gap-4">
        {formError ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {formError}
          </p>
        ) : null}

        {needsPaymentDate ? (
          <FormField id="issue-payment-date" label="Payment date" required error={fieldErrors.payment_date}>
            {(field) => (
              <Input
                {...field}
                type="date"
                required
                disabled={isPending}
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            )}
          </FormField>
        ) : null}

        <FormField
          id="issue-invoice-date"
          label="Receipt date"
          error={fieldErrors.invoice_date}
          help="Optional. Left blank, it is the payment date."
        >
          {(field) => (
            <Input
              {...field}
              type="date"
              disabled={isPending}
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </ConfirmDialog>
  );
}

/** The Issue Receipt button of Membership Details, and the dialog it opens. */
export default function IssueInvoice({ membershipId, needsPaymentDate, paymentDateLabel, student, membership }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Receipt className="size-4" aria-hidden="true" />
        Issue Receipt
      </Button>

      <IssueInvoiceDialog
        open={open}
        onOpenChange={setOpen}
        membershipId={membershipId}
        needsPaymentDate={needsPaymentDate}
        paymentDateLabel={paymentDateLabel}
        student={student}
        membership={membership}
      />
    </>
  );
}
