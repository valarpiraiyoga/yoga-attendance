"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, Eye, Percent, UserRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { cn } from "@/lib/utils";
import SessionCardMenu from "@/app/attendance/session-card-menu";
import { summarizeSession } from "@/app/attendance/session-summary";

/**
 * Attendance session card (`14 Attendance today-session.png`,
 * `15 Attendance all sessions.png`): identity (batch avatar, name, code,
 * session status), then Time / Instructor / Eligible students — plus Date on
 * All Sessions and the Attendance percentage once a session is completed.
 * Actions follow the finalized pattern shared with the other list pages: eye
 * icon (the session's primary action) + overflow menu. Where attendance can
 * be taken, the card also carries a full-width "Take Attendance" primary
 * button (the reference pattern) to the same route the eye links to.
 * Composed from `EntityCard`; only the menu-open tint is local state.
 */
export default function SessionCardItem({ session, today, showDate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSession(session, today);

  const meta = [];
  if (showDate) meta.push({ icon: CalendarDays, label: summary.dateLabel, title: summary.dateLabel });
  meta.push(
    { icon: Clock, label: summary.timeLabel, title: summary.timeLabel },
    { icon: UserRound, label: summary.instructor, title: summary.instructor },
    { icon: Users, label: summary.eligibleLabel, title: summary.eligibleLabel }
  );
  if (summary.attendanceLabel) {
    const label = `${summary.attendanceLabel} attendance`;
    meta.push({ icon: Percent, label, title: label });
  }

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={summary.batchName} shape="square" bordered />}
      title={summary.batchName}
      subtitle={summary.batchCode}
      status={<Badge variant={summary.status.variant}>{summary.status.label}</Badge>}
      actions={
        <>
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
        </>
      }
      meta={meta}
    >
      {summary.actionLabel === "Take Attendance" ? (
        <div className="mt-auto">
          <Button className="w-full" render={<Link href={summary.actionHref} />} nativeButton={false}>
            Take Attendance
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </EntityCard>
  );
}
