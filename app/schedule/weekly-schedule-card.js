"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import BatchAvatar from "@/components/ui/batch-avatar";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { getBatchColor } from "@/lib/batches/identity";
import { cn } from "@/lib/utils";

/**
 * One Weekly Schedule event: a compact avatar + batch code inside its
 * absolutely-positioned time slot. `style` (top/height/left/width) is
 * computed entirely by the parent grid (WeeklySchedule) from the schedule's
 * real start/end time — this component only renders what goes inside that
 * box, never touches where or how tall it is.
 *
 * Batch Identity: the card's tint and left edge are the batch's colour
 * (`getBatchColor`), and a batch with an image shows it, small, in the avatar
 * spot in place of the instructor's photo (the instructor is still named in the
 * popup and the card's accessible name). The code stays the identifier; colour
 * is only the accent. Position and size are never touched.
 *
 * The card no longer has room to show the time range or the instructor's
 * name, so activating it (click, or Enter/Space as a real `<button>`) opens
 * a small read-only popup with those details — reusing the same info-dialog
 * shape already used elsewhere in this app for a plain "here's more detail,
 * Close" disclosure (e.g. Delete Schedule's "couldn't check this schedule"
 * state), rather than introducing a new popover component.
 *
 * Below `sm` the card has a little more to say: a second line with the short
 * time range (`shortTimeParts`, "6:30–7:30 AM") under the avatar and code,
 * since a phone has no room for the popup to be the only place the time lives.
 * The range is never truncated: in a narrow (overlapping) card it wraps between
 * the numbers and the period instead, and a session too short to hold the
 * second line (`showShortTime` false) shows only its code. From `sm` up it is
 * exactly the single avatar-and-code row it always was.
 */
export default function WeeklyScheduleCard({ schedule, style, dayLabel, timeRange, shortTimeParts, showShortTime, instructor }) {
  const [open, setOpen] = useState(false);
  const code = schedule.batches?.code ?? "—";
  const batchName = schedule.batches?.name ?? code;
  const photoUrl = schedule.instructors?.photo_url ?? null;
  const color = getBatchColor(schedule.batches?.batch_color);
  const batchImage = schedule.batches?.batch_image_url ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute flex flex-col justify-center overflow-hidden rounded-md border border-l-4 px-1.5 py-1 text-left text-small outline-none sm:flex-row sm:items-center sm:justify-start transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          color.border,
          color.edge,
          color.wash
        )}
        style={style}
        aria-label={`${batchName}, ${dayLabel} ${timeRange}, ${instructor}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {batchImage ? (
            <BatchAvatar batch={schedule.batches} className="size-4 rounded-sm" />
          ) : (
            <Avatar name={instructor} src={photoUrl} className="size-4 shrink-0" />
          )}
          <span className="truncate font-semibold text-text-primary">{code}</span>
        </span>
        {showShortTime && shortTimeParts?.length ? (
          <span className="mt-0.5 min-w-0 text-small leading-tight text-text-secondary sm:hidden">
            {shortTimeParts.map((part, index) => (
              <span key={index} className="whitespace-nowrap">
                {index > 0 && !shortTimeParts[index - 1].endsWith("–") ? " " : ""}
                {part}
              </span>
            ))}
          </span>
        ) : null}
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
