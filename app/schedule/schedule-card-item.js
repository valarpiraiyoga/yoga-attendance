"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, CalendarRange, Clock, Eye, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import { formatDate, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";
import ScheduleCardMenu from "@/app/schedule/schedule-card-menu";

/**
 * Schedule list card (`12 schedule list card view.png`): identity (batch
 * avatar, name, code, status), then Day / Time / Instructor / Effective
 * period. One card is one recurring schedule record, so it has a single Day.
 * Actions follow the finalized pattern shared with Students, Memberships and
 * Batches: eye icon (View) + overflow menu. Composed from `EntityCard`; only
 * the menu-open tint is local state.
 */
export default function ScheduleCardItem({ schedule }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive;
  const batchName = schedule.batches?.name ?? "—";
  const day = DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week;
  const time = formatTimeRange(schedule.start_time, schedule.end_time);
  const instructor = schedule.instructors?.full_name ?? "—";
  const effective = `${formatDate(schedule.effective_from)} – ${formatDate(schedule.effective_until)}`;

  return (
    <EntityCard
      className={cn(menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={batchName} shape="square" bordered />}
      title={batchName}
      subtitle={schedule.batches?.code ?? "No batch"}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View schedule for ${batchName}`}
            render={<Link href={`/schedule/${schedule.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <ScheduleCardMenu
            scheduleId={schedule.id}
            batchId={schedule.batches?.id}
            batchName={batchName}
            onOpenChange={setMenuOpen}
          />
        </>
      }
      meta={[
        { icon: CalendarDays, label: day, title: day },
        { icon: Clock, label: time, title: time },
        { icon: UserRound, label: instructor, title: instructor },
        { icon: CalendarRange, label: effective, title: `Effective ${effective}` },
      ]}
    />
  );
}
