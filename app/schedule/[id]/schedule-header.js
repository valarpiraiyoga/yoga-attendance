import Link from "next/link";
import { ArrowLeft, CalendarDays, CircleCheck, Clock, Hash, Pencil, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import { formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import DeactivateSchedule from "@/app/schedule/[id]/deactivate-schedule";

function describe(schedule) {
  return {
    isActive: schedule.status === "active",
    status: ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive,
    batchName: schedule.batches?.name ?? "Schedule",
    batchCode: schedule.batches?.code || "—",
    dayLabel: DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week,
    timeLabel: formatTimeRange(schedule.start_time, schedule.end_time),
    instructorName: schedule.instructors?.full_name ?? "—",
  };
}

/**
 * Schedule Details' back link + the finalized detail header (the same one
 * Student, Membership and Batch Details use): batch avatar, batch name,
 * status, the schedule's code / day / time / instructor, and the Edit /
 * Deactivate actions. The parent stacks this with the summary tiles and the
 * tabs (`gap-6`).
 */
export default function ScheduleHeader({ schedule, today }) {
  const { isActive, status, batchName, batchCode, dayLabel, timeLabel, instructorName } = describe(schedule);

  return (
    <>
      <Link
        href="/schedule"
        className="text-body inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Schedule
      </Link>

      <EntityDetailHeader
        className="mb-0"
        avatar={<Avatar name={batchName} shape="square" size="lg" />}
        title={batchName}
        status={<Badge variant={status.variant}>{status.label}</Badge>}
        subMeta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 shrink-0" aria-hidden="true" />
              Code: {batchCode}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
              {dayLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {timeLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              {instructorName}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="outline" render={<Link href={`/schedule/${schedule.id}/edit`} />} nativeButton={false}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit Schedule
            </Button>
            <DeactivateSchedule scheduleId={schedule.id} isActive={isActive} today={today} />
          </>
        }
      />
    </>
  );
}

/** The four summary tiles under the header (finalized `StatTile`s). */
export function ScheduleSummary({ schedule }) {
  const { isActive, status, dayLabel, timeLabel, instructorName } = describe(schedule);

  return (
    <StatTileGroup ariaLabel="Schedule summary" className="grid-cols-1 sm:grid-cols-2">
      <StatTile icon={CircleCheck} label="Status" value={status.label} tone={isActive ? "success" : "warning"} />
      <StatTile icon={CalendarDays} label="Day" value={dayLabel} tone="brand" />
      <StatTile icon={Clock} label="Time" value={timeLabel} tone="info" />
      <StatTile icon={UserRound} label="Instructor" value={instructorName} tone="warning" />
    </StatTileGroup>
  );
}
