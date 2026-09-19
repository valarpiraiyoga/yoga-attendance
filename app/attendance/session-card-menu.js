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
 * Session card / row overflow — links only to Session Details, the one
 * destination both roles can open. The primary action (Take Attendance /
 * View Attendance / View Session) and Session Details' Overview are the two
 * targets; Batch and Schedule pages are admin-only, so they are not offered
 * here to instructors. Mirrors `BatchCardMenu`.
 */
export default function SessionCardMenu({ batchName, actionLabel, actionHref, detailsHref, onOpenChange }) {
  return (
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
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={actionHref} />} nativeButton={false}>
          {actionLabel}
        </DropdownMenuItem>
        {actionLabel !== "View Session" ? (
          <DropdownMenuItem render={<Link href={detailsHref} />} nativeButton={false}>
            View Session Details
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
