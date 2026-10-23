import Link from "next/link";
import Avatar from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBatchColor } from "@/lib/batches/identity";
import { formatDateWithWeekday, formatTime } from "@/lib/format";
import { deriveDisplayStatus, DISPLAY_STATUS_BADGE_VARIANTS, DISPLAY_STATUS_LABELS } from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";

const HEAD = "h-10 border-b border-border bg-brand/5 px-3 text-left text-small font-medium whitespace-nowrap text-text-secondary";
const CELL = "border-b border-border/60 px-3 py-3 align-middle";

/** "Thu, 16 Oct": the weekday and day, without the year (an upcoming class is always near). */
function shortDate(value) {
  return formatDateWithWeekday(value).replace(/,?\s*\d{4}$/, "");
}

/** The batch's code tile, in the batch's own saved colour (Batch Identity), with the name beside it. */
function BatchCell({ batch }) {
  const color = getBatchColor(batch?.batch_color);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border text-small font-semibold", color.tile, color.border)}>
        {batch?.code || "?"}
      </span>
      <span className="text-body truncate font-medium text-text-primary">{batch?.name || "—"}</span>
    </span>
  );
}

/**
 * "Present / Eligible" for a session whose attendance has been taken or is being taken (from its existing `attendanceSummary`); a dash for a
 * session still to come, cancelled or a holiday - never a made-up count.
 */
function studentsOf(session, displayStatus) {
  const summary = session.attendanceSummary;
  if (!summary || displayStatus === "upcoming" || session.status === "cancelled" || session.status === "holiday") return "–";
  return `${summary.presentCount ?? 0} / ${summary.eligibleCount ?? 0}`;
}

/**
 * The Dashboard's classes as a table from `md` up (Today's Classes and Upcoming Classes; the phone keeps the stacked `DashboardClassRow`s):
 * [Date,] Time, Batch (its colour tile and name), Instructor & Status (one column for an Admin: the instructor with the status badge beneath; just
 * Status otherwise), Students and the row's action button - the same label,
 * destination and emphasis the rows use (`actionOf(session)` -> `{ label, href, primary }`).
 */
export default function DashboardClassTable({ sessions, showInstructor, timeZone, actionOf, showDate = false, ariaLabel }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table aria-label={ariaLabel} className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            {showDate ? <th scope="col" className={HEAD}>Date</th> : null}
            <th scope="col" className={HEAD}>Time</th>
            <th scope="col" className={HEAD}>Batch</th>
            {/* Instructor and Status share one column for an Admin: the instructor, with the status beneath. */}
            <th scope="col" className={HEAD}>{showInstructor ? "Instructor & Status" : "Status"}</th>
            <th scope="col" className={HEAD}>Students</th>
            <th scope="col" className={cn(HEAD, "w-px")}>{showDate ? "Action" : "Actions"}</th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {sessions.map((session) => {
            const displayStatus = deriveDisplayStatus(session, new Date(), timeZone);
            const action = actionOf(session);
            const instructor = session.instructors;
            return (
              <tr key={session.id ?? `${session.schedule_id}:${session.session_date}`}>
                {showDate ? (
                  <td className={cn(CELL, "text-body whitespace-nowrap text-text-primary")}>{shortDate(session.session_date)}</td>
                ) : null}
                <td className={cn(CELL, "whitespace-nowrap")}>
                  <p className="text-body font-semibold text-text-primary">{formatTime(session.start_time)}</p>
                  <p className="text-small text-text-secondary">{formatTime(session.end_time)}</p>
                </td>
                <td className={CELL}>
                  <BatchCell batch={session.batches} />
                </td>
                <td className={CELL}>
                  {showInstructor ? (
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* The avatar on the left; the name, then the status badge beneath it, on the right. */}
                      <Avatar name={instructor?.full_name ?? "—"} src={instructor?.photo_url} size="md" className="shrink-0" />
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <span className="text-body truncate font-medium text-text-primary">{instructor?.full_name ?? "—"}</span>
                        <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
                      </div>
                    </div>
                  ) : (
                    <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
                  )}
                </td>
                <td className={cn(CELL, "text-body whitespace-nowrap text-text-primary tabular-nums")}>{studentsOf(session, displayStatus)}</td>
                <td className={cn(CELL, "w-px whitespace-nowrap")}>
                  <Button
                    size="sm"
                    variant={action.primary ? "default" : "outline"}
                    className={action.primary ? undefined : "border-brand/40 bg-surface text-brand hover:bg-brand/5 hover:text-brand"}
                    render={<Link href={action.href} />}
                    nativeButton={false}
                  >
                    {action.label}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
