"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/ui/avatar";
import AnimatedBorder from "@/components/ui/animated-border";
import { ENTITY_STATUS, MEMBERSHIP_SUMMARY } from "@/lib/status";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import StudentCardMenu from "@/app/students/student-card-menu";
import StudentViewButton from "@/app/students/student-view-button";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the Attendance, Schedule and Batches tables. Narrowest
// (mobile): Student (identity), Status, Action. From 40rem: Phone and
// Membership. From 52rem: Batch — the whole table, which fits the ~1120px a
// 1440px screen leaves it.
const MID_ONLY = "hidden @[40rem]:table-cell";
const WIDE_ONLY = "hidden @[52rem]:table-cell";

// Each student is its own rounded row card on the page background (the table is `border-separate`, with a gap between rows): the header is a
// pale, rounded strip and every row's cells carry the surface and the pale border, rounded at the row's two ends.
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
// The row's surface lives on its cells (a `border-separate` row cannot paint its own background); there is no hover tint, rows stay white.
const SURFACE = "[&>td]:bg-surface";
const SURFACE_OPEN = "[&>td]:bg-brand/10";
const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";

/**
 * One student as a table row: Student (avatar, name, and the student code
 * beneath it — one combined cell, never separate Name and Code columns),
 * Phone, Batch, Membership, Status, Actions. Statuses come from the existing
 * `ENTITY_STATUS` / `MEMBERSHIP_SUMMARY` maps (the membership summary is
 * derived in the data layer against the centre timezone, not here); Action is
 * the overflow menu, with View Student as its first item.
 */
function StudentRow({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const entityStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = MEMBERSHIP_SUMMARY[student.membershipSummary] ?? MEMBERSHIP_SUMMARY.none;
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "\u2014";

  return (
    <TableRow
      className={cn(
        "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent",
        menuOpen ? SURFACE_OPEN : SURFACE
      )}
    >
      <TableCell className={cn(CELL, "py-3 pr-2 pl-3")}>
        {/* The row's hover border: drawn from the first cell, sized to the whole row (see `.card-border-animated-row`). */}
        <AnimatedBorder />
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={student.full_name} src={student.photo_url} size="lg" shape="square" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">
              <Link href={`/students/${student.id}`} className="rounded-sm text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {student.full_name}
              </Link>
            </p>
            <p className="text-small text-text-secondary">{student.student_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap text-text-secondary", MID_ONLY)}>
        {formatPhone(student.phone, student.phone_country_code)}
      </TableCell>
      <TableCell className={cn(CELL, "text-text-secondary", WIDE_ONLY)}>{batchValue}</TableCell>
      <TableCell className={cn(CELL, MID_ONLY)}>
        <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
      </TableCell>
      <TableCell className={CELL}>
        <Badge variant={entityStatus.variant}>{entityStatus.label}</Badge>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-3 pl-1 whitespace-nowrap")}>
        <div className="flex items-center gap-1">
          <StudentViewButton student={student} />
          <StudentCardMenu
            studentId={student.id}
            membershipId={student.currentMembershipId}
            enrollmentId={student.primaryEnrollmentId}
            onOpenChange={setMenuOpen}
            listActions
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The Students table (rounded row cards on the page background): see `StudentRow` for the columns. */
export default function StudentTable({ students }) {
  return (
    <div className="@container">
      <Table aria-label="Students" className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Student</TableHead>
            <TableHead className={cn(HEAD, MID_ONLY)}>Phone</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Batch</TableHead>
            <TableHead className={cn(HEAD, MID_ONLY)}>Membership</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={cn(HEAD, "w-px pr-3 pl-1 whitespace-nowrap")}>Actions</TableHead>
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
