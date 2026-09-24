"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * One row of Batch Overview's Students list: the enrolled student (avatar,
 * name, code · phone), status, and the finalized action pair — eye icon
 * (View Student) + overflow menu (View Student, Edit Enrollment). Both
 * destinations are existing routes.
 *
 * A flat `<li>` in a `divide-y` list, not a table row — the same row-list
 * shape Student Details' Batch Enrollments / Current Membership panels use
 * for a secondary, narrower column, so it stays readable without a cramped
 * multi-column table.
 */
export default function BatchStudentRow({ enrollment }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const status = ENTITY_STATUS[student?.status] ?? ENTITY_STATUS.inactive;
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;
  const meta = [student?.student_code, student?.phone].filter(Boolean).join(" · ");

  return (
    <li className={cn("flex items-center gap-3 py-3 first:pt-0 last:pb-0", menuOpen && "bg-brand/5")}>
      <Avatar name={name} src={student?.photo_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-semibold text-text-primary">{name}</p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {meta ? <p className="text-small truncate text-text-secondary">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {studentHref ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View student ${name}`}
            render={<Link href={studentHref} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                aria-label={`Student actions for ${name}`}
              />
            }
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {studentHref ? (
              <DropdownMenuItem render={<Link href={studentHref} />} nativeButton={false}>
                View Student
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem render={<Link href={editHref} />} nativeButton={false}>
              Edit Enrollment
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
