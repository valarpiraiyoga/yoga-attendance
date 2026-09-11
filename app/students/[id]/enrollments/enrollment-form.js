"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
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
import { DAY_LABELS } from "@/lib/schedules/validation";
import {
  validateEnrollmentInput,
  validateScheduleSelection,
  validateScheduleChangeDate,
} from "@/lib/enrollments/validation";

const BLUR_VALIDATED_FIELDS = new Set(["batch_id", "effective_start_date", "effective_end_date"]);

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function scheduleLabel(schedule) {
  if (!schedule) return "Unknown schedule";
  return `${DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week} · ${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)} · ${schedule.instructors?.full_name ?? "—"}`;
}

/**
 * Shared Add/Edit Batch Enrollment form (wireframe p13). Review → Confirm
 * before saving (02-ux.md Flow 10), same as before Phase 15A.
 *
 * Phase 15A adds schedule selection (01-product.md §4 "Schedule
 * Assignment"): after a batch is chosen, its currently-available schedules
 * (`currentSchedules`, all batches, filtered here to the selected one) are
 * offered as checkboxes — one or more required. In edit mode,
 * `assignedSchedules` (the enrollment's currently-active assignments,
 * already resolved to a representative schedule for display) pre-checks
 * the picker and is also unioned into its options, so an assignment to a
 * schedule that is no longer "currently available" (e.g. since
 * deactivated) still shows up to be deliberately kept or unchecked rather
 * than silently disappearing.
 *
 * Changing the schedule selection in edit mode reveals one more field —
 * the date the change takes effect — and the Review step states plainly
 * which schedules are being added and which are being ended, and from
 * which date (02-ux.md Flow 10 "Selecting schedules" / "Changing schedule
 * assignments"). A selection identical to what is already assigned needs
 * no date and shows no add/remove summary — this is the no-op path, and
 * the server (`updateEnrollment`) writes nothing for it either.
 *
 * Status is edit-only, mirroring Instructor/Batch forms: `enrollment`
 * being present signals edit mode and gates both the Status field and the
 * schedule-change-date field.
 */
