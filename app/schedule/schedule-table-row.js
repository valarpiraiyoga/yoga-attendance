"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";

// One schedule's data row: Day & Time, Instructor (avatar + name), Effective
// From, Effective Until, Status, Action. No Batch column here — the group's
// identity lives on the trigger bar above, not inside this per-group table.
function ScheduleDataRow({ schedule, batchId, batchName }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive;
  const day = DAY_LABELS[schedule.day_of_week]?.slice(0, 3) ?? schedule.day_of_week;
  const time = formatTimeRange(schedule.start_time, schedule.end_time);
  const instructor = schedule.instructors?.full_name ?? "—";

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell>
        <div className="flex items-baseline gap-3">
          <span className="w-9 shrink-0 font-medium text-text-primary">{day}</span>
          <span className="whitespace-nowrap text-text-secondary">{time}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={instructor} src={schedule.instructors?.photo_url} size="sm" />
          <span className="min-w-0 truncate text-text-secondary">{instructor}</span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_from)}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_until)}</TableCell>
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
            aria-label={`View schedule for ${batchName}, ${day} ${time}`}
            render={<Link href={`/schedule/${schedule.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <ScheduleCardMenu
            scheduleId={schedule.id}
            batchId={batchId}
            batchName={batchName}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * One batch's collapsible group in the Schedule List Table view: a trigger
 * bar (batch identity, schedule count, chevron toggle) sitting above its own
 * self-contained table of schedule rows, shown only while expanded.
 *
 * The trigger bar is a plain flex header, not a table row — earlier this used
 * one shared `<table>` across every group with the Batch column left blank on
 * every schedule row (so the trigger's batch-identity column could line up
 * above them), which produced dead space at the start of every data row. Each
 * group is independent (no columns shared or aligned across groups — the
 * previous shared column header was already dropped), so there is no reason
 * for a batch-identity column at all inside the body table; splitting the
 * trigger out removes it, and also means this group can be its own rounded,
 * bordered "card" (`overflow-hidden` clipping the tinted trigger's corners)
 * reliably, rather than approximating one with spacer rows inside one giant
 * table.
 *
 * `schedules` is already Monday → Sunday / start-time ordered
 * (`groupSchedulesByBatch`, lib/schedules/validation.js). Expanded by
 * default — collapsing hides nothing an admin couldn't already see before
 * this control existed, so the safer default is showing everything until the
 * admin chooses to collapse a group.
 */
export default function ScheduleBatchGroupTableRows({ batch, batchId, schedules }) {
  const [expanded, setExpanded] = useState(true);
  const batchName = batch?.name ?? "Unknown batch";
  const count = schedules.length;

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-xs">
      <div className="flex items-center justify-between gap-4 bg-brand/5 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={batchName} shape="square" bordered />
          <div className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{batchName}</p>
            <p className="truncate text-small text-text-secondary">
              {batch?.code ? `Code: ${batch.code}` : "No batch"}
              {batch?.category ? ` • ${batch.category}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <p className="font-semibold text-text-primary">
            {count} {count === 1 ? "schedule" : "schedules"}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-text-secondary hover:bg-brand/10 hover:text-brand"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${batchName} schedules`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {expanded ? (
        <Table aria-label={`${batchName} schedules`} className="[&_td]:px-3 [&_th]:px-3">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Day &amp; Time</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead>Effective From</TableHead>
              <TableHead>Effective Until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((schedule) => (
              <ScheduleDataRow key={schedule.id} schedule={schedule} batchId={batchId} batchName={batchName} />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
