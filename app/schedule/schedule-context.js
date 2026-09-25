import { UserRound } from "lucide-react";
import BatchAvatar from "@/components/ui/batch-avatar";
import ContextCard from "@/components/ui/context-card";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";

/**
 * What a schedule popup needs to say which schedule it is about, as plain data a server
 * page or a client component can hand on. `schedule` may be empty (a schedule being
 * created has no day or time yet); the batch is then all there is to show.
 *
 * @param {object} [schedule] - a schedule row (`day_of_week`, `start_time`, `end_time`, `instructors`, `batches`).
 * @param {object} [batch] - the batch, when the schedule row does not carry it.
 */
export function scheduleContextOf(schedule, batch) {
  const source = batch ?? schedule?.batches ?? null;

  return {
    batch: {
      name: source?.name ?? "—",
      code: source?.code ?? null,
      batch_color: source?.batch_color ?? null,
      batch_image_url: source?.batch_image_url ?? null,
    },
    dayOfWeek: schedule?.day_of_week ?? null,
    startTime: schedule?.start_time ?? null,
    endTime: schedule?.end_time ?? null,
    instructor: schedule?.instructors?.full_name ?? null,
  };
}

/**
 * The context card for a popup about a schedule (deactivate, delete, review a change, view):
 * the batch's own mark (saved colour or image), the batch name and code, the day and time,
 * and the instructor.
 *
 * @param {object} props
 * @param {ReturnType<typeof scheduleContextOf>} [props.context]
 */
export default function ScheduleContext({ context }) {
  if (!context) return null;

  const when =
    context.dayOfWeek && context.startTime && context.endTime
      ? `${DAY_LABELS[context.dayOfWeek] ?? context.dayOfWeek} · ${formatTimeRange(context.startTime, context.endTime)}`
      : "New schedule";

  return (
    <ContextCard
      mark={<BatchAvatar batch={context.batch} size="lg" />}
      title={
        <>
          {context.batch.name}
          {context.batch.code ? (
            <span className="text-small font-medium text-text-secondary"> · {context.batch.code}</span>
          ) : null}
        </>
      }
      detail={when}
      meta={
        context.instructor ? (
          <>
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            {context.instructor}
          </>
        ) : null
      }
    />
  );
}
