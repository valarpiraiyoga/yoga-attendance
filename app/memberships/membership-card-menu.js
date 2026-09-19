"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Memberships card / row overflow — links only to routes that already
 * exist (Membership Details, Edit, Renew, and the student's own page).
 * Cancel is deliberately not here: it needs its confirmation dialog, which
 * lives on Membership Details. Mirrors `StudentCardMenu`.
 */
export default function MembershipCardMenu({ membershipId, studentId, onOpenChange }) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
            aria-label="Membership actions"
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}`} />} nativeButton={false}>
          View Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
          Edit Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/renew`} />} nativeButton={false}>
          Renew Membership
        </DropdownMenuItem>

        {studentId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={`/students/${studentId}`} />} nativeButton={false}>
              View Student
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
