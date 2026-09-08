"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { validateEnrollmentInput } from "@/lib/enrollments/validation";

const BLUR_VALIDATED_FIELDS = new Set(["batch_id", "effective_start_date", "effective_end_date"]);

/**
 * Shared Add/Edit Batch Enrollment form (wireframe p13). Unlike the
 * Instructor/Batch/Student forms, saving requires an explicit Review →
 * Confirm step (02-ux.md Flow 10: "... Set Effective End Date if
 * applicable → Review Change → Confirm → Save"): the Save button opens a
 * summary dialog (ConfirmDialog) instead of submitting directly. Confirming
 * there calls `formRef.current.requestSubmit()`, which runs the exact same
 * `action={formAction}` submission React would run for a normal submit
 * click — this is a UI gate in front of the existing submit mechanism, not
 * a second one.
 *
 * Status is edit-only, mirroring Instructor/Batch forms: `enrollment` being
 * present signals edit mode and gates the Status field. A new enrollment
 * has no status to choose — it always starts active via the database
 * default.
 */
export default function EnrollmentForm({
  action,
  enrollment,
  batchOptions,
  submitLabel,
  pendingLabel,
  cancelHref,
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [batchId, setBatchId] = useState(state?.values?.batch_id ?? enrollment?.batch_id ?? "");
  const [isActive, setIsActive] = useState(enrollment?.status === "active");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const formRef = useRef(null);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  const batchSelectOptions = batchOptions.map((batch) => ({
    value: batch.id,
    label: `${batch.name} (${batch.code})`,
  }));

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateEnrollmentInput({
      batch_id: formData.get("batch_id"),
      effective_start_date: formData.get("effective_start_date"),
      effective_end_date: formData.get("effective_end_date"),
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
    const batch_id = formData.get("batch_id");
    const effective_start_date = formData.get("effective_start_date");
    const effective_end_date = formData.get("effective_end_date");

    const result = validateEnrollmentInput({ batch_id, effective_start_date, effective_end_date });
    if (!result.success) {
      setFieldErrors(result.errors);
      return;
    }

    setReviewData({
      batchName: batchOptions.find((batch) => batch.id === batch_id)?.name ?? "—",
      startDate: effective_start_date,
      endDate: effective_end_date,
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
        {state?.error ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
          >
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="batch_id">Batch</Label>
          <Select
            name="batch_id"
            items={batchSelectOptions}
            value={batchId}
            onValueChange={setBatchId}
            disabled={isPending}
          >
            <SelectTrigger id="batch_id" aria-invalid={Boolean(fieldErrors.batch_id)}>
              <SelectValue placeholder="Select a batch…" />
            </SelectTrigger>
            <SelectContent>
              {batchSelectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.batch_id ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.batch_id}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="effective_start_date">Enrollment Start Date</Label>
            <Input
              id="effective_start_date"
              name="effective_start_date"
              type="date"
              required
              disabled={isPending}
              defaultValue={
                state?.values?.effective_start_date ?? enrollment?.effective_start_date ?? ""
              }
              aria-invalid={Boolean(fieldErrors.effective_start_date)}
              aria-describedby={
                fieldErrors.effective_start_date ? "effective_start_date-error" : undefined
              }
            />
            {fieldErrors.effective_start_date ? (
              <p id="effective_start_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.effective_start_date}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="effective_end_date">Enrollment End Date</Label>
            <Input
              id="effective_end_date"
              name="effective_end_date"
              type="date"
              disabled={isPending}
              defaultValue={state?.values?.effective_end_date ?? enrollment?.effective_end_date ?? ""}
              aria-invalid={Boolean(fieldErrors.effective_end_date)}
              aria-describedby={fieldErrors.effective_end_date ? "effective_end_date-error" : undefined}
            />
            <p className="text-small text-text-secondary">
              Optional — leave blank if the enrollment has no planned end date.
            </p>
            {fieldErrors.effective_end_date ? (
              <p id="effective_end_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.effective_end_date}
              </p>
            ) : null}
          </div>
        </div>

        {enrollment ? (
          <div className="flex flex-col gap-2">
            <Label id="enrollment-status-label">Status</Label>
            <div className="flex items-center gap-3">
              <Switch
                name="status"
                value="active"
                uncheckedValue="inactive"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isPending}
                aria-labelledby="enrollment-status-label"
              />
              <span className="text-body font-medium text-text-primary">
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            render={<Link href={cancelHref} />}
            nativeButton={false}
          >
            Cancel
          </Button>
          <Button type="button" onClick={openReview} disabled={isPending}>
            {isPending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Review enrollment"
        description="Confirm these details before saving."
        confirmLabel="Confirm & Save"
        isPending={isPending}
        onConfirm={confirmAndSubmit}
      >
        {reviewData ? (
          <dl className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4">
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Batch</dt>
              <dd className="text-body font-medium text-text-primary">{reviewData.batchName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Start date</dt>
              <dd className="text-body font-medium text-text-primary">{reviewData.startDate}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">End date</dt>
              <dd className="text-body font-medium text-text-primary">
                {reviewData.endDate || "No end date"}
              </dd>
            </div>
            {enrollment ? (
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Status</dt>
                <dd className="text-body font-medium text-text-primary">
                  {isActive ? "Active" : "Inactive"}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
