"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { validateScheduleInput, calculateEndTime, DAYS_OF_WEEK, DAY_LABELS } from "@/lib/schedules/validation";

const DAY_OPTIONS = DAYS_OF_WEEK.map((value) => ({ value, label: DAY_LABELS[value] }));

const BLUR_VALIDATED_FIELDS = new Set([
  "batch_id",
  "instructor_id",
  "day_of_week",
  "start_time",
  "end_time",
  "effective_from",
  "effective_until",
]);

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Shared Add/Edit Schedule form (Phase 13 — no dedicated wireframe for
 * either screen; composed from the Students/Batches form layout and, for
 * Edit, Review → Confirm → Save (02-ux.md Flow 04), matching how Phase 12's
 * composed Membership screens were built).
 *
 * `batch` fixes the batch as read-only context (Edit mode, always — a
 * schedule's batch does not change; and Add Schedule launched from Batch
 * Details). Without it, a Batch Select renders from `batchOptions`
 * (standalone Add Schedule).
 *
 * `requireConfirmation` is false for Add (02-ux.md Flow 03 saves directly,
 * no Review/Confirm step) and true for Edit (Flow 04). There is no
 * Deactivate mode here — that is its own action/component
 * (app/schedule/[id]/deactivate-schedule.js), not a field on this form.
 *
 * Effective From means different things depending on mode: for Add, when
 * the schedule begins; for Edit, the date the edited values take effect —
 * the current version is versioned (closed the day before), never rewritten
 * (01-product.md §7).
 */
