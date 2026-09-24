"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { ENTITY_STATUS, MEMBERSHIP_SUMMARY } from "@/lib/status";
import { cn } from "@/lib/utils";
import StudentCardMenu from "@/app/students/student-card-menu";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the Attendance, Schedule and Batches tables. Narrowest
// (mobile): Student (identity), Status, Action. From 40rem: Phone and
// Membership. From 52rem: Batch — the whole table, which fits the ~1120px a
// 1440px screen leaves it.
const MID_ONLY = "hidden @[40rem]:table-cell";
const WIDE_ONLY = "hidden @[52rem]:table-cell";

const HEAD = "h-10 px-2 text-small tracking-normal";

/**
 * One student as a table row: Student (avatar, name, and the student code
 * beneath it — one combined cell, never separate Name and Code columns),
 * Phone, Batch, Membership, Status, Action. Statuses come from the existing
 * `ENTITY_STATUS` / `MEMBERSHIP_SUMMARY` maps (the membership summary is
 * derived in the data layer against the centre timezone, not here); Action is
 * the finalized eye + overflow menu.
 */
function StudentRow({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const entityStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = MEMBERSHIP_SUMMARY[student.membershipSummary] ?? MEMBERSHIP_SUMMARY.none;
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "\u2014";

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={student.full_name} src={student.photo_url} />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">{student.full_name}</p>
            <p className="text-small text-text-secondary">{student.student_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", MID_ONLY)}>
        {student.phone || "\u2014"}
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-text-secondary", WIDE_ONLY)}>{batchValue}</TableCell>
      <TableCell className={cn("px-2 py-3", MID_ONLY)}>
        <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
      </TableCell>
      <TableCell className="px-2 py-3">
        <Badge variant={entityStatus.variant}>{entityStatus.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3 pr-3 pl-1 whitespace-nowrap">
        <div className="flex items-center gap-1">
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
          <StudentCardMenu
            studentId={student.id}
            membershipId={student.currentMembershipId}
            enrollmentId={student.primaryEnrollmentId}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The Students table (finalized compact style): see `StudentRow` for the columns. */
export default function StudentTable({ students }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label="Students">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Student</TableHead>
            <TableHead className={cn(HEAD, MID_ONLY)}>Phone</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Batch</TableHead>
            <TableHead className={cn(HEAD, MID_ONLY)}>Membership</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className="h-10 w-px pr-3 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <StudentRow key={student.id} student={student} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
