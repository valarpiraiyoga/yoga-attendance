"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Clock, Eye, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import AnimatedBorder from "@/components/ui/animated-border";
import BatchAvatar from "@/components/ui/batch-avatar";
import { InstructorCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS, DAYS_OF_WEEK } from "@/lib/schedules/validation";
import { TIME_RANGE_CHIPS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";
import { scheduleContextOf } from "@/app/schedule/schedule-context";
import SchedulePlaces from "@/app/schedule/schedule-places";
import { placesDisplay } from "@/lib/schedules/capacity";

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
      <ScheduleCardMenu
        scheduleId={schedule.id}
        batchId={batchId}
        batchName={batchName}
        scheduleContext={scheduleContextOf(schedule, schedule.batches ?? { id: batchId, name: batchName })}
        onOpenChange={onOpenChange}
      />
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

/**
 * The batch's schedules grouped by time slot for the table (presentation only): slots earliest first, inside a slot by instructor and then
 * Monday to Sunday. A schedule is still ONE row with its own day, dates, status, places and actions.
 */
function groupByTimeSlot(schedules) {
  const dayIndex = (schedule) => {
    const index = DAYS_OF_WEEK.indexOf(schedule.day_of_week);
    return index === -1 ? DAYS_OF_WEEK.length : index;
  };
  const groups = new Map();
  for (const schedule of schedules) {
    const key = timeRangeKey(schedule);
    const group = groups.get(key) ?? { key, schedules: [] };
    group.schedules.push(schedule);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      schedules: [...group.schedules].sort(
        (a, b) => String(a.instructors?.full_name ?? "").localeCompare(String(b.instructors?.full_name ?? "")) || dayIndex(a) - dayIndex(b)
      ),
    }))
    .sort((a, b) => String(a.schedules[0].start_time).localeCompare(String(b.schedules[0].start_time)) || a.key.localeCompare(b.key));
}

const instructorKey = (schedule) => schedule.instructors?.id ?? schedule.instructors?.full_name ?? "none";

/**
 * A slot's schedules as table rows: one row per instructor (and per effective period and status, so every column of a row is true for all of
 * its days), its days in week order. Each day is still its own schedule record.
 */
