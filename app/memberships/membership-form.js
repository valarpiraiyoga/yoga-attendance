"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Banknote, CalendarDays, CalendarX2, CircleCheck, Hash, Layers, Receipt, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import HelpTip from "@/components/ui/help-tip";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StudentContext from "@/components/ui/student-context";
import ReviewDialog, { ReviewRow } from "@/components/ui/review-dialog";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import { validateMembershipInput, calculateMembershipEndDate } from "@/lib/memberships/validation";
import { INITIAL_PAYMENT_FIELD, validateInitialPayment } from "@/lib/memberships/initial-payment";
import { fromPaise, PAYMENT_METHOD_LABEL, toPaise } from "@/lib/memberships/payments-core";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";
import PackageMembershipForm from "@/app/memberships/package-membership-form";

const PLAN_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom duration" },
];

// The two kinds of membership (migration 0042). Choosing one is only possible when a membership is created.
const KIND_OPTIONS = [
  { value: "duration", label: "Duration" },
  { value: "class_count", label: "Class Count" },
];

const BLUR_VALIDATED_FIELDS = new Set(["plan", "start_date", "end_date", "amount", "notes"]);

// A class-count membership's plan is `class_count`, which is also its kind's value.
function planLabel(plan) {
  return PLAN_OPTIONS.find((option) => option.value === plan)?.label ?? KIND_OPTIONS.find((option) => option.value === plan)?.label ?? "—";
}

/**
 * Shared Add/Edit Membership form (Phase 12) — the single form component
 * behind all three Add Membership entry points and Edit/Renew
 * (02-ux.md "Add Membership entry points"): the caller always pre-binds a
 * `student` (the standalone Memberships-list entry resolves its own Select
 * Student step before rendering this), and controls whether Save goes
 * through Review → Confirm via `requireConfirmation` — true for standalone
 * Add Membership, Student Details' Add Membership, and Renewal (02-ux.md
 * Flows 14/09); false for the Add Student guided flow's Membership step,
 * which saves directly (Flow 02), and for ordinary Edit Membership, which
 * has no confirmation step at all.
 *
 * End Date recomputes from Plan + Start Date (01-product.md §5/§12) on every
 * change to either, except when Plan is "custom" — matching
 * calculateMembershipEndDate's own rule — but the field itself is always a
 * plain, always-editable date input; recomputation just changes its value,
 * it never becomes read-only.
 *
 * No Status/cancellation field here: cancellation is its own action
 * (app/memberships/[id]/cancel-membership.js), never a field on this form.
 *
 * No Payment Status either, shown or submitted (V1 Tax Adjustment): a new membership is Pending with its whole
 * amount outstanding, and the payments recorded for it determine Pending / Partially Paid / Paid. The status is
 * read on Membership Details and the Memberships list, never on this form.
 *
 * Two kinds of membership. A DURATION membership (the default) is chosen by Plan and runs for a period. A CLASS-COUNT
 * membership has a number of classes and an optional End Date - left empty it has no expiry. The kind is chosen when a
 * membership is created and is fixed afterwards (Edit and Renew show it, they do not offer it); the form then has the
 * class-count fields in place of Plan, and End Date is optional and never calculated.
 *
 * Create and Renew can also record the first payment together with the membership (`allowInitialPayment`): an
 * optional "Record Payment Now" section, off by default, that reuses the Record Payment fields. While it is off
 * nothing about the payment is submitted, and the form saves exactly as before. The payment is validated and
 * recorded by the server action (lib/memberships/initial-payment.js); the status still follows the payments.
 */
