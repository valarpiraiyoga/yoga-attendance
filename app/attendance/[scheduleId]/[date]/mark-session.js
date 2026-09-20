"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { markSessionException } from "@/lib/class-sessions/actions";
import { validateSessionNote } from "@/lib/class-sessions/validation";

const STATUS_OPTIONS = [
  { value: "cancelled", label: "Cancelled" },
  { value: "holiday", label: "Holiday" },
];

const STATUS_LABELS = {
  cancelled: "Cancelled",
  holiday: "Holiday",
};

/**
 * Mark Cancelled / Holiday (02-ux.md Flow 07 — "Admin: Cancel / Holiday").
 * One entry point, two dialog stages, matching the flow's own diagram
 * ("Mark Session → Cancelled / Holiday → Optional Note → Review Change →
 * Confirm → Save"):
 *
 * 1. **Compose** — choose Cancelled or Holiday and an optional note.
 *    Opening this, and typing into it, writes nothing.
 * 2. **Review** — the chosen status and note, plus the three required
 *    disclosures, with Confirm actually calling `markSessionException`
 *    (wrapped in `useTransition`, matching
 *    app/schedule/[id]/deactivate-schedule.js exactly). Only this step can
 *    write anything.
 *
 * `destructive` styling (`ConfirmDialog`) applies only to the Review step,
 * and only when Cancelled is chosen — Holiday is a planned closure, not a
 * loss, so it keeps standard styling (approved Phase 14 decision).
 */
export default function MarkSession({ scheduleId, date }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [statusError, setStatusError] = useState(null);
  const [noteError, setNoteError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();

  function openCompose() {
    setStatus("");
    setNote("");
    setStatusError(null);
    setNoteError(null);
    setFeedback(null);
    setComposeOpen(true);
  }

  function openReview() {
    if (!status) {
      setStatusError("Choose Cancelled or Holiday.");
      return;
    }

    const noteResult = validateSessionNote(note);
    if (!noteResult.success) {
      setNoteError(noteResult.errors.note);
      return;
    }

    setComposeOpen(false);
    setReviewOpen(true);
  }

  function runMarkSession() {
    startTransition(async () => {
      const result = await markSessionException(scheduleId, date, status, note);
      if (result?.error) {
        setFeedback({ text: result.error });
        return;
      }
      setReviewOpen(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" onClick={openCompose} disabled={isPending}>
        Mark Cancelled / Holiday
      </Button>

      {feedback ? (
        <p role="alert" className="text-small text-danger">
          {feedback.text}
        </p>
      ) : null}

      <ConfirmDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        title="Mark session"
        description="This session did not run, or the centre was closed. Choose which, and add an optional note."
        confirmLabel="Review Change"
        onConfirm={openReview}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span id="mark-session-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
              Status
            </span>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setStatusError(null);
              }}
            >
              <SelectTrigger aria-labelledby="mark-session-status-label" aria-invalid={Boolean(statusError)}>
                <SelectValue placeholder="Select Cancelled or Holiday…" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {statusError ? (
              <p role="alert" className="text-small text-danger">
                {statusError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="mark-session-note">Note</Label>
            <Textarea
              id="mark-session-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteError(null);
              }}
              placeholder="Optional — reason for cancelling or marking holiday"
              aria-invalid={Boolean(noteError)}
              aria-describedby={noteError ? "mark-session-note-error" : undefined}
            />
            {noteError ? (
              <p id="mark-session-note-error" role="alert" className="text-small text-danger">
                {noteError}
              </p>
            ) : null}
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={status === "cancelled" ? "Review cancellation" : "Review holiday"}
        description="This change applies only to this session. The recurring schedule remains unchanged and other occurrences are unaffected. This cannot be reversed."
        confirmLabel={status === "cancelled" ? "Confirm Cancellation" : "Confirm Holiday"}
        destructive={status === "cancelled"}
        isPending={isPending}
        onConfirm={runMarkSession}
      >
        <dl className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4">
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Status</dt>
            <dd className="text-body font-medium text-text-primary">{STATUS_LABELS[status] ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Note</dt>
            <dd className="text-body font-medium text-text-primary">{note.trim() || "No note"}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  );
}
