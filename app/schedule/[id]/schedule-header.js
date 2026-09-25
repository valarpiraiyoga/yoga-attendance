import Link from "next/link";
import { CalendarClock, CalendarDays, Clock, Layers, Pencil, RefreshCw, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StartTimeTile from "@/components/ui/start-time-tile";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import { formatDate, formatDateWithWeekday, formatDuration, formatTime, formatTimeRange } from "@/lib/format";
import { ENTITY_STATUS } from "@/lib/status";
import { DAY_LABELS } from "@/lib/schedules/validation";
import DeactivateSchedule from "@/app/schedule/[id]/deactivate-schedule";
import { scheduleContextOf } from "@/app/schedule/schedule-context";

function describe(schedule) {
  return {
    isActive: schedule.status === "active",
    status: ENTITY_STATUS[schedule.status] ?? ENTITY_STATUS.inactive,
    batchName: schedule.batches?.name ?? "Schedule",
    batchCode: schedule.batches?.code || null,
    dayLabel: DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week,
    timeLabel: formatTimeRange(schedule.start_time, schedule.end_time),
    instructorName: schedule.instructors?.full_name ?? "—",
  };
}

/**
 * Schedule Details' header card, in the same shape as Session Details': the schedule's
 * start-time tile, and as the heading WHEN it happens - "Every Sunday · 6:00 AM - 7:00 AM",
 * the day and start time large, the end time small - with the batch's code as a small mark and
 * the schedule's status beside it. Under it, which batch and who teaches it. Edit Schedule and
 * Deactivate Schedule sit at the right. The parent stacks this with the summary cards
 * (`ScheduleSummary`) and the page's content (`gap-6`).
 */
export default function ScheduleHeader({ schedule, today }) {
  const { isActive, status, batchName, batchCode, dayLabel, timeLabel, instructorName } = describe(schedule);

  return (
    <EntityDetailHeader
      decorative={false}
      wash
      className="mb-0"
      avatar={<StartTimeTile startTime={schedule.start_time} label={timeLabel} />}
      title={
        <>
          Every {dayLabel}
          {/* On a phone the time drops to its own line, so no separator is left dangling. */}
          <span className="text-section-title hidden font-medium text-text-secondary sm:inline"> · </span>
          <span className="block sm:inline">
            {formatTime(schedule.start_time)}
            <span className="text-section-title font-medium text-text-secondary"> – {formatTime(schedule.end_time)}</span>
          </span>
          {batchCode ? (
            <span className="text-small mt-1 inline-flex items-center rounded-md bg-brand/10 px-2 py-0.5 align-middle font-semibold text-brand sm:mt-0 sm:ml-2">
              {batchCode}
            </span>
          ) : null}
        </>
      }
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      subMeta={
        <>
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-medium text-text-primary">{batchName}</span>
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
          <DeactivateSchedule
            scheduleId={schedule.id}
            isActive={isActive}
            today={today}
            scheduleContext={scheduleContextOf(schedule)}
          />
        </>
      }
    />
  );
}

/**
 * The four summary cards under the header. They say what the header does not: how often and how
 * long the class is, the period the schedule is in force, and when its next session is - not the
 * day, time and instructor the header already states.
 */
export function ScheduleSummary({ schedule, upcomingSessions }) {
  const { dayLabel, timeLabel } = describe(schedule);
  const next = upcomingSessions[0] ?? null;

  return (
    // The tiles Student / Membership / Batch Details use: 1 / 2 / 4 columns.
    <StatTileGroup ariaLabel="Schedule summary" columns={2} className="-mt-2 grid-cols-1 xl:grid-cols-4">
      <StatTile compact icon={RefreshCw} label="Frequency" value="Weekly" caption={`Every ${dayLabel}`} tone="brand" />
      <StatTile
        compact
        icon={Clock}
        label="Duration"
        value={formatDuration(schedule.start_time, schedule.end_time)}
        caption="Each session"
        tone="info"
      />
      <StatTile
        compact
        icon={CalendarDays}
        label="Effective From"
        value={formatDate(schedule.effective_from)}
        caption={schedule.effective_until ? `Until ${formatDate(schedule.effective_until)}` : "Open-ended"}
        tone="neutral"
      />
      <StatTile
        compact
        icon={CalendarClock}
        label="Next Session"
        value={next ? formatDateWithWeekday(next.date) : "None"}
        caption={next ? timeLabel : "Inactive or ended"}
        tone={next ? "success" : "warning"}
      />
    </StatTileGroup>
  );
}
