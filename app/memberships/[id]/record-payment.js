"use client";

import { useState, useTransition } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { formatCurrency } from "@/lib/currencies";
import { recordMembershipPayment } from "@/lib/memberships/payment-actions";
import { fromPaise } from "@/lib/memberships/payments-core";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";

/**
 * Record Payment (V1 Tax Adjustment, Step 2) - a payment against a membership that is not yet fully
 * paid: its date and one or more methods (cash, card, UPI, bank transfer, other), each with its
 * amount and an optional reference ID and notes. Several methods make one payment; several payments
 * make installments.
 *
 * Mirrors the Issue Receipt dialog: the button only opens the dialog, and the action runs from
 * Confirm inside `startTransition`. The action revalidates the membership, so on success the page
 * re-renders with the new payment, paid amount, balance and payment status. The database repeats
 * every check (balance, totals, date, Admin role).
 */
export default function RecordPayment({ membershipId, balancePaise, currency, today, student, membership, taxInvoiceDefault = true }) {
  const [open, setOpen] = useState(false);
  // The fields and their state are the shared payment entry (also used by Create / Renew Membership): the first
  // method starts with the balance as the suggested amount, and the tax invoice choice with the student's preference.
  const draft = usePaymentDraft({ today, balancePaise, taxInvoiceDefault, initialAmount: fromPaise(balancePaise) });
  const [fieldErrors, setFieldErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) {
      // Start clean next time, with the balance as the suggested amount.
      draft.reset(fromPaise(balancePaise));
      setFieldErrors({});
      setRowErrors({});
      setFormError(null);
    }
  }

  function runRecord() {
    startTransition(async () => {
      const result = await recordMembershipPayment(membershipId, draft.input);

      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        setRowErrors(result.rowErrors ?? {});
        const shownOnField = result.fieldErrors?.payment_date || result.fieldErrors?.methods || Object.keys(result.rowErrors ?? {}).length > 0;
        setFormError(shownOnField ? null : result.error);
        return;
      }

      handleOpenChange(false);
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Wallet className="size-4" aria-hidden="true" />
        Record Payment
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Record payment"
        size="lg"
        context={<StudentContext student={student} membership={membership} />}
        description={`Outstanding balance: ${formatCurrency(fromPaise(balancePaise), currency)}. A payment can combine several methods.`}
        confirmLabel="Record Payment"
        pendingLabel="Recording…"
        isPending={isPending}
        onConfirm={runRecord}
      >
        <PaymentFields
          draft={draft}
          currency={currency}
          today={today}
          disabled={isPending}
          fieldErrors={fieldErrors}
          rowErrors={rowErrors}
          formError={formError}
          taxInvoiceDefault={taxInvoiceDefault}
          onRowRemoved={() => setRowErrors({})}
        />
      </ConfirmDialog>
    </>
  );
}
