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
import TimeSelect from "@/components/ui/time-select";
import { cn } from "@/lib/utils";
import { validateScheduleInput, calculateEndTime, DAYS_OF_WEEK, DAY_LABELS } from "@/lib/schedules/validation";
import { describeAffectedStudents } from "@/lib/schedules/usage";

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
 * Days of Week: a set of weekday checkboxes. Add Schedule creates one schedule
 * per ticked day (`createSchedule`). A schedule itself is always one weekday
 * (it is one recurring class with its own student assignments), so on Edit the
 * schedule's own day is pre-ticked and locked, and ticking other days ALSO
 * creates a new schedule for each of them with the same values
 * (`updateSchedule`). Start / End Time use `TimeSelect` (hour, minute, AM/PM
 * dropdowns) rather than the browser's time input.
 *
 * Effective From means different things depending on mode: for Add, when
 * the schedule begins; for Edit, the date the edited values take effect —
 * the current version is versioned (closed the day before), never rewritten
 * (01-product.md §7).
 *
 * `editMode` ("direct" | "versioned", from `getScheduleDeleteImpact`) is the
 * exception for a completely unused schedule (no class session, one version,
 * no started assignment): it is corrected in place, so nothing is locked and
 * no new effective date is asked for. The days work as on Add — untick this
 * schedule's day and tick another to move it; the schedule takes the first
 * ticked day if its own is unticked, and any other ticked day becomes a new
 * schedule. Effective From / Until are prefilled with the schedule's own
 * dates. `affectedStudentCount` is the number of students with an unstarted
 * assignment on it: a day change moves those assignments, so Review says so.
 * The action re-checks in the database and refuses a schedule that has since
 * gained history.
 */
