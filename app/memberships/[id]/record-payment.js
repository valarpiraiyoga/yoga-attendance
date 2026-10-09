"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StudentContext from "@/components/ui/student-context";
import { formatCurrency } from "@/lib/currencies";
import { recordMembershipPayment } from "@/lib/memberships/payment-actions";
import { fromPaise, PAYMENT_METHODS, toPaise } from "@/lib/memberships/payments-core";

const emptyRow = (amount = "") => ({ method: "cash", amount, referenceId: "", notes: "" });

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
  const [paymentDate, setPaymentDate] = useState(today);
  const [rows, setRows] = useState([emptyRow(fromPaise(balancePaise))]);
  // This payment's choice, starting from the student's saved preference; changing it never changes the preference.
  const [issueTaxInvoice, setIssueTaxInvoice] = useState(taxInvoiceDefault);
  const [fieldErrors, setFieldErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const totalPaise = rows.reduce((sum, row) => sum + (toPaise(row.amount) ?? 0), 0);
  const remainingPaise = balancePaise - totalPaise;

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) {
      // Start clean next time, with the balance as the suggested amount.
      setPaymentDate(today);
      setRows([emptyRow(fromPaise(balancePaise))]);
      setIssueTaxInvoice(taxInvoiceDefault);
      setFieldErrors({});
      setRowErrors({});
      setFormError(null);
    }
  }

  function updateRow(index, key, value) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    setRows((current) => [...current, emptyRow(remainingPaise > 0 ? fromPaise(remainingPaise) : "")]);
  }

  function removeRow(index) {
    setRows((current) => current.filter((_, at) => at !== index));
    setRowErrors({});
  }

  function runRecord() {
    startTransition(async () => {
      const result = await recordMembershipPayment(membershipId, { paymentDate, methods: rows, issueTaxInvoice });

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
        context={<StudentContext student={student} membership={membership} />}
        description={`Outstanding balance: ${formatCurrency(fromPaise(balancePaise), currency)}. A payment can combine several methods.`}
        confirmLabel="Record Payment"
        pendingLabel="Recording…"
        isPending={isPending}
        onConfirm={runRecord}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField id="payment-date" label="Payment date" required error={fieldErrors.payment_date}>
            {(field) => (
              <Input
                {...field}
                type="date"
                required
                max={today}
                disabled={isPending}
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            )}
          </FormField>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-small mb-2 font-medium text-text-primary">Payment methods</legend>

            {rows.map((row, index) => {
              const errors = rowErrors[index] ?? {};
              const number = index + 1;
              return (
                <div key={index} className="flex flex-col gap-3 rounded-input border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-small font-medium text-text-secondary">Method {number}</p>
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(index)}
                        disabled={isPending}
                        aria-label={`Remove method ${number}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField id={`payment-method-${index}`} label="Method" required error={errors.method}>
                      {(field) => (
                        <Select
                          items={PAYMENT_METHODS}
                          value={row.method}
                          onValueChange={(value) => updateRow(index, "method", value)}
                          disabled={isPending}
                        >
                          <SelectTrigger {...field} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHODS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormField>

                    <FormField id={`payment-amount-${index}`} label={`Amount (${currency})`} required error={errors.amount}>
                      {(field) => (
                        <Input
                          {...field}
                          inputMode="decimal"
                          required
                          disabled={isPending}
                          value={row.amount}
                          onChange={(event) => updateRow(index, "amount", event.target.value)}
                        />
                      )}
                    </FormField>
                  </div>

                  {row.method !== "cash" ? (
                    <FormField
                      id={`payment-reference-${index}`}
                      label="Transaction / reference ID"
                      error={errors.referenceId}
                      help="Optional."
                    >
                      {(field) => (
                        <Input
                          {...field}
                          maxLength={100}
                          disabled={isPending}
                          value={row.referenceId}
                          onChange={(event) => updateRow(index, "referenceId", event.target.value)}
                        />
                      )}
                    </FormField>
                  ) : null}

                  <FormField id={`payment-notes-${index}`} label="Notes" error={errors.notes} help="Optional.">
                    {(field) => (
                      <Input
                        {...field}
                        maxLength={500}
                        disabled={isPending}
                        value={row.notes}
                        onChange={(event) => updateRow(index, "notes", event.target.value)}
                      />
                    )}
                  </FormField>
                </div>
              );
            })}

            <div>
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={isPending}>
                <Plus className="size-4" aria-hidden="true" />
                Add method
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id="issue-tax-invoice"
                type="checkbox"
                className="size-4 shrink-0 accent-brand"
                checked={issueTaxInvoice}
                disabled={isPending}
                onChange={(event) => setIssueTaxInvoice(event.target.checked)}
                aria-describedby="issue-tax-invoice-help"
              />
              <Label htmlFor="issue-tax-invoice">Issue tax invoice</Label>
            </div>
            <p id="issue-tax-invoice-help" className="text-small text-text-secondary">
              For this payment only. The student&rsquo;s default is {taxInvoiceDefault ? "on" : "off"}; changing this does not change it.
            </p>
          </div>

          <dl className="text-small flex flex-col gap-1 rounded-input bg-background px-3 py-2">
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">This payment</dt>
              <dd className="font-medium text-text-primary tabular-nums">{formatCurrency(fromPaise(totalPaise), currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Balance after this payment</dt>
              <dd className={remainingPaise < 0 ? "font-medium text-danger tabular-nums" : "font-medium text-text-primary tabular-nums"}>
                {formatCurrency(fromPaise(remainingPaise), currency)}
              </dd>
            </div>
          </dl>

          {fieldErrors.methods ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.methods}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
