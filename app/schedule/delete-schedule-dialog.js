"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Alert from "@/components/ui/alert";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ScheduleContext from "@/app/schedule/schedule-context";
import { deleteSchedule, previewScheduleDelete } from "@/lib/schedules/actions";
import {
  dayLabel,
  describeAffectedStudents,
  describeBlockReason,
  describeUnrecordedPastOccurrences,
} from "@/lib/schedules/usage";
import { formatTimeRange } from "@/lib/format";

/**
 * Delete Schedule (01-product.md §7 "Deleting and correcting an unused
 * schedule"). Opens from the schedule action menu and first asks the server
 * what deleting would do (`previewScheduleDelete`), then shows one of:
 *
 *   - clean delete — no sessions, attendance or assignments;
 *   - students affected — unstarted schedule assignments will be withdrawn;
 *   - unrecorded past occurrences — elapsed dates that were never recorded
 *     as sessions and will no longer appear (never claims attendance existed);
 *   - blocked — the schedule has session history, earlier versions, or a
 *     started student assignment: no delete is offered, only a way to
 *     Deactivate it from Schedule Details.
 *
 * The preview is advisory. `deleteSchedule` re-checks under locks in the
 * database, so a session that appeared after this dialog opened turns the
 * dialog into the blocked state instead of deleting.
 */
export default function DeleteScheduleDialog({ scheduleId, scheduleContext, open, onOpenChange }) {
  const router = useRouter();
  const [preview, setPreview] = useState(null);
  const [blockedReason, setBlockedReason] = useState(null);
  const [errorText, setErrorText] = useState(null);
  const [isPending, startTransition] = useTransition();

  // Ask the server each time the dialog opens; forget the answer when it closes.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    previewScheduleDelete(scheduleId).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
      setPreview(null);
      setBlockedReason(null);
      setErrorText(null);
    };
  }, [open, scheduleId]);

  const isChecking = open && preview === null;
  const impact = preview?.impact ?? null;
  const context = <ScheduleContext context={scheduleContext} />;

  function runDelete() {
    setErrorText(null);
    startTransition(async () => {
      const result = await deleteSchedule(scheduleId);
      if (result?.success) {
        onOpenChange(false);
      } else if (result?.blocked) {
        setBlockedReason(result.blockReason);
      } else if (result?.error) {
        setErrorText(result.error);
      }
    });
  }

  function viewSchedule() {
    onOpenChange(false);
    router.push(`/schedule/${scheduleId}`);
  }

  // The server could not be asked (or the schedule is gone).
  if (preview?.error) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        tone="warning"
        title="Couldn't check this schedule"
        context={context}
        description={preview.error}
        confirmLabel="Close"
        hideCancel
        onConfirm={() => onOpenChange(false)}
      />
    );
  }

  // State D — blocked: by what the server said, or by the delete being refused.
  const blockReason = blockedReason ?? impact?.blockReason ?? null;
  if (blockReason) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        tone="warning"
        title="Schedule can't be deleted"
        context={context}
        description={describeBlockReason(blockReason)}
        confirmLabel="View / Deactivate Schedule"
        onConfirm={viewSchedule}
      >
        <p className="text-body text-center text-text-secondary">
          Use Deactivate Schedule to stop future classes. Past sessions and attendance stay available.
        </p>
      </ConfirmDialog>
    );
  }

  // States A–C — deletable (or still being checked).
  const label = impact
    ? `${dayLabel(impact.dayOfWeek)} · ${formatTimeRange(impact.startTime, impact.endTime)}`
    : "Checking this schedule…";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title="Delete Schedule?"
      context={context}
      description={label}
      confirmLabel="Delete Schedule"
      pendingLabel={isChecking ? "Checking…" : "Deleting…"}
      isPending={isChecking || isPending}
      onConfirm={runDelete}
    >
      {impact ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-center text-text-secondary">
            This schedule has no recorded sessions or attendance and can be safely deleted.
          </p>
          {impact.affectedStudentCount > 0 ? (
            <Alert variant="warning" title={describeAffectedStudents(impact.affectedStudentCount)}>
              Deleting it will remove those unstarted schedule assignments.
            </Alert>
          ) : null}
          {impact.unrecordedPastOccurrenceCount > 0 ? (
            <Alert variant="warning">{describeUnrecordedPastOccurrences(impact.unrecordedPastOccurrenceCount)}</Alert>
          ) : null}
          {errorText ? (
            <Alert variant="danger" role="alert">
              {errorText}
            </Alert>
          ) : null}
          <p className="text-body text-center font-medium text-text-primary">This action cannot be undone.</p>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
