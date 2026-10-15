"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/currencies";
import { fromPaise, PAYMENT_METHODS, toPaise } from "@/lib/memberships/payments-core";

const emptyRow = (amount = "") => ({ method: "cash", amount, referenceId: "", notes: "" });

/**
 * The state of one payment being entered: its date, its method rows and this payment's tax invoice choice. The one
 * implementation behind the Record Payment dialog and the "Record Payment Now" section of Create / Renew Membership,
 * so a payment is entered - and sent - the same way in both.
 *
 * `balancePaise` is what the payment may not exceed (read fresh on every render, so a membership amount still being
 * typed is followed). `initialAmount` is the amount the first method starts with. The tax invoice choice starts from
 * the student's saved preference; changing it never changes the preference.
 *
 * Editing a recorded payment starts from what is saved instead: `initialPaymentDate` and `initialRows` (the saved
 * methods in the draft's row shape), and `load` puts the saved values back each time the editor is opened.
 *
 * @param {{ today: string, balancePaise: number, taxInvoiceDefault?: boolean, initialAmount?: string,
 *   initialPaymentDate?: string, initialRows?: { method: string, amount: string, referenceId: string, notes: string }[] }} options
 */
export function usePaymentDraft({ today, balancePaise, taxInvoiceDefault = true, initialAmount = "", initialPaymentDate, initialRows }) {
  const [paymentDate, setPaymentDate] = useState(initialPaymentDate ?? today);
  const [rows, setRows] = useState(initialRows ?? [emptyRow(initialAmount)]);
  const [issueTaxInvoice, setIssueTaxInvoice] = useState(taxInvoiceDefault);

  const totalPaise = rows.reduce((sum, row) => sum + (toPaise(row.amount) ?? 0), 0);
  const remainingPaise = balancePaise - totalPaise;

  return {
    paymentDate,
    setPaymentDate,
    rows,
    issueTaxInvoice,
    setIssueTaxInvoice,
    totalPaise,
    remainingPaise,
    updateRow(index, key, value) {
      setRows((current) => current.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
    },
    addRow() {
      setRows((current) => [...current, emptyRow(remainingPaise > 0 ? fromPaise(remainingPaise) : "")]);
    },
    removeRow(index) {
      setRows((current) => current.filter((_, at) => at !== index));
    },
    /** Puts saved values in the draft (the editor of a recorded payment, each time it opens). */
    load(date, savedRows) {
      setPaymentDate(date);
      setRows(savedRows);
    },
    /** Starts clean: today, one method with `amount`, and the student's preference. */
    reset(amount = initialAmount) {
      setPaymentDate(today);
      setRows([emptyRow(amount)]);
      setIssueTaxInvoice(taxInvoiceDefault);
    },
    /** What the payment actions and `validatePaymentInput` take. */
    get input() {
      return { paymentDate, methods: rows, issueTaxInvoice };
    },
  };
}

/**
 * The payment fields: payment date, one or more methods (each with its amount and an optional reference ID and
 * notes), this payment's tax invoice choice and a running total with the balance after it. Controlled by a
 * `usePaymentDraft`; it validates nothing itself - the errors it shows come from the caller.
 *
 * With `fieldName`, the payment is also submitted with the surrounding form, as one JSON field of that name (the
 * inputs themselves carry no names). Render the component only while the payment is wanted: no component, no field.
 *
 * `showTaxInvoice` is on wherever a payment is recorded; editing a recorded payment turns it off (its tax invoice
 * choice is not editable). `showPaymentDate` is on everywhere except the document correction (its payment date cannot change).
 */
export default function PaymentFields({
  draft,
  currency,
  today,
  disabled = false,
  fieldErrors = {},
  rowErrors = {},
  formError = null,
  taxInvoiceDefault = true,
  showTaxInvoice = true,
  showPaymentDate = true,
  idPrefix = "payment",
  fieldName,
  onRowRemoved,
}) {
  const { rows, totalPaise, remainingPaise } = draft;
  const money = (paise) => formatCurrency(fromPaise(paise), currency);
  const taxId = `${idPrefix}-tax-invoice`;

  return (
    <div className="flex flex-col gap-4">
      {fieldName ? <input type="hidden" name={fieldName} value={JSON.stringify(draft.input)} /> : null}

      {formError ? (
        <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {formError}
        </p>
      ) : null}

      {showPaymentDate ? (
        <FormField id={`${idPrefix}-date`} label="Payment date" required error={fieldErrors.payment_date}>
          {(field) => (
            <Input
              {...field}
              type="date"
              required
              max={today}
              disabled={disabled}
              value={draft.paymentDate}
              onChange={(event) => draft.setPaymentDate(event.target.value)}
            />
          )}
        </FormField>
      ) : null}

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
                    onClick={() => {
                      draft.removeRow(index);
                      onRowRemoved?.();
                    }}
                    disabled={disabled}
                    aria-label={`Remove method ${number}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField id={`${idPrefix}-method-${index}`} label="Method" required error={errors.method}>
                  {(field) => (
                    <Select
                      items={PAYMENT_METHODS}
                      value={row.method}
                      onValueChange={(value) => draft.updateRow(index, "method", value)}
                      disabled={disabled}
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

                <FormField id={`${idPrefix}-amount-${index}`} label={`Amount (${currency})`} required error={errors.amount}>
                  {(field) => (
                    <Input
                      {...field}
                      inputMode="decimal"
                      required
                      disabled={disabled}
                      value={row.amount}
                      onChange={(event) => draft.updateRow(index, "amount", event.target.value)}
                    />
                  )}
                </FormField>
              </div>

              {row.method !== "cash" ? (
                <FormField
                  id={`${idPrefix}-reference-${index}`}
                  label="Transaction / reference ID"
                  error={errors.referenceId}
                  help="Optional."
                >
                  {(field) => (
                    <Input
                      {...field}
                      maxLength={100}
                      disabled={disabled}
                      value={row.referenceId}
                      onChange={(event) => draft.updateRow(index, "referenceId", event.target.value)}
                    />
                  )}
                </FormField>
              ) : null}

              <FormField id={`${idPrefix}-notes-${index}`} label="Notes" error={errors.notes} help="Optional.">
                {(field) => (
                  <Input
                    {...field}
                    maxLength={500}
                    disabled={disabled}
                    value={row.notes}
                    onChange={(event) => draft.updateRow(index, "notes", event.target.value)}
                  />
                )}
              </FormField>
            </div>
          );
        })}

        <div>
          <Button type="button" variant="outline" size="sm" onClick={draft.addRow} disabled={disabled}>
            <Plus className="size-4" aria-hidden="true" />
            Add method
          </Button>
        </div>
      </fieldset>

      {showTaxInvoice ? (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            id={taxId}
            type="checkbox"
            className="size-4 shrink-0 accent-brand"
            checked={draft.issueTaxInvoice}
            disabled={disabled}
            onChange={(event) => draft.setIssueTaxInvoice(event.target.checked)}
            aria-describedby={`${taxId}-help`}
          />
          <Label htmlFor={taxId}>Issue tax invoice</Label>
        </div>
        <p id={`${taxId}-help`} className="text-small text-text-secondary">
          For this payment only. The student&rsquo;s default is {taxInvoiceDefault ? "on" : "off"}; changing this does not change it.
        </p>
      </div>
      ) : null}

      <dl className="text-small flex flex-col gap-1 rounded-input bg-background px-3 py-2">
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">This payment</dt>
          <dd className="font-medium text-text-primary tabular-nums">{money(totalPaise)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Balance after this payment</dt>
          <dd className={remainingPaise < 0 ? "font-medium text-danger tabular-nums" : "font-medium text-text-primary tabular-nums"}>
            {money(remainingPaise)}
          </dd>
        </div>
      </dl>

      {fieldErrors.methods ? (
        <p role="alert" className="text-small text-danger">
          {fieldErrors.methods}
        </p>
      ) : null}
    </div>
  );
}
