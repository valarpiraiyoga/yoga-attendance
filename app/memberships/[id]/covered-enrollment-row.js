"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * One row of Membership Details' Covered Batch Enrollments table: batch
 * (avatar, name, code), the enrollment's start and end, its status, and the
 * finalized action pair — eye icon (View Batch) + overflow menu (View Batch,
 * Edit Enrollment). Both destinations are existing routes.
 */
export default function CoveredEnrollmentRow({ enrollment, studentId }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const batch = enrollment.batches;
  const batchName = batch?.name ?? "Unknown batch";
  const status = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;
  const batchHref = batch?.id ? `/batches/${batch.id}` : null;
  const editHref = `/students/${studentId}/enrollments/${enrollment.id}/edit`;

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={batchName} shape="square" />
          <div className="min-w-0">
            <p className="font-semibold whitespace-nowrap text-text-primary">{batchName}</p>
            <p className="text-small whitespace-nowrap text-text-secondary">{batch?.code ?? "—"}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(enrollment.effective_start_date)}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">
        {enrollment.effective_end_date ? formatDate(enrollment.effective_end_date) : "Present"}
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {batchHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`View batch ${batchName}`}
              render={<Link href={batchHref} />}
              nativeButton={false}
            >
              <Eye className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <DropdownMenu onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                  aria-label={`Enrollment actions for ${batchName}`}
                />
              }
            >
              <MoreVertical className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {batchHref ? (
                <DropdownMenuItem render={<Link href={batchHref} />} nativeButton={false}>
                  View Batch
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem render={<Link href={editHref} />} nativeButton={false}>
                Edit Enrollment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}