function LegacyMembershipForm({
  action,
  currency,
  student,
  membership,
  initialValues,
  requireConfirmation = false,
  submitLabel,
  pendingLabel,
  cancelHref,
  skipHref,
  allowInitialPayment = false,
  today,
  lockKind = false,
  classesUsed = 0,
  headerAction = null,
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [kind, setKind] = useState(state?.values?.kind || membership?.kind || initialValues?.kind || "duration");
  const isClassCount = kind === "class_count";
  const kindLocked = Boolean(membership) || lockKind;
  const [totalClasses, setTotalClasses] = useState(
    String(state?.values?.total_classes ?? membership?.total_classes ?? initialValues?.total_classes ?? "")
  );
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [plan, setPlan] = useState(state?.values?.plan ?? membership?.plan ?? initialValues?.plan ?? "");
  const [startDate, setStartDate] = useState(
    state?.values?.start_date ?? membership?.start_date ?? initialValues?.start_date ?? ""
  );
  const [endDate, setEndDate] = useState(
    state?.values?.end_date ?? membership?.end_date ?? initialValues?.end_date ?? ""
  );
  // Controlled like Plan and the dates: its first value can come from the saved membership, the renewal, or
  // the values a failed save hands back, so it is never an uncontrolled field whose default changes later.
  const [amount, setAmount] = useState(
    String(state?.values?.amount ?? membership?.amount ?? initialValues?.amount ?? "")
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const formRef = useRef(null);

  // Record Payment Now: off by default. The balance is the membership amount as typed so far (a new membership is
  // wholly outstanding); the tax invoice choice starts from the student saved preference.
  const taxInvoiceDefault = student?.tax_invoice_default ?? true;
  const amountPaise = toPaise(String(amount).trim());
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentErrors, setPaymentErrors] = useState(state?.paymentErrors ?? {});
  const payment = usePaymentDraft({ today, balancePaise: amountPaise ?? 0, taxInvoiceDefault });

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
    setPaymentErrors(state?.paymentErrors ?? {});
  }

  function handlePaymentToggle(event) {
    const on = event.target.checked;
    setPaymentEnabled(on);
    setPaymentErrors({});
    // Starts clean each time it is turned on, with the membership amount as the first method suggested amount.
    if (on) payment.reset(amountPaise ? fromPaise(amountPaise) : "");
  }

  function handleKindChange(value) {
    if (value === kind) return;
    setKind(value);
    // Each kind starts clean: a class-count membership has the class_count plan and no end date until one is entered;
    // a duration membership has no plan until one is chosen.
    setPlan(value === "class_count" ? "class_count" : "");
    setEndDate("");
    setFieldErrors({});
  }

  function recalculateEndDate(nextPlan, nextStartDate) {
    if (nextPlan === "custom") return;
    const calculated = calculateMembershipEndDate(nextPlan, nextStartDate);
    if (calculated) setEndDate(calculated);
  }

  function handlePlanChange(value) {
    setPlan(value);
    recalculateEndDate(value, startDate);
  }

  function handleStartDateChange(event) {
    const value = event.target.value;
    setStartDate(value);
    recalculateEndDate(plan, value);
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateMembershipInput({
      kind: formData.get("kind"),
      plan: formData.get("plan"),
      start_date: formData.get("start_date"),
      end_date: formData.get("end_date"),
      total_classes: formData.get("total_classes"),
      amount: formData.get("amount"),
      notes: formData.get("notes"),
    });

    if (result.success || !result.errors[name]) {
      setFieldErrors((current) => {
        if (!(name in current)) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  }

  // Opens the Review step instead of submitting directly. Re-runs the same
  // validator the server uses purely so the review can't be opened with
  // obviously incomplete required fields — the server still re-validates
  // authoritatively when Confirm actually submits.
  function openReview(event) {
    event.preventDefault();

    const formData = new FormData(formRef.current);
    const input = {
      kind: formData.get("kind"),
      plan: formData.get("plan"),
      start_date: formData.get("start_date"),
      end_date: formData.get("end_date"),
      total_classes: formData.get("total_classes"),
      amount: formData.get("amount"),
      notes: formData.get("notes"),
    };

    const result = validateMembershipInput(input);
    const paymentResult = paymentEnabled ? validateInitialPayment(payment.input, { amount: input.amount, today }) : null;
    if (!result.success || (paymentResult && !paymentResult.success)) {
      setFieldErrors(result.success ? {} : result.errors);
      setPaymentErrors(paymentResult && !paymentResult.success ? paymentResult.errors : {});
      return;
    }
    setPaymentErrors({});

    const remainingPaise = (toPaise(String(input.amount).trim()) ?? 0) - (paymentResult?.data.totalPaise ?? 0);
    setReviewData({
      planLabel: planLabel(input.plan),
      totalClasses: result.data.kind === "class_count" ? result.data.total_classes : null,
      startDate: input.start_date,
      endDate: input.end_date || "No expiry",
      amount: input.amount,
      payment: paymentResult
        ? {
            date: paymentResult.data.paymentDate,
            totalPaise: paymentResult.data.totalPaise,
            methods: paymentResult.data.methods,
            taxInvoice: payment.issueTaxInvoice,
            remainingPaise,
          }
        : null,
    });
    setConfirmOpen(true);
  }

  function confirmAndSubmit() {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        onBlur={handleBlur}
        className="flex flex-col gap-5"
        noValidate
      >
        <StudentIdentityHeader
          student={student}
          membership={membership ? { code: membership.membership_code, plan: planLabel(membership.plan) } : undefined}
          action={headerAction}
        />

        {/* A message already shown against its own field (e.g. the invoice rule on Payment Status) is not repeated here. */}
        {state?.error && !Object.values(fieldErrors).includes(state.error) ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
          >
            {state.error}
          </p>
        ) : null}

        {/* The kind travels with the form; only a new membership can choose it (Edit and Renew keep the stored one). */}
        <input name="kind" value={kind} readOnly hidden />

        {kindLocked ? (
          isClassCount ? (
            <div className="flex flex-col gap-1">
              <Label>Membership type</Label>
              <p className="text-body text-text-primary">Class Count</p>
            </div>
          ) : null
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="kind-select">Membership type</Label>
            <Select items={KIND_OPTIONS} value={kind} onValueChange={handleKindChange} disabled={isPending}>
              <SelectTrigger id="kind-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-small text-text-secondary">
              {isClassCount ? "A number of classes, with or without an expiry date." : "A period of time, chosen by Plan."}
            </p>
          </div>
        )}

        {isClassCount ? (
          <>
            <input name="plan" value="class_count" readOnly hidden />
            <div className="flex flex-col gap-2">
              <Label htmlFor="total_classes">Number of Classes</Label>
              <Input
                id="total_classes"
                name="total_classes"
                type="number"
                inputMode="numeric"
                min={Math.max(1, classesUsed)}
                step="1"
                required
                disabled={isPending}
                value={totalClasses}
                onChange={(event) => setTotalClasses(event.target.value)}
                placeholder="Enter the number of classes"
                aria-invalid={Boolean(fieldErrors.total_classes)}
                aria-describedby={fieldErrors.total_classes ? "total_classes-error" : undefined}
              />
              {classesUsed > 0 ? (
                <p className="text-small text-text-secondary">
                  {classesUsed} {classesUsed === 1 ? "class has" : "classes have"} been recorded, so the total cannot be lower.
                </p>
              ) : null}
              {fieldErrors.total_classes ? (
                <p id="total_classes-error" role="alert" className="text-small text-danger">
                  {fieldErrors.total_classes}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="plan">Plan</Label>
            <Select
              name="plan"
              items={PLAN_OPTIONS}
              value={plan}
              onValueChange={handlePlanChange}
              disabled={isPending}
            >
              <SelectTrigger id="plan" aria-invalid={Boolean(fieldErrors.plan)}>
                <SelectValue placeholder="Select a plan…" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.plan ? (
              <p role="alert" className="text-small text-danger">
                {fieldErrors.plan}
              </p>
            ) : null}
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="start_date">Start Date</Label>
            <Input
              id="start_date"
              name="start_date"
              type="date"
              required
              disabled={isPending}
              value={startDate}
              onChange={handleStartDateChange}
              aria-invalid={Boolean(fieldErrors.start_date)}
              aria-describedby={fieldErrors.start_date ? "start_date-error" : undefined}
            />
            {fieldErrors.start_date ? (
              <p id="start_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.start_date}
              </p>
            ) : null}
          </div>

          {isClassCount && membership ? (
            // An existing class-count membership's expiry is changed only by Edit expiry on its details page (audited, with a
            // reason), never from this form: it is shown here and not submitted.
            <div className="flex flex-col gap-2">
              <Label>Expiry</Label>
              <p className="text-body text-text-primary">{membership.end_date ? formatDate(membership.end_date) : "No expiry"}</p>
              <p className="text-small text-text-secondary">To change the expiry, use Edit expiry on the membership page.</p>
            </div>
          ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="end_date">{isClassCount ? "End Date (optional)" : "End Date"}</Label>
            <Input
              id="end_date"
              name="end_date"
              type="date"
              required={!isClassCount}
              disabled={isPending}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-invalid={Boolean(fieldErrors.end_date)}
              aria-describedby={fieldErrors.end_date ? "end_date-error" : undefined}
            />
            {isClassCount ? (
              <p className="text-small text-text-secondary">Leave empty for no expiry.</p>
            ) : (
              <p className="text-small text-text-secondary">
                {plan === "custom" ? "Enter the membership's end date." : "Calculated from Plan and Start Date — editable."}
              </p>
            )}
            {fieldErrors.end_date ? (
              <p id="end_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.end_date}
              </p>
            ) : null}
          </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Amount ({currency})</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              disabled={isPending}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Enter amount"
              aria-invalid={Boolean(fieldErrors.amount)}
              aria-describedby={fieldErrors.amount ? "amount-error" : undefined}
            />
            {fieldErrors.amount ? (
              <p id="amount-error" role="alert" className="text-small text-danger">
                {fieldErrors.amount}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            disabled={isPending}
            defaultValue={state?.values?.notes ?? membership?.notes ?? initialValues?.notes ?? ""}
            placeholder="Enter any relevant notes (optional)"
            aria-invalid={Boolean(fieldErrors.notes)}
            aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
          />
          {fieldErrors.notes ? (
            <p id="notes-error" role="alert" className="text-small text-danger">
              {fieldErrors.notes}
            </p>
          ) : null}
        </div>

        {allowInitialPayment ? (
          <div className="overflow-hidden rounded-card border border-border">
            <div className="flex items-center gap-2 bg-background px-4 py-3">
              <input
                id="record-payment-now"
                type="checkbox"
                className="size-4 shrink-0 accent-brand"
                checked={paymentEnabled}
                disabled={isPending}
                onChange={handlePaymentToggle}
              />
              <Label htmlFor="record-payment-now">Record first payment now (Optional)</Label>
              <HelpTip label="About recording the first payment">
                Optional. Record the first payment together with this membership. Leave it off to save the membership as Pending.
              </HelpTip>
            </div>

            {paymentEnabled ? (
              <div className="flex flex-col gap-4 border-t border-border p-4">
                {amountPaise === null ? (
                  <p className="text-small text-text-secondary">Enter the membership amount to see the balance.</p>
                ) : null}
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
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              render={<Link href={skipHref} />}
              nativeButton={false}
              className="mr-auto"
            >
              Skip this step
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            render={<Link href={cancelHref} />}
            nativeButton={false}
          >
            Cancel
          </Button>
          {requireConfirmation ? (
            <Button type="button" onClick={openReview} disabled={isPending}>
              {isPending ? pendingLabel : submitLabel}
            </Button>
          ) : (
            <Button type="submit" disabled={isPending}>
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
          description="Confirm these details before saving."
          isPending={isPending}
          onConfirm={confirmAndSubmit}
        >
          {reviewData ? (
            <dl className="flex flex-col gap-3">
              <ReviewRow icon={UserRound} label="Student">
                {student.full_name}
              </ReviewRow>
              <ReviewRow icon={Layers} label="Plan">
                {reviewData.planLabel}
              </ReviewRow>
              {reviewData.totalClasses ? (
                <ReviewRow icon={Hash} label="Classes">
                  {reviewData.totalClasses}
                </ReviewRow>
              ) : null}
              <ReviewRow icon={CalendarDays} label="Start date">
                {reviewData.startDate}
              </ReviewRow>
              <ReviewRow icon={CalendarX2} label="End date">
                {reviewData.endDate}
              </ReviewRow>
              <ReviewRow icon={Banknote} label="Amount">
                {formatCurrency(reviewData.amount, currency)}
              </ReviewRow>
              {reviewData.payment ? (
                <>
                  <ReviewRow icon={Wallet} label="Payment">
                    {formatCurrency(fromPaise(reviewData.payment.totalPaise), currency)} on {reviewData.payment.date}
                    <span className="block text-small font-normal text-text-secondary">
                      {reviewData.payment.methods
                        .map((method) => `${PAYMENT_METHOD_LABEL[method.method] ?? method.method} ${formatCurrency(method.amount, currency)}`)
                        .join(" · ")}
                    </span>
                  </ReviewRow>
                  <ReviewRow icon={Receipt} label="Tax invoice">
                    {reviewData.payment.taxInvoice ? "Yes" : "No"}
                  </ReviewRow>
                  <ReviewRow icon={CircleCheck} label="Result">
                    {reviewData.payment.remainingPaise <= 0
                      ? "Paid in full"
                      : `Partly paid · balance ${formatCurrency(fromPaise(reviewData.payment.remainingPaise), currency)}`}
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

/**
 * The membership form. A NEW membership can be priced from a package (`packages` and `packageAction` given, V1 Fee Structure,
 * FS-6): the package form is shown first, with a switch to the form below for a membership without a package. Everything
 * else - Edit, Renew, every entry point that passes no packages, and a membership whose type is locked - is exactly the form
 * above, unchanged. `packageInitialValues` start the package form (a renewal's package and start date); `defaultMode` is
 * "package" (the default) or "manual", the form without a package, which a renewal of a membership without a package opens first.
 */
export default function MembershipForm(props) {
  const { packages, packageAction, packageInitialValues, defaultMode = "package", membership } = props;
  const offersPackages = Boolean(packageAction) && !membership && Array.isArray(packages) && packages.length > 0;
  const [mode, setMode] = useState(defaultMode);

  const modeSwitch = (
    <div role="group" aria-label="Pricing" className="inline-flex gap-0.5 rounded-input border border-border bg-surface p-0.5">
      <Button type="button" size="sm" variant={mode === "package" ? "default" : "ghost"} aria-pressed={mode === "package"} onClick={() => setMode("package")}>
        From a package
      </Button>
      <Button type="button" size="sm" variant={mode === "manual" ? "default" : "ghost"} aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>
        Without a package
      </Button>
    </div>
  );

  // Edit of a package-linked membership is its own workflow (app/memberships/[id]/edit/package-membership-editor.js); every Edit form
  // that reaches here is the legacy form below.
  if (!offersPackages) return <LegacyMembershipForm {...props} />;

  return (
    <div className="flex flex-col gap-5">
      {mode === "package" ? (
        <PackageMembershipForm {...props} action={packageAction} initialValues={packageInitialValues} headerAction={modeSwitch} />
      ) : (
        <LegacyMembershipForm {...props} headerAction={modeSwitch} />
      )}
    </div>
  );
}
