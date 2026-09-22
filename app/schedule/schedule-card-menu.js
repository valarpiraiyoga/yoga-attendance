"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteScheduleDialog from "@/app/schedule/delete-schedule-dialog";

/**
 * Schedule card / row overflow — View Schedule, Edit Schedule, the schedule's
 * Batch, and Delete Schedule (destructive, below a divider). Deactivation stays
 * on Schedule Details, behind its own review step, as the lifecycle action for
 * a schedule that has been used; Delete opens `DeleteScheduleDialog`, which
 * says whether the schedule can be deleted at all. Mirrors `BatchCardMenu`.
 */
export default function ScheduleCardMenu({ scheduleId, batchId, batchName, onOpenChange }) {
  const [deleteOpen, setDeleteOpen] = useState(false);

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
              aria-label={`Schedule actions for ${batchName}`}
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem render={<Link href={`/schedule/${scheduleId}`} />} nativeButton={false}>
            View Schedule
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={`/schedule/${scheduleId}/edit`} />} nativeButton={false}>
            Edit Schedule
          </DropdownMenuItem>

          {batchId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={`/batches/${batchId}`} />} nativeButton={false}>
                View Batch
              </DropdownMenuItem>
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            Delete Schedule
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteScheduleDialog scheduleId={scheduleId} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
