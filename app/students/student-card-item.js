"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

export default function StudentCardItem({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "—";
  const isActive = student.status === "active";

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-card border bg-surface p-4 shadow-xs transition-colors",
        menuOpen ? "border-brand/40 bg-brand/5" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand"
        >
          {getInitials(student.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-text-primary">{student.full_name}</p>
          <p className="text-small mt-0.5 truncate text-text-secondary">{student.student_code}</p>
        </div>
        <StudentCardMenu
          studentId={student.id}
          membershipId={student.currentMembershipId}
          enrollmentId={student.primaryEnrollmentId}
          onOpenChange={setMenuOpen}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-small text-text-secondary">Phone</p>
          <p className="mt-1 truncate text-body font-semibold text-text-primary">{student.phone || "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-small text-text-secondary">Batch</p>
          <p className="mt-1 truncate text-body font-semibold text-text-primary">{batchValue}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant={MEMBERSHIP_SUMMARY_VARIANTS[student.membershipSummary]} className="px-1.5 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            Membership: {MEMBERSHIP_SUMMARY_LABELS[student.membershipSummary]}
          </span>
        </Badge>
        <Badge variant={isActive ? "success" : "danger"} className="px-1.5 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            Status: {isActive ? "Active" : "Inactive"}
          </span>
        </Badge>
      </div>

      <div className="mt-auto pt-4">
        <div className="border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-auto w-full justify-end gap-1 px-0 py-0 text-small font-semibold text-brand hover:bg-transparent hover:text-brand"
            render={<Link href={`/students/${student.id}`} />}
            nativeButton={false}
          >
            View Student
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}
