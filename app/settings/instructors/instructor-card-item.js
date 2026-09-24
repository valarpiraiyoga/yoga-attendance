"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Mail, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import InstructorRowMenu from "@/app/settings/instructors/instructor-row-menu";

/**
 * Instructor list card: identity (circular initials avatar, name, status),
 * then Phone and Email — the only instructor details that exist (an
 * instructor has no specialization, photo or schedule summary in the
 * data). Actions follow the finalized pattern shared with the other list
 * pages: eye icon + overflow menu, the same `InstructorRowMenu` the table
 * uses (Edit Instructor, Activate / Deactivate). As in the table, the eye
 * opens the edit page — the one place an instructor's record is shown.
 * Composed from `EntityCard`; only the menu-open tint is local state.
 */
export default function InstructorCardItem({ instructor, isUpdating, disabled, onToggleStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = ENTITY_STATUS[instructor.status] ?? ENTITY_STATUS.inactive;
  const phone = instructor.phone || "—";
  const email = instructor.email || "—";

  return (
    <EntityCard
      className={cn((menuOpen || isUpdating) && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={instructor.full_name} src={instructor.photo_url} size="lg" bordered />}
      title={instructor.full_name}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      statusPlacement="actions"
      actions={
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View instructor ${instructor.full_name}`}
            render={<Link href={`/settings/instructors/${instructor.id}/edit`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <InstructorRowMenu
            instructorId={instructor.id}
            instructorName={instructor.full_name}
            isActive={instructor.status === "active"}
            isUpdating={isUpdating}
            disabled={disabled}
            onToggleStatus={onToggleStatus}
            onOpenChange={setMenuOpen}
          />
        </div>
      }
    >
      {/* Divider, then compact icon rows — the same shape as the Students card. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-small text-text-secondary">
        <span className="inline-flex min-w-0 items-center gap-1.5" title={phone}>
          <Phone className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">{phone}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5" title={email}>
          <Mail className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 truncate">{email}</span>
        </span>
      </div>
    </EntityCard>
  );
}
