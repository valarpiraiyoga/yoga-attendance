"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { ENTITY_STATUS, MEMBERSHIP_SUMMARY } from "@/lib/status";
import { cn } from "@/lib/utils";
import StudentCardMenu from "@/app/students/student-card-menu";

export default function StudentTableRow({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const entityStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = MEMBERSHIP_SUMMARY[student.membershipSummary] ?? MEMBERSHIP_SUMMARY.none;
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "—";

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={student.full_name} src={student.photo_url} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{student.full_name}</p>
            <p className="text-small text-text-secondary">{student.student_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">{student.phone || "—"}</TableCell>
      <TableCell className="text-text-secondary">{batchValue}</TableCell>
      <TableCell>
        <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={entityStatus.variant}>{entityStatus.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label="View Student"
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
