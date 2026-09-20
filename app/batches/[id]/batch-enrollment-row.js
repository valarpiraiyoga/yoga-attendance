"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";

/**
 * One row of Batch Details' Students tab: the enrollment's student, phone,
 * status and currently-active schedule assignments, with the finalized action
 * pair — eye icon (View Student) + overflow menu (View Student, Edit
 * Enrollment). Both destinations are existing routes. Cells stay on one line
 * so the table scrolls inside its container instead of wrapping at narrow
 * widths.
 */
export default function BatchEnrollmentRow({ enrollment, activeAssignments }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="whitespace-nowrap">
        <p className="font-medium text-text-primary">{name}</p>
        <p className="text-small text-text-secondary">{student?.student_code}</p>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{student?.phone ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={enrollment.status === "active" ? "success" : "danger"}>
          {enrollment.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">
        {activeAssignments.length === 0 ? (
          <span className="font-medium text-danger">No schedule assigned</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {activeAssignments.map((assignment) => (
              <li key={assignment.id}>
                {assignment.schedule ? (
                  <>
                    {DAY_LABELS[assignment.schedule.day_of_week] ?? assignment.schedule.day_of_week}
                    {" · "}
                    {formatTimeRange(assignment.schedule.start_time, assignment.schedule.end_time)}
                  </>
                ) : (
                  <span className="text-danger">Assigned schedule could not be found</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        {studentHref ? (
          <div className="flex items-center gap-1">
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
                <DropdownMenuItem render={<Link href={studentHref} />} nativeButton={false}>
                  View Student
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={editHref} />} nativeButton={false}>
                  Edit Enrollment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}
