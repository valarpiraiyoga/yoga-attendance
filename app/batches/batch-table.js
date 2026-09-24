"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BATCH_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";
import BatchInstructorSummary from "@/app/batches/batch-instructor-summary";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the Attendance tables. Narrowest: Batch, Status, Action —
// with the days and time stacked under the batch. From 40rem: Days & Time
// (its own column) and Students. From 56rem: Instructor. From 64rem: Category
// and Schedules — the whole table, which fits the ~1120px a 1440px screen
// leaves it.
const DAYS_TIME_ONLY = "hidden @[40rem]:table-cell";
const INSTRUCTOR_ONLY = "hidden @[56rem]:table-cell";
const WIDE_ONLY = "hidden @[64rem]:table-cell";

const HEAD = "h-10 px-2 text-small tracking-normal";

/**
 * One batch as a table row: Batch (initials, name, and the code beneath it —
 * one combined cell, never separate Name and Code columns), Category,
 * Instructor (avatar, name, "Instructor"), Days & Time, Schedules, Students,
 * Status, Action. The schedule-derived cells summarise the batch's current
 * schedules (unmodified `summarizeCurrentSchedules`, plus
 * `BatchInstructorSummary` for the Instructor cell's avatar(s)); Action is the
 * finalized eye + overflow menu.
 */
function BatchRow({ batch }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={batch.name} shape="square" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">{batch.name}</p>
            {batch.code ? <p className="text-small text-text-secondary">{batch.code}</p> : null}
            {/* Below 40rem the schedule summary has no column of its own. */}
            {summary.hasSchedule ? (
              <p className="text-small text-text-secondary @[40rem]:hidden">
                {summary.days} · {summary.time}
              </p>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-text-secondary", WIDE_ONLY)}>{batch.category || "—"}</TableCell>
      <TableCell className={cn("px-2 py-3", INSTRUCTOR_ONLY)}>
        <BatchInstructorSummary schedules={batch.currentSchedules} showLabel />
      </TableCell>
      <TableCell className={cn("px-2 py-3", DAYS_TIME_ONLY)} title={summary.detail || undefined}>
        {summary.hasSchedule ? (
          <>
            <p className="text-body font-medium text-text-primary">{summary.days}</p>
            <p className="text-small whitespace-nowrap text-text-secondary">{summary.time}</p>
          </>
        ) : (
          <span className="text-text-secondary">{summary.time}</span>
        )}
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-center tabular-nums text-text-secondary", WIDE_ONLY)}>
        {summary.count}
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-center tabular-nums text-text-secondary", DAYS_TIME_ONLY)}>
        {batch.studentCount}
      </TableCell>
      <TableCell className="px-2 py-3">
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3 pr-3 pl-1 whitespace-nowrap">
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

/** The Batches table (finalized compact style): see `BatchRow` for the columns. */
export default function BatchTable({ batches }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label="Batches">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Batch</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Category</TableHead>
            <TableHead className={cn(HEAD, INSTRUCTOR_ONLY)}>Instructor</TableHead>
            <TableHead className={cn(HEAD, DAYS_TIME_ONLY)}>Days &amp; Time</TableHead>
            <TableHead className={cn(HEAD, "text-center", WIDE_ONLY)}>Schedules</TableHead>
            <TableHead className={cn(HEAD, "text-center", DAYS_TIME_ONLY)}>Students</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className="h-10 w-px pr-3 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <BatchRow key={batch.id} batch={batch} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
