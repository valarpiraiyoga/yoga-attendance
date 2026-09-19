"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import SessionCardMenu from "@/app/attendance/session-card-menu";
import { summarizeSession } from "@/app/attendance/session-summary";

/**
 * Attendance session table row: [Date,] Time, Batch (avatar + name + code),
 * Instructor, Eligible, Session Status, Attendance, Action. Date appears on
 * All Sessions only — every Today's Sessions row is already today. Action is
 * the finalized eye + overflow menu.
 */
export default function SessionTableRow({ session, today, showDate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSession(session, today);

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      {showDate ? (
        <TableCell className="whitespace-nowrap text-text-secondary">{summary.dateLabel}</TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap text-text-secondary">{summary.timeLabel}</TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={summary.batchName} shape="square" />
          <div className="min-w-0">
            <p className="font-semibold text-text-primary">{summary.batchName}</p>
            {summary.batchCode ? <p className="text-small text-text-secondary">{summary.batchCode}</p> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">{summary.instructor}</TableCell>
      <TableCell className="tabular-nums text-text-secondary">{summary.eligibleCount}</TableCell>
      <TableCell>
        <Badge variant={summary.status.variant}>{summary.status.label}</Badge>
      </TableCell>
      <TableCell className="tabular-nums text-text-secondary">{summary.attendanceLabel ?? "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`${summary.actionLabel} for ${summary.batchName}`}
            render={<Link href={summary.actionHref} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <SessionCardMenu
            batchName={summary.batchName}
            actionLabel={summary.actionLabel}
            actionHref={summary.actionHref}
            detailsHref={summary.detailsHref}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
