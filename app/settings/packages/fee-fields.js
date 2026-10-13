"use client";

import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DURATION_LABELS } from "@/lib/packages/labels";

const DISCOUNT_OPTIONS = ["quarterly", "half_yearly", "annual"];
const DISCOUNT_TYPES = [
  { value: "none", label: "No discount" },
  { value: "fixed", label: "Fixed amount" },
  { value: "percent", label: "Percentage" },
];

/** The editable state of a fee's discounts, from a fee entry's discount rows (none for a new fee). */
export function initialDiscountState(discounts = []) {
  return Object.fromEntries(
    DISCOUNT_OPTIONS.map((option) => {
      const row = discounts.find((discount) => discount.duration_option === option);
      if (!row) return [option, { type: "none", value: "" }];
      return [option, { type: row.discount_type, value: String(row.discount_type === "percent" ? row.percent_value : row.fixed_amount) }];
    })
  );
}

/** The `discounts` input of the fee actions, from the editable state. */
export function discountsInput(state) {
  return DISCOUNT_OPTIONS.filter((option) => state[option].type !== "none").map((option) => ({
    option,
    type: state[option].type,
    value: state[option].value,
  }));
}

/** The Monthly Fee / Price field. */
export function AmountField({ id, kind, value, onChange, error, disabled, currency }) {
  return (
    <FormField
      id={id}
      label={kind === "duration" ? `Monthly base fee${currency ? ` (${currency})` : ""}` : `Price${currency ? ` (${currency})` : ""}`}
      error={error}
      required
    >
      {(field) => (
        <Input {...field} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder="0.00" />
      )}
    </FormField>
  );
}

/** A required or optional reason. */
export function ReasonField({ id, value, onChange, error, disabled, required = false, help }) {
  return (
    <FormField id={id} label="Reason" error={error} help={help} required={required}>
      {(field) => (
        <Textarea {...field} rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={500} />
      )}
    </FormField>
  );
}

/** Per-option package discounts for Quarterly, Half Yearly and Annual (Monthly has none; Custom follows these). */
export function DiscountFields({ state, onChange, errors = {}, disabled }) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-body font-medium text-text-primary">Package discounts</legend>
      <p className="text-small text-text-secondary">
        Optional, against the standard fee. Monthly has no discount; Custom uses the largest standard duration it does not exceed.
      </p>
      {DISCOUNT_OPTIONS.map((option) => {
        const row = state[option];
        const error = errors[`discount_${option}`] ?? errors.discounts;
        return (
          <div key={option} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2">
            <span className="text-body pt-2 text-text-primary">{DURATION_LABELS[option]}</span>
            <Select
              items={DISCOUNT_TYPES}
              value={row.type}
              onValueChange={(type) => onChange({ ...state, [option]: { type, value: type === "none" ? "" : row.value } })}
            >
              <SelectTrigger aria-label={`${DURATION_LABELS[option]} discount type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCOUNT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row.type !== "none" ? (
              <Input
                aria-label={`${DURATION_LABELS[option]} discount ${row.type === "percent" ? "percentage" : "amount"}`}
                inputMode="decimal"
                value={row.value}
                onChange={(event) => onChange({ ...state, [option]: { ...row, value: event.target.value } })}
                placeholder={row.type === "percent" ? "e.g. 10" : "0.00"}
                aria-invalid={Boolean(error)}
                className="col-span-2"
              />
            ) : null}
          </div>
        );
      })}
      {errors.discounts ? (
        <p role="alert" className="text-small text-danger">
          {errors.discounts}
        </p>
      ) : null}
    </fieldset>
  );
}
