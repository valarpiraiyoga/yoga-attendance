"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Progress from "@/components/ui/progress";
import { InstructorCell, SessionCell } from "@/components/ui/session-cells";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import SessionCardMenu from "@/app/attendance/session-card-menu";
import { sessionContextOf } from "@/app/attendance/session-context";
import { summarizeSession } from "@/app/attendance/session-summary";

// Responsive by the table's own width (container queries), not the viewport -
// the same rule as Attendance History's table. Narrow (mobile): Session,
// the instructor's avatar, Status, Actions, with the header row visually
// hidden. From 38rem: the instructor's name and the Eligible column join and
// the header row shows. From 46rem: Attendance.
const ELIGIBLE_ONLY = "hidden @[38rem]:table-cell";
const ATTENDANCE_ONLY = "hidden @[46rem]:table-cell";

// Each session is its own rounded row card on the page background (the table is `border-separate`, with a gap between rows) - the same look as
// the Students, Memberships and Batches tables: a pale rounded header strip, and every row's cells carry the surface and the pale border,
// rounded at the row's two ends.
const HEAD_CLASS = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";
const SURFACE = "[&>td]:bg-surface";
const SURFACE_OPEN = "[&>td]:bg-brand/10";

/**
 * The Attendance cell's figures, from the session's existing `attendanceSummary` (nothing is computed from the database here):
 *   - a completed session: Present / Eligible with its attendance percentage (the summary's own `percentage`), green;
 *   - a session still to be taken or in progress: how many of the eligible students are marked so far, blue;
 *   - a Cancelled / Holiday session, or one whose summary could not be read: no figure (a dash), never zeros.
 */
function attendanceOf(session) {
  const summary = session.attendanceSummary;
  if (!summary || session.status === "cancelled" || session.status === "holiday") return null;
  const eligible = summary.eligibleCount ?? 0;
  if (session.status === "completed") {
    return { count: summary.presentCount ?? 0, eligible, percent: summary.percentage ?? 0, tone: "success", label: "Present of eligible students" };
  }
  const marked = (summary.presentCount ?? 0) + (summary.absentCount ?? 0);
  return { count: marked, eligible, percent: eligible > 0 ? Math.round((marked / eligible) * 100) : 0, tone: "brand", label: "Students marked so far, of eligible" };
}

function SessionRow({ session, today, timeZone, isAdmin }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSession(session, today, timeZone);
  const attendance = attendanceOf(session);
  const takes = summary.actionLabel === "Take Attendance";

  return (
    <TableRow className={cn("border-0 hover:bg-transparent", menuOpen ? SURFACE_OPEN : SURFACE)}>
      <TableCell className={cn(CELL, "py-3 pr-1 pl-2 @xl:pr-2 @xl:pl-3")}>
        <SessionCell
          startTime={summary.startTime}
          endTime={summary.endTime}
          batchName={summary.batchName}
          batchCode={summary.batchCode}
          batchColor={summary.batchColor}
        />
      </TableCell>
      <TableCell className={cn(CELL, "px-1 @xl:px-2")}>
        <InstructorCell name={summary.instructor} photoUrl={summary.instructorPhotoUrl} avatarOnlyWhenNarrow />
      </TableCell>
      <TableCell className={cn(CELL, "text-center font-semibold tabular-nums text-text-secondary", ELIGIBLE_ONLY)}>
        {summary.eligibleCount}
      </TableCell>
      <TableCell className={cn(CELL, ATTENDANCE_ONLY)}>
        {attendance ? (
          <div className="min-w-40" title={attendance.label}>
            <p className="text-body font-semibold text-text-primary tabular-nums">
              {attendance.count} / {attendance.eligible}
              <span className="sr-only"> ({attendance.label})</span>
            </p>
            <div className="flex items-center gap-3">
              <Progress value={attendance.percent} tone={attendance.tone} label={attendance.label} className="flex-1" />
              <span className="text-small w-10 shrink-0 text-text-secondary tabular-nums">{attendance.percent}%</span>
            </div>
          </div>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className={cn(CELL, "px-1 @xl:px-2")}>
        <Badge variant={summary.status.variant}>{summary.status.label}</Badge>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-2 pl-1 whitespace-nowrap")}>
        <div className="flex items-center gap-1">
          {/* The row's primary action as a labelled button, by the session's status: Take Attendance, View Attendance or View Session. */}
          <Button
            type="button"
            variant={takes ? "default" : "outline"}
            size="sm"
            aria-label={`${summary.actionLabel} for ${summary.batchName}`}
            render={<Link href={summary.actionHref} />}
            nativeButton={false}
          >
            {summary.actionLabel}
          </Button>
          <SessionCardMenu
            batchName={summary.batchName}
            actionLabel={summary.actionLabel}
            actionHref={summary.actionHref}
            detailsHref={summary.detailsHref}
            scheduleId={session.schedule_id}
            date={session.session_date}
            canMarkException={isAdmin && session.status === "scheduled"}
            sessionContext={sessionContextOf(session)}
            onOpenChange={setMenuOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * The one Attendance session table, shared by Today's Sessions and every date group of All Sessions (finalized reference): Session (clock, start
 * time, end time, batch and code - the same compact cell Attendance History uses), Instructor, Eligible, Attendance (the figures and a progress
 * bar of `attendanceOf`), Status, and Actions: the primary action as a labelled button - Take Attendance (primary), View Attendance or View
 * Session (outlined), by the session's status - beside the overflow menu.
 */
export default function SessionTable({ sessions, today, timeZone, ariaLabel, isAdmin = false }) {
  return (
    <div className="@container">
      <Table aria-label={ariaLabel} className="border-separate border-spacing-y-2">
        <TableHeader className="sr-only @xl:not-sr-only">
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD_CLASS, "pl-3")}>Session</TableHead>
            <TableHead className={HEAD_CLASS}>Instructor</TableHead>
            <TableHead className={cn(HEAD_CLASS, "text-center", ELIGIBLE_ONLY)}>Eligible</TableHead>
            <TableHead className={cn(HEAD_CLASS, ATTENDANCE_ONLY)}>Attendance</TableHead>
            <TableHead className={HEAD_CLASS}>Status</TableHead>
            <TableHead className={cn(HEAD_CLASS, "w-px pr-2 pl-1 whitespace-nowrap")}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <SessionRow key={session.id ?? `${session.schedule_id}:${session.session_date}`} session={session} today={today} timeZone={timeZone} isAdmin={isAdmin} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
