"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { BATCH_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";
import BatchInstructorSummary from "@/app/batches/batch-instructor-summary";

/**
 * Batch table row: Batch (avatar + name), Code, Category, Instructor,
 * Days & Time, Students, Status, Action. The schedule-derived cells
 * summarise the batch's current schedules (unmodified `summarizeCurrentSchedules`,
 * plus `BatchInstructorSummary` for the Instructor cell's avatar(s) — see
 * that component's own comment for why it isn't folded into the shared
 * summary function); Action is the finalized eye + overflow menu.
 */
export default function BatchTableRow({ batch }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={batch.name} shape="square" />
          <p className="font-semibold text-text-primary">{batch.name}</p>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{batch.code || "—"}</TableCell>
      <TableCell className="text-text-secondary">{batch.category || "—"}</TableCell>
      <TableCell>
        <BatchInstructorSummary schedules={batch.currentSchedules} />
      </TableCell>
      <TableCell title={summary.detail || undefined}>
        {summary.hasSchedule ? (
          <>
            <p className="text-text-primary">{summary.days}</p>
            <p className="text-small whitespace-nowrap text-text-secondary">{summary.time}</p>
            {summary.countLabel ? (
              <p className="text-small whitespace-nowrap text-text-secondary">{summary.countLabel}</p>
            ) : null}
          </>
        ) : (
          <span className="text-text-secondary">{summary.time}</span>
        )}
      </TableCell>
      <TableCell className="tabular-nums text-text-secondary">{batch.studentCount}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View batch ${batch.name}`}
            render={<Link href={`/batches/${batch.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <BatchCardMenu batchId={batch.id} batchName={batch.name} onOpenChange={setMenuOpen} />
        </div>
      </TableCell>
    </TableRow>
  );
}
