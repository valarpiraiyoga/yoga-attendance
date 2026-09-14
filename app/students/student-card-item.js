"use client";

import { useState } from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
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
        "flex h-full flex-col gap-3 rounded-2xl border p-3.5 shadow-sm backdrop-blur-sm transition-colors",
        menuOpen
          ? "border-brand/40 bg-gradient-to-br from-brand/15 via-surface/90 to-info/15"
          : "border-border/70 bg-gradient-to-br from-brand/10 via-surface/80 to-info/10"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-surface/80 bg-brand/15 text-small font-semibold text-brand shadow-xs"
        >
          {getInitials(student.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold leading-snug text-text-primary">
            {student.full_name}
          </h3>
          <p className="text-small truncate text-text-secondary">{student.student_code}</p>
        </div>
        <StudentCardMenu
          studentId={student.id}
          membershipId={student.currentMembershipId}
          enrollmentId={student.primaryEnrollmentId}
          onOpenChange={setMenuOpen}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={MEMBERSHIP_SUMMARY_VARIANTS[student.membershipSummary]} className="rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            Membership: {MEMBERSHIP_SUMMARY_LABELS[student.membershipSummary]}
          </span>
        </Badge>
        <Badge variant={isActive ? "success" : "danger"} className="rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            Status: {isActive ? "Active" : "Inactive"}
          </span>
        </Badge>
      </div>

      <div className="grid grid-cols-2 border-y border-border/50 py-2.5">
        <div className="min-w-0 pr-2">
          <p className="flex items-center gap-1 truncate text-body font-semibold leading-snug text-text-primary">
            <Phone className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
            <span className="truncate">{student.phone || "—"}</span>
          </p>
          <p className="text-small mt-0.5 text-text-secondary">Phone</p>
        </div>
        <div className="min-w-0 border-l border-border/50 pl-3">
          <p className="truncate text-body font-semibold leading-snug text-text-primary">{batchValue}</p>
          <p className="text-small mt-0.5 text-text-secondary">Batch</p>
        </div>
      </div>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full border-border/80 bg-surface/70 text-small font-semibold text-text-primary shadow-xs hover:bg-surface hover:text-text-primary"
          render={<Link href={`/students/${student.id}`} />}
          nativeButton={false}
        >
          View Student
        </Button>
      </div>
    </article>
  );
}
