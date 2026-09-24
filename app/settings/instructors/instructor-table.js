"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { ENTITY_STATUS } from "@/lib/status";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import InstructorRowMenu from "@/app/settings/instructors/instructor-row-menu";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the other list-page tables. Narrowest (mobile): Instructor,
// Status, Action. From 36rem: Phone. From 48rem: Email — the whole table.
const PHONE_ONLY = "hidden @[36rem]:table-cell";
const EMAIL_ONLY = "hidden @[48rem]:table-cell";

const HEAD = "h-10 px-2 text-small tracking-normal";

/**
 * One Instructor table row (wireframe p39; `18 Settings instructor.png`):
 * identity (initials / photo avatar + name), Phone, Email, Status, and the
 * finalized action pair — eye icon + overflow menu. Instructors have no
 * separate details screen: the edit page is the one place an instructor's
 * record (and login access) is shown, so the eye opens it, and the menu
 * repeats it as Edit Instructor beside Activate / Deactivate.
 */
function InstructorRow({ instructor, isUpdating, disabled, onToggleStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = ENTITY_STATUS[instructor.status] ?? ENTITY_STATUS.inactive;
  const editHref = `/settings/instructors/${instructor.id}/edit`;

  return (
    <TableRow className={cn((menuOpen || isUpdating) && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={instructor.full_name} src={instructor.photo_url} />
          <p className="min-w-0 text-body font-semibold text-text-primary">{instructor.full_name}</p>
        </div>
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", PHONE_ONLY)}>
        {formatPhone(instructor.phone, instructor.phone_country_code)}
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-text-secondary", EMAIL_ONLY)}>{instructor.email || "\u2014"}</TableCell>
      <TableCell className="px-2 py-3">
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3 pr-3 pl-1 whitespace-nowrap">
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

/**
 * The Instructors table (finalized compact style): see `InstructorRow`.
 * `renderRowProps(instructor)` supplies each row's update state and toggle
 * handler from the list, which owns them.
 */
export default function InstructorTable({ instructors, renderRowProps }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label="Instructors">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Instructor</TableHead>
            <TableHead className={cn(HEAD, PHONE_ONLY)}>Phone</TableHead>
            <TableHead className={cn(HEAD, EMAIL_ONLY)}>Email</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className="h-10 w-px pr-3 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instructors.map((instructor) => (
            <InstructorRow key={instructor.id} instructor={instructor} {...renderRowProps(instructor)} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
