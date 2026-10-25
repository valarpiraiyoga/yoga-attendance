"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { formatCurrency } from "@/lib/currencies";
import { editMembershipPayment } from "@/lib/memberships/payment-actions";
import { fromPaise, toPaise } from "@/lib/memberships/payments-core";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";
import { showSuccessToast } from "@/components/ui/success-toast";

/** A saved method in the shape the payment fields edit. */
const rowOf = (method) => ({
  method: method.method,
  amount: String(method.amount),
  referenceId: method.reference_id ?? "",
  notes: method.notes ?? "",
});

/**
 * Edit Payment - corrects a recorded payment while no document has been issued for it: its date, and its methods
 * (type, amount, reference / transaction ID and notes; changed, added or removed). The total is the sum of the methods.
 * It uses the same payment fields as Record Payment, and the dialog always opens with what is saved NOW.
 *
 * Nothing is saved until Save: the action validates exactly as when recording, and the database replaces the methods,
 * date and amount in one transaction and recomputes the membership's payment status - so a refused edit changes
 * nothing. Once a document exists the button is not offered and the database refuses the edit; the payment is then
 * corrected by Cancel and Reissue on its document.
 */
export default function EditPayment({ membershipId, payment, balancePaise, currency, today, paymentLabel, student, membership }) {
  const [open, setOpen] = useState(false);

  // What this payment may total: the current balance plus its own current amount (the other payments stay as they are).
  const availablePaise = balancePaise + (toPaise(Number(payment.amount).toFixed(2)) ?? 0);
  const draft = usePaymentDraft({
    today,
    balancePaise: availablePaise,
    initialPaymentDate: payment.payment_date,
    initialRows: payment.methods.map(rowOf),
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next) {
    // Every time it opens it shows what is saved now (the page may have refreshed since the last edit).
    if (next) draft.load(payment.payment_date, payment.methods.map(rowOf));
    setOpen(next);
    if (!next) {
      setFieldErrors({});
      setRowErrors({});
      setFormError(null);
    }
  }

  function runEdit() {
    startTransition(async () => {
      const result = await editMembershipPayment(membershipId, payment.id, { paymentDate: draft.paymentDate, methods: draft.rows });

      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        setRowErrors(result.rowErrors ?? {});
        const shownOnField = result.fieldErrors?.payment_date || result.fieldErrors?.methods || Object.keys(result.rowErrors ?? {}).length > 0;
        setFormError(shownOnField ? null : result.error);
        return;
      }

      handleOpenChange(false);
      showSuccessToast("Payment updated successfully.");
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => handleOpenChange(true)} aria-label={`Edit ${paymentLabel}`} title="Edit payment">
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Edit payment"
        size="lg"
        context={<StudentContext student={student} membership={membership} />}
        description={`This payment may total up to ${formatCurrency(fromPaise(availablePaise), currency)}. Once a document is issued for it, it can only be corrected by Cancel and Reissue.`}
        confirmLabel="Save Payment"
        pendingLabel="Saving…"
        isPending={isPending}
        onConfirm={runEdit}
      >
        <PaymentFields
          draft={draft}
          currency={currency}
          today={today}
          disabled={isPending}
          fieldErrors={fieldErrors}
          rowErrors={rowErrors}
          formError={formError}
          showTaxInvoice={false}
          idPrefix="edit-payment"
          onRowRemoved={() => setRowErrors({})}
        />
      </ConfirmDialog>
    </>
  );
}
