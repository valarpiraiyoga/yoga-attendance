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
 * Batches card / row overflow — links only to routes that already exist
 * (Batch Details, Edit, and the batch's Students and Schedules tabs).
 * Status changes stay on Edit Batch. Mirrors `StudentCardMenu` /
 * `MembershipCardMenu`.
 */
export default function BatchCardMenu({ batchId, batchName, onOpenChange }) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`Batch actions for ${batchName}`}
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={`/batches/${batchId}`} />} nativeButton={false}>
          View Batch
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/batches/${batchId}/edit`} />} nativeButton={false}>
          Edit Batch
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href={`/batches/${batchId}/students`} />} nativeButton={false}>
          View Students
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/batches/${batchId}/schedules`} />} nativeButton={false}>
          View Schedule
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
