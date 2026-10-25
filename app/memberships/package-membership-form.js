"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Banknote, CalendarDays, CalendarX2, CircleCheck, Hash, Layers, Package, Receipt, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import HelpTip from "@/components/ui/help-tip";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StudentContext from "@/components/ui/student-context";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import ReviewDialog, { ReviewRow } from "@/components/ui/review-dialog";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { INITIAL_PAYMENT_FIELD, validateInitialPayment } from "@/lib/memberships/initial-payment";
import { fromPaise, PAYMENT_METHOD_LABEL, toPaise } from "@/lib/memberships/payments-core";
import { calculateDurationEndDate, CUSTOM_MONTHS_MAX, CUSTOM_MONTHS_MIN, packageDiscountDurationFor, resolveDurationMonths } from "@/lib/packages/duration";
import { DURATION_LABELS, DURATION_OPTIONS_ORDER, KIND_LABELS } from "@/lib/packages/labels";
import { packageMembershipInputOf, previewStandardPrice, validatePackageMembershipInput } from "@/lib/packages/membership-creation";
import { INDIVIDUAL_DISCOUNT_REASONS, REASON_MAX_LENGTH } from "@/lib/packages/validation";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";
import { joinDateLabel } from "@/lib/students/join-date";

// The errors this form shows beside a field. Any other error from the server is shown in the banner, so none is lost.
const FIELD_ERRORS = new Set([
  "package_id",
  "duration_option",
  "custom_months",
  "start_date",
  "end_date",
  "notes",
  "discount",
  "discount_reason",
  "discount_note",
  "custom_fee",
  "custom_fee_reason",
  "custom_fee_confirmed",
]);

const DISCOUNT_TYPES = [
  { value: "none", label: "No individual discount" },
  { value: "fixed", label: "Fixed amount" },
  { value: "percent", label: "Percentage" },
];
const REASON_ITEMS = INDIVIDUAL_DISCOUNT_REASONS;
const reasonLabel = (code) => REASON_ITEMS.find((reason) => reason.value === code)?.label ?? code;

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-small text-danger">
      {message}
    </p>
  );
}

/** One line of the fee breakdown. */
function BreakdownRow({ label, children, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "text-body font-semibold text-text-primary" : "text-body text-text-secondary"}>{label}</dt>
      <dd className={strong ? "text-body font-semibold text-text-primary" : "text-body text-text-primary"}>{children}</dd>
    </div>
  );
}

// A choice that only switches the form (expiry, pricing mode). The options of one `group` share a name, so the browser treats them
// as a radio group (arrow keys move between them), and the `form` attribute names no form, so they belong to none and are never
// submitted - the values that matter travel as `end_date` and `pricing_mode`.
const NO_FORM = "package-membership-switches-none";
function RadioOption({ id, group, checked, onChange, disabled, children }) {
  return (
    <label htmlFor={id} className="text-body flex items-center gap-2 text-text-primary">
      <input id={id} type="radio" name={group} form={NO_FORM} checked={checked} onChange={onChange} disabled={disabled} className="size-4 accent-brand" />
      {children}
    </label>
  );
}

/**
 * Add Membership from a package (V1 Fee Structure, FS-6): the package, its duration option (or a class-count package's
 * allowance and expiry), the start date, an optional individual discount or an explicit Custom Fee Plan, a live fee breakdown,
 * then Review and the explicit confirmation of the final agreed fee.
 *
 * Everything priced here is a PREVIEW (lib/packages/membership-creation.js, the FS-1 rules). No price, amount or end date is
 * submitted as data: the form sends the package, the duration or the optional expiry date, the start date, the discount or
 * the Custom Fee Plan inputs, and the notes, and the database (migration 0048) resolves the fee, the end date and the
 * discounts when the membership is created. If no valid standard fee applies the breakdown says so and standard pricing
 * cannot be saved; a Custom Fee Plan is the explicit alternative. Record Payment Now is the existing section, checked
 * against the resolved fee.
 */
