"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 10;

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Attendance Details' student roster (Phase 16; approved wireframe p.31:
 * STUDENT / PHONE / ATTENDANCE, paginated). Read-only — there is no Edit
 * mode here; correcting a mark is the separate, not-yet-built Edit
 * Attendance route (`/attendance-history/[scheduleId]/[date]/edit`), not
 * an inline toggle on this page.
 *
 * `students` is the session's already-resolved eligible list
 * (`listEligibleStudents`, lib/attendance/data.js) and `marksByStudentId`
 * is that session's already-recorded marks (`getAttendanceForSession`),
 * both fetched once by the page and handed down already joined — this
 * component only displays them, it does not resolve eligibility or
 * attendance itself. A student with no entry in `marksByStudentId` shows
 * "Unmarked" (D10 — saving with some students unmarked is allowed and
 * still completes the session), never a fabricated third status.
 *
 * Client-side pagination over the already-fully-loaded list — the same
 * approved pattern app/attendance/[scheduleId]/[date]/eligible-students-list.js
 * already uses for the same reason: every row is already in memory, so
 * paging is a local `slice()`, not a second fetch.
 */
export default function AttendanceDetailsRoster({ students, marksByStudentId }) {
  const [page, setPage] = useState(1);

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          No students were eligible for this session.
        </p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageStudents = students.slice(start, start + PAGE_SIZE);
  const rangeStart = start + 1;
  const rangeEnd = Math.min(students.length, start + PAGE_SIZE);

  return (
    <div>
      <DataTableShell>
        <Table aria-label="Attendance">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Attendance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageStudents.map((student) => {
              const status = marksByStudentId[student.id];
              return (
                <TableRow key={student.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-small font-medium text-brand"
                      >
                        {getInitials(student.full_name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">{student.full_name}</p>
                        <p className="text-small text-text-secondary">{student.student_code}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-text-secondary">{student.phone}</TableCell>
                  <TableCell>
                    <Badge variant={status === "present" ? "success" : status === "absent" ? "danger" : "neutral"}>
                      {status === "present" ? "Present" : status === "absent" ? "Absent" : "Unmarked"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableShell>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body text-text-secondary">
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
