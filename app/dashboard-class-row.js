import Link from "next/link";
import { CalendarDays, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBatchColor } from "@/lib/batches/identity";
import { formatDateWithWeekday, formatTime } from "@/lib/format";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_BADGE_VARIANTS,
  DISPLAY_STATUS_LABELS,
} from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** The batch's code tile, in the batch's own saved colour (Batch Identity) - the same colour as everywhere else. */
function BatchCodeTile({ batch }) {
  const color = getBatchColor(batch?.batch_color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-xl text-body font-semibold",
        color.tile
      )}
    >
      {batch?.code || "?"}
    </span>
  );
}

function InstructorMeta({ instructor }) {
  const name = instructor?.full_name;
  const photoUrl = instructor?.photo_url;

  if (!name && !photoUrl) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-text-secondary">
        <User className="size-3.5 shrink-0" aria-hidden="true" />—
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-text-secondary">
      {photoUrl ? (
        // A plain <img>: the same tradeoff as every other stored image here (see Avatar).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-5 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] leading-none font-semibold text-brand"
        >
          {initials(name)}
        </span>
      )}
      <span className="truncate">{name || "—"}</span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />;
}

/** "Fri, Sep 25": the weekday and day, without the year (an upcoming class is always near). */
function shortDate(value) {
  return formatDateWithWeekday(value).replace(/,?\s*\d{4}$/, "");
}

function StatusPill({ status }) {
  return <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[status]}>{DISPLAY_STATUS_LABELS[status]}</Badge>;
}

/**
 * One class on the Dashboard (Today's and Upcoming Classes share it, and look the same):
 * the time stacked on the left, the batch tile, the batch name over its instructor, student
 * count and status, and the row's action. A row of a bordered list, not a card of its own, so
 * a list reads as one calm surface. Below `sm` the time moves into the name line and the
 * action sits below.
 *
 * `action` is `{ label, href, primary }`; `showDate` (Upcoming) adds the session's date above
 * the start time - and, where that column is hidden on a phone, at the front of the meta line.
 */
export default function DashboardClassRow({ session, showInstructor, timeZone, action, showDate = false }) {
  const displayStatus = deriveDisplayStatus(session, new Date(), timeZone);
  const studentCount = session.attendanceSummary?.eligibleCount ?? 0;
  const batch = session.batches;
  const name = batch?.name || "—";

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-[6.5rem_3rem_minmax(0,1fr)_auto]">
      <div className="hidden text-body leading-tight font-semibold text-text-primary sm:block">
        {showDate ? (
          <p className="text-small mb-0.5 whitespace-nowrap font-medium text-text-secondary">
            {shortDate(session.session_date)}
          </p>
        ) : null}
        <p className="whitespace-nowrap">{formatTime(session.start_time)}</p>
        {/* The end time is the quieter line: smaller, so the start time leads and the two align as a pair. */}
        <p className="text-small whitespace-nowrap font-medium text-text-secondary">– {formatTime(session.end_time)}</p>
      </div>

      <BatchCodeTile batch={batch} />

      <div className="min-w-0">
        <p className="text-body truncate font-semibold text-text-primary">
          <span className="whitespace-nowrap sm:hidden">{formatTime(session.start_time)} - </span>
          {name}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {showDate ? (
            <>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-small whitespace-nowrap text-text-secondary sm:hidden">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                {shortDate(session.session_date)}
              </span>
              <span className="sm:hidden">
                <Divider />
              </span>
            </>
          ) : null}
          {showInstructor ? (
            <>
              <InstructorMeta instructor={session.instructors} />
              <Divider />
            </>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1.5 text-small text-text-secondary">
            <Users className="size-3.5 shrink-0" aria-hidden="true" />
            {studentCount} {studentCount === 1 ? "Student" : "Students"}
          </span>
          <Divider />
          <StatusPill status={displayStatus} />
        </div>
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-1 sm:justify-end">
        <Button
          size="sm"
          variant={action.primary ? "default" : "outline"}
          className={cn(
            "w-full sm:w-auto",
            action.primary ? undefined : "border-brand/40 bg-surface text-brand hover:bg-brand/5 hover:text-brand"
          )}
          render={<Link href={action.href} />}
          nativeButton={false}
        >
          {action.label}
        </Button>
      </div>
    </div>
  );
}
