import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardCheck, Clock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import BatchAvatar from "@/components/ui/batch-avatar";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import SessionActionsMenu from "@/app/attendance/[scheduleId]/[date]/session-actions-menu";
import { sessionContextOf } from "@/app/attendance/session-context";

/**
 * The one-line session summary at the top of Take Attendance: which class this is
 * (the batch's own mark, name and status) and when and who (date, time, instructor),
 * nothing more, so the students are on screen straight away. The admin's Edit This
 * Session and Mark Cancelled / Holiday actions sit in an overflow menu at the right
 * (`session-actions-menu.js`); an Instructor sees no menu. A session note, when the
 * session has one, is a quiet second line.
 *
 * Everything shown is data the session already carries - there is no room /
 * location on a class session, so none is shown.
 */
export default function SessionHeader({
  session,
  displayStatus,
  scheduleId,
  date,
  isAdmin,
  canEdit,
  canMarkException,
}) {
  const batchName = session.batches?.name ?? "—";
  const base = `/attendance/${scheduleId}/${date}`;
  const hasActions = isAdmin && (canEdit || canMarkException);

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-center gap-3">
        <BatchAvatar batch={{ ...session.batches, name: batchName }} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-section-title font-semibold break-words text-text-primary">{batchName}</p>
            <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
          </div>
          <div className="text-small mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
              {formatDateWithWeekday(session.session_date)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {formatTimeRange(session.start_time, session.end_time)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              {session.instructors?.full_name ?? "—"}
            </span>
            <Link
              href={`${base}/details`}
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
            >
              Session details
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {hasActions ? (
          <SessionActionsMenu
            scheduleId={scheduleId}
            date={date}
            base={base}
            canEdit={canEdit}
            canMarkException={canMarkException}
            sessionContext={sessionContextOf(session)}
          />
        ) : null}
      </div>

      {session.note ? (
        <p className="text-small mt-3 flex items-start gap-1.5 border-t border-border pt-3 break-words whitespace-pre-line text-text-secondary">
          <ClipboardCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {session.note}
        </p>
      ) : null}
    </div>
  );
}
