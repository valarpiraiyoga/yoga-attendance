"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import BatchAvatar from "@/components/ui/batch-avatar";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ScheduleContext, { scheduleContextOf } from "@/app/schedule/schedule-context";
import { getBatchColor } from "@/lib/batches/identity";
import { formatTimeParts } from "@/lib/format";
import { placesDisplay } from "@/lib/schedules/capacity";
import { cn } from "@/lib/utils";

/** "6:00 – 7:00 AM" (the period once when both ends share it): the time the card writes out from `sm` up. */
function cardTimeRange(startTime, endTime) {
  const start = formatTimeParts(startTime);
  const end = formatTimeParts(endTime);
  return start.period === end.period ? `${start.time} – ${end.time} ${end.period}` : `${start.time} ${start.period} – ${end.time} ${end.period}`;
}

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
 * From `sm` up the card is three stacked lines, each in full: the batch code as a small tile, the written time range beneath it, and the instructor's photo beneath that.
 * The instructor's name is not drawn on the card, so activating it (click, or Enter/Space as a real `<button>`) opens
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
  // This class's own places (capacity belongs to the schedule, not the batch): the card only flags Full - the popup has the rest.
  const places = placesDisplay(schedule.places);
  const placesLabel = places.unavailable ? "" : places.isFull ? ", full" : `, places ${places.text}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute flex flex-col justify-center overflow-hidden rounded-md border border-l-4 px-1.5 py-1 text-left text-small outline-none sm:items-start sm:justify-center sm:gap-0.5 sm:px-2 transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          color.border,
          color.edge,
          color.wash
        )}
        style={style}
        aria-label={`${batchName}, ${dayLabel} ${timeRange}, ${instructor}${placesLabel}`}
      >
        <span className="flex min-w-0 max-w-full flex-col items-start gap-0.5 sm:max-w-none">
          {/* The batch's mark (its image, when it has one) and its code, inline on one row. */}
          <span className="flex min-w-0 max-w-full items-center gap-1 sm:gap-1.5">
          {batchImage ? (
            <BatchAvatar batch={schedule.batches} className="size-4 rounded-sm" />
          ) : (
            <Avatar name={instructor} src={photoUrl} className="size-4 shrink-0 sm:hidden" />
          )}
          <span className="truncate font-semibold text-text-primary sm:overflow-visible sm:rounded-md sm:border sm:border-border/60 sm:bg-surface/80 sm:px-1.5 sm:py-px sm:whitespace-nowrap">{code}</span>
          {places.isFull ? (
            <span className="hidden shrink-0 rounded-sm bg-danger/10 px-1 font-semibold text-danger sm:inline" aria-hidden="true">
              Full
            </span>
          ) : null}
          </span>
          <span className="text-small font-medium whitespace-nowrap text-text-primary max-sm:hidden">{cardTimeRange(schedule.start_time, schedule.end_time)}</span>
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
        {/* From sm up: the instructor's photo under the code and time (the name is in the popup and the card's accessible name). */}
        <Avatar name={instructor} src={photoUrl} className="size-5 shrink-0 max-sm:hidden" />
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="info"
        title="Schedule details"
        context={<ScheduleContext context={scheduleContextOf(schedule)} />}
        confirmLabel="Close"
        hideCancel
        onConfirm={() => setOpen(false)}
      >
        <Button variant="secondary" className="w-full" render={<Link href={`/schedule/${schedule.id}`} />} nativeButton={false}>
          View Schedule
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </ConfirmDialog>
    </>
  );
}
