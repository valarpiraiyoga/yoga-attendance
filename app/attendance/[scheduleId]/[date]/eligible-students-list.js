"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Eligible Students tab content (approved wireframe: STUDENT / PHONE /
 * BATCH ENROLLMENT / MEMBERSHIP / STATUS / ACTION). `students` is already
 * the fully-resolved eligible list for this session's batch and date
 * (lib/attendance/data.js's `listEligibleStudents`, itself backed by
 * `resolve_eligible_students` — the single source of eligibility); this
 * component only paginates and displays it, it does not filter or
 * re-derive who is eligible.
 *
 * Client-side pagination (approved decision, no URL page param): every
 * eligible student is already loaded, so paging is a local `slice()`, not
 * a new fetch. `batch` is constant across every row — every student here
 * is eligible specifically because they are actively enrolled in *this*
 * session's own batch, so BATCH ENROLLMENT never varies row to row.
 */
export default function EligibleStudentsList({ students, batch }) {
  const [page, setPage] = useState(1);

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          No students are eligible for this session. Eligibility requires an active enrollment in this
          batch and an active membership covering this session&rsquo;s date.
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
      <p className="text-body mb-4 text-text-secondary">
        {students.length} student{students.length === 1 ? "" : "s"} eligible for this session.
      </p>

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <Table aria-label="Eligible Students">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Batch Enrollment</TableHead>
              <TableHead>Membership</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageStudents.map((student) => (
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
                <TableCell className="text-text-secondary">
                  {batch?.name ?? "—"} {batch?.code ? `(${batch.code})` : ""}
                  <span className="block text-small">(Active)</span>
                </TableCell>
                <TableCell className="text-text-secondary">
                  Active
                  {student.membership ? (
                    <span className="block text-small">
                      ({formatDate(student.membership.start_date)} – {formatDate(student.membership.end_date)})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="success">Eligible</Badge>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/students/${student.id}`}
                    className="text-body font-medium text-brand hover:underline"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body text-text-secondary">
          Showing {rangeStart}–{rangeEnd} of {students.length} eligible students
        </p>

        <nav aria-label="Eligible Students pagination" className="flex flex-wrap items-center gap-2">
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