export default function ScheduleForm({
  action,
  batch,
  batchOptions,
  instructorOptions,
  schedule,
  requireConfirmation = false,
  submitLabel,
  pendingLabel,
  cancelHref,
}) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [batchId, setBatchId] = useState(state?.values?.batch_id ?? "");
  const [instructorId, setInstructorId] = useState(
    state?.values?.instructor_id ?? schedule?.instructors?.id ?? ""
  );
  const [dayOfWeek, setDayOfWeek] = useState(state?.values?.day_of_week ?? schedule?.day_of_week ?? "");
  const [startTime, setStartTime] = useState(state?.values?.start_time ?? schedule?.start_time ?? "");
  const [endTime, setEndTime] = useState(state?.values?.end_time ?? schedule?.end_time ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const formRef = useRef(null);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  const instructorSelectOptions = instructorOptions.map((instructor) => ({
    value: instructor.id,
    label: instructor.full_name,
  }));

  function handleStartTimeChange(event) {
    const value = event.target.value;
    setStartTime(value);
    const calculated = calculateEndTime(value);
    if (calculated) setEndTime(calculated);
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateScheduleInput({
      batch_id: formData.get("batch_id"),
      instructor_id: formData.get("instructor_id"),
      day_of_week: formData.get("day_of_week"),
      start_time: formData.get("start_time"),
      end_time: formData.get("end_time"),
      effective_from: formData.get("effective_from"),
      effective_until: formData.get("effective_until"),
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

  function submitDirectly(event) {
    // Add Schedule saves directly — no Review/Confirm (02-ux.md Flow 03).
    // Still re-run validation so obviously incomplete required fields don't
    // even reach the server action; it re-validates authoritatively either way.
    const formData = new FormData(formRef.current);
    const result = validateScheduleInput({
      batch_id: formData.get("batch_id"),
      instructor_id: formData.get("instructor_id"),
      day_of_week: formData.get("day_of_week"),
      start_time: formData.get("start_time"),
      end_time: formData.get("end_time"),
      effective_from: formData.get("effective_from"),
      effective_until: formData.get("effective_until"),
    });
    if (!result.success) {
      event.preventDefault();
      setFieldErrors(result.errors);
    }
  }

  function openReview(event) {
    event.preventDefault();

    const formData = new FormData(formRef.current);
    const input = {
      batch_id: formData.get("batch_id"),
      instructor_id: formData.get("instructor_id"),
      day_of_week: formData.get("day_of_week"),
      start_time: formData.get("start_time"),
      end_time: formData.get("end_time"),
      effective_from: formData.get("effective_from"),
      effective_until: formData.get("effective_until"),
    };

    const result = validateScheduleInput(input);
    if (!result.success) {
      setFieldErrors(result.errors);
      return;
    }

    setReviewData({
      dayLabel: DAY_LABELS[input.day_of_week] ?? input.day_of_week,
      startTime: input.start_time,
      endTime: input.end_time,
      instructorName:
        instructorOptions.find((instructor) => instructor.id === input.instructor_id)?.full_name ?? "—",
      effectiveFrom: input.effective_from,
      effectiveUntil: input.effective_until,
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
        onSubmit={requireConfirmation ? undefined : submitDirectly}
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

        {batch ? (
          <div className="flex flex-col gap-2">
            <Label>Batch</Label>
            <div className="flex flex-wrap items-baseline gap-x-3 rounded-lg border border-border bg-background/60 p-3">
              <span className="text-body font-medium text-text-primary">{batch.name}</span>
              <span className="text-small text-text-secondary">{batch.code}</span>
            </div>
            <input type="hidden" name="batch_id" value={batch.id} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="batch_id">Batch</Label>
            <Select
              name="batch_id"
              items={batchOptions.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
              value={batchId}
              onValueChange={setBatchId}
              disabled={isPending}
            >
              <SelectTrigger id="batch_id" aria-invalid={Boolean(fieldErrors.batch_id)}>
                <SelectValue placeholder="Select a batch…" />
              </SelectTrigger>
              <SelectContent>
                {batchOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} ({b.code})
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
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="day_of_week">Day of Week</Label>
            <Select
              name="day_of_week"
              items={DAY_OPTIONS}
              value={dayOfWeek}
              onValueChange={setDayOfWeek}
              disabled={isPending}
            >
              <SelectTrigger id="day_of_week" aria-invalid={Boolean(fieldErrors.day_of_week)}>
                <SelectValue placeholder="Select a day…" />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.day_of_week ? (
              <p role="alert" className="text-small text-danger">
                {fieldErrors.day_of_week}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="instructor_id">Instructor</Label>
            <Select
              name="instructor_id"
              items={instructorSelectOptions}
              value={instructorId}
              onValueChange={setInstructorId}
              disabled={isPending}
            >
              <SelectTrigger id="instructor_id" aria-invalid={Boolean(fieldErrors.instructor_id)}>
                <SelectValue placeholder="Select an instructor…" />
              </SelectTrigger>
              <SelectContent>
                {instructorSelectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.instructor_id ? (
              <p role="alert" className="text-small text-danger">
                {fieldErrors.instructor_id}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="start_time">Start Time</Label>
            <Input
              id="start_time"
              name="start_time"
              type="time"
              required
              disabled={isPending}
              value={startTime}
              onChange={handleStartTimeChange}
              aria-invalid={Boolean(fieldErrors.start_time)}
              aria-describedby={fieldErrors.start_time ? "start_time-error" : undefined}
            />
            {fieldErrors.start_time ? (
              <p id="start_time-error" role="alert" className="text-small text-danger">
                {fieldErrors.start_time}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="end_time">End Time</Label>
            <Input
              id="end_time"
              name="end_time"
              type="time"
              required
              disabled={isPending}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-invalid={Boolean(fieldErrors.end_time)}
              aria-describedby={fieldErrors.end_time ? "end_time-error" : undefined}
            />
            <p className="text-small text-text-secondary">
              Defaults to 60 minutes after Start Time — editable.
            </p>
            {fieldErrors.end_time ? (
              <p id="end_time-error" role="alert" className="text-small text-danger">
                {fieldErrors.end_time}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="effective_from">Effective From</Label>
            <Input
              id="effective_from"
              name="effective_from"
              type="date"
              required
              disabled={isPending}
              defaultValue={state?.values?.effective_from ?? ""}
              aria-invalid={Boolean(fieldErrors.effective_from)}
              aria-describedby={fieldErrors.effective_from ? "effective_from-error" : undefined}
            />
            <p className="text-small text-text-secondary">
              {schedule
                ? "The date this change takes effect. The current schedule is unaffected before this date."
                : "When this schedule begins."}
            </p>
            {fieldErrors.effective_from ? (
              <p id="effective_from-error" role="alert" className="text-small text-danger">
                {fieldErrors.effective_from}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="effective_until">Effective Until</Label>
            <Input
              id="effective_until"
              name="effective_until"
              type="date"
              disabled={isPending}
              defaultValue={state?.values?.effective_until ?? ""}
              aria-invalid={Boolean(fieldErrors.effective_until)}
              aria-describedby={fieldErrors.effective_until ? "effective_until-error" : undefined}
            />
            <p className="text-small text-text-secondary">Optional — leave blank for an open-ended schedule.</p>
            {fieldErrors.effective_until ? (
              <p id="effective_until-error" role="alert" className="text-small text-danger">
                {fieldErrors.effective_until}
              </p>
            ) : null}
          </div>
        </div>

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
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Review schedule change"
          description="Confirm these details before saving. This starts a new version of the schedule from the effective date below — the current schedule is preserved as history."
          confirmLabel="Confirm & Save"
          isPending={isPending}
          onConfirm={confirmAndSubmit}
        >
          {reviewData ? (
            <dl className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4">
              {batch ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-body text-text-secondary">Batch</dt>
                  <dd className="text-body font-medium text-text-primary">{batch.name}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Day</dt>
                <dd className="text-body font-medium text-text-primary">{reviewData.dayLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Time</dt>
                <dd className="text-body font-medium text-text-primary">
                  {formatTime(reviewData.startTime)} – {formatTime(reviewData.endTime)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Instructor</dt>
                <dd className="text-body font-medium text-text-primary">{reviewData.instructorName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Effective From</dt>
                <dd className="text-body font-medium text-text-primary">{reviewData.effectiveFrom}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Effective Until</dt>
                <dd className="text-body font-medium text-text-primary">{reviewData.effectiveUntil || "Open-ended"}</dd>
              </div>
            </dl>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
