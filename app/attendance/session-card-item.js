"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import StartTimeTile from "@/components/ui/start-time-tile";
import { cn } from "@/lib/utils";
import SessionCardMenu from "@/app/attendance/session-card-menu";
import { sessionContextOf } from "@/app/attendance/session-context";
import { summarizeSession } from "@/app/attendance/session-summary";

/**
 * Attendance session card, shared by Today's Sessions and All Sessions
 * (finalized reference): the start-time tile, batch name and "Code: XYZ", the
 * status badge stacked under the View / More actions, the full time range, the
 * instructor (avatar, name, role) beside the Eligible count, and one primary
 * action — "Take Attendance →" where attendance can be taken, otherwise an
 * outline "View Attendance" / "View Session" to the same routes the eye and
 * menu use. Composed from `EntityCard`; only the menu-open tint is local state.
 */
export default function SessionCardItem({ session, today, timeZone, isAdmin = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSession(session, today, timeZone);
  const canTake = summary.actionLabel === "Take Attendance";

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      avatar={<StartTimeTile startTime={summary.startTime} label={summary.timeLabel} />}
      title={summary.batchName}
      subtitle={summary.batchCode ? `Code: ${summary.batchCode}` : null}
      status={<Badge variant={summary.status.variant}>{summary.status.label}</Badge>}
      statusPlacement="actions"
      actions={
        <div className="flex items-center">
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
            scheduleId={session.schedule_id}
            date={session.session_date}
            canMarkException={isAdmin && session.status === "scheduled"}
            sessionContext={sessionContextOf(session)}
            onOpenChange={setMenuOpen}
          />
        </div>
      }
      meta={[{ icon: CalendarDays, label: summary.timeLabel, title: summary.timeLabel }]}
      iconClassName="text-brand"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={summary.instructor} src={summary.instructorPhotoUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-small font-semibold text-text-primary" title={summary.instructor}>
            {summary.instructor}
          </p>
          <p className="text-small text-text-secondary">Instructor</p>
        </div>
        <div
          className="flex shrink-0 flex-col items-center rounded-lg border border-border bg-background px-3 py-1 text-center leading-tight"
          aria-label={summary.eligibleLabel}
        >
          <span className="text-section-title font-semibold text-text-primary tabular-nums">
            {summary.eligibleCount}
          </span>
          <span className="text-small text-text-secondary">Eligible</span>
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant={canTake ? "default" : "outline"}
          className="w-full"
          render={<Link href={summary.actionHref} />}
          nativeButton={false}
        >
          {summary.actionLabel}
          {canTake ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
        </Button>
      </div>
    </EntityCard>
  );
}