export default function ScheduleForm({
  action,
  batch,
  batchOptions,
  instructorOptions,
  schedule,
  editMode = "versioned",
  affectedStudentCount = 0,
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
  // Versioned edit: the schedule's own day is fixed (submitted through a hidden
  // input); `days` holds the ticked days without it. Direct edit (an unused
  // schedule): nothing is fixed and `days` holds every ticked day.
  const directEdit = Boolean(schedule) && editMode === "direct";
  const lockedDay = schedule && !directEdit ? schedule.day_of_week : null;
  const [days, setDays] = useState(
    directEdit
      ? (state?.values?.days ?? [schedule.day_of_week])
      : (state?.values?.days ?? []).filter((day) => day !== lockedDay)
  );
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

  function clearError(name) {
    setFieldErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function handleStartTimeChange(value) {
    setStartTime(value);
    if (value) clearError("start_time");
    const calculated = calculateEndTime(value);
    if (calculated) {
      setEndTime(calculated);
      clearError("end_time");
    }
  }

  function handleEndTimeChange(value) {
    setEndTime(value);
    if (value) clearError("end_time");
  }

  function toggleDay(day) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  }

  // The same field set every submit path validates. At least one day must be
  // ticked; the shared validator sees the first one.
  function readInput(formData) {
    const chosenDays = formData.getAll("day_of_week");
    return {
      batch_id: formData.get("batch_id"),
      instructor_id: formData.get("instructor_id"),
      day_of_week: chosenDays[0] ?? "",
      start_time: formData.get("start_time"),
      end_time: formData.get("end_time"),
      effective_from: formData.get("effective_from"),
      effective_until: formData.get("effective_until"),
    };
  }

  function validateForm(formData) {
    const input = readInput(formData);
    const result = validateScheduleInput(input);
    const errors = result.success ? {} : { ...result.errors };
    if (formData.getAll("day_of_week").length === 0) {
      errors.day_of_week = "Select at least one day.";
    } else {
      delete errors.day_of_week;
    }
    return { input, errors, success: Object.keys(errors).length === 0 };
  }

  // Clears a field's stale error as soon as its value is valid — on change as
  // well as on blur. Clearing only on blur removed the error text (and shifted
  // the layout up) at the very moment the mouse went down on Save, so the
  // click landed on whatever had moved under the pointer and did nothing.
  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const { errors } = validateForm(new FormData(event.currentTarget));

    if (!errors[name]) clearError(name);
  }

  function submitDirectly(event) {
    // Add Schedule saves directly — no Review/Confirm (02-ux.md Flow 03).
    // Still re-run validation so obviously incomplete required fields don't
    // even reach the server action; it re-validates authoritatively either way.
    const { success, errors } = validateForm(new FormData(formRef.current));
    if (!success) {
      event.preventDefault();
      setFieldErrors(errors);
    }
  }

  function openReview(event) {
    event.preventDefault();

    const { input, success, errors } = validateForm(new FormData(formRef.current));
    if (!success) {
      setFieldErrors(errors);
      return;
    }

    const chosenDays = new FormData(formRef.current).getAll("day_of_week");
    // Direct edit: this schedule keeps its own day while it is still ticked,
    // otherwise it moves to the first ticked day (as `updateSchedule` does).
    const ownDay = directEdit
      ? (chosenDays.includes(schedule.day_of_week) ? schedule.day_of_week : chosenDays[0])
      : (lockedDay ?? input.day_of_week);
    const extraDays = chosenDays.filter((day) => day !== ownDay).map((day) => DAY_LABELS[day] ?? day);

    setReviewData({
      dayLabel: DAY_LABELS[ownDay] ?? ownDay,
      movedFrom: directEdit && ownDay !== schedule.day_of_week ? DAY_LABELS[schedule.day_of_week] : null,
      extraDays,
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
        onChange={handleBlur}
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
              onValueChange={(next) => {
                setBatchId(next);
                clearError("batch_id");
              }}
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

        <div role="group" aria-labelledby="day_of_week-label" className="flex flex-col gap-2">
          <Label id="day_of_week-label">Days of Week</Label>
          {lockedDay ? <input type="hidden" name="day_of_week" value={lockedDay} /> : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DAY_OPTIONS.map((option) => {
              const locked = option.value === lockedDay;
              const checked = locked || days.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex h-10 cursor-pointer items-center gap-2.5 rounded-input border px-3 text-body transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    checked
                      ? "border-brand bg-brand/5 font-medium text-text-primary"
                      : "border-border bg-background text-text-secondary hover:bg-muted",
                    (isPending || locked) && "cursor-not-allowed",
                    isPending && "opacity-50"
                  )}
                >
                  <input
                    type="checkbox"
                    // The locked day is submitted by the hidden input above.
                    name={locked ? undefined : "day_of_week"}
                    value={option.value}
                    checked={checked}
                    onChange={() => toggleDay(option.value)}
                    disabled={isPending || locked}
                    aria-invalid={Boolean(fieldErrors.day_of_week)}
                    className="size-4 shrink-0 accent-primary outline-none"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          <p className="text-small text-text-secondary">
            {directEdit
              ? "Untick this schedule's day and tick another to move it. Any other ticked day also creates the same schedule on it."
              : lockedDay
                ? "This schedule stays on its current day. Tick other days to also create the same schedule on them."
                : "Select one or more days — a schedule is created for each."}
          </p>
          {directEdit && affectedStudentCount > 0 ? (
            <p className="text-small text-text-secondary">
              {describeAffectedStudents(affectedStudentCount)} Changing its day moves their assignment to the new day.
            </p>
          ) : null}
          {fieldErrors.day_of_week ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.day_of_week}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="instructor_id">Instructor</Label>
            <Select
              name="instructor_id"
              items={instructorSelectOptions}
              value={instructorId}
              onValueChange={(next) => {
                setInstructorId(next);
                clearError("instructor_id");
              }}
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
            <TimeSelect
              id="start_time"
              name="start_time"
              label="Start time"
              value={startTime}
              onChange={handleStartTimeChange}
              disabled={isPending}
              invalid={Boolean(fieldErrors.start_time)}
            />
            {fieldErrors.start_time ? (
              <p id="start_time-error" role="alert" className="text-small text-danger">
                {fieldErrors.start_time}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="end_time">End Time</Label>
            <TimeSelect
              id="end_time"
              name="end_time"
              label="End time"
              value={endTime}
              onChange={handleEndTimeChange}
              disabled={isPending}
              invalid={Boolean(fieldErrors.end_time)}
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
              defaultValue={state?.values?.effective_from ?? (directEdit ? schedule.effective_from : "")}
              aria-invalid={Boolean(fieldErrors.effective_from)}
              aria-describedby={fieldErrors.effective_from ? "effective_from-error" : undefined}
            />
            <p className="text-small text-text-secondary">
              {schedule && !directEdit
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
              defaultValue={state?.values?.effective_until ?? (directEdit ? (schedule.effective_until ?? "") : "")}
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
          description={
            directEdit
              ? "Confirm these details before saving. This schedule has no sessions, attendance or student history yet, so the changes are applied to it directly — no new version is created."
              : "Confirm these details before saving. This starts a new version of the schedule from the effective date below — the current schedule is preserved as history."
          }
          tone={directEdit && reviewData?.movedFrom && affectedStudentCount > 0 ? "warning" : undefined}
          note={
            directEdit && reviewData?.movedFrom && affectedStudentCount > 0
              ? `${describeAffectedStudents(affectedStudentCount)} Moving this schedule to ${reviewData.dayLabel} moves their assignment with it.`
              : undefined
          }
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
                <dd className="text-body font-medium text-text-primary">
                  {reviewData.movedFrom ? `${reviewData.movedFrom} → ${reviewData.dayLabel}` : reviewData.dayLabel}
                </dd>
              </div>
              {reviewData.extraDays.length > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-body text-text-secondary">Also creates</dt>
                  <dd className="text-body text-right font-medium text-text-primary">
                    {reviewData.extraDays.join(", ")}
                  </dd>
                </div>
              ) : null}
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
