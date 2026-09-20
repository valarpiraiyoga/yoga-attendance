"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const STATUS_BADGE = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
};
const ROW_TONE = { present: "bg-success/5 hover:bg-success/5", absent: "bg-danger/5 hover:bg-danger/5" };

/** The row's overflow menu — links only to routes that already exist: the student and this session's Edit Attendance. */
function RosterRowActions({ student, editHref }) {
  const studentHref = `/students/${student.id}`;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-brand hover:bg-brand/10 hover:text-brand"
        aria-label={`View student ${student.full_name}`}
        render={<Link href={studentHref} />}
        nativeButton={false}
      >
        <Eye className="size-4" aria-hidden="true" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`Attendance actions for ${student.full_name}`}
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
            Edit Attendance
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Attendance Details roster — the recorded Present / Absent / Unmarked state of
 * every student eligible for the session, in the finalized table pattern
 * (shared `Avatar` and `Badge`, one-line cells that scroll inside the panel at
 * narrow widths, Eye + overflow-menu row actions). Data, states and the
 * client-side pagination are unchanged. Attendance stores no per-student note,
 * so there is none to show.
 */
export default function AttendanceDetailsRoster({ students, marksByStudentId, editHref }) {
  const [page, setPage] = useState(1);

  if (students.length === 0) {
    return <EmptyState size="sm" title="No eligible students" description="No students were eligible for this session." />;
  }

  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageStudents = students.slice(start, start + PAGE_SIZE);
  const rangeStart = start + 1;
  const rangeEnd = Math.min(students.length, start + PAGE_SIZE);

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table aria-label="Student attendance">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="whitespace-nowrap">Student</TableHead>
              <TableHead className="whitespace-nowrap">Phone</TableHead>
              <TableHead className="whitespace-nowrap">Attendance</TableHead>
              <TableHead className="whitespace-nowrap">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageStudents.map((student) => {
              const status = marksByStudentId[student.id];
              const badge = STATUS_BADGE[status] ?? { label: "Unmarked", variant: "neutral" };

              return (
                <TableRow key={student.id} className={cn(ROW_TONE[status])}>
                  <TableCell>
                    <div className="flex items-center gap-3 whitespace-nowrap">
                      <Avatar name={student.full_name} />
                      <div>
                        <p className="font-semibold text-text-primary">{student.full_name}</p>
                        <p className="text-small text-text-secondary">{student.student_code}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-text-secondary">{student.phone || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <RosterRowActions student={student} editHref={editHref} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-text-secondary">
          Showing {rangeStart}–{rangeEnd} of {students.length} students
        </p>

        <nav aria-label="Attendance pagination" className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
            <Button
              key={pageNumber}
              type="button"
              variant={pageNumber === currentPage ? "default" : "outline"}
              size="sm"
              aria-current={pageNumber === currentPage ? "page" : undefined}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </nav>
      </div>
    </div>
  );
}
