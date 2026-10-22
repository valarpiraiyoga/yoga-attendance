"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ScheduleContext from "@/app/schedule/schedule-context";
import { activateSchedule } from "@/lib/schedules/actions";

/**
 * Activate Schedule (V1; 01-product.md §7 "Activation"): the explicit way to bring an INACTIVE schedule back - never a side effect of editing
 * its dates. The Admin confirms a new Effective From, which defaults to today on the centre's own clock (`today` comes from the page, read
 * with `getCentreToday`) and can be changed before confirming. Nothing is saved until Activate is confirmed; cancelling or closing the dialog
 * changes nothing and puts the date back to today.
 *
 * The inactive schedule is history and is not reused: a new version of the same class starts on the chosen date (`activateSchedule`). A
 * refusal - the date, or an instructor conflict - is shown inside the dialog, which stays open so the date can be changed.
 * On success the action redirects to the new version's Schedule Details.
 */
export default function ActivateSchedule({ scheduleId, isInactive, today, scheduleContext }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();

  if (!isInactive) {
    return null;
  }

  function handleOpenChange(open) {
    setConfirmOpen(open);
    if (!open) {
      setEffectiveFrom(today);
      setError(null);
    }
  }

  function runActivate() {
    startTransition(async () => {
      const result = await activateSchedule(scheduleId, effectiveFrom);
      // A success redirects; only a refusal comes back here, and the dialog stays open so the date can be changed.
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setConfirmOpen(true)} disabled={isPending}>
        Activate Schedule
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleOpenChange}
        title="Activate schedule"
        context={<ScheduleContext context={scheduleContext} />}
        description="This schedule is inactive. Activating starts the same class again from the date below, with no end date. Its earlier dates, past sessions and attendance are not changed."
        confirmLabel="Activate"
        isPending={isPending}
        onConfirm={runActivate}
      >
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-4">
          <Label htmlFor="activate-effective-from">Effective From</Label>
          <Input
            id="activate-effective-from"
            type="date"
            value={effectiveFrom}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
              setError(null);
            }}
            disabled={isPending}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "activate-effective-from-error" : undefined}
          />
          {error ? (
            <p id="activate-effective-from-error" role="alert" className="text-small text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
