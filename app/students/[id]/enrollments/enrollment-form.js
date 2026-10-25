"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import HelpTip from "@/components/ui/help-tip";
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
import SchedulePicker from "@/app/students/[id]/enrollments/schedule-picker";
import EnrollmentReviewDialog from "@/app/students/[id]/enrollments/enrollment-review-dialog";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { joinDateLabel } from "@/lib/students/join-date";
import { enrollmentWillTakePlaces, everyScheduleFull, heldSeriesIdsOf } from "@/lib/enrollments/schedule-availability";
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
 * `guided` (Add Student flow, step 3) only adds a hidden `guided=1` field so
 * `createEnrollment` can send the admin to the flow's completion screen; the
 * form's fields, validation and Review step are the same either way.
 *
 * Status is edit-only, mirroring Instructor/Batch forms: `enrollment`
 * being present signals edit mode and gates both the Status field and the
 * schedule-change-date field.
 *
 * Schedule capacity (V1 Final Improvements, S4; 01-product.md §7): `scheduleCapacities` - the places taken against each
 * schedule's capacity, keyed by schedule series id, or null when they could not be read - is shown in the picker, and a full
 * schedule cannot be newly ticked. The places this enrollment already holds (`heldSeriesIds`: its current assignments - started
 * or not yet started - while the stored enrollment is active and current) stay selectable even if now full; an enrollment that is
 * inactive or ended holds none, so reactivating or extending it treats a full schedule like a new one. Nothing is locked when the
 * enrollment, as the form would save it, takes no place at all (inactive, or ended before today): the database counts only
 * active, current enrollments, so that save cannot be refused for capacity. The database stays authoritative: if a schedule fills
 * up meanwhile, the save is refused with a message on the schedule field, and everything entered here stays as it was.
 */
export default function EnrollmentForm({
  action,
  student,
  joinDate,
  enrollment,
  batchOptions,
  currentSchedules,
  assignedSchedules,
  scheduleCapacities = null,
  todayDate,
  guided = false,
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
  const heldSeriesIds = useMemo(
    () => heldSeriesIdsOf(enrollment, assignedSchedules, todayDate),
    [enrollment, assignedSchedules, todayDate]
  );
  // The end date as typed (the input itself stays uncontrolled): whether the enrollment will take places decides if a full
  // schedule is locked at all. A new enrollment is created active.
  const [endDate, setEndDate] = useState(state?.values?.effective_end_date ?? enrollment?.effective_end_date ?? "");
  const restricted = enrollmentWillTakePlaces({ active: enrollment ? isActive : true, endDate }, todayDate);

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
        {guided ? <input type="hidden" name="guided" value="1" /> : null}

        {state?.error ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
          >
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="batch_id">
            Batch<span className="text-danger" aria-hidden="true"> *</span>
          </Label>
          <Select
            name="batch_id"
            items={batchSelectOptions}
            value={batchId}
            onValueChange={setBatchId}
            disabled={isPending}
          >
            <SelectTrigger id="batch_id" aria-invalid={Boolean(fieldErrors.batch_id)} className="w-full">
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

        {/* The schedules appear only once a batch is chosen (they are that batch's schedules); the label is an ordinary field label. */}
        {batchId ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label id="schedules-label">
              Select Class Schedules<span className="text-danger" aria-hidden="true"> *</span>
            </Label>
            {batchId && pickerOptions.length > 0 ? (
              <span aria-live="polite" className="text-small rounded-full bg-brand/10 px-2.5 py-0.5 font-medium text-brand">
                {selectedSeriesIds.size} selected
              </span>
            ) : null}
          </div>
          {pickerOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/60 p-4">
              <p className="text-body text-text-secondary">
                This batch has no currently available schedules. Add a schedule for this batch first.
              </p>
            </div>
          ) : (
            <>
              {everyScheduleFull(pickerOptions, scheduleCapacities, heldSeriesIds, restricted) ? (
                <div role="status" className="rounded-lg border border-dashed border-border bg-background/60 p-4">
                  <p className="text-body text-text-secondary">
                    Every schedule of this batch is full. Raise a schedule&rsquo;s capacity first, then enrol the student.
                  </p>
                </div>
              ) : null}
              <SchedulePicker
                schedules={pickerOptions}
                selectedSeriesIds={selectedSeriesIds}
                onToggle={toggleSeries}
                disabled={isPending}
                labelledBy="schedules-label"
                capacities={scheduleCapacities}
                heldSeriesIds={heldSeriesIds}
                restricted={restricted}
              />
            </>
          )}
          {fieldErrors.schedule_series_ids ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.schedule_series_ids}
            </p>
          ) : null}
        </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="effective_start_date">
                Enrollment Start Date<span className="text-danger" aria-hidden="true"> *</span>
              </Label>
              {joinDate ? (
                <HelpTip label="About the start date">
                  Cannot be before the student&rsquo;s join date ({joinDateLabel(joinDate)}).
                </HelpTip>
              ) : null}
            </div>
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
            <div className="flex items-center gap-1.5">
              <Label htmlFor="effective_end_date">Enrollment End Date</Label>
              <HelpTip label="About the end date">Optional — leave blank if there is no planned end date.</HelpTip>
            </div>
            <Input
              id="effective_end_date"
              name="effective_end_date"
              type="date"
              disabled={isPending}
              defaultValue={state?.values?.effective_end_date ?? enrollment?.effective_end_date ?? ""}
              onChange={(event) => setEndDate(event.target.value)}
              aria-invalid={Boolean(fieldErrors.effective_end_date)}
              aria-describedby={fieldErrors.effective_end_date ? "effective_end_date-error" : undefined}
            />
            {fieldErrors.effective_end_date ? (
              <p id="effective_end_date-error" role="alert" className="text-small text-danger">
                {fieldErrors.effective_end_date}
              </p>
            ) : null}
          </div>
        </div>

        {enrollment && selectionChanged ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="schedule_effective_date">Schedule Change Effective Date</Label>
              <HelpTip label="About the effective date">
                The date this schedule change takes effect. Past sessions are unaffected; it cannot be back-dated.
              </HelpTip>
            </div>
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
            variant="secondary"
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

      <EnrollmentReviewDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        student={student}
        review={reviewData}
        isEdit={Boolean(enrollment)}
        isActive={isActive}
        isPending={isPending}
        onConfirm={confirmAndSubmit}
      />
    </>
  );
}
