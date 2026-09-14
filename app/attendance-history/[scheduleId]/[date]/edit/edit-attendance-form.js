"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { validateAttendanceMarks } from "@/lib/attendance/validation";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function pendingReviewStorageKey(scheduleId, date) {
  return `attendance-history:pending-review:${scheduleId}:${date}`;
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function marksToMap(marks) {
  const map = {};
  for (const mark of marks) {
    map[mark.student_id] = mark.status;
  }
  return map;
}

/**
 * Edit Attendance roster — Present/Absent controls match Attendance marking
 * screen. Nothing is saved here; Review Changes hands off via sessionStorage.
 */
export default function EditAttendanceForm({ scheduleId, date, students, initialMarks }) {
  const router = useRouter();
  const [marks, setMarks] = useState(() => marksToMap(initialMarks ?? []));
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);

  function setMark(studentId, status) {
    setError(null);
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  }

  function handleReviewChanges() {
    const payload = Object.entries(marks).map(([student_id, status]) => ({ student_id, status }));
    const result = validateAttendanceMarks(payload);

    if (!result.success) {
      setError(result.error);
      return;
    }

    try {
      window.sessionStorage.setItem(
        pendingReviewStorageKey(scheduleId, date),
        JSON.stringify({ marks: result.data })
      );
    } catch {
      // Private browsing / storage disabled — still navigate; Review handles missing draft.
    }

    router.push(`/attendance-history/${scheduleId}/${date}/review`);
  }

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-background/40 px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          No students were eligible for this session.
        </p>
        <Button variant="outline" render={<Link href={`/attendance-history/${scheduleId}/${date}`} />} nativeButton={false}>
          Cancel
        </Button>
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
      {error ? (
        <p role="alert" className="mb-4 rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border" aria-label="Edit Attendance">
        {pageStudents.map((student) => {
          const status = marks[student.id];
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
                "flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
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

              <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex w-full gap-2 sm:w-auto">
                <Button
                  type="button"
                  size="sm"
                  aria-pressed={status === "present"}
                  onClick={() => setMark(student.id, "present")}
                  variant="outline"
                  className={cn(
                    "h-10 flex-1 sm:min-w-24 sm:flex-none",
                    status === "present"
                      ? "border-success bg-success text-surface hover:bg-success/90 hover:text-surface"
                      : "border-border bg-surface text-text-secondary hover:border-success/40 hover:text-success"
                  )}
                >
                  Present
                </Button>
                <Button
                  type="button"
                  size="sm"
                  aria-pressed={status === "absent"}
                  onClick={() => setMark(student.id, "absent")}
                  variant="outline"
                  className={cn(
                    "h-10 flex-1 sm:min-w-24 sm:flex-none",
                    status === "absent"
                      ? "border-danger bg-danger text-surface hover:bg-danger/90 hover:text-surface"
                      : "border-border bg-surface text-text-secondary hover:border-danger/40 hover:text-danger"
                  )}
                >
                  Absent
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-text-secondary">
          Showing {rangeStart}–{rangeEnd} of {students.length} entries
        </p>

        <nav aria-label="Edit Attendance pagination" className="flex flex-wrap items-center gap-2">
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

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <Button variant="outline" render={<Link href={`/attendance-history/${scheduleId}/${date}`} />} nativeButton={false}>
          Cancel
        </Button>
        <Button type="button" onClick={handleReviewChanges}>
          Review Changes
        </Button>
      </div>
    </div>
  );
}
