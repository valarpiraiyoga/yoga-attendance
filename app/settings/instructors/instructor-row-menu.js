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
 * Instructor row overflow — the two actions the table always had, now in the
 * finalized menu: Edit Instructor (the existing edit route) and
 * Activate / Deactivate (the existing quick status action, invoked by the
 * list). Mirrors `StudentCardMenu` / `BatchCardMenu`.
 */
export default function InstructorRowMenu({
  instructorId,
  instructorName,
  isActive,
  isUpdating,
  disabled,
  onToggleStatus,
  onOpenChange,
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`Instructor actions for ${instructorName}`}
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={`/settings/instructors/${instructorId}/edit`} />} nativeButton={false}>
          Edit Instructor
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={onToggleStatus}>
          {isUpdating ? "Updating…" : isActive ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
