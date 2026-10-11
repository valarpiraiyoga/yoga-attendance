"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import StudentContext from "@/components/ui/student-context";
import { recordClassCount } from "@/lib/class-count-attendance/actions";
import { attendanceDateError, remainingText } from "@/lib/class-count-attendance/record-core";
import { formatPeriod } from "@/lib/memberships/period";

/**
 * "Record class" for one class-count membership (01-product.md §8 "Class Count Attendance"; 02-ux.md): the button opens a
 * confirmation that names the student and membership, takes the **attendance date** (today at the centre by default; never
 * before the membership starts, after it ends or in the future) and shows the classes left before and after. Nothing is
 * recorded until **Confirm**, which is disabled while the call is in flight.
 *
 * Each confirmation carries a request ID the database uses to answer a repeat with the original result - so a double
 * click, a retry after a dropped connection, or a second device never takes a second class. The ID is created when the
 * dialog opens and kept until the call has been answered; if the call could not even be answered (a network failure) it
 * is kept, so trying again is a retry of the same confirmation. It is renewed when the Admin picks a different date,
 * because the database refuses one request used with two dates. The chosen date is sent as it is, never replaced by today.
 *
 * `today` is the centre's today, read on the server: the browser's clock and time zone are never used.
 */
export default function RecordClassButton({ membership, student, today }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [message, setMessage] = useState(null);
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(null);
  const requestDateRef = useRef(null);

  const { membershipId, startDate, endDate, remaining } = membership;
  const dateError = attendanceDateError(date, { today, startDate, endDate });
  const max = endDate && endDate < today ? endDate : today;

  function openDialog() {
    setDate(today);
    setDateTouched(false);
    setSubmitError(null);
    setMessage(null);
    requestIdRef.current = crypto.randomUUID();
    requestDateRef.current = today;
    setOpen(true);
  }

  function changeDate(value) {
    setDate(value);
    setDateTouched(true);
    setSubmitError(null);
  }

  function confirm() {
    if (isPending) return;
    setDateTouched(true);
    if (dateError) return;
    // A request ID is used with one date only.
    if (requestDateRef.current !== date || !requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
      requestDateRef.current = date;
    }
    const requestId = requestIdRef.current;
    setSubmitError(null);

    startTransition(async () => {
      try {
        const result = await recordClassCount(membershipId, requestId, date);
        if (result?.error) {
          // Answered: a refusal ends this request. The next confirmation is a new one.
          requestIdRef.current = null;
          setSubmitError(result.error);
        } else {
          requestIdRef.current = null;
          setOpen(false);
          setMessage(`Recorded. ${remainingText(result.classesRemaining)}.`);
        }
      } catch {
        // Not answered: keep the request ID, so another click repeats this one rather than recording a second class.
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  function handleOpenChange(next) {
    if (isPending) return;
    setOpen(next);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={openDialog} aria-label={`Record a class for ${student.fullName}`}>
        Record class
      </Button>
      <p role="status" aria-live="polite" className="max-w-48 text-right text-small text-text-secondary">
        {message ?? ""}
      </p>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Record class"
        description="Record one completed class for this membership."
        context={
          <StudentContext
            student={{ full_name: student.fullName, student_code: student.studentCode, photo_url: student.photoUrl }}
            membership={{ code: membership.code, planLabel: "Class Count", period: formatPeriod(startDate, endDate) }}
          />
        }
        confirmLabel="Record class"
        pendingLabel="Recording…"
        isPending={isPending}
        onConfirm={confirm}
        tone="info"
      >
        <FormField
          id={`record-date-${membershipId}`}
          label="Attendance date"
          required
          error={submitError ?? (dateTouched ? dateError : null)}
          help="The day the class was held. Today unless you change it."
        >
          {(field) => (
            <Input
              {...field}
              type="date"
              required
              min={startDate}
              max={max}
              disabled={isPending}
              value={date}
              onChange={(event) => changeDate(event.target.value)}
            />
          )}
        </FormField>

        <dl className="grid grid-cols-2 gap-3 rounded-card border border-border bg-muted px-3 py-2.5 text-small">
          <div>
            <dt className="text-text-secondary">Before</dt>
            <dd className="font-medium text-text-primary">{remainingText(remaining)}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">After recording</dt>
            <dd className="font-medium text-text-primary">{remainingText(remaining - 1)}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  );
}
