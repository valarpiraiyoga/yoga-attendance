"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import InstructorRowMenu from "@/app/settings/instructors/instructor-row-menu";

/**
 * One Instructor table row (wireframe p39; `18 Settings instructor.png`):
 * identity (circular initials avatar + name), Phone, Email, Status, and the
 * finalized action pair — eye icon + overflow menu. Instructors have no
 * separate details screen: the edit page is the one place an instructor's
 * record (and login access) is shown, so the eye opens it, and the menu
 * repeats it as Edit Instructor beside Activate / Deactivate.
 */
export default function InstructorTableRow({ instructor, isUpdating, disabled, onToggleStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = ENTITY_STATUS[instructor.status] ?? ENTITY_STATUS.inactive;
  const editHref = `/settings/instructors/${instructor.id}/edit`;

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        (menuOpen || isUpdating) && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={instructor.full_name} />
          <p className="truncate font-semibold text-text-primary">{instructor.full_name}</p>
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">{instructor.phone || "—"}</TableCell>
      <TableCell className="text-text-secondary">{instructor.email || "—"}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View instructor ${instructor.full_name}`}
            render={<Link href={editHref} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <InstructorRowMenu
            instructorId={instructor.id}
            instructorName={instructor.full_name}
            isActive={instructor.status === "active"}
            isUpdating={isUpdating}
            disabled={disabled}
            onToggleStatus={onToggleStatus}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
