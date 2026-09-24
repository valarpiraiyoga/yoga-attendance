"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Eye } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Progress from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import HistoryCardMenu from "@/app/attendance-history/history-card-menu";

// Responsive by the table's own width (container queries — the timeline gives
// each group's region `@container`), not the viewport: the page's calendar
// column narrows the table at desktop widths, so a viewport breakpoint would
// misjudge it. Narrow (mobile): Session, Attendance, Action. From `@xl`
// (36rem): the Instructor column joins. From `@2xl` (42rem): the Eligible /
// Present / Absent counts too — the whole table fits from there, including
// the ~750px table a 1440px screen leaves beside the calendar.
const INSTRUCTOR_ONLY = "hidden @xl:table-cell";
const COUNTS_ONLY = "hidden @2xl:table-cell";

const HEAD_CLASS = "h-10 px-2 text-small tracking-normal";

function GroupRow({ session, variant }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const summary = session.attendanceSummary;
  const percentage = summary?.percentage ?? 0;
  const instructorName = session.instructors?.full_name ?? null;
  const batchName = session.batches?.name ?? "—";
  const code = session.batches?.code;
  const detailsHref = `/attendance-history/${session.schedule_id}/${session.session_date}`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      {/* Session: clock + start time (strong), end time (muted), then the batch
          name with its code inline and muted. */}
      <TableCell className="py-3 pr-1 pl-2 @xl:pr-2 @xl:pl-3">
        <div className="flex items-center gap-2 @xl:gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center @xl:size-8 justify-center rounded-full bg-brand/10 text-brand"
          >
            <Clock className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="leading-tight whitespace-nowrap">
              <span className="text-section-title font-semibold whitespace-nowrap text-text-primary">
                {formatTime(session.start_time)}
              </span>{" "}
              <span className="text-small whitespace-nowrap text-text-secondary">– {formatTime(session.end_time)}</span>
            </p>
            <p className="leading-snug">
              <span className="text-body font-medium text-text-primary">{batchName}</span>
              {code ? <span className="text-small whitespace-nowrap text-text-secondary"> · {code}</span> : null}
            </p>
          </div>
        </div>
      </TableCell>
      {variant === "admin" ? (
        <TableCell className={cn("px-2 py-3", INSTRUCTOR_ONLY)}>
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar name={instructorName} src={session.instructors?.photo_url} size="sm" />
            <span className="min-w-0">
              <span className="block text-small font-semibold whitespace-nowrap text-text-primary">
                {instructorName || "—"}
              </span>
              <span className="block text-small text-text-secondary">Instructor</span>
            </span>
          </span>
        </TableCell>
      ) : null}
      <TableCell className={cn("px-1.5 py-3 text-center font-semibold tabular-nums text-text-secondary", COUNTS_ONLY)}>
        {summary?.eligibleCount ?? 0}
      </TableCell>
      <TableCell className={cn("px-1.5 py-3 text-center font-semibold tabular-nums text-success", COUNTS_ONLY)}>
        {summary?.presentCount ?? 0}
      </TableCell>
      <TableCell className={cn("px-1.5 py-3 text-center font-semibold tabular-nums text-warning", COUNTS_ONLY)}>
        {summary?.absentCount ?? 0}
      </TableCell>
      {variant === "admin" ? (
        <TableCell className="px-1.5 py-3 @xl:px-2">
          <div className="w-16 @xl:w-20">
            <p className="text-body leading-tight font-bold tabular-nums text-text-primary">{percentage}%</p>
            <Progress value={percentage} tone="brand" label={`Attendance rate for ${batchName}`} className="mt-1" />
          </div>
        </TableCell>
      ) : (
        <TableCell className="px-2 py-3">
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed} className="rounded-full px-2 py-0">
            <span className="text-[10px] leading-[14px] font-medium">{DISPLAY_STATUS_LABELS.completed}</span>
          </Badge>
        </TableCell>
      )}
      <TableCell className="w-px py-3 pr-2 pl-1 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View attendance details for ${batchName}`}
            render={<Link href={detailsHref} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <HistoryCardMenu batchName={batchName} detailsHref={detailsHref} onOpenChange={setMenuOpen} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * One date's sessions as a table (finalized Table view): Session (start time,
 * end time, batch name and code in one compact column), Instructor, Eligible,
 * Present, Absent, Attendance (rate over a progress bar), Action. The date is
 * the group header above, so there is no Date column. `variant` keeps the
 * wireframe's role split: an instructor (who only ever sees their own
 * sessions) has no Instructor column and sees the Completed status instead of
 * the attendance rate.
 */
export default function HistoryGroupTable({ sessions, variant = "admin", ariaLabel }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label={ariaLabel}>
        <TableHeader className="sr-only @xl:not-sr-only">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD_CLASS, "pl-3")}>Session</TableHead>
            {variant === "admin" ? <TableHead className={cn(HEAD_CLASS, INSTRUCTOR_ONLY)}>Instructor</TableHead> : null}
            <TableHead className={cn(HEAD_CLASS, "px-1.5 text-center", COUNTS_ONLY)}>Eligible</TableHead>
            <TableHead className={cn(HEAD_CLASS, "px-1.5 text-center", COUNTS_ONLY)}>Present</TableHead>
            <TableHead className={cn(HEAD_CLASS, "px-1.5 text-center", COUNTS_ONLY)}>Absent</TableHead>
            <TableHead className={HEAD_CLASS}>{variant === "admin" ? "Attendance" : "Status"}</TableHead>
            <TableHead className="h-10 w-px pr-2 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <GroupRow key={session.id} session={session} variant={variant} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
