"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { calculateDurationEndDate, resolveDurationMonths } from "@/lib/packages/duration";
import { DURATION_LABELS } from "@/lib/packages/labels";
import { INDIVIDUAL_DISCOUNT_REASONS } from "@/lib/packages/validation";
import {
  CORRECTION_REASON_MAX,
  protectedTermsChanged,
  rawCorrectionInput,
  validateCorrectionInput,
  validateCorrectionReason,
} from "@/lib/memberships/correction-core";
import { previewMembershipCorrection, saveMembershipEdit } from "@/lib/memberships/corrections";

const DISCOUNT_TYPES = [
  { value: "none", label: "No individual discount" },
  { value: "fixed", label: "Fixed amount" },
  { value: "percent", label: "Percentage" },
];

const MODES = [
  { value: "standard", label: "Standard package pricing" },
  { value: "custom_fee_plan", label: "Custom Fee Plan" },
];

const DURATION_OPTIONS_ORDER = ["monthly", "quarterly", "half_yearly", "annual", "custom"];

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className={strong ? "text-body font-semibold text-text-primary" : "text-body text-text-primary"}>{value}</dd>
    </div>
  );
}

function Section({ id, title, description, children }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h2 id={id} className="text-section-title font-semibold text-text-primary">
          {title}
        </h2>
        {description ? <p className="text-small text-text-secondary">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Edit Membership of a PACKAGE-LINKED membership (02-ux.md "Membership Details (package-linked)"): one workflow, three sections -
 * Membership (package, duration, start date, end date), Pricing (standard package pricing or a Custom Fee Plan, the custom fee, the
 * individual discount) and Notes.
 *
 * What the save does depends on what changed (the server decides again from the stored membership):
 *   - only the notes: a plain save. No reason and no price confirmation are asked for.
 *   - a PROTECTED term (package, duration, start date, pricing, discount): the revised price is calculated by the database and
 *     REVIEWED - the breakdown, the revised final fee, what has been paid, the balance - and the save needs the reason and the
 *     explicit confirmation of the revised final fee. It is the audited correction of migration 0050: payments and issued
 *     receipts are not changed, and the correction is added to the membership's history.
 *
 * A class-count membership's expiry is not edited here (it changes only with Edit expiry). A cancelled membership can have its
 * notes edited only.
 *
 * @param {{ membershipId: string, kind: "duration"|"class_count", currency: string, current: Record<string, string>,
 *   packages: { id: string, name: string, kind: string, total_classes: number|null, status: string, options: string[] }[],
 *   endDate: string|null, notes: string, locked: boolean, student: object|null, membership: object }} props
 */
export default function PackageMembershipEditor({ membershipId, kind, currency, current, packages, endDate, notes: initialNotes, locked, student, membership }) {
  const router = useRouter();
  const [step, setStep] = useState("edit");
  const [values, setValues] = useState(current);
  const [notes, setNotes] = useState(initialNotes);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const pkg = packages.find((item) => item.id === values.package_id) ?? null;
  const offered = pkg ? DURATION_OPTIONS_ORDER.filter((option) => pkg.options?.includes(option)) : [];
  const isCustomPlan = values.pricing_mode === "custom_fee_plan";
  const discountType = values.individual_discount_type || "none";
  const termsChanged = !locked && protectedTermsChanged(current, rawCorrectionInput(values, kind));
  const notesChanged = notes.trim() !== initialNotes.trim();

  const months = resolveDurationMonths(values.duration_option, values.custom_months);
  const calculatedEnd = kind === "duration" && months.success ? calculateDurationEndDate(values.start_date, months.data) : null;
  const money = (amount) => formatCurrency(amount, currency);

  const set = (field) => (value) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSubmitError(null);
  };

  function handlePackageChange(packageId) {
    const next = packages.find((item) => item.id === packageId);
    setValues((previous) => ({
      ...previous,
      package_id: packageId,
      // The duration of another package may not be offered by it: choose again rather than keep one it does not offer.
      duration_option: next?.options?.includes(previous.duration_option) ? previous.duration_option : "",
    }));
    setErrors({});
    setSubmitError(null);
  }

  function done() {
    router.push(`/memberships/${membershipId}?success=updated`);
    router.refresh();
  }

  // Step 1: Save changes. Notes only: saved. A protected term: the revised price is calculated and reviewed first.
  function saveChanges(event) {
    event.preventDefault();
    if (isPending) return;

    if (!termsChanged && !notesChanged) {
      setSubmitError("Nothing has changed.");
      return;
    }

    const raw = rawCorrectionInput(values, kind);

    if (!termsChanged) {
      setErrors({});
      setSubmitError(null);
      startTransition(async () => {
        try {
          const result = await saveMembershipEdit(membershipId, rawCorrectionInput(current, kind), { notes });
          if (result?.success) done();
          else {
            setErrors(result?.fieldErrors ?? {});
            setSubmitError(result?.error ?? null);
          }
        } catch {
          setSubmitError("Could not reach the server. Try again.");
        }
      });
      return;
    }

    const checked = validateCorrectionInput(raw, pkg?.kind ?? null);
    if (!checked.success) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);

    startTransition(async () => {
      try {
        const result = await previewMembershipCorrection(membershipId, raw);
        if (result?.success) {
          setPreview(result.preview);
          setConfirmed(false);
          setStep("review");
        } else {
          setErrors(result?.fieldErrors ?? {});
          setSubmitError(result?.error ?? null);
        }
      } catch {
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  // Step 2 (protected terms only): the reason and the confirmation of the revised final fee, then the correction is saved.
  function confirmCorrection() {
    if (isPending) return;
    const checkedReason = validateCorrectionReason(reason);
    if (!checkedReason.success) {
      setErrors({ reason: checkedReason.error });
      return;
    }
    if (!confirmed) {
      setErrors({ confirm: "Confirm the revised final fee before saving." });
      return;
    }
    setErrors({});
    setSubmitError(null);

    startTransition(async () => {
      try {
        const result = await saveMembershipEdit(membershipId, rawCorrectionInput(values, kind), { notes, confirmedFee: preview.finalFee, reason });
        if (result?.success) done();
        else {
          setErrors(result?.fieldErrors ?? {});
          setSubmitError(result?.error ?? null);
        }
      } catch {
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  const cancelHref = `/memberships/${membershipId}`;

  if (step === "review" && preview) {
    return (
      <div className="flex flex-col gap-5">
        <StudentIdentityHeader student={student} membership={{ code: membership.membership_code, plan: preview.packageName }} />
        <div>
          <h2 className="text-section-title font-semibold text-text-primary">Review the revised price</h2>
          <p className="text-small text-text-secondary">
            You changed the package, duration, start date or price. Check the revised terms, give the reason and confirm the revised final fee. Payments and
            issued receipts stay exactly as they are.
          </p>
        </div>

        {submitError ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {submitError}
          </p>
        ) : null}

        <dl className="rounded-lg border border-border bg-surface-muted/40 px-4 py-2">
          <Row label="Package" value={preview.packageName} />
          <Row
            label="Term"
            value={
              preview.kind === "class_count"
                ? `${preview.totalClasses} ${preview.totalClasses === 1 ? "class" : "classes"}`
                : `${DURATION_LABELS[preview.plan] ?? preview.plan} · ${preview.durationMonths} ${preview.durationMonths === 1 ? "month" : "months"}`
            }
          />
          <Row label="Start date" value={formatDate(preview.startDate)} />
          <Row label={preview.kind === "class_count" ? "Expiry (unchanged)" : "End date"} value={preview.endDate ? formatDate(preview.endDate) : NO_EXPIRY_LABEL} />
          {preview.pricingMode === "custom_fee_plan" ? (
            <Row label="Pricing" value="Custom Fee Plan" />
          ) : (
            <>
              <Row label="Standard fee" value={money(preview.standardFee)} />
              {preview.packageDiscount ? <Row label="Package discount" value={`− ${money(preview.packageDiscount)}`} /> : null}
              {preview.individualDiscountAmount ? <Row label="Individual discount" value={`− ${money(preview.individualDiscountAmount)}`} /> : null}
            </>
          )}
          <Row label="Revised final fee" value={money(preview.finalFee)} strong />
          <Row label="Current final fee" value={money(preview.currentAmount)} />
          <Row label="Paid so far" value={money(preview.paidTotal)} />
          <Row label="Balance after" value={money(preview.balanceAfter)} />
        </dl>
        <p className="text-small text-text-secondary">The payment status is recalculated from the payments recorded.</p>

        <FormField
          id="correct-reason"
          label="Reason for the change"
          required
          error={errors.reason}
          help={`${reason.trim().length} of ${CORRECTION_REASON_MAX} characters, at least 3. Kept in the membership's correction history.`}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              disabled={isPending}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setErrors((previous) => ({ ...previous, reason: undefined }));
              }}
            />
          )}
        </FormField>

        <div className="flex flex-col gap-1">
          <label htmlFor="correct-confirm" className="text-body flex items-start gap-2 text-text-primary">
            <input
              id="correct-confirm"
              type="checkbox"
              className="mt-1 size-4 accent-brand"
              checked={confirmed}
              disabled={isPending}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                setErrors((previous) => ({ ...previous, confirm: undefined }));
              }}
            />
            <span>
              I confirm the revised final fee of <strong>{money(preview.finalFee)}</strong>.
            </span>
          </label>
          {errors.confirm ? (
            <p role="alert" className="text-small text-danger">
              {errors.confirm}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => setStep("edit")}>
            Back to edit
          </Button>
          <Button type="button" disabled={isPending} onClick={confirmCorrection}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={saveChanges} className="flex flex-col gap-6" noValidate>
      {submitError ? (
        <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {submitError}
        </p>
      ) : null}

      <StudentIdentityHeader student={student} membership={{ code: membership.membership_code, plan: membership.package_name }} />

      {locked ? (
        <p className="text-small rounded-card border border-border bg-background/60 p-3 text-text-secondary">
          This membership is cancelled: its package, price and dates cannot be changed. Its notes can.
        </p>
      ) : null}

      <Section id="edit-membership" title="Membership" description="The package, how long it runs and when it starts.">
        <FormField id="edit-package" label="Package" required error={errors.package_id}>
          {(field) => (
            <Select
              items={packages.map((item) => ({ value: item.id, label: item.status === "active" ? item.name : `${item.name} (deactivated)` }))}
              value={values.package_id}
              onValueChange={handlePackageChange}
              disabled={isPending || locked}
            >
              <SelectTrigger {...field}>
                <SelectValue placeholder="Select a package…" />
              </SelectTrigger>
              <SelectContent>
                {packages.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.status === "active" ? item.name : `${item.name} (deactivated)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        {kind === "duration" ? (
          <>
            <FormField id="edit-duration" label="Duration" required error={errors.duration_option ?? errors.duration}>
              {(field) => (
                <Select
                  items={offered.map((option) => ({ value: option, label: DURATION_LABELS[option] }))}
                  value={values.duration_option}
                  onValueChange={set("duration_option")}
                  disabled={isPending || locked || !pkg}
                >
                  <SelectTrigger {...field}>
                    <SelectValue placeholder={pkg ? "Select a duration…" : "Select a package first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {offered.map((option) => (
                      <SelectItem key={option} value={option}>
                        {DURATION_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            {values.duration_option === "custom" ? (
              <FormField id="edit-months" label="Months" required error={errors.custom_months} help="A whole number of calendar months, 1 to 120.">
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={120}
                    disabled={isPending || locked}
                    value={values.custom_months}
                    onChange={(event) => set("custom_months")(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </>
        ) : (
          <p className="text-small text-text-secondary">
            {pkg?.total_classes ? `${pkg.total_classes} classes. ` : ""}Expiry: {endDate ? formatDate(endDate) : NO_EXPIRY_LABEL}. The expiry is changed only with Edit
            expiry on Membership Details.
          </p>
        )}

        <FormField id="edit-start" label="Start date" required error={errors.start_date ?? errors.startDate}>
          {(field) => (
            <Input {...field} type="date" disabled={isPending || locked} value={values.start_date} onChange={(event) => set("start_date")(event.target.value)} />
          )}
        </FormField>

        {kind === "duration" ? (
          <FormField id="edit-end" label="End date" help="Calculated from the duration and the start date. It cannot be edited.">
            {(field) => <Input {...field} readOnly value={calculatedEnd?.success ? formatDate(calculatedEnd.data) : endDate ? formatDate(endDate) : ""} placeholder="Calculated" />}
          </FormField>
        ) : null}
      </Section>

      <Section id="edit-pricing" title="Pricing" description="The final agreed fee is calculated for you and shown for confirmation before anything is saved.">
        <fieldset className="flex flex-col gap-2" disabled={isPending || locked}>
          <legend className="mb-1 text-body font-medium text-text-primary">Pricing type</legend>
          {MODES.map((mode) => (
            <label key={mode.value} htmlFor={`edit-mode-${mode.value}`} className="text-body flex items-center gap-2 text-text-primary">
              <input
                id={`edit-mode-${mode.value}`}
                type="radio"
                name="edit-mode"
                className="size-4 accent-brand"
                checked={values.pricing_mode === mode.value}
                onChange={() => set("pricing_mode")(mode.value)}
              />
              {mode.label}
            </label>
          ))}
          {errors.pricing_mode ? (
            <p role="alert" className="text-small text-danger">
              {errors.pricing_mode}
            </p>
          ) : null}
        </fieldset>

        {isCustomPlan ? (
          <>
            <FormField id="edit-custom-fee" label="Custom agreed fee" required error={errors.custom_fee ?? errors.customFee} help="The final agreed fee. No discount is applied on top of it.">
              {(field) => (
                <Input {...field} inputMode="decimal" disabled={isPending || locked} value={values.custom_fee} onChange={(event) => set("custom_fee")(event.target.value)} />
              )}
            </FormField>
            <FormField id="edit-custom-reason" label="Reason for the Custom Fee Plan" required error={errors.custom_fee_reason}>
              {(field) => (
                <Textarea
                  {...field}
                  rows={2}
                  disabled={isPending || locked}
                  value={values.custom_fee_reason}
                  onChange={(event) => set("custom_fee_reason")(event.target.value)}
                />
              )}
            </FormField>
          </>
        ) : (
          <>
            <FormField id="edit-discount-type" label="Individual discount" error={discountType === "none" ? errors.discount : undefined}>
              {(field) => (
                <Select items={DISCOUNT_TYPES} value={discountType} onValueChange={set("individual_discount_type")} disabled={isPending || locked}>
                  <SelectTrigger {...field}>
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
              )}
            </FormField>
            {discountType !== "none" ? (
              <>
                <FormField
                  id="edit-discount-value"
                  label={discountType === "percent" ? "Percentage" : "Amount"}
                  required
                  error={errors.discount}
                  help="Taken from the fee after the package discount."
                >
                  {(field) => (
                    <Input
                      {...field}
                      inputMode="decimal"
                      disabled={isPending || locked}
                      value={values.individual_discount_value}
                      onChange={(event) => set("individual_discount_value")(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField id="edit-discount-reason" label="Discount reason" required error={errors.discount_reason}>
                  {(field) => (
                    <Select
                      items={INDIVIDUAL_DISCOUNT_REASONS}
                      value={values.individual_discount_reason}
                      onValueChange={set("individual_discount_reason")}
                      disabled={isPending || locked}
                    >
                      <SelectTrigger {...field}>
                        <SelectValue placeholder="Select a reason…" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDIVIDUAL_DISCOUNT_REASONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                {values.individual_discount_reason === "other" ? (
                  <FormField id="edit-discount-note" label="Explanation" required error={errors.discount_note}>
                    {(field) => (
                      <Textarea
                        {...field}
                        rows={2}
                        disabled={isPending || locked}
                        value={values.individual_discount_note}
                        onChange={(event) => set("individual_discount_note")(event.target.value)}
                      />
                    )}
                  </FormField>
                ) : null}
              </>
            ) : null}
          </>
        )}
        <p className="text-small text-text-secondary">
          Current final agreed fee: <span className="font-medium text-text-primary">{money(membership.amount)}</span>. Changing the package, duration, start date or price
          asks you to review the revised fee and give a reason. Payments and issued receipts are never changed.
        </p>
      </Section>

      <Section id="edit-notes" title="Notes">
        <FormField id="edit-notes-field" label="Notes" error={errors.notes}>
          {(field) => (
            <Textarea
              {...field}
              disabled={isPending}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setErrors((previous) => ({ ...previous, notes: undefined }));
                setSubmitError(null);
              }}
              placeholder="Enter any relevant notes (optional)"
            />
          )}
        </FormField>
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="secondary" render={<Link href={cancelHref} />} nativeButton={false} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (termsChanged ? "Calculating…" : "Saving…") : termsChanged ? "Review revised price" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
