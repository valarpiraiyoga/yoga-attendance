"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Layers, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { cn } from "@/lib/utils";
import { ENTITY_STATUS, MEMBERSHIP_SUMMARY } from "@/lib/status";
import { formatPhone } from "@/lib/phone";
import StudentCardMenu from "@/app/students/student-card-menu";

/**
 * Student list card (finalized reference): the photo (initials when there is
 * none), the name primary with the student code beneath it, View + menu with
 * the student's status stacked under them, then a divider and compact
 * icon rows — phone, batch, membership. All values come from the list query
 * (the membership summary is derived in the data layer against the centre
 * timezone), and the statuses from the shared badge maps.
 */
export default function StudentCardItem({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const phone = formatPhone(student.phone, student.phone_country_code);
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "—";
  const entityStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = MEMBERSHIP_SUMMARY[student.membershipSummary] ?? MEMBERSHIP_SUMMARY.none;

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      avatar={<Avatar name={student.full_name} src={student.photo_url} size="lg" bordered />}
      title={student.full_name}
      subtitle={student.student_code}
      status={<Badge variant={entityStatus.variant}>{entityStatus.label}</Badge>}
      statusPlacement="actions"
      actions={
        <div className="flex items-center">
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
      }
    >
      {/* Hand-rolled rather than EntityCard's `meta` prop: `meta` has no
          leading divider (its other callers — Memberships, Instructors,
          Attendance's session cards — were not asked to gain one), so this
          replicates the same icon + label row markup here, scoped to just
          this card, with the divider the reference adds above it. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-small text-text-secondary">
        <span className="inline-flex min-w-0 items-center gap-1.5" title={student.phone ? phone : undefined}>
          <Phone className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">{phone}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5" title={`Batch ${batchValue}`}>
          <Layers className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Batch <span className="ml-1.5 font-semibold text-text-primary">{batchValue}</span>
          </span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5" title={`Membership ${membershipStatus.label}`}>
          <Users className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Membership <Badge variant={membershipStatus.variant} className="ml-1.5">{membershipStatus.label}</Badge>
          </span>
        </span>
      </div>
    </EntityCard>
  );
}
