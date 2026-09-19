"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Schedule card / row overflow — links only to routes that already exist
 * (Schedule Details, Edit Schedule, and the schedule's Batch). Deactivation
 * stays on Schedule Details, behind its own review step. Mirrors
 * `BatchCardMenu`.
 */
export default function ScheduleCardMenu({ scheduleId, batchId, batchName, onOpenChange }) {
  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
