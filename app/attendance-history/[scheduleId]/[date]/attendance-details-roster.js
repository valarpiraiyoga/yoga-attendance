"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * Attendance Details roster — scannable list rows with semantic Present /
 * Absent / Unmarked states (same visual language as Attendance marking).
 */
export default function AttendanceDetailsRoster({ students, marksByStudentId }) {
  const [page, setPage] = useState(1);

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-6 py-16 text-center">
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
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border" aria-label="Attendance">
        {pageStudents.map((student) => {
          const status = marksByStudentId[student.id];
          const rowTone =
            status === "present"
              ? "bg-success/5"
              : status === "absent"
                ? "bg-danger/5"
                : "bg-surface";

          return (
            <li
              key={student.id}
              className={cn(
                "flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                rowTone
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand"
                >
                  {getInitials(student.full_name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-text-primary">{student.full_name}</p>
                  <p className="text-small truncate text-text-secondary">
                    {student.student_code}
                    {student.phone ? ` · ${student.phone}` : ""}
                  </p>
                </div>
              </div>
              <Badge
                variant={status === "present" ? "success" : status === "absent" ? "danger" : "neutral"}
                className="w-fit rounded-full px-2.5 py-0.5"
              >
                <span className="text-[11px] leading-[14px] font-medium">
                  {status === "present" ? "Present" : status === "absent" ? "Absent" : "Unmarked"}
                </span>
              </Badge>
            </li>
          );
        })}
      </ul>

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
