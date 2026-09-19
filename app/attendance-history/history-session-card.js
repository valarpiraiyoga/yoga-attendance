"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Eye, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EntityCard from "@/components/ui/entity-card";
import Progress from "@/components/ui/progress";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";
import HistoryCardMenu from "@/app/attendance-history/history-card-menu";

function DateTile({ date }) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const year = parsed.getUTCFullYear();

  return (
    <span className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-brand/10 px-1 py-1.5 text-center">
      <span className="sr-only">{formatDateWithWeekday(date)}</span>
      <span aria-hidden="true" className="text-section-title font-semibold text-brand">
        {parsed.getUTCDate()}
      </span>
      <span aria-hidden="true" className="text-small font-medium whitespace-nowrap text-brand">
        {month} {year}
      </span>
    </span>
  );
}

/**
 * Attendance History card (`16-attendance-history-card-view-desktop-final.png`):
 * the session date tile, batch name and code, then time and (admin) the
 * instructor, and the session's attendance — rate, a progress bar, and
 * attended / eligible. Actions follow the finalized pattern shared with the
 * other list pages: eye icon (View Details) + overflow menu. `variant` keeps
 * the wireframe's role split: admin sees the instructor row, an instructor
 * (viewing their own sessions) sees the Completed badge instead. Composed
 * from `EntityCard`; only the menu-open tint is local state.
 */
export default function HistorySessionCard({ session, variant = "admin" }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const summary = session.attendanceSummary;
  const eligible = summary?.eligibleCount ?? 0;
  const present = summary?.presentCount ?? 0;
  const percentage = summary?.percentage ?? 0;
  const batchName = session.batches?.name ?? "—";
  const time = formatTimeRange(session.start_time, session.end_time);
  const instructor = session.instructors?.full_name ?? "—";
  const detailsHref = `/attendance-history/${session.schedule_id}/${session.session_date}`;

  const meta = [{ icon: Clock, label: time, title: time }];
  if (variant === "admin") meta.push({ icon: UserRound, label: instructor, title: instructor });

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<DateTile date={session.session_date} />}
      title={batchName}
      subtitle={session.batches?.code}
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
      meta={meta}
    >
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
