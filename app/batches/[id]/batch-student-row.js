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
import { TableCell, TableRow } from "@/components/ui/table";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * One row of Batch Overview's Students table: the enrolled student (avatar,
 * name, code), phone, status, and the finalized action pair — eye icon
 * (View Student) + overflow menu (View Student, Edit Enrollment). Both
 * destinations are existing routes.
 */
export default function BatchStudentRow({ enrollment }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const status = ENTITY_STATUS[student?.status] ?? ENTITY_STATUS.inactive;
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} src={student?.photo_url} />
          <div className="min-w-0">
            <p className="font-semibold text-text-primary">{name}</p>
            {student?.student_code ? <p className="text-small text-text-secondary">{student.student_code}</p> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{student?.phone || "—"}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
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
      </TableCell>
    </TableRow>
  );
}
