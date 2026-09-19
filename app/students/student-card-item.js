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
import StudentCardMenu from "@/app/students/student-card-menu";

export default function StudentCardItem({ student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const batchValue = student.batchCodes.length > 0 ? student.batchCodes.join(", ") : "—";
  const entityStatus = ENTITY_STATUS[student.status] ?? ENTITY_STATUS.inactive;
  const membershipStatus = MEMBERSHIP_SUMMARY[student.membershipSummary] ?? MEMBERSHIP_SUMMARY.none;

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={student.full_name} bordered />}
      title={student.full_name}
      subtitle={`ID: ${student.student_code}`}
      status={<Badge variant={entityStatus.variant}>{entityStatus.label}</Badge>}
      actions={
        <>
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
        </>
      }
      meta={[
        { icon: Phone, label: student.phone || "—", title: student.phone || undefined },
        {
          icon: Layers,
          label: (
            <>
              Batch: <span className="font-medium text-text-primary">{batchValue}</span>
            </>
          ),
          title: `Batch: ${batchValue}`,
        },
        {
          icon: Users,
          label: (
            <>
              Membership: <Badge variant={membershipStatus.variant}>{membershipStatus.label}</Badge>
            </>
          ),
          title: `Membership: ${membershipStatus.label}`,
        },
      ]}
    />
  );
}
