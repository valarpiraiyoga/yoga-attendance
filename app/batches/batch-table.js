"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AnimatedBorder from "@/components/ui/animated-border";
import BatchAvatar from "@/components/ui/batch-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BATCH_STATUS } from "@/lib/status";
import { summarizeCurrentSchedules } from "@/lib/batches/summary";
import { cn } from "@/lib/utils";
import BatchCardMenu from "@/app/batches/batch-card-menu";
import BatchQuickView from "@/app/batches/batch-quick-view";
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

// Each batch is its own rounded row card on the page background (the table is `border-separate`, with a gap between rows) - the same look as
// the Students and Memberships tables: a pale rounded header strip, and every row's cells carry the surface and the pale border, rounded at the
// row's two ends. The hover border is the shared animated one (`.card-border-animated-row`, drawn by `AnimatedBorder` in the first cell).
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";
const SURFACE = "[&>td]:bg-surface";
const SURFACE_OPEN = "[&>td]:bg-brand/10";

/**
 * One batch as a table row: Batch (initials, name, and the code beneath it —
 * one combined cell, never separate Name and Code columns), Category,
 * Instructor (avatar, name, "Instructor"), Days & Time, Schedules, Students,
 * Status, Action. The schedule-derived cells summarise the batch's current
 * schedules (unmodified `summarizeCurrentSchedules`, plus
 * `BatchInstructorSummary` for the Instructor cell's avatar(s)); Action is the
 * overflow menu, with View Batch as its first item.
 */
function BatchRow({ batch }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = BATCH_STATUS[batch.displayStatus] ?? BATCH_STATUS.active;
  const summary = summarizeCurrentSchedules(batch.currentSchedules);

  return (
    <TableRow
      className={cn(
        "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent",
        menuOpen ? SURFACE_OPEN : SURFACE
      )}
    >
      <TableCell className={cn(CELL, "py-3 pr-2 pl-3")}>
        {/* The row's hover border: drawn from the first cell, sized to the whole row (see `.card-border-animated-row`). */}
        <AnimatedBorder />
        <div className="flex min-w-0 items-center gap-3">
          <BatchAvatar batch={batch} size="lg" />
          <div className="min-w-0">
            {/* The name opens the quick view (a right-hand panel with View Details); the eye icon in Actions goes straight to Batch Details. */}
            <p className="text-body font-semibold text-text-primary">
              <BatchQuickView batch={batch} />
            </p>
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
      <TableCell className={cn(CELL, WIDE_ONLY)}>
        {batch.category ? <Badge variant="default">{batch.category}</Badge> : <span className="text-text-secondary">—</span>}
      </TableCell>
      <TableCell className={cn(CELL, INSTRUCTOR_ONLY)}>
        <BatchInstructorSummary schedules={batch.currentSchedules} showLabel />
      </TableCell>
      <TableCell className={cn(CELL, DAYS_TIME_ONLY)} title={summary.detail || undefined}>
        {summary.hasSchedule ? (
          <div className="flex min-w-0 items-center gap-3">
            <CalendarDays className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body font-medium text-text-primary">{summary.days}</p>
              <p className="text-small whitespace-nowrap text-text-secondary">{summary.time}</p>
            </div>
          </div>
        ) : (
          <span className="text-text-secondary">{summary.time}</span>
        )}
      </TableCell>
      <TableCell className={cn(CELL, "text-center tabular-nums text-text-secondary", WIDE_ONLY)}>
        {summary.count}
      </TableCell>
      <TableCell className={cn(CELL, "text-center tabular-nums text-text-primary", DAYS_TIME_ONLY)}>
        {batch.studentCount}
      </TableCell>
      <TableCell className={CELL}>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-3 pl-1 whitespace-nowrap")}>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View batch ${batch.name}`}
            title="View batch"
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

/** The Batches table (rounded row cards on the page background): see `BatchRow` for the columns. */
export default function BatchTable({ batches }) {
  return (
    <div className="@container">
      <Table aria-label="Batches" className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Batch</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Category</TableHead>
            <TableHead className={cn(HEAD, INSTRUCTOR_ONLY)}>Instructor</TableHead>
            <TableHead className={cn(HEAD, DAYS_TIME_ONLY)}>Days &amp; Time</TableHead>
            <TableHead className={cn(HEAD, "text-center", WIDE_ONLY)}>Schedules</TableHead>
            <TableHead className={cn(HEAD, "text-center", DAYS_TIME_ONLY)}>Students</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={cn(HEAD, "w-px pr-3 pl-1 whitespace-nowrap")}>Actions</TableHead>
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
