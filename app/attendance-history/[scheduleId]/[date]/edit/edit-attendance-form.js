"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { validateAttendanceMarks } from "@/lib/attendance/validation";

const PAGE_SIZE = 10;

// The sessionStorage key a not-yet-built Review Attendance Changes page
// (wireframe p.33) will read from, namespaced per session so editing two
// different sessions in the same browser tab (e.g. two tabs) never
// collides. Exported so that later page can import the exact same key
// rather than re-deriving it.
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
 * Edit Attendance's roster and Cancel/Review Changes actions (Phase 16;
 * approved wireframe p.32). Read-then-correct, not a fresh Take Attendance
 * form: `initialMarks` is this session's actual saved attendance
 * (`getAttendanceForSession`, fetched by the page), and local state starts
 * from it exactly (`marksToMap`, the same helper
 * `attendance-panel.js`'s own Edit Attendance mode already uses) — a
 * student who was saved Present starts this screen showing Present, not
 * reset to Unmarked. A student who was never marked at all (D10 — saving
 * with some students unmarked is allowed) correctly starts Unmarked here
 * too, because that is what was actually saved; nothing here invents a
 * third state or silently changes a value nobody touched.
 *
 * The Present/Absent controls are the exact same pattern
 * `attendance-panel.js`'s own editing mode already renders (`role="group"`,
 * `aria-pressed`, `default`/`destructive`/`outline` variants) — copied
 * here rather than imported, matching this codebase's established
 * per-component duplication of small, tightly-coupled UI fragments
 * (e.g. `formatTime`/`formatDate` duplicated across every session list).
 *
 * Nothing is saved from this page. "Cancel" is a plain link back to
 * Attendance Details — no state to discard because nothing was ever
 * written. "Review Changes" validates the current marks with the existing
 * `validateAttendanceMarks` (lib/attendance/validation.js) — the same
 * shape check `saveSessionAttendance` itself runs, reused rather than
 * duplicated — then hands the validated marks to the next screen via
 * `sessionStorage`, namespaced per session, and navigates to the planned
 * (not yet built) Review Attendance Changes route. This is a draft
 * handoff only: nothing here touches Supabase, `saveSessionAttendance`, or
 * any persisted attendance row.
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
      // Private browsing / storage disabled: fall through and navigate
      // anyway rather than blocking Review entirely on a browser quirk —
      // the not-yet-built Review page is responsible for handling a
      // missing draft (e.g. by falling back to the saved marks).
    }

    router.push(`/attendance-history/${scheduleId}/${date}/review`);
  }

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
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
        <p role="alert" className="mb-4 text-body text-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <Table aria-label="Edit Attendance">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Attendance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageStudents.map((student) => {
              const status = marks[student.id];
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
                    <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={status === "present" ? "default" : "outline"}
                        aria-pressed={status === "present"}
                        onClick={() => setMark(student.id, "present")}
                      >
                        Present
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={status === "absent" ? "destructive" : "outline"}
                        aria-pressed={status === "absent"}
                        onClick={() => setMark(student.id, "absent")}
                      >
                        Absent
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body text-text-secondary">
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

      <div className="mt-6 flex justify-end gap-3">
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
