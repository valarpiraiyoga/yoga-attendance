"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstructorCell, SessionCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import SessionCardMenu from "@/app/attendance/session-card-menu";
import { summarizeSession } from "@/app/attendance/session-summary";

// Responsive by the table's own width (container queries), not the viewport —
// the same rule as Attendance History's table. Narrow (mobile): Session,
// the instructor's avatar, Status, Action, with the header row visually
// hidden. From `@xl` (36rem): the instructor's name and the Eligible column
// join and the header row shows.
const ELIGIBLE_ONLY = "hidden @[38rem]:table-cell";

const HEAD_CLASS = "h-10 px-2 text-small tracking-normal";

function SessionRow({ session, today }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSession(session, today);

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-1 pl-2 @xl:pr-2 @xl:pl-3">
        <SessionCell
          startTime={summary.startTime}
          endTime={summary.endTime}
          batchName={summary.batchName}
          batchCode={summary.batchCode}
        />
      </TableCell>
      <TableCell className="px-1 py-3 @xl:px-2">
        <InstructorCell name={summary.instructor} photoUrl={summary.instructorPhotoUrl} avatarOnlyWhenNarrow />
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-center font-semibold tabular-nums text-text-secondary", ELIGIBLE_ONLY)}>
        {summary.eligibleCount}
      </TableCell>
      <TableCell className="px-1 py-3 @xl:px-2">
        <Badge variant={summary.status.variant}>{summary.status.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3 pr-2 pl-1 whitespace-nowrap">
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

/**
 * The one Attendance session table, shared by Today's Sessions and every date
 * group of All Sessions (finalized reference): Session (clock, start time,
 * end time, batch and code — the same compact cell Attendance History uses),
 * Instructor, Eligible, Session Status, Action (eye + overflow menu). No
 * Present / Absent / Attendance columns — those are Attendance History's. The
 * primary "Take Attendance" action lives on the card and in the row's eye /
 * menu, not as a button in the row.
 */
export default function SessionTable({ sessions, today, ariaLabel }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label={ariaLabel}>
        <TableHeader className="sr-only @xl:not-sr-only">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD_CLASS, "pl-3")}>Session</TableHead>
            <TableHead className={HEAD_CLASS}>Instructor</TableHead>
            <TableHead className={cn(HEAD_CLASS, "text-center", ELIGIBLE_ONLY)}>Eligible</TableHead>
            <TableHead className={HEAD_CLASS}>Session Status</TableHead>
            <TableHead className="h-10 w-px pr-2 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <SessionRow key={session.id ?? `${session.schedule_id}:${session.session_date}`} session={session} today={today} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
