import { UserRound } from "lucide-react";
import ContextCard from "@/components/ui/context-card";
import StartTimeTile from "@/components/ui/start-time-tile";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";

/**
 * What a session-level dialog needs to say which session it belongs to, as plain data a
 * server page can hand to a client component.
 *
 * @param {object} session - a session occurrence (with its `batches` and `instructors`).
 */
export function sessionContextOf(session) {
  return {
    batchName: session.batches?.name ?? "—",
    batchCode: session.batches?.code ?? null,
    date: session.session_date,
    startTime: session.start_time,
    endTime: session.end_time,
    instructor: session.instructors?.full_name ?? null,
  };
}

/**
 * The context card for a popup about a session (Mark Cancelled / Holiday, review attendance,
 * review a session change): the session's start-time tile - the same mark the session card and
 * Session Details use - then the batch and its code, the date and time, and the instructor.
 * Renders nothing without a context, so a caller that has none is unchanged.
 *
 * @param {object} props
 * @param {ReturnType<typeof sessionContextOf>} [props.context]
 */
export default function SessionContext({ context }) {
  if (!context) return null;

  const timeLabel = formatTimeRange(context.startTime, context.endTime);

  return (
    <ContextCard
      mark={<StartTimeTile startTime={context.startTime} label={timeLabel} />}
      title={
        <>
          {context.batchName}
          {context.batchCode ? (
            <span className="text-small font-medium text-text-secondary"> · {context.batchCode}</span>
          ) : null}
        </>
      }
      detail={`${formatDateWithWeekday(context.date)} · ${timeLabel}`}
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
