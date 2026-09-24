"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { deactivateSchedule } from "@/lib/schedules/actions";

/**
 * Deactivate Schedule (02-ux.md Flow 05: "Deactivate → Set Effective Until
 * / End Date → Review Change → Confirm → Save → Schedule Inactive").
 *
 * Unlike Deactivate Student / Cancel Membership, this Review step needs one
 * more piece of input first — the effective until date that closes the
 * schedule — so the date is chosen before the dialog opens (defaulting to
 * today, still editable) and the dialog reviews that chosen value rather
 * than needing a form of its own. `deactivateSchedule` is still called
 * directly via `useTransition`, matching the same direct-action-call
 * pattern as every other quick status action in this project.
 */
export default function DeactivateSchedule({ scheduleId, isActive, today }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [effectiveUntil, setEffectiveUntil] = useState(today);
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();

  if (!isActive) {
    return null;
  }

  function runDeactivate() {
    startTransition(async () => {
      const result = await deactivateSchedule(scheduleId, effectiveUntil);
      if (result?.error) {
        setFeedback({ type: "error", text: result.error });
      }
      setConfirmOpen(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)} disabled={isPending}>
        Deactivate Schedule
      </Button>

      {feedback ? (
        <p role="status" className="text-small text-danger">
          {feedback.text}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate schedule"
        description="This does not delete the schedule — it closes it from the date below and marks it inactive. Historical sessions and attendance remain available."
        confirmLabel="Deactivate"
        destructive
        isPending={isPending}
        onConfirm={runDeactivate}
      >
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-4">
          <Label htmlFor="deactivate-effective-until">Effective Until</Label>
          <Input
            id="deactivate-effective-until"
            type="date"
            value={effectiveUntil}
            onChange={(event) => setEffectiveUntil(event.target.value)}
            disabled={isPending}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
