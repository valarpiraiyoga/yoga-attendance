"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import BatchAvatar from "@/components/ui/batch-avatar";
import { InstructorCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";

// How many schedule rows a batch group shows on mobile before "+N more
// schedules" (an in-place reveal, not pagination). The desktop table lists
// every row.
const MOBILE_ROW_LIMIT = 3;

function scheduleFacts(schedule) {
  return {
    status: ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive,
    day: DAY_LABELS[schedule.day_of_week]?.slice(0, 3) ?? schedule.day_of_week,
    instructor: schedule.instructors?.full_name ?? "—",
  };
}

function ScheduleActions({ schedule, batchId, batchName, day, time, onOpenChange }) {
  return (
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
      <ScheduleCardMenu scheduleId={schedule.id} batchId={batchId} batchName={batchName} onOpenChange={onOpenChange} />
    </div>
  );
}

// The time range, as everywhere in the finalized tables: the start time
// prominent, the end time the same size but muted. Never breaks inside either.
function TimeRange({ schedule }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-text-primary">{formatTime(schedule.start_time)}</span>{" "}
      <span className="text-text-secondary">– {formatTime(schedule.end_time)}</span>
    </span>
  );
}

// One schedule as a desktop table row: Day, Time, Instructor, Effective
// From, Effective Until, Status, Action.
function ScheduleTableRow({ schedule, batchId, batchName }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { status, day, instructor } = scheduleFacts(schedule);
  const time = `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-2 pl-4 font-medium text-text-primary">{day}</TableCell>
      <TableCell className="px-2 py-3">
        <TimeRange schedule={schedule} />
      </TableCell>
      <TableCell className="px-2 py-3">
        <InstructorCell name={instructor} photoUrl={schedule.instructors?.photo_url} />
      </TableCell>
      <TableCell className="px-2 py-3 whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_from)}</TableCell>
      <TableCell className="px-2 py-3 whitespace-nowrap text-text-secondary">{formatDate(schedule.effective_until)}</TableCell>
      <TableCell className="px-2 py-3">
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3 pr-3 pl-1 whitespace-nowrap">
        <ScheduleActions
          schedule={schedule}
          batchId={batchId}
          batchName={batchName}
          day={day}
          time={time}
          onOpenChange={setMenuOpen}
        />
      </TableCell>
    </TableRow>
  );
}

// One schedule as a compact mobile row: the day beside the time, the
// instructor below it, and Status + View + menu on the right.
function ScheduleMobileRow({ schedule, batchId, batchName }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { status, day, instructor } = scheduleFacts(schedule);
  const time = `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`;

  return (
    <li className={cn("flex gap-3 px-3 py-3", menuOpen && "bg-brand/10")}>
      <span className="w-9 shrink-0 pt-0.5 text-body font-medium text-text-primary">{day}</span>
      <div className="min-w-0 flex-1">
        <p className="text-body">
          <TimeRange schedule={schedule} />
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar name={instructor} src={schedule.instructors?.photo_url} size="sm" />
            <span className="min-w-0 truncate text-small text-text-secondary" title={instructor}>
              {instructor}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            <ScheduleActions
              schedule={schedule}
              batchId={batchId}
              batchName={batchName}
              day={day}
              time={time}
              onOpenChange={setMenuOpen}
            />
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * One batch's collapsible group in the Schedule List Table view
 * (finalized reference): a highlighted header — batch initials, the batch
 * name (primary) with "Code: XYZ · Category" beneath it (secondary), the
 * schedule count and the expand / collapse chevron at the far right — over the
 * batch's schedules. The whole header is one `<button>`
 * (`aria-expanded` / `aria-controls`), so it is keyboard and screen-reader
 * operable; a collapsed group shows only the header.
 *
 * The schedules are a table — Day, Time, Instructor, Effective From,
 * Effective Until, Status, Action — while the group is at least `@2xl` wide,
 * and compact rows (with "+N more schedules" past the first few) below that,
 * so a phone never scrolls sideways. Width is the group's own (container
 * query), so the page's sidebar and gutters cannot make the choice wrong.
 *
 * `schedules` is already Monday → Sunday / start-time ordered
 * (`groupSchedulesByBatch`, lib/schedules/validation.js).
 */
export default function ScheduleBatchAccordion({ batch, batchId, schedules, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const regionId = useId();
  const batchName = batch?.name ?? "Unknown batch";
  const count = schedules.length;
  const countLabel = `${count} ${count === 1 ? "schedule" : "schedules"}`;
  const detail = [batch?.code ? `Code: ${batch.code}` : null, batch?.category].filter(Boolean).join(" · ");
  const hiddenCount = Math.max(0, count - MOBILE_ROW_LIMIT);
  const mobileSchedules = showAll ? schedules : schedules.slice(0, MOBILE_ROW_LIMIT);

  return (
    <section className="@container overflow-hidden rounded-card border border-border bg-surface shadow-xs">
      <button
        type="button"
        className="group flex w-full items-center gap-3 bg-brand/5 px-4 py-3 text-left transition-colors hover:bg-brand/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
      >
        <BatchAvatar batch={{ ...batch, name: batchName }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-text-primary" title={batchName}>
            {batchName}
          </span>
          {detail ? <span className="block truncate text-small text-text-secondary">{detail}</span> : null}
          <span className="block text-small font-medium text-text-secondary @2xl:hidden">{countLabel}</span>
        </span>
        <span className="hidden shrink-0 text-body font-medium text-text-primary @2xl:block">{countLabel}</span>
        {expanded ? (
          <ChevronUp className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        )}
      </button>

      <div id={regionId} role="region" aria-label={`${batchName} schedules`} hidden={!expanded}>
        {expanded ? (
          <>
            <div className="hidden @2xl:block">
              <Table aria-label={`${batchName} schedules`}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 pr-2 pl-4 text-small tracking-normal">Day</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Time</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Instructor</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Effective From</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Effective Until</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Status</TableHead>
                    <TableHead className="h-10 w-px pr-3 pl-1 text-small tracking-normal">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => (
                    <ScheduleTableRow key={schedule.id} schedule={schedule} batchId={batchId} batchName={batchName} />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="@2xl:hidden">
              <ul className="divide-y divide-border/60" aria-label={`${batchName} schedules`}>
                {mobileSchedules.map((schedule) => (
                  <ScheduleMobileRow key={schedule.id} schedule={schedule} batchId={batchId} batchName={batchName} />
                ))}
              </ul>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 px-3 py-2.5 text-small font-medium text-brand hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? (
                    <>
                      <ChevronUp className="size-4" aria-hidden="true" />
                      Show fewer schedules
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-4" aria-hidden="true" />+{hiddenCount} more{" "}
                      {hiddenCount === 1 ? "schedule" : "schedules"}
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
