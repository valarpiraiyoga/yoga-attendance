"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Attendance History card overflow — links only to routes that already exist
 * and that both roles may open: the session's attendance details and its
 * Edit Attendance flow (Flow 08, which starts with Review Changes). Mirrors
 * `SessionCardMenu` / `BatchCardMenu`.
 */
export default function HistoryCardMenu({ batchName, detailsHref, onOpenChange }) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`Attendance record actions for ${batchName}`}
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={detailsHref} />} nativeButton={false}>
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`${detailsHref}/edit`} />} nativeButton={false}>
          Edit Attendance
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
