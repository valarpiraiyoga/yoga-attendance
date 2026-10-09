"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import StudentContext from "@/components/ui/student-context";
import { formatCurrency } from "@/lib/currencies";
import { editMembershipPayment } from "@/lib/memberships/payment-actions";
import { fromPaise, toPaise } from "@/lib/memberships/payments-core";

/**
 * Edit Amount (V1 Tax Adjustment, Step 8) - corrects a recorded payment's amount while no document has been issued
 * for it. Only the amounts of the payment's EXISTING methods change: there is no adding or removing a method, and
 * each method keeps its type, reference and notes. The dialog opens with each method's current amount and shows
 * the new total and the balance it would leave.
 *
 * Mirrors Record Payment: the button only opens the dialog, and the action runs from Confirm inside
 * `startTransition`. The database checks everything again, records the edit in the audit trail and recomputes the
 * membership's payment status; once a document exists the button is not offered and the database refuses the edit.
 */
export default function EditPaymentAmount({ membershipId, paymentId, methods, paymentAmount, balancePaise, currency, paymentLabel, student, membership }) {
  const initial = () => Object.fromEntries(methods.map((method) => [method.id, method.amount]));
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState(initial);
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  // What this payment may total: the current balance plus its own current amount (the other payments stay as they are).
  const availablePaise = balancePaise + (toPaise(Number(paymentAmount).toFixed(2)) ?? 0);
  const totalPaise = methods.reduce((sum, method) => sum + (toPaise(amounts[method.id]) ?? 0), 0);
  const remainingPaise = availablePaise - totalPaise;
  const money = (paise) => formatCurrency(fromPaise(paise), currency);

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) {
      setAmounts(initial());
      setRowErrors({});
      setFormError(null);
    }
  }

  function runEdit() {
    startTransition(async () => {
      const result = await editMembershipPayment(membershipId, paymentId, {
        allocations: methods.map((method) => ({ id: method.id, amount: amounts[method.id] })),
      });

      if (result?.error) {
        setRowErrors(result.rowErrors ?? {});
        setFormError(Object.keys(result.rowErrors ?? {}).length > 0 && !result.fieldErrors?.allocations ? null : result.fieldErrors?.allocations ?? result.error);
        return;
      }

      handleOpenChange(false);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Edit the amount of ${paymentLabel}`}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit Amount
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Edit payment amount"
        context={<StudentContext student={student} membership={membership} />}
        description="Correct the amount of each payment method. The methods, their references and notes stay as recorded, and the edit is kept in the payment's history. This is possible only until a document is issued."
        confirmLabel="Save Amount"
        pendingLabel="Saving…"
        isPending={isPending}
        onConfirm={runEdit}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="text-small mb-2 font-medium text-text-primary">Payment methods</legend>
            {methods.map((method) => (
              <FormField
                key={method.id}
                id={`edit-amount-${method.id}`}
                label={`${method.label} (${currency})`}
                required
                error={rowErrors[method.id]}
                help={method.reference ? `Ref: ${method.reference}` : undefined}
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    required
                    disabled={isPending}
                    value={amounts[method.id] ?? ""}
                    onChange={(event) => setAmounts((current) => ({ ...current, [method.id]: event.target.value }))}
                  />
                )}
              </FormField>
            ))}
          </fieldset>

          <dl className="text-small flex flex-col gap-1 rounded-input bg-background px-3 py-2">
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Current amount</dt>
              <dd className="font-medium text-text-primary tabular-nums">{formatCurrency(paymentAmount, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">New total</dt>
              <dd className="font-medium text-text-primary tabular-nums">{money(totalPaise)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Balance after this edit</dt>
              <dd className={remainingPaise < 0 ? "font-medium text-danger tabular-nums" : "font-medium text-text-primary tabular-nums"}>{money(remainingPaise)}</dd>
            </div>
          </dl>
        </div>
      </ConfirmDialog>
    </>
  );
}
