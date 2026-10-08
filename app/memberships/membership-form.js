"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Banknote, CalendarDays, CalendarX2, CircleCheck, Layers, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { getFormPaymentDateState, paymentDateText } from "@/lib/invoices/membership-invoice";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import { validateMembershipInput, calculateMembershipEndDate } from "@/lib/memberships/validation";

const PLAN_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom duration" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
];

const BLUR_VALIDATED_FIELDS = new Set(["plan", "start_date", "end_date", "amount", "payment_status", "notes"]);

function planLabel(plan) {
  return PLAN_OPTIONS.find((option) => option.value === plan)?.label ?? "—";
}

function paymentStatusLabel(status) {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "—";
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
 */
export default function MembershipForm({
  action,
  currency,
  student,
  membership,
  hasInvoice = false,
  initialValues,
  requireConfirmation = false,
  submitLabel,
  pendingLabel,
  cancelHref,
  skipHref,
}) {
  const [state, formAction, isPending] = useActionState(action, {});
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
  const [paymentStatus, setPaymentStatus] = useState(
    state?.values?.payment_status ?? membership?.payment_status ?? initialValues?.payment_status ?? "pending"
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  // Read-only: the form never sends a payment date. The database records it when a membership becomes Paid and locks it once an invoice exists.
  const paymentDateState = getFormPaymentDateState({ paymentStatus, membership, hasInvoice });
  const formRef = useRef(null);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
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
      plan: formData.get("plan"),
      start_date: formData.get("start_date"),
      end_date: formData.get("end_date"),
      amount: formData.get("amount"),
      payment_status: formData.get("payment_status"),
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
      plan: formData.get("plan"),
      start_date: formData.get("start_date"),
      end_date: formData.get("end_date"),
      amount: formData.get("amount"),
      payment_status: formData.get("payment_status"),
      notes: formData.get("notes"),
    };

    const result = validateMembershipInput(input);
    if (!result.success) {
      setFieldErrors(result.errors);
      return;
    }

    setReviewData({
      planLabel: planLabel(input.plan),
      startDate: input.start_date,
      endDate: input.end_date,
      amount: input.amount,
      paymentStatusLabel: paymentStatusLabel(String(input.payment_status).toLowerCase() || "pending"),
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
        {/* A message already shown against its own field (e.g. the invoice rule on Payment Status) is not repeated here. */}
        {state?.error && !Object.values(fieldErrors).includes(state.error) ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
          >
            {state.error}
          </p>
        ) : null}

        <StudentIdentityHeader
          student={student}
          membership={membership ? { code: membership.membership_code, plan: planLabel(membership.plan) } : undefined}
        />

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

          <div className="flex flex-col gap-2">
            <Label htmlFor="end_date">End Date</Label>
            <Input
              id="end_date"
              name="end_date"
              type="date"
              required
              disabled={isPending}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-invalid={Boolean(fieldErrors.end_date)}
              aria-describedby={fieldErrors.end_date ? "end_date-error" : undefined}
            />
            <p className="text-small text-text-secondary">
              {plan === "custom" ? "Enter the membership's end date." : "Calculated from Plan and Start Date — editable."}
            </p>
            {fieldErrors.end_date ? (
              <p id="end_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.end_date}
              </p>
            ) : null}
          </div>
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="payment_status">Payment Status</Label>
            <Select
              name="payment_status"
              items={PAYMENT_STATUS_OPTIONS}
              value={paymentStatus}
              onValueChange={setPaymentStatus}
              disabled={isPending}
            >
              <SelectTrigger
                id="payment_status"
                aria-invalid={Boolean(fieldErrors.payment_status)}
                aria-describedby="payment_date-note"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.payment_status ? (
              <p role="alert" className="text-small text-danger">
                {fieldErrors.payment_status}
              </p>
            ) : null}
            <p id="payment_date-note" className="text-small text-text-secondary">
              Payment date: {paymentDateText(paymentDateState)}
            </p>
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
            variant="outline"
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
              <ReviewRow icon={CalendarDays} label="Start date">
                {reviewData.startDate}
              </ReviewRow>
              <ReviewRow icon={CalendarX2} label="End date">
                {reviewData.endDate}
              </ReviewRow>
              <ReviewRow icon={Banknote} label="Amount">
                {formatCurrency(reviewData.amount, currency)}
              </ReviewRow>
              <ReviewRow icon={CircleCheck} label="Payment status">
                {reviewData.paymentStatusLabel}
              </ReviewRow>
            </dl>
          ) : null}
        </ReviewDialog>
      ) : null}
    </>
  );
}
