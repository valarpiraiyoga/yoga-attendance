"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Layers, Phone, Users } from "lucide-react";
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
  const membershipLabel = MEMBERSHIP_SUMMARY_LABELS[student.membershipSummary];
  const isActive = student.status === "active";

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-surface p-3.5 shadow-sm transition-colors",
        menuOpen && "border-brand/40 bg-brand/5"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-surface/80 bg-brand/15 text-small font-semibold text-brand shadow-xs"
        >
          {getInitials(student.full_name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <h3
                className="min-w-0 truncate text-body font-semibold leading-snug text-text-primary"
                title={student.full_name}
              >
                {student.full_name}
              </h3>
              <Badge
                variant={isActive ? "success" : "danger"}
                className="mt-1 rounded-full px-2 py-0"
              >
                <span className="text-[10px] leading-[14px] font-medium">
                  {isActive ? "Active" : "Inactive"}
                </span>
              </Badge>
            </div>
            <div className="flex shrink-0 items-center">
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
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-small text-text-secondary">
        <span className="inline-flex min-w-0 items-center gap-1.5" title={student.phone || undefined}>
          <Phone className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">{student.phone || "—"}</span>
        </span>

        <span className="inline-flex min-w-0 items-center gap-1.5" title={`Batch: ${batchValue}`}>
          <Layers className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Batch: <span className="font-medium text-text-primary">{batchValue}</span>
          </span>
        </span>

        <span
          className="inline-flex min-w-0 items-center gap-1.5"
          title={`Membership: ${membershipLabel}`}
        >
          <Users className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="shrink-0">Membership:</span>
          <Badge
            variant={MEMBERSHIP_SUMMARY_VARIANTS[student.membershipSummary]}
            className="rounded-full px-2 py-0"
          >
            <span className="text-[10px] leading-[14px] font-medium">{membershipLabel}</span>
          </Badge>
        </span>
      </div>
    </article>
  );
}
