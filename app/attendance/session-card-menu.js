"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MarkSession from "@/app/attendance/[scheduleId]/[date]/mark-session";

/**
 * Session card / row overflow: the primary action (Take Attendance / View Attendance /
 * View Session) and Session Details, the two destinations both roles can open; Batch and
 * Schedule pages are admin-only, so they are not offered here to instructors. Mirrors
 * `BatchCardMenu`.
 *
 * An admin also gets Mark Cancelled / Holiday (`canMarkException`, decided by the list: the
 * viewer is an admin and the session's stored status is still scheduled, the same rule as on
 * Session Details). It opens the same two-step dialog; `MarkSession` is mounted with a fresh
 * key on every choice so the dialog always starts empty.
 */
export default function SessionCardMenu({
  batchName,
  actionLabel,
  actionHref,
  detailsHref,
  scheduleId,
  date,
  canMarkException = false,
  sessionContext,
  onOpenChange,
}) {
  const [markKey, setMarkKey] = useState(0);

  return (
    <>
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`Session actions for ${batchName}`}
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem render={<Link href={actionHref} />} nativeButton={false}>
          {actionLabel}
        </DropdownMenuItem>
        {actionLabel !== "View Session" ? (
          <DropdownMenuItem render={<Link href={detailsHref} />} nativeButton={false}>
            View Session Details
          </DropdownMenuItem>
        ) : null}
        {canMarkException ? (
          <DropdownMenuItem onClick={() => setMarkKey((key) => key + 1)}>Mark Cancelled / Holiday</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>

    {markKey > 0 ? <MarkSession key={markKey} scheduleId={scheduleId} date={date} sessionContext={sessionContext} defaultOpen hideTrigger /> : null}
    </>
  );
}
