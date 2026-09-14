"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import StudentCardMenu from "@/app/students/student-card-menu";

const MEMBERSHIP_SUMMARY_VARIANTS = { active: "success", expired: "neutral", none: "outline" };
const MEMBERSHIP_SUMMARY_LABELS = { active: "Active", expired: "Expired", none: "None" };

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function StudentTableRow({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell className="px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand"
          >
            {getInitials(student.full_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{student.full_name}</p>
            <p className="text-small text-text-secondary">{student.student_code}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">{student.phone || "—"}</TableCell>
      <TableCell className="px-5 py-3.5">
        {student.batchCodes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {student.batchCodes.map((code) => (
              <Badge key={code} variant="outline" className="border-border/70 bg-surface/60">
                {code}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Badge variant={MEMBERSHIP_SUMMARY_VARIANTS[student.membershipSummary]}>
          {MEMBERSHIP_SUMMARY_LABELS[student.membershipSummary]}
        </Badge>
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Badge variant={student.status === "active" ? "success" : "danger"}>
          {student.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="px-5 py-3.5">
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
