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
 * The session's admin-only actions in one overflow (⋮) menu: Edit This Session and
 * Mark Cancelled / Holiday. Both are occasional exceptions, so they stay out of
 * the way of the Present / Absent work; each keeps its own rule for when it is
 * offered (`canEdit`, `canMarkException`, decided by the page) and its own flow.
 *
 * Choosing Mark Cancelled / Holiday opens the same two-step dialog as before.
 * `MarkSession` is mounted with a fresh key on every choice, so the dialog always
 * starts empty, exactly as when its button opened it.
 */
export default function SessionActionsMenu({ scheduleId, date, base, canEdit, canMarkException, sessionContext }) {
  const [markKey, setMarkKey] = useState(0);

  return (
    <div className="flex flex-col items-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="outline" size="icon" aria-label="Session actions" />}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {canEdit ? (
            <DropdownMenuItem render={<Link href={`${base}/edit`} />} nativeButton={false}>
              Edit This Session
            </DropdownMenuItem>
          ) : null}
          {canMarkException ? (
            <DropdownMenuItem onClick={() => setMarkKey((key) => key + 1)}>Mark Cancelled / Holiday</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {markKey > 0 ? <MarkSession key={markKey} scheduleId={scheduleId} date={date} sessionContext={sessionContext} defaultOpen hideTrigger /> : null}
    </div>
  );
}
