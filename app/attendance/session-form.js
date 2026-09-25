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
import SessionContext, { sessionContextOf } from "@/app/attendance/session-context";
import { calculateEndTime } from "@/lib/schedules/validation";
import { validateSessionEditInput } from "@/lib/class-sessions/validation";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Edit This Session (02-ux.md Flow 06). Deliberately narrower than
 * app/schedule/schedule-form.js: only instructor and start/end time are
 * editable (approved Phase 14 decision — date and batch never change on a
 * session edit), and Review → Confirm → Save is always required, so there
 * is no direct-submit mode to switch on.
 *
 * `session` supplies the current values to pre-fill the form and to show
 * "Current" alongside "Updated" in the Review step — it is either a
 * materialized row or a projected occurrence
 * (lib/class-sessions/data.js's `getSessionOccurrence`); this form does not
 * care which, since saving always goes through `materializeClassSession`
 * first (lib/class-sessions/actions.js's `updateClassSession`).
 */
export default function SessionForm({ action, session, instructorOptions, cancelHref }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [instructorId, setInstructorId] = useState(session.instructor_id ?? "");
  const [startTime, setStartTime] = useState(session.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(session.end_time.slice(0, 5));
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

  function openReview(event) {
    event.preventDefault();

    const formData = new FormData(formRef.current);
    const input = {
      instructor_id: formData.get("instructor_id"),
      start_time: formData.get("start_time"),
      end_time: formData.get("end_time"),
    };

    const result = validateSessionEditInput(input);
    if (!result.success) {
      setFieldErrors(result.errors);
      return;
    }

    setReviewData({
      currentInstructorName: session.instructors?.full_name ?? "—",
      currentStartTime: session.start_time.slice(0, 5),
      currentEndTime: session.end_time.slice(0, 5),
      instructorName:
        instructorOptions.find((instructor) => instructor.id === input.instructor_id)?.full_name ?? "—",
      startTime: input.start_time,
      endTime: input.end_time,
    });
    setConfirmOpen(true);
  }

  function confirmAndSubmit() {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
        {state?.error ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label>Batch</Label>
          <div className="flex flex-wrap items-baseline gap-x-3 rounded-lg border border-border bg-background/60 p-3">
            <span className="text-body font-medium text-text-primary">{session.batches?.name ?? "—"}</span>
            <span className="text-small text-text-secondary">{session.batches?.code}</span>
          </div>
          <p className="text-small text-text-secondary">Cannot be changed on a single session.</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Date</Label>
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <span className="text-body font-medium text-text-primary">{session.session_date}</span>
          </div>
          <p className="text-small text-text-secondary">Cannot be changed on a single session.</p>
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
            <p className="text-small text-text-secondary">Defaults to 60 minutes after Start Time — editable.</p>
            {fieldErrors.end_time ? (
              <p id="end_time-error" role="alert" className="text-small text-danger">
                {fieldErrors.end_time}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={isPending} render={<Link href={cancelHref} />} nativeButton={false}>
            Cancel
          </Button>
          <Button type="button" onClick={openReview} disabled={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Review session change"
        context={<SessionContext context={sessionContextOf(session)} />}
        description="This change applies only to this session and does not modify the recurring schedule. This session will no longer follow future changes made to the recurring schedule."
        confirmLabel="Confirm & Save"
        isPending={isPending}
        onConfirm={confirmAndSubmit}
      >
        {reviewData ? (
          <dl className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4">
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Batch</dt>
              <dd className="text-body font-medium text-text-primary">{session.batches?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Date</dt>
              <dd className="text-body font-medium text-text-primary">{session.session_date}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Instructor</dt>
              <dd className="text-body font-medium text-text-primary">
                {reviewData.instructorName === reviewData.currentInstructorName ? (
                  reviewData.instructorName
                ) : (
                  <>
                    {reviewData.currentInstructorName} <span className="text-text-secondary">→</span>{" "}
                    {reviewData.instructorName}
                  </>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-body text-text-secondary">Time</dt>
              <dd className="text-body font-medium text-text-primary">
                {reviewData.startTime === reviewData.currentStartTime && reviewData.endTime === reviewData.currentEndTime ? (
                  <>
                    {formatTime(reviewData.startTime)} – {formatTime(reviewData.endTime)}
                  </>
                ) : (
                  <>
                    {formatTime(reviewData.currentStartTime)} – {formatTime(reviewData.currentEndTime)}{" "}
                    <span className="text-text-secondary">→</span> {formatTime(reviewData.startTime)} –{" "}
                    {formatTime(reviewData.endTime)}
                  </>
                )}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