function rowsOf(groupSchedules) {
  const rows = new Map();
  for (const schedule of groupSchedules) {
    const key = [instructorKey(schedule), schedule.effective_from ?? "", schedule.effective_until ?? "", schedule.status ?? ""].join("|");
    const row = rows.get(key) ?? { key, schedules: [] };
    row.schedules.push(schedule);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * One day of a row as a chip: the day and that schedule's places ("8 / 20", "Unlimited", a dash when they could not be read; tinted red when
 * full). The chip opens the schedule's own menu (`ScheduleCardMenu`: View, Edit, View Batch, Delete) - every schedule keeps all its actions.
 */
function DayChip({ schedule, batchId, batchName }) {
  const day = DAY_LABELS[schedule.day_of_week]?.slice(0, 3) ?? schedule.day_of_week;
  const time = `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`;
  const places = placesDisplay(schedule.places);
  const placesText = places.unavailable ? "—" : places.text;
  const placesLabel = places.unavailable ? "places unavailable" : places.isFull ? `full, ${places.text}` : `places ${places.text}`;

  return (
    <ScheduleCardMenu
      scheduleId={schedule.id}
      batchId={batchId}
      batchName={batchName}
      scheduleContext={scheduleContextOf(schedule, schedule.batches ?? { id: batchId, name: batchName })}
      trigger={
        <button
          type="button"
          aria-label={`${batchName}, ${DAY_LABELS[schedule.day_of_week] ?? day} ${time}, ${placesLabel}: schedule actions`}
          className={cn(
            "inline-flex min-w-14 flex-col items-center rounded-md border px-2.5 py-1 text-center transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            places.isFull ? "border-danger/30 bg-danger/10 hover:bg-danger/15" : "border-border bg-brand/5 hover:bg-brand/10"
          )}
        >
          <span className="text-small font-semibold text-text-primary">{day}</span>
          <span className={cn("text-[0.6875rem] leading-4 tabular-nums", places.isFull ? "font-semibold text-danger" : "text-text-secondary")}>{placesText}</span>
        </button>
      }
    />
  );
}

// One table row: [the slot's Time block on its first row], Instructor, Days (a chip per day, with its places), Effective (from and until), Status.
function ScheduleTableRow({ row, batchId, batchName, timeCell }) {
  const first = row.schedules[0];
  const { status, instructor } = scheduleFacts(first);

  return (
    <TableRow className="border-border/60 hover:bg-transparent">
      {timeCell}
      <TableCell className="px-2 py-3">
        <InstructorCell name={instructor} photoUrl={first.instructors?.photo_url} />
      </TableCell>
      <TableCell className="px-2 py-3">
        <span className="flex flex-wrap gap-1.5">
          {row.schedules.map((schedule) => (
            <DayChip key={schedule.id} schedule={schedule} batchId={batchId} batchName={batchName} />
          ))}
        </span>
      </TableCell>
      <TableCell className="px-2 py-3 whitespace-nowrap text-text-secondary">
        <span className="block">
          <span className="text-small">From </span>
          <span className="text-text-primary">{formatDate(first.effective_from)}</span>
        </span>
        <span className="block">
          <span className="text-small">Until </span>
          <span className="text-text-primary">{formatDate(first.effective_until)}</span>
        </span>
      </TableCell>
      <TableCell className="px-2 py-3 pr-4">
        <Badge variant={status.variant}>{status.label}</Badge>
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
        <p className="mt-1.5 flex items-center gap-1.5 text-small text-text-secondary">
          Places
          <SchedulePlaces places={schedule.places} />
        </p>
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
  // The header's two figures: the batch's distinct time slots, and its distinct instructors (each person once, however many slots they teach).
  const slotGroups = groupByTimeSlot(schedules);
  const instructorCount = new Set(schedules.filter((schedule) => schedule.instructors).map(instructorKey)).size;
  const tones = timeRangeSlots(schedules, TIME_RANGE_CHIPS.length);
  const mobileSchedules = showAll ? schedules : schedules.slice(0, MOBILE_ROW_LIMIT);

  return (
    // The shared hover border and lift of the list cards (`.card-border-animated`): inset 0 because the box clips its overflow.
    <section className="card-border-animated @container overflow-hidden rounded-card border border-border bg-surface shadow-xs transition-shadow [--card-border-inset:0px] hover:shadow-lg">
      <AnimatedBorder />
      <button
        type="button"
        className="group flex w-full items-center gap-3 bg-surface px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
      >
        <BatchAvatar batch={{ ...batch, name: batchName }} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-text-primary" title={batchName}>
            {batchName}
          </span>
          {detail ? <span className="block truncate text-small text-text-secondary">{detail}</span> : null}
          <span className="block text-small font-medium text-text-secondary @2xl:hidden">{countLabel}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 @2xl:flex">
          <span className="text-small inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-medium text-text-primary">
            <Clock className="size-4 text-text-secondary" aria-hidden="true" />
            {slotGroups.length} {slotGroups.length === 1 ? "time slot" : "time slots"}
          </span>
          <span className="text-small inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-medium text-text-primary">
            <User className="size-4 text-text-secondary" aria-hidden="true" />
            {instructorCount} {instructorCount === 1 ? "instructor" : "instructors"}
          </span>
          <span className="sr-only">{countLabel}</span>
        </span>
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
                  <TableRow className="bg-brand/5 hover:bg-brand/5">
                    <TableHead className="h-10 w-48 pr-2 pl-4 text-small tracking-normal">Time</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Instructor</TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">
                      Days <span className="font-normal normal-case">(places)</span>
                    </TableHead>
                    <TableHead className="h-10 px-2 text-small tracking-normal">Effective</TableHead>
                    <TableHead className="h-10 px-2 pr-4 text-small tracking-normal">Status</TableHead>
                  </TableRow>
                </TableHeader>
                {slotGroups.map((group) => {
                  const first = group.schedules[0];
                  const instructorCount = new Set(group.schedules.filter((schedule) => schedule.instructors).map(instructorKey)).size;
                  const rows = rowsOf(group.schedules);
                  return (
                    <TableBody key={group.key} className="border-t border-border first:border-t-0">
                      {rows.map((row, index) => (
                        <ScheduleTableRow
                          key={row.key}
                          row={row}
                          batchId={batchId}
                          batchName={batchName}
                          timeCell={
                            index === 0 ? (
                              <TableCell rowSpan={rows.length} className="p-1.5 pl-3 align-middle">
                                <div className={cn("flex h-full min-h-14 flex-col items-center justify-center rounded-lg px-3 py-2 text-center", TIME_RANGE_CHIPS[tones.get(group.key) ?? 0])}>
                                  <span className="text-small font-semibold whitespace-nowrap tabular-nums">
                                    {formatTime(first.start_time)} – {formatTime(first.end_time)}
                                  </span>
                                  <span className="text-small opacity-80">
                                    {instructorCount === 0 ? "No instructor" : instructorCount === 1 ? "1 instructor" : `${instructorCount} instructors`}
                                  </span>
                                </div>
                              </TableCell>
                            ) : null
                          }
                        />
                      ))}
                    </TableBody>
                  );
                })}
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
