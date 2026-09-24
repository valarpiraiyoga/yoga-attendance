"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";

/**
 * One Weekly Schedule event: a compact avatar + batch code inside its
 * absolutely-positioned time slot. `style` (top/height/left/width) is
 * computed entirely by the parent grid (WeeklySchedule) from the schedule's
 * real start/end time — this component only renders what goes inside that
 * box, never touches where or how tall it is.
 *
 * The card no longer has room to show the time range or the instructor's
 * name, so activating it (click, or Enter/Space as a real `<button>`) opens
 * a small read-only popup with those details — reusing the same info-dialog
 * shape already used elsewhere in this app for a plain "here's more detail,
 * Close" disclosure (e.g. Delete Schedule's "couldn't check this schedule"
 * state), rather than introducing a new popover component.
 */
export default function WeeklyScheduleCard({ schedule, style, dayLabel, timeRange, instructor }) {
  const [open, setOpen] = useState(false);
  const code = schedule.batches?.code ?? "—";
  const batchName = schedule.batches?.name ?? code;
  const photoUrl = schedule.instructors?.photo_url ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute flex items-center overflow-hidden rounded-md border border-l-4 border-brand/30 border-l-brand bg-brand/10 px-1.5 py-1 text-left text-small outline-none transition-colors hover:bg-brand/15 focus-visible:ring-3 focus-visible:ring-ring/50"
        style={style}
        aria-label={`${batchName}, ${dayLabel} ${timeRange}, ${instructor}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          <Avatar name={instructor} src={photoUrl} className="size-4 shrink-0" />
          <span className="truncate font-semibold text-text-primary">{code}</span>
        </span>
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="info"
        title={batchName}
        description={`${dayLabel} · ${timeRange}`}
        confirmLabel="Close"
        hideCancel
        onConfirm={() => setOpen(false)}
      >
        <div className="flex items-center justify-center gap-2">
          <Avatar name={instructor} src={photoUrl} size="sm" />
          <span className="text-body text-text-primary">{instructor}</span>
        </div>
        <Button variant="outline" className="w-full" render={<Link href={`/schedule/${schedule.id}`} />} nativeButton={false}>
          View Schedule
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </ConfirmDialog>
    </>
  );
}