export default function PackageMembershipForm({
  action,
  packages,
  currency,
  student,
  initialValues,
  requireConfirmation = false,
  submitLabel,
  pendingLabel,
  cancelHref,
  skipHref,
  allowInitialPayment = false,
  today,
  headerAction = null,
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const saved = state?.values ?? {};

  const [packageId, setPackageId] = useState(saved.package_id ?? initialValues?.package_id ?? "");
  const [option, setOption] = useState(saved.duration_option ?? initialValues?.duration_option ?? "");
  const [customMonths, setCustomMonths] = useState(saved.custom_months ?? initialValues?.custom_months ?? "");
  const [startDate, setStartDate] = useState(saved.start_date ?? initialValues?.start_date ?? "");
  const [expiryMode, setExpiryMode] = useState(saved.end_date ? "date" : "none");
  const [expiryDate, setExpiryDate] = useState(saved.end_date ?? "");
  const [pricingMode, setPricingMode] = useState(saved.pricing_mode === "custom_fee_plan" ? "custom_fee_plan" : "standard");
  const [discountType, setDiscountType] = useState(saved.individual_discount_type || "none");
  const [discountValue, setDiscountValue] = useState(saved.individual_discount_value ?? "");
  const [discountReason, setDiscountReason] = useState(saved.individual_discount_reason ?? "");
  const [discountNote, setDiscountNote] = useState(saved.individual_discount_note ?? "");
  const [customFee, setCustomFee] = useState(saved.custom_fee ?? "");
  const [customReason, setCustomReason] = useState(saved.custom_fee_reason ?? "");
  const [customConfirmed, setCustomConfirmed] = useState(false);
  const [notes, setNotes] = useState(saved.notes ?? "");
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [review, setReview] = useState(null);
  const formRef = useRef(null);

  const pkg = packages.find((candidate) => candidate.id === packageId) ?? null;
  const isClassCount = pkg?.kind === "class_count";
  const isCustomPlan = pricingMode === "custom_fee_plan";
  const packageItems = packages.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${KIND_LABELS[candidate.kind]}` }));
  const offered = DURATION_OPTIONS_ORDER.filter((value) => pkg?.options?.includes(value)).map((value) => ({ value, label: DURATION_LABELS[value] }));

  // What the form can work out locally. The database does the same on save and is the authority.
  const resolvedMonths = !isClassCount && option ? resolveDurationMonths(option, customMonths) : null;
  const months = resolvedMonths?.success ? resolvedMonths.data : null;
  const endDate = months && startDate ? calculateDurationEndDate(startDate, months) : null;
  const expiryChosen = expiryMode === "date";
  const expiryOk = !expiryChosen || Boolean(expiryDate && startDate && expiryDate >= startDate);
  const datesReady = isClassCount ? Boolean(startDate) && expiryOk : Boolean(endDate?.success);

  const individual = !isCustomPlan && discountType !== "none" ? { type: discountType, value: discountValue } : null;
  const standardPrice =
    !isCustomPlan && pkg && startDate && (isClassCount || months)
      ? previewStandardPrice(pkg, { startDate, months: isClassCount ? null : months, individualDiscount: individual }, currency)
      : null;
  const customPaise = isCustomPlan ? toPaise(customFee) : null;
  const customOk = customPaise !== null && customPaise > 0;
  const priceOk = isCustomPlan ? customOk : Boolean(standardPrice?.success);
  const finalPaise = isCustomPlan ? (customOk ? customPaise : 0) : standardPrice?.success ? standardPrice.finalFeePaise : 0;
  const canSave = Boolean(pkg) && datesReady && priceOk;

  // Record Payment Now: off by default; the balance is the previewed final fee (a new membership is wholly outstanding).
  const taxInvoiceDefault = student?.tax_invoice_default ?? true;
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentErrors, setPaymentErrors] = useState(state?.paymentErrors ?? {});
  const payment = usePaymentDraft({ today, balancePaise: finalPaise, taxInvoiceDefault });

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
    setPaymentErrors(state?.paymentErrors ?? {});
  }

  function handlePackageChange(value) {
    setPackageId(value);
    const next = packages.find((candidate) => candidate.id === value);
    if (next?.kind === "class_count") {
      setOption("");
      setCustomMonths("");
    } else if (option && !next?.options?.includes(option)) {
      setOption("");
    }
    setFieldErrors((current) => ({ ...current, package_id: undefined }));
  }

  function handlePricingModeChange(mode) {
    setPricingMode(mode);
    setCustomConfirmed(false);
    setFieldErrors({});
  }

  function handlePaymentToggle(event) {
    const on = event.target.checked;
    setPaymentEnabled(on);
    setPaymentErrors({});
    if (on) payment.reset(finalPaise ? fromPaise(finalPaise) : "");
  }

  // Opens the Review step. The same checks as the server (which still re-validates), so it cannot open with a field missing.
  function openReview(event) {
    event.preventDefault();
    if (!canSave) return;

    const raw = packageMembershipInputOf(new FormData(formRef.current));
    const result = validatePackageMembershipInput(raw, pkg.kind);
    const paymentResult = paymentEnabled ? validateInitialPayment(payment.input, { amount: fromPaise(finalPaise), today }) : null;
    if (!result.success || (paymentResult && !paymentResult.success)) {
      setFieldErrors(result.success ? {} : result.errors);
      setPaymentErrors(paymentResult && !paymentResult.success ? paymentResult.errors : {});
      return;
    }
    setFieldErrors({});
    setPaymentErrors({});
    setReview({
      pkg,
      isClassCount,
      isCustomPlan,
      durationLabel: option === "custom" && months ? `Custom · ${months} months` : DURATION_LABELS[option],
      startDate,
      endLabel: isClassCount ? (expiryChosen ? formatDate(expiryDate) : "No expiry") : formatDate(endDate.data),
      price: standardPrice,
      individual: result.data.individualDiscount,
      customReason: result.data.customReason,
      finalPaise,
      payment: paymentResult
        ? {
            date: paymentResult.data.paymentDate,
            totalPaise: paymentResult.data.totalPaise,
            methods: paymentResult.data.methods,
            taxInvoice: payment.issueTaxInvoice,
            remainingPaise: finalPaise - paymentResult.data.totalPaise,
          }
        : null,
    });
    setConfirmOpen(true);
  }

  function confirmAndSubmit() {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  const unshownErrors = Object.entries(fieldErrors).filter(([key, message]) => message && !FIELD_ERRORS.has(key));
  const customDiscountLabel = option === "custom" && months && months >= 3 ? DURATION_LABELS[packageDiscountDurationFor(months)] : null;
  const discountErrors = fieldErrors.discount;

  return (
    <>
      <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
        <StudentIdentityHeader student={student} action={headerAction} />

        {state?.error && !Object.values(fieldErrors).includes(state.error) ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {state.error}
          </p>
        ) : null}
        {unshownErrors.map(([key, message]) => (
          <p key={key} role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {message}
          </p>
        ))}

        <input name="pricing_mode" value={pricingMode} readOnly hidden />

        {/* Row 1: Package | Duration (a class-count package shows its allowance instead). */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="package_id">
              Package<span className="text-danger" aria-hidden="true"> *</span>
            </Label>
            <Select name="package_id" items={packageItems} value={packageId} onValueChange={handlePackageChange} disabled={isPending}>
              <SelectTrigger id="package_id" aria-invalid={Boolean(fieldErrors.package_id)} className="w-full">
                <SelectValue placeholder="Select a package…" />
              </SelectTrigger>
              <SelectContent>
                {packageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.package_id} />
          </div>

          {isClassCount ? (
            <div className="flex flex-col gap-2">
              <Label>Class allowance</Label>
              <p className="text-body flex h-9 items-center gap-2 text-text-primary">
                <Hash className="size-4 text-text-secondary" aria-hidden="true" />
                {pkg.total_classes} {pkg.total_classes === 1 ? "class" : "classes"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration_option">
                Duration<span className="text-danger" aria-hidden="true"> *</span>
              </Label>
              <Select name="duration_option" items={offered} value={option} onValueChange={setOption} disabled={isPending || !pkg}>
                <SelectTrigger id="duration_option" aria-invalid={Boolean(fieldErrors.duration_option)} className="w-full">
                  <SelectValue placeholder={pkg ? "Select a duration…" : "Select a package first"} />
                </SelectTrigger>
                <SelectContent>
                  {offered.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.duration_option} />
            </div>
          )}

          {!isClassCount && option === "custom" ? (
            <div className="flex flex-col gap-2 sm:col-start-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="custom_months">Number of months</Label>
                <HelpTip label="About the number of months">
                  {customDiscountLabel
                    ? `The ${customDiscountLabel} package discount applies, if this package has one.`
                    : months
                      ? "Under 3 months there is no package discount."
                      : "A whole number of calendar months. The package discount of the largest standard duration it does not exceed applies."}
                </HelpTip>
              </div>
              <Input
                id="custom_months"
                name="custom_months"
                type="number"
                inputMode="numeric"
                min={CUSTOM_MONTHS_MIN}
                max={CUSTOM_MONTHS_MAX}
                step="1"
                disabled={isPending}
                value={customMonths}
                onChange={(event) => setCustomMonths(event.target.value)}
                placeholder={`Whole months, ${CUSTOM_MONTHS_MIN} to ${CUSTOM_MONTHS_MAX}`}
                aria-invalid={Boolean(fieldErrors.custom_months)}
              />
              <FieldError message={fieldErrors.custom_months} />
            </div>
          ) : null}
        </div>

        {/* Row 2: Start Date | End Date (a class-count package has an optional expiry instead). */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="start_date">
                Start Date<span className="text-danger" aria-hidden="true"> *</span>
              </Label>
              <HelpTip label="About the start date">
                {isCustomPlan ? "The first day of the membership." : "The fee in effect on this date prices the membership."}
                {student?.join_date ? ` Not before the student's join date (${joinDateLabel(student.join_date)}).` : ""}
              </HelpTip>
            </div>
            <Input
              id="start_date"
              name="start_date"
              type="date"
              required
              disabled={isPending}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-invalid={Boolean(fieldErrors.start_date)}
            />
            <FieldError message={fieldErrors.start_date} />
          </div>

          {isClassCount ? null : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="end_date_display">
                  End Date<span className="text-danger" aria-hidden="true"> *</span>
                </Label>
                <HelpTip label="About the end date">Calculated from the duration and Start Date. It cannot be edited.</HelpTip>
              </div>
              <Input id="end_date_display" value={endDate?.success ? formatDate(endDate.data) : ""} readOnly placeholder="Calculated" />
              <FieldError message={fieldErrors.end_date} />
            </div>
          )}
        </div>

        {isClassCount ? (
          <fieldset className="flex flex-col gap-3" disabled={isPending}>
            <legend className="text-body font-medium text-text-primary">Expiry</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <RadioOption id="expiry-none" group="expiry" checked={expiryMode === "none"} onChange={() => setExpiryMode("none")} disabled={isPending}>
                No expiry
              </RadioOption>
              <RadioOption id="expiry-date" group="expiry" checked={expiryMode === "date"} onChange={() => setExpiryMode("date")} disabled={isPending}>
                Expires on a date
              </RadioOption>
            </div>
            {expiryChosen ? (
              <div className="flex flex-col gap-2 sm:max-w-sm">
                <Label htmlFor="end_date">Expiry date</Label>
                <Input
                  id="end_date"
                  name="end_date"
                  type="date"
                  min={startDate || undefined}
                  disabled={isPending}
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.end_date) || !expiryOk}
                />
                {expiryDate && !expiryOk ? <p className="text-small text-danger">The expiry date cannot be before the start date.</p> : null}
              </div>
            ) : null}
            <FieldError message={fieldErrors.end_date} />
          </fieldset>
        ) : null}

        {/* Row 3: Pricing | Individual discount (a Custom Fee Plan has no discount; its fee fields follow below). */}
        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2" disabled={isPending}>
            <legend className="text-body mb-2 flex items-center gap-1.5 font-medium text-text-primary">
              <span>
                Pricing<span className="text-danger" aria-hidden="true"> *</span>
              </span>
            </legend>
            <div className="flex h-9 flex-wrap items-center gap-x-6 gap-y-2">
              <RadioOption id="pricing-standard" group="pricing" checked={!isCustomPlan} onChange={() => handlePricingModeChange("standard")} disabled={isPending}>
                Standard pricing
              </RadioOption>
              <RadioOption id="pricing-custom" group="pricing" checked={isCustomPlan} onChange={() => handlePricingModeChange("custom_fee_plan")} disabled={isPending}>
                Custom Fee Plan
              </RadioOption>
              <HelpTip label="About the Custom Fee Plan">
                A Custom Fee Plan is a special price agreed by the Admin. The agreed fee is the final fee: no package or individual discount is applied.
              </HelpTip>
            </div>
          </fieldset>

          {isCustomPlan ? null : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="individual_discount_type_select">Individual discount</Label>
                <HelpTip label="About the individual discount">
                  Optional. Taken from the fee after the package discount, with a reason.
                </HelpTip>
              </div>
              <Select
                items={DISCOUNT_TYPES}
                value={discountType}
                onValueChange={(value) => {
                  setDiscountType(value);
                  if (value === "none") {
                    setDiscountValue("");
                    setDiscountReason("");
                    setDiscountNote("");
                  }
                }}
                disabled={isPending}
              >
                <SelectTrigger id="individual_discount_type_select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="individual_discount_type" value={discountType === "none" ? "" : discountType} />
            </div>
          )}
        </div>

        {isCustomPlan ? (
          <div className="flex flex-col gap-4 rounded-card border border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="custom_fee">Custom agreed fee ({currency})</Label>
                <Input
                  id="custom_fee"
                  name="custom_fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  disabled={isPending}
                  value={customFee}
                  onChange={(event) => setCustomFee(event.target.value)}
                  placeholder="Enter the agreed fee"
                  aria-invalid={Boolean(fieldErrors.custom_fee)}
                />
                <FieldError message={fieldErrors.custom_fee} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="custom_fee_reason">Reason</Label>
                <Textarea
                  id="custom_fee_reason"
                  name="custom_fee_reason"
                  rows={2}
                  maxLength={REASON_MAX_LENGTH}
                  disabled={isPending}
                  value={customReason}
                  onChange={(event) => setCustomReason(event.target.value)}
                  placeholder="Why this fee is agreed (3 to 500 characters)"
                  aria-invalid={Boolean(fieldErrors.custom_fee_reason)}
                />
                <FieldError message={fieldErrors.custom_fee_reason} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="custom_fee_confirmed" className="text-body flex items-start gap-3 text-text-primary">
                <input
                  id="custom_fee_confirmed"
                  name="custom_fee_confirmed"
                  type="checkbox"
                  value="on"
                  className="mt-1 size-4 shrink-0 accent-brand"
                  checked={customConfirmed}
                  disabled={isPending}
                  onChange={(event) => setCustomConfirmed(event.target.checked)}
                />
                I confirm this Custom Fee Plan{customOk ? ` of ${formatCurrency(fromPaise(customPaise), currency)}` : ""} for this membership.
              </label>
              <FieldError message={fieldErrors.custom_fee_confirmed} />
            </div>
          </div>
        ) : discountType !== "none" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="individual_discount_value">{discountType === "percent" ? "Discount (%)" : `Discount amount (${currency})`}</Label>
              <Input
                id="individual_discount_value"
                name="individual_discount_value"
                inputMode="decimal"
                disabled={isPending}
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                placeholder={discountType === "percent" ? "e.g. 10" : "0.00"}
                aria-invalid={Boolean(discountErrors)}
              />
              <FieldError message={discountErrors} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="individual_discount_reason_select">Reason</Label>
              <Select items={REASON_ITEMS} value={discountReason} onValueChange={setDiscountReason} disabled={isPending}>
                <SelectTrigger id="individual_discount_reason_select" aria-invalid={Boolean(fieldErrors.discount_reason)} className="w-full">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="individual_discount_reason" value={discountReason} />
              <FieldError message={fieldErrors.discount_reason} />
            </div>

            {discountReason === "other" ? (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="individual_discount_note">Explanation</Label>
                <Textarea
                  id="individual_discount_note"
                  name="individual_discount_note"
                  rows={2}
                  maxLength={REASON_MAX_LENGTH}
                  disabled={isPending}
                  value={discountNote}
                  onChange={(event) => setDiscountNote(event.target.value)}
                  placeholder="Explain the discount (3 to 500 characters)"
                  aria-invalid={Boolean(fieldErrors.discount_note)}
                />
                <FieldError message={fieldErrors.discount_note} />
              </div>
            ) : null}
          </div>
        ) : null}

        <section aria-label="Fee breakdown" className="flex flex-col gap-2 rounded-card bg-background px-4 py-3">
          {isCustomPlan ? (
            customOk ? (
              <dl className="flex flex-col gap-2">
                <BreakdownRow label="Custom Fee Plan" strong>
                  {formatCurrency(fromPaise(customPaise), currency)}
                </BreakdownRow>
              </dl>
            ) : (
              <p className="text-body text-text-secondary">Enter the custom agreed fee, an amount greater than 0.</p>
            )
          ) : standardPrice?.success ? (
            <dl className="flex flex-col gap-2">
              <BreakdownRow label="Standard fee">{formatCurrency(fromPaise(standardPrice.standardFeePaise), currency)}</BreakdownRow>
              <BreakdownRow label={standardPrice.packageDiscountSource && standardPrice.packageDiscountSource !== "monthly" ? `Package discount (${DURATION_LABELS[standardPrice.packageDiscountSource]})` : "Package discount"}>
                {standardPrice.packageDiscountPaise > 0 ? `− ${formatCurrency(fromPaise(standardPrice.packageDiscountPaise), currency)}` : "None"}
              </BreakdownRow>
              <BreakdownRow label="Individual discount">
                {standardPrice.individualDiscountPaise > 0 ? `− ${formatCurrency(fromPaise(standardPrice.individualDiscountPaise), currency)}` : "None"}
              </BreakdownRow>
              <div className="border-t border-border pt-2">
                <BreakdownRow
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      Final agreed fee
                      <HelpTip label="About the fee preview">
                        A preview. The final fee{isClassCount ? " is" : " and the end date are"} calculated again when the membership is saved.
                      </HelpTip>
                    </span>
                  }
                  strong
                >
                  <span className="text-section-title">{formatCurrency(fromPaise(standardPrice.finalFeePaise), currency)}</span>
                </BreakdownRow>
              </div>
            </dl>
          ) : standardPrice ? (
            <div role="alert" className="flex flex-col gap-1">
              <p className="text-body text-danger">{standardPrice.message}</p>
              <p className="text-small text-text-secondary">
                A standard price cannot be saved as it is. Change the start date, the package or the discount, or choose a Custom Fee Plan.
              </p>
            </div>
          ) : (
            <p className="text-body text-text-secondary">
              {isClassCount ? "Choose a package and a start date to see the fee." : "Choose a package, a duration and a start date to see the fee."}
            </p>
          )}
        </section>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            disabled={isPending}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Enter any relevant notes (optional)"
            aria-invalid={Boolean(fieldErrors.notes)}
          />
          <FieldError message={fieldErrors.notes} />
        </div>

        {allowInitialPayment ? (
          <div className="overflow-hidden rounded-card border border-border">
            <div className="flex items-center gap-2 bg-background px-4 py-3">
              <input
                id="record-payment-now"
                type="checkbox"
                className="size-4 shrink-0 accent-brand"
                checked={paymentEnabled}
                disabled={isPending || !canSave}
                onChange={handlePaymentToggle}
              />
              <Label htmlFor="record-payment-now">Record first payment now (Optional)</Label>
              <HelpTip label="About recording the first payment">
                Optional. Record the first payment together with this membership. Leave it off to save the membership as Pending.
              </HelpTip>
            </div>

            {paymentEnabled && canSave ? (
              <div className="border-t border-border p-4">
                <PaymentFields
                  compact
                  draft={payment}
                  currency={currency}
                  today={today}
                  disabled={isPending}
                  fieldErrors={paymentErrors}
                  rowErrors={paymentErrors.rows ?? {}}
                  taxInvoiceDefault={taxInvoiceDefault}
                  idPrefix="initial-payment"
                  fieldName={INITIAL_PAYMENT_FIELD}
                  onRowRemoved={() => setPaymentErrors((current) => ({ ...current, rows: {} }))}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
          {skipHref ? (
            <Button type="button" variant="ghost" disabled={isPending} render={<Link href={skipHref} />} nativeButton={false} className="mr-auto">
              Skip this step
            </Button>
          ) : null}
          <Button type="button" variant="secondary" disabled={isPending} render={<Link href={cancelHref} />} nativeButton={false}>
            Cancel
          </Button>
          {requireConfirmation ? (
            <Button type="button" onClick={openReview} disabled={isPending || !canSave}>
              {isPending ? pendingLabel : submitLabel}
            </Button>
          ) : (
            <Button type="submit" disabled={isPending || !canSave}>
              {isPending ? pendingLabel : submitLabel}
            </Button>
          )}
        </div>
      </form>

      {requireConfirmation ? (
        <ReviewDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Review membership"
          context={<StudentContext student={student} />}
          description="Confirm the final agreed fee before the membership is created."
          confirmLabel={review ? `Confirm ${formatCurrency(fromPaise(review.finalPaise), currency)} & Save` : "Confirm & Save"}
          isPending={isPending}
          onConfirm={confirmAndSubmit}
        >
          {review ? (
            <dl className="flex flex-col gap-3">
              <ReviewRow icon={UserRound} label="Student">
                {student.full_name}
              </ReviewRow>
              <ReviewRow icon={Package} label="Package">
                {review.pkg.name}
              </ReviewRow>
              <ReviewRow icon={Layers} label="Type">
                {review.isClassCount ? `Class count · ${review.pkg.total_classes} ${review.pkg.total_classes === 1 ? "class" : "classes"}` : `Duration · ${review.durationLabel}`}
              </ReviewRow>
              <ReviewRow icon={CalendarDays} label="Start date">
                {formatDate(review.startDate)}
              </ReviewRow>
              <ReviewRow icon={CalendarX2} label={review.isClassCount ? "Expiry" : "End date"}>
                {review.endLabel}
              </ReviewRow>
              {review.isCustomPlan ? (
                <>
                  <ReviewRow icon={Banknote} label="Pricing">
                    Custom Fee Plan
                  </ReviewRow>
                  <ReviewRow icon={Banknote} label="Reason">
                    {review.customReason}
                  </ReviewRow>
                </>
              ) : (
                <>
                  <ReviewRow icon={Banknote} label="Standard fee">
                    {formatCurrency(fromPaise(review.price.standardFeePaise), currency)}
                  </ReviewRow>
                  <ReviewRow icon={Banknote} label="Package discount">
                    {review.price.packageDiscountPaise > 0 ? `− ${formatCurrency(fromPaise(review.price.packageDiscountPaise), currency)}` : "None"}
                  </ReviewRow>
                  <ReviewRow icon={Banknote} label="Individual discount">
                    {review.individual ? (
                      <>
                        {`− ${formatCurrency(fromPaise(review.price.individualDiscountPaise), currency)}`}
                        <span className="block text-small font-normal text-text-secondary">
                          {review.individual.type === "percent" ? `${review.individual.value}%` : "Fixed amount"} · {reasonLabel(review.individual.reasonCode)}
                          {review.individual.reasonNote ? ` — ${review.individual.reasonNote}` : ""}
                        </span>
                      </>
                    ) : (
                      "None"
                    )}
                  </ReviewRow>
                </>
              )}
              <ReviewRow icon={Banknote} label="Final agreed fee">
                {formatCurrency(fromPaise(review.finalPaise), currency)}
              </ReviewRow>
              {review.payment ? (
                <>
                  <ReviewRow icon={Wallet} label="Payment">
                    {formatCurrency(fromPaise(review.payment.totalPaise), currency)} on {review.payment.date}
                    <span className="block text-small font-normal text-text-secondary">
                      {review.payment.methods
                        .map((method) => `${PAYMENT_METHOD_LABEL[method.method] ?? method.method} ${formatCurrency(method.amount, currency)}`)
                        .join(" · ")}
                    </span>
                  </ReviewRow>
                  <ReviewRow icon={Receipt} label="Tax invoice">
                    {review.payment.taxInvoice ? "Yes" : "No"}
                  </ReviewRow>
                  <ReviewRow icon={CircleCheck} label="Result">
                    {review.payment.remainingPaise <= 0
                      ? "Paid in full"
                      : `Partly paid · balance ${formatCurrency(fromPaise(review.payment.remainingPaise), currency)}`}
                  </ReviewRow>
                </>
              ) : null}
            </dl>
          ) : null}
        </ReviewDialog>
      ) : null}
    </>
  );
}
