"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Eye } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EntityCard from "@/components/ui/entity-card";
import Progress from "@/components/ui/progress";
import { formatDateWithWeekday, formatTime } from "@/lib/format";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";
import HistoryCardMenu from "@/app/attendance-history/history-card-menu";

function DateTile({ date }) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();

  // Compact and secondary: the card normally sits inside a date group whose
  // header already carries the full date, so the tile is just day + month.
  return (
    <span
      title={formatDateWithWeekday(date)}
      className="flex size-14 shrink-0 flex-col items-center justify-center rounded-full bg-brand/10 text-center leading-tight"
    >
      <span className="sr-only">{formatDateWithWeekday(date)}</span>
      <span aria-hidden="true" className="text-section-title font-semibold text-brand">
        {parsed.getUTCDate()}
      </span>
      <span aria-hidden="true" className="text-small font-medium text-brand">
        {month}
      </span>
    </span>
  );
}

/**
 * The session time — the card's primary focus. Each half stays whole so a
 * narrow card wraps only at the dash.
 */
function SessionTime({ startTime, endTime }) {
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-section-title leading-snug font-semibold text-text-primary">
      <Clock className="mt-1 size-5 shrink-0 text-brand" aria-hidden="true" />
      <span>
        <span className="whitespace-nowrap">{formatTime(startTime)} –</span>{" "}
        <span className="whitespace-nowrap">{formatTime(endTime)}</span>
      </span>
    </p>
  );
}

/**
 * Attendance History card (`ui-reference/02/attendance history.png`, refined):
 * a compact date tile, batch name and "Code: XYZ" with the View / More
 * actions, then the session time as the primary line — beside the prominent
 * instructor avatar, name and role for an admin — and the session's
 * attendance: rate, progress bar, attended / eligible. `variant` keeps the
 * wireframe's role split: admin sees the instructor beside the time, an
 * instructor (viewing their own sessions) sees the time alone and the
 * Completed badge. Composed from `EntityCard`; only the menu-open tint is
 * local state.
 */
export default function HistorySessionCard({ session, variant = "admin" }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const summary = session.attendanceSummary;
  const eligible = summary?.eligibleCount ?? 0;
  const present = summary?.presentCount ?? 0;
  const percentage = summary?.percentage ?? 0;
  const batchName = session.batches?.name ?? "—";
  const instructor = session.instructors?.full_name ?? "—";
  const code = session.batches?.code;
  const detailsHref = `/attendance-history/${session.schedule_id}/${session.session_date}`;

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      avatar={<DateTile date={session.session_date} />}
      title={batchName}
      subtitle={code ? `Code: ${code}` : null}
      status={
        variant === "instructor" ? (
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}>{DISPLAY_STATUS_LABELS.completed}</Badge>
        ) : null
      }
      actions={
        <>
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
        </>
      }
    >
      {variant === "admin" ? (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={session.instructors?.full_name} src={session.instructors?.photo_url} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-l border-border pl-3">
            <SessionTime startTime={session.start_time} endTime={session.end_time} />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-text-primary">{instructor}</p>
              <p className="text-small text-text-secondary">Instructor</p>
            </div>
          </div>
        </div>
      ) : (
        <SessionTime startTime={session.start_time} endTime={session.end_time} />
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-small text-text-secondary">Attendance</span>
          <span className="text-body font-semibold text-text-primary">{percentage}%</span>
        </div>
        <Progress value={percentage} tone="brand" label={`Attendance rate for ${batchName}`} />
        <p className="text-small text-text-secondary">
          <span className="font-semibold text-text-primary">
            {present} / {eligible}
          </span>{" "}
          attended
        </p>
      </div>
    </EntityCard>
  );
}
