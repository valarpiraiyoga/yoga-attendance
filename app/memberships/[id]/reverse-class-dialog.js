"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import StudentContext from "@/components/ui/student-context";
import { Textarea } from "@/components/ui/textarea";
import { reverseClassCount } from "@/lib/class-count-attendance/actions";
import { REASON_MAX, reasonError, remainingText, trimReason } from "@/lib/class-count-attendance/record-core";
import { showSuccessToast } from "@/components/ui/success-toast";

/**
 * Reverse for one recorded class (02-ux.md "Class Attendance panel"): a confirmation that names the record - its date, who
 * recorded it and when - and asks for a **reason**, required, 3 to 500 characters once trimmed. The record is never
 * edited or deleted; the database adds a reversal and the class counts again. Confirm is refused until the reason is
 * valid and is disabled while the call is in flight. The request ID is created when the dialog opens and kept until the
 * call has been answered, so a retry never reverses twice.
 *
 * `record` carries the text to show, already formatted by the panel: `{ id, dateLabel, recordedBy, recordedAt }`.
 * `student` and `membership` fill the context card (`StudentContext`). `remaining` is the membership's classes left now (net), so the dialog can say what it will be afterwards.
 */
export default function ReverseClassDialog({ record, remaining, student, membership }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(null);

  const invalid = reasonError(reason);
  const length = trimReason(reason).length;

  function openDialog() {
    setReason("");
    setTouched(false);
    setSubmitError(null);
    requestIdRef.current = crypto.randomUUID();
    setOpen(true);
  }

  function confirm() {
    if (isPending) return;
    setTouched(true);
    if (invalid) return;
    requestIdRef.current ??= crypto.randomUUID();
    const requestId = requestIdRef.current;
    setSubmitError(null);

    startTransition(async () => {
      try {
        const result = await reverseClassCount(record.id, reason, requestId);
        requestIdRef.current = null;
        if (result?.error) {
          setSubmitError(result.error);
        } else {
          setOpen(false);
          showSuccessToast("Class reversed successfully.");
        }
      } catch {
        // Not answered: keep the request ID, so trying again repeats this reversal rather than making another.
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        aria-label={`Reverse the class recorded for ${record.dateLabel}`}
      >
        Reverse
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!isPending) setOpen(next);
        }}
        title="Reverse class"
        description="The record stays in the history, marked Reversed, and the class counts again."
        context={<StudentContext student={student} membership={membership} />}
        confirmLabel="Reverse class"
        pendingLabel="Reversing…"
        destructive
        isPending={isPending}
        onConfirm={confirm}
      >
        <dl className="grid grid-cols-1 gap-3 rounded-card border border-border bg-muted px-3 py-2.5 text-small sm:grid-cols-3">
          <div>
            <dt className="text-text-secondary">Attendance date</dt>
            <dd className="font-medium text-text-primary">{record.dateLabel}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Recorded by</dt>
            <dd className="font-medium text-text-primary">{record.recordedBy ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Recorded at</dt>
            <dd className="font-medium text-text-primary">{record.recordedAt}</dd>
          </div>
        </dl>

        <FormField
          id={`reverse-reason-${record.id}`}
          label="Reason"
          required
          error={submitError ?? (touched ? invalid : null)}
          help={`${length} of ${REASON_MAX} characters, at least 3. After reversing: ${remainingText(remaining + 1)}.`}
        >
          {(field) => (
            <Textarea
              {...field}
              required
              rows={3}
              disabled={isPending}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setSubmitError(null);
              }}
            />
          )}
        </FormField>
      </ConfirmDialog>
    </>
  );
}