export default function EnrollmentForm({
  action,
  enrollment,
  batchOptions,
  currentSchedules,
  assignedSchedules,
  todayDate,
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

  const originalSeriesIds = useMemo(
    () => new Set((assignedSchedules ?? []).map((a) => a.schedule_series_id)),
    [assignedSchedules]
  );
  const [selectedSeriesIds, setSelectedSeriesIds] = useState(() => new Set(originalSeriesIds));

  function toggleSeries(seriesId) {
    setSelectedSeriesIds((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  }

  const batchSelectOptions = batchOptions.map((batch) => ({
    value: batch.id,
    label: `${batch.name} (${batch.code})`,
  }));

  const pickerOptions = useMemo(() => {
    const options = new Map();
    for (const schedule of currentSchedules) {
      if (schedule.batch_id === batchId) {
        options.set(schedule.series_id, schedule);
      }
    }
    for (const assignment of assignedSchedules ?? []) {
      if (
        assignment.schedule &&
        assignment.schedule.batch_id === batchId &&
        !options.has(assignment.schedule_series_id)
      ) {
        options.set(assignment.schedule_series_id, assignment.schedule);
      }
    }
    return [...options.values()];
  }, [currentSchedules, assignedSchedules, batchId]);

  const selectionChanged =
    Boolean(enrollment) &&
    (selectedSeriesIds.size !== originalSeriesIds.size ||
      [...selectedSeriesIds].some((seriesId) => !originalSeriesIds.has(seriesId)));

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
  // validators the server uses purely so the review can't be opened with
  // obviously incomplete fields — the server still re-validates
  // authoritatively when Confirm actually submits.
  function openReview(event) {
    event.preventDefault();

    const formData = new FormData(formRef.current);
    const batch_id = formData.get("batch_id");
    const effective_start_date = formData.get("effective_start_date");
    const effective_end_date = formData.get("effective_end_date");

    const result = validateEnrollmentInput({ batch_id, effective_start_date, effective_end_date });
    const scheduleResult = validateScheduleSelection([...selectedSeriesIds]);

    const errors = {
      ...(result.success ? {} : result.errors),
      ...(scheduleResult.success ? {} : scheduleResult.errors),
    };

    let scheduleEffectiveDate = null;
    if (selectionChanged) {
      const dateResult = validateScheduleChangeDate(formData.get("schedule_effective_date"), todayDate);
      if (!dateResult.success) {
        Object.assign(errors, dateResult.errors);
      } else {
        scheduleEffectiveDate = dateResult.data;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const selectedSchedules = pickerOptions.filter((schedule) => selectedSeriesIds.has(schedule.series_id));
    // Add/remove framing only makes sense relative to something already
    // assigned — in create mode every selected schedule would otherwise
    // show as both "Schedules" and redundantly "Adding" the same list.
    const addedSchedules = enrollment
      ? selectedSchedules.filter((schedule) => !originalSeriesIds.has(schedule.series_id))
      : [];
    const removedAssignments = enrollment
      ? (assignedSchedules ?? []).filter((assignment) => !selectedSeriesIds.has(assignment.schedule_series_id))
      : [];

    setReviewData({
      batchName: batchOptions.find((batch) => batch.id === batch_id)?.name ?? "—",
      startDate: effective_start_date,
      endDate: effective_end_date,
      selectedSchedules,
      addedSchedules,
      removedAssignments,
      scheduleEffectiveDate,
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

        <div className="flex flex-col gap-2">
          <Label id="schedules-label">Schedules</Label>
          {!batchId ? (
            <p className="text-body text-text-secondary">Select a batch to see its available schedules.</p>
          ) : pickerOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/60 p-4">
              <p className="text-body text-text-secondary">
                This batch has no currently available schedules. Add a schedule for this batch first.
              </p>
            </div>
          ) : (
            <div
              role="group"
              aria-labelledby="schedules-label"
              className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-2"
            >
              {pickerOptions.map((schedule) => (
                <label
                  key={schedule.series_id}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    name="schedule_series_ids"
                    value={schedule.series_id}
                    checked={selectedSeriesIds.has(schedule.series_id)}
                    onChange={() => toggleSeries(schedule.series_id)}
                    disabled={isPending}
                    className="size-4 rounded border-border accent-brand"
                  />
                  <span className="text-body text-text-primary">{scheduleLabel(schedule)}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-small text-text-secondary">Select at least one schedule this student attends.</p>
          {fieldErrors.schedule_series_ids ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.schedule_series_ids}
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

        {enrollment && selectionChanged ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule_effective_date">Schedule Change Effective Date</Label>
            <Input
              id="schedule_effective_date"
              name="schedule_effective_date"
              type="date"
              min={todayDate}
              defaultValue={todayDate}
              disabled={isPending}
              aria-invalid={Boolean(fieldErrors.schedule_effective_date)}
              aria-describedby={
                fieldErrors.schedule_effective_date ? "schedule_effective_date-error" : undefined
              }
            />
            <p className="text-small text-text-secondary">
              The date this schedule change takes effect. Past sessions are unaffected; it cannot be
              back-dated.
            </p>
            {fieldErrors.schedule_effective_date ? (
              <p id="schedule_effective_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.schedule_effective_date}
              </p>
            ) : null}
          </div>
        ) : null}

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
        description="Confirm these details before saving. This applies only to this enrollment and does not affect past attendance."
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
            <div className="flex flex-col gap-1">
              <dt className="text-body text-text-secondary">Schedules</dt>
              <dd className="text-body font-medium text-text-primary">
                {reviewData.selectedSchedules.map(scheduleLabel).join("; ")}
              </dd>
            </div>
            {reviewData.addedSchedules.length > 0 ? (
              <div className="flex flex-col gap-1">
                <dt className="text-body text-text-secondary">Adding</dt>
                <dd className="text-body font-medium text-success">
                  {reviewData.addedSchedules.map(scheduleLabel).join("; ")}
                </dd>
              </div>
            ) : null}
            {reviewData.removedAssignments.length > 0 ? (
              <div className="flex flex-col gap-1">
                <dt className="text-body text-text-secondary">Ending</dt>
                <dd className="text-body font-medium text-danger">
                  {reviewData.removedAssignments.map((assignment) => scheduleLabel(assignment.schedule)).join("; ")}
                </dd>
              </div>
            ) : null}
            {reviewData.scheduleEffectiveDate ? (
              <div className="flex justify-between gap-4">
                <dt className="text-body text-text-secondary">Schedule change effective</dt>
                <dd className="text-body font-medium text-text-primary">{reviewData.scheduleEffectiveDate}</dd>
              </div>
            ) : null}
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
