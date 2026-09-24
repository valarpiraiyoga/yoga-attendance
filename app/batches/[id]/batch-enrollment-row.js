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
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";

/**
 * One row of Batch Details' Students tab: the enrollment's student (avatar,
 * name, code — the same identity pattern the Overview tab's student list
 * uses), phone, status and currently-active schedule assignments, with the
 * finalized action pair — eye icon (View Student) + overflow menu (View
 * Student, Edit Enrollment). Both destinations are existing routes.
 *
 * Phone drops below `sm` — the same column-hiding technique the Attendance
 * panel's student table already uses — so Student / Status / Assigned
 * Schedules / Action stay on screen without a cramped desktop table.
 */
export default function BatchEnrollmentRow({ enrollment, activeAssignments }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;
  const scheduleCount = activeAssignments.length;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} src={student?.photo_url} />
          <div className="min-w-0">
            <p className="truncate font-medium text-text-primary">{name}</p>
            <p className="truncate text-small text-text-secondary">{student?.student_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-text-secondary sm:table-cell">
        {student?.phone ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant={enrollment.status === "active" ? "success" : "danger"}>
          {enrollment.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>
        {scheduleCount === 0 ? (
          <span className="font-medium text-danger">No schedule assigned</span>
        ) : (
          <div>
            {/* Count first, as a quiet badge, so a roster of several schedules is a glance, not a read. */}
            <Badge variant="neutral">
              {scheduleCount} {scheduleCount === 1 ? "schedule" : "schedules"}
            </Badge>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {activeAssignments.map((assignment) => (
                <li key={assignment.id} className="text-small whitespace-nowrap">
                  {assignment.schedule ? (
                    <>
                      <span className="font-medium text-text-primary">
                        {(DAY_LABELS[assignment.schedule.day_of_week] ?? assignment.schedule.day_of_week).slice(0, 3)}
                      </span>
                      <span className="text-text-secondary">
                        {" · "}
                        {formatTimeRange(assignment.schedule.start_time, assignment.schedule.end_time)}
                      </span>
                    </>
                  ) : (
                    <span className="text-danger">Assigned schedule could not be found</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </TableCell>
      <TableCell className="w-px px-3 whitespace-nowrap sm:px-4">
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
