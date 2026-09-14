"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Students card overflow — links only to existing Student / Membership /
 * Enrollment routes already used on Student Details. "View Membership" and
 * "Edit Batch" disable when no current membership / active enrollment exists.
 */
export default function StudentCardMenu({ studentId, membershipId, enrollmentId, onOpenChange }) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-text-secondary hover:text-text-primary"
            aria-label="Student actions"
          />
        }
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={`/students/${studentId}`} />} nativeButton={false}>
          View Student
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/students/${studentId}/edit`} />} nativeButton={false}>
          Edit Student
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={<Link href={`/students/${studentId}/memberships/new`} />}
          nativeButton={false}
        >
          Add Membership
        </DropdownMenuItem>
        {membershipId ? (
          <DropdownMenuItem render={<Link href={`/memberships/${membershipId}`} />} nativeButton={false}>
            View Membership
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>View Membership</DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={<Link href={`/students/${studentId}/enrollments/new`} />}
          nativeButton={false}
        >
          Add Batch
        </DropdownMenuItem>
        {enrollmentId ? (
          <DropdownMenuItem
            render={<Link href={`/students/${studentId}/enrollments/${enrollmentId}/edit`} />}
            nativeButton={false}
          >
            Edit Batch
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>Edit Batch</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
