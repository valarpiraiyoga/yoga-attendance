"use client";

import { useRef, useState, useTransition } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { formatCurrency } from "@/lib/currencies";
import { recordMembershipPayment } from "@/lib/memberships/payment-actions";
import { endsPaymentRequest, fromPaise, paymentRequestFor } from "@/lib/memberships/payments-core";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";
import { showSuccessToast } from "@/components/ui/success-toast";

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
 *
 * Each payment carries a request ID the database uses to answer a repeat with the payment it already recorded (0065), so
 * a retry after a dropped connection or a timeout never records it twice. The ID is created at the first Confirm and kept
 * - across a failed attempt, and across closing and reopening the dialog - until the request has been answered for good
 * (`endsPaymentRequest`): a recorded payment, or the database saying the ID already recorded one with other details. The
 * next payment then gets a new ID. A failure, however unclear, never creates a new one: only the same ID repeats safely.
 * The one other end: the kept ID belongs to the number of payments the page showed when it was made (`paymentCount`, see
 * `paymentRequestFor`). If the page is refreshed showing another payment (this component stays mounted when another action
 * revalidates it), the earlier attempt is settled by what the page now shows, and a payment entered then is a new payment
 * with a new ID.
 */
export default function RecordPayment({ membershipId, balancePaise, paymentCount, currency, today, student, membership, taxInvoiceDefault = true }) {
  const [open, setOpen] = useState(false);
  // The fields and their state are the shared payment entry (also used by Create / Renew Membership): the first
  // method starts with the balance as the suggested amount, and the tax invoice choice with the student's preference.
  const draft = usePaymentDraft({ today, balancePaise, taxInvoiceDefault, initialAmount: fromPaise(balancePaise) });
  const [fieldErrors, setFieldErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const requestRef = useRef(null); // { id, paymentCount } of the request not yet answered for good

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
    if (isPending) return;
    // Kept request, or a new one when another payment has appeared since it was made (see `paymentRequestFor`). Set in the
    // click handler, before the transition starts, so a retry always finds it.
    requestRef.current = paymentRequestFor(requestRef.current, paymentCount, () => crypto.randomUUID());
    const requestId = requestRef.current.id;

    startTransition(async () => {
      let result;
      try {
        result = await recordMembershipPayment(membershipId, draft.input, requestId);
      } catch {
        // Not answered: the payment may or may not have been recorded. Keep the request ID, so trying again repeats this
        // request rather than recording a second payment.
        setFormError("Could not reach the server. Try again.");
        return;
      }
      if (endsPaymentRequest(result)) requestRef.current = null;

      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        setRowErrors(result.rowErrors ?? {});
        const shownOnField = result.fieldErrors?.payment_date || result.fieldErrors?.methods || Object.keys(result.rowErrors ?? {}).length > 0;
        setFormError(shownOnField ? null : result.error);
        return;
      }

      handleOpenChange(false);
      showSuccessToast("Payment recorded successfully.");
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
