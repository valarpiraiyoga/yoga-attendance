"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Users } from "lucide-react";
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
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 10;

/**
 * Session Details → Eligible Students. Same data, columns and client-side
 * pagination as before, in the finalized `Panel` + table pattern: shared
 * `Avatar` and `Badge`, one-line cells that scroll inside the panel at narrow
 * widths, and the eye icon (View Student) for the row action — the student's
 * page is the only destination, so there is no overflow menu to add.
 */
export default function EligibleStudentsList({ students, batch }) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageStudents = students.slice(start, start + PAGE_SIZE);
  const rangeStart = students.length === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(students.length, start + PAGE_SIZE);

  return (
    <Panel>
      <PanelHeader
        icon={Users}
        title="Eligible Students"
        description={`${students.length} student${students.length === 1 ? "" : "s"} eligible for this session`}
        className="mb-4 min-h-8"
      />

      {students.length === 0 ? (
        <EmptyState
          size="sm"
          title="No eligible students"
          description="No students are eligible for this session. Eligibility requires an active enrollment in this batch and an active membership covering this session’s date."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label="Eligible Students">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Student</TableHead>
                  <TableHead className="whitespace-nowrap">Phone</TableHead>
                  <TableHead className="whitespace-nowrap">Batch Enrollment</TableHead>
                  <TableHead className="whitespace-nowrap">Membership</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageStudents.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <Avatar name={student.full_name} />
                        <div>
                          <p className="font-semibold text-text-primary">{student.full_name}</p>
                          <p className="text-small text-text-secondary">{student.student_code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary">{student.phone}</TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary">
                      {batch?.name ?? "—"} {batch?.code ? `(${batch.code})` : ""}
                      <span className="block text-small">(Active)</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-text-secondary">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-brand hover:bg-brand/10 hover:text-brand"
                        aria-label={`View student ${student.full_name}`}
                        render={<Link href={`/students/${student.id}`} />}
                        nativeButton={false}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-text-secondary">
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
        </>
      )}
    </Panel>
  );
}
