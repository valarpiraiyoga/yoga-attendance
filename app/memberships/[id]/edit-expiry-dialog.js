"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import StudentContext from "@/components/ui/student-context";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { editClassCountExpiry } from "@/lib/class-count-attendance/actions";
import { validateExpiryEdit } from "@/lib/class-count-attendance/expiry-core";
import { REASON_MAX, trimReason } from "@/lib/class-count-attendance/record-core";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";

/**
 * Edit expiry of a class-count membership (02-ux.md "Membership Details"): a new expiry date or No expiry, and a required
 * reason of 3 to 500 characters once trimmed. It extends, shortens or switches the expiry through the database function
 * (`edit_class_count_expiry`, migration 0049) - never by updating the membership - and changes nothing else: not the fee, the
 * class allowance, any attendance record or reversal. Records dated after a shortened expiry are kept and flagged.
 *
 * The same shape as Reverse for a class: confirm is refused until the fields are valid and is disabled while the call is in
 * flight; the database checks everything again.
 *
 * @param {{ membershipId: string, currentExpiry: string|null, startDate: string,
 *   student: object|null, membership: { code: string, planLabel: string, period: string } }} props
 */
export default function EditExpiryDialog({ membershipId, currentExpiry, startDate, student, membership }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("date");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const length = trimReason(reason).length;

  function openDialog() {
    // With an expiry now, start from it (to move the date); with No expiry, start from choosing a date.
    setMode("date");
    setDate(currentExpiry ?? "");
    setReason("");
    setErrors({});
    setSubmitError(null);
    setOpen(true);
  }

  function confirm() {
    if (isPending) return;
    const result = validateExpiryEdit({ mode, date, reason, currentExpiry, startDate });
    if (!result.success) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);

    startTransition(async () => {
      try {
        const saved = await editClassCountExpiry(membershipId, result.data.newExpiry, result.data.reason);
        if (saved?.error) setSubmitError(saved.error);
        else setOpen(false);
      } catch {
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
        <CalendarClock className="size-4" aria-hidden="true" />
        Edit expiry
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!isPending) setOpen(next);
        }}
        title="Edit expiry"
        description="Extend or shorten the expiry, or switch to No expiry. The classes already recorded are kept; the fee and the class allowance do not change."
        context={<StudentContext student={student} membership={membership} />}
        confirmLabel="Save expiry"
        pendingLabel="Saving…"
        isPending={isPending}
        onConfirm={confirm}
      >
        <p className="text-body text-text-secondary">
          Current expiry: <span className="font-medium text-text-primary">{currentExpiry ? formatDate(currentExpiry) : NO_EXPIRY_LABEL}</span>
        </p>

        <fieldset className="flex flex-col gap-3" disabled={isPending}>
          <legend className="text-body font-medium text-text-primary">New expiry</legend>
          <label htmlFor="expiry-mode-date" className="text-body flex items-center gap-2 text-text-primary">
            <input id="expiry-mode-date" type="radio" name="expiry-mode" className="size-4 accent-brand" checked={mode === "date"} onChange={() => setMode("date")} />
            Expires on a date
          </label>
          <label htmlFor="expiry-mode-none" className="text-body flex items-center gap-2 text-text-primary">
            <input id="expiry-mode-none" type="radio" name="expiry-mode" className="size-4 accent-brand" checked={mode === "none"} onChange={() => setMode("none")} />
            No expiry
          </label>
        </fieldset>

        {mode === "date" ? (
          <FormField id="expiry-date" label="Expiry date" required error={errors.expiry}>
            {(field) => (
              <Input {...field} type="date" min={startDate} disabled={isPending} value={date} onChange={(event) => setDate(event.target.value)} />
            )}
          </FormField>
        ) : errors.expiry ? (
          <p role="alert" className="text-small text-danger">
            {errors.expiry}
          </p>
        ) : null}

        <FormField
          id="expiry-reason"
          label="Reason"
          required
          error={submitError ?? errors.reason}
          help={`${length} of ${REASON_MAX} characters, at least 3. Kept in the expiry history.`}
        >
          {(field) => (
            <Textarea
              {...field}
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
