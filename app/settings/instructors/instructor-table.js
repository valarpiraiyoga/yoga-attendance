"use client";

import { useState } from "react";
import Link from "next/link";
import AnimatedBorder from "@/components/ui/animated-border";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/ui/avatar";
import { ENTITY_STATUS } from "@/lib/status";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import InstructorRowMenu from "@/app/settings/instructors/instructor-row-menu";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the other list-page tables. Narrowest (mobile): Instructor,
// Status, Action. From 36rem: Phone. From 48rem: Email — the whole table.
const PHONE_ONLY = "hidden @[36rem]:table-cell";
const EMAIL_ONLY = "hidden @[48rem]:table-cell";

// Each instructor is its own rounded row card on the page background, as on the Students and Batches lists: a pale header strip, the cells
// carrying the surface and the pale border, and the shared hover border (`.card-border-animated-row`, drawn by `AnimatedBorder`).
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";
const LINK = "rounded-sm text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * One Instructor table row (wireframe p39; `18 Settings instructor.png`):
 * identity (initials / photo avatar + name), Phone, Email, Status, and the
 * overflow menu. Instructors have no separate details screen: the edit page
 * is the one place an instructor's record (and login access) is shown, so
 * the menu's Edit Instructor item is the row's only way in, beside
 * Activate / Deactivate.
 */
function InstructorRow({ instructor, isUpdating, disabled, onToggleStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = ENTITY_STATUS[instructor.status] ?? ENTITY_STATUS.inactive;

  return (
    <TableRow
      className={cn(
        "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent",
        menuOpen || isUpdating ? "[&>td]:bg-brand/10" : "[&>td]:bg-surface"
      )}
    >
      <TableCell className={cn(CELL, "py-3 pr-2 pl-3")}>
        <AnimatedBorder />
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={instructor.full_name} src={instructor.photo_url} size="lg" />
          <p className="min-w-0 text-body font-semibold">
            <Link href={`/settings/instructors/${instructor.id}/edit`} className={LINK}>
              {instructor.full_name}
            </Link>
          </p>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap text-text-secondary", PHONE_ONLY)}>
        {formatPhone(instructor.phone, instructor.phone_country_code)}
      </TableCell>
      <TableCell className={cn(CELL, "text-text-secondary", EMAIL_ONLY)}>{instructor.email || "\u2014"}</TableCell>
      <TableCell className={CELL}>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-3 pl-1 whitespace-nowrap")}>
        <InstructorRowMenu
          instructorId={instructor.id}
          instructorName={instructor.full_name}
          isActive={instructor.status === "active"}
          isUpdating={isUpdating}
          disabled={disabled}
          onToggleStatus={onToggleStatus}
          onOpenChange={setMenuOpen}
        />
      </TableCell>
    </TableRow>
  );
}

/**
 * The Instructors table (finalized compact style): see `InstructorRow`.
 * `renderRowProps(instructor)` supplies each row's update state and toggle
 * handler from the list, which owns them.
 */
export default function InstructorTable({ instructors, renderRowProps }) {
  return (
    <div className="@container">
      <Table aria-label="Instructors" className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Instructor</TableHead>
            <TableHead className={cn(HEAD, PHONE_ONLY)}>Phone</TableHead>
            <TableHead className={cn(HEAD, EMAIL_ONLY)}>Email</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={cn(HEAD, "w-px pr-3 pl-1 whitespace-nowrap")}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instructors.map((instructor) => (
            <InstructorRow key={instructor.id} instructor={instructor} {...renderRowProps(instructor)} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
