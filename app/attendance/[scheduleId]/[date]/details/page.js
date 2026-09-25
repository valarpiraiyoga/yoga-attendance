import { notFound } from "next/navigation";
import Link from "next/link";
import { CircleCheck, CircleX, ClipboardCheck, Layers, Percent, UserRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FlashToast from "@/components/ui/flash-toast";
import StartTimeTile from "@/components/ui/start-time-tile";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import Container from "@/components/layout/Container";
import { EntityDetailHeader } from "@/components/layout/EntityDetailHeader";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_BADGE_VARIANTS,
  DISPLAY_STATUS_LABELS,
  todayInCentreTimezone,
} from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { listEligibleStudents, getAttendanceSummary } from "@/lib/attendance/data";
import { formatDateWithWeekday, formatTime, formatTimeRange } from "@/lib/format";
import EligibleStudentsList from "@/app/attendance/[scheduleId]/[date]/eligible-students-list";
import SessionActionsMenu from "@/app/attendance/[scheduleId]/[date]/session-actions-menu";
import { sessionContextOf } from "@/app/attendance/session-context";
import { sessionActionLabel } from "@/app/attendance/session-summary";

const SUCCESS_MESSAGES = {
  updated: "Session updated successfully.",
  unchanged: "No changes were made.",
};

/**
 * Session Details ("View Session Details" in the Attendance list): what this session is,
 * how its attendance stands, and who is eligible. The finalized detail pattern: the compact
 * page strip, the detail header card, four KPI cards (Eligible, Present, Absent, Attendance -
 * the same four Attendance Details shows), then the Eligible Students list.
 *
 * The header card is about the SESSION, not the batch: its heading is the session's date, time
 * (smaller) and the batch code (a small mark), with the session's own status beside it (a
 * Cancelled badge means this session is cancelled, never the batch), and under it the batch
 * name and the instructor - the same
 * facts the session card in the list shows - so there is no separate Session Information
 * panel. Take / View Attendance and the admin's Edit This Session / Mark Cancelled-or-Holiday
 * (overflow menu) sit at the right.
 *
 * Marking attendance is its own screen (`../page.js`, "Take Attendance"); the header's action
 * opens it whenever the session has attendance to take or view. Addressed by
 * `(scheduleId, date)` like that screen, so a projected occurrence and a stored one both work
 * (01-product.md §7A).
 */
export default async function SessionDetailsPage({ params, searchParams }) {
  const user = await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const isAdmin = user.role === ROLES.ADMIN;

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session) {
    notFound();
  }

  const timeZone = await getCenterTimezone();
  const displayStatus = deriveDisplayStatus(session, new Date(), timeZone);
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const [eligibleStudents, attendanceSummary] = await Promise.all([
    listEligibleStudents(session.batch_id, session.schedule_id, session.session_date),
    getAttendanceSummary(session.id, session.batch_id, session.schedule_id, session.session_date),
  ]);

  const batchName = session.batches?.name ?? "—";
  const batchCode = session.batches?.code ?? null;
  const base = `/attendance/${scheduleId}/${date}`;
  const canEdit = displayStatus === "upcoming";
  const canMarkException = session.status === "scheduled";
  const timeLabel = formatTimeRange(session.start_time, session.end_time);
  // The heading sets the day and month and the start time large, the year and the end time small.
  const fullDate = formatDateWithWeekday(session.session_date);
  const yearAt = fullDate.search(/,?\s*\d{4}$/);
  const dayMonth = yearAt > 0 ? fullDate.slice(0, yearAt) : fullDate;
  const yearLabel = yearAt > 0 ? fullDate.slice(yearAt) : "";

  // The same rule as the list's row action; a session with nothing to take or view has none.
  const actionLabel = sessionActionLabel(session, todayInCentreTimezone(new Date(), timeZone));
  const summary = attendanceSummary ?? {};
  const marked = (summary.presentCount ?? 0) + (summary.absentCount ?? 0);
  // A cancelled or holiday session has no attendance to mark, so "not marked yet" would mislead.
  const takesAttendance = session.status !== "cancelled" && session.status !== "holiday";
  const unmarked = takesAttendance ? (summary.unmarkedCount ?? 0) : 0;

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/attendance", label: "Back to Attendance" }}
        title="Session Details"
        description={`Information, attendance summary and eligible students for ${batchName}.`}
      />
      <FlashToast message={message} />

      <Container className="flex flex-col gap-6">
        <EntityDetailHeader
          decorative={false}
          wash
          className="mb-0"
          avatar={<StartTimeTile startTime={session.start_time} label={timeLabel} />}
          title={
            <>
              {dayMonth}
              <span className="text-section-title font-medium text-text-secondary">{yearLabel}</span>
              {/* On a phone the time drops to its own line, so no separator is left dangling. */}
              <span className="text-section-title hidden font-medium text-text-secondary sm:inline"> · </span>
              <span className="block sm:inline">
                {formatTime(session.start_time)}
                <span className="text-section-title font-medium text-text-secondary"> – {formatTime(session.end_time)}</span>
              </span>
              {/* The batch code is part of the heading: a small brand-tinted mark, like the code chips elsewhere. */}
              {batchCode ? (
                <span className="text-small mt-1 inline-flex items-center rounded-md bg-brand/10 px-2 py-0.5 align-middle font-semibold text-brand sm:mt-0 sm:ml-2">
                  {batchCode}
                </span>
              ) : null}
            </>
          }
          status={
            <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
          }
          subMeta={
            <>
              <span className="inline-flex items-center gap-1.5">
                <Layers className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="font-medium text-text-primary">{batchName}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                {session.instructors?.full_name ?? "—"}
              </span>
              {session.note ? (
                <span className="inline-flex basis-full items-start gap-1.5 break-words whitespace-pre-line">
                  <ClipboardCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {session.note}
                </span>
              ) : null}
            </>
          }
          actions={
            <>
              {actionLabel !== "View Session" ? (
                <Button
                  variant={actionLabel === "Take Attendance" ? "default" : "outline"}
                  render={<Link href={base} />}
                  nativeButton={false}
                >
                  {actionLabel}
                </Button>
              ) : null}
              {isAdmin && (canEdit || canMarkException) ? (
                <SessionActionsMenu
                  scheduleId={scheduleId}
                  date={date}
                  base={base}
                  canEdit={canEdit}
                  canMarkException={canMarkException}
                  sessionContext={sessionContextOf(session)}
                />
              ) : null}
            </>
          }
        />

        <StatTileGroup ariaLabel="Attendance summary" columns={2} className="-mt-2 grid-cols-1 xl:grid-cols-4">
          <StatTile
            icon={Users}
            label="Eligible"
            value={summary.eligibleCount ?? 0}
            caption={unmarked > 0 ? `${unmarked} not marked yet` : undefined}
            tone="brand"
          />
          <StatTile icon={CircleCheck} label="Present" value={summary.presentCount ?? 0} tone="success" />
          <StatTile icon={CircleX} label="Absent" value={summary.absentCount ?? 0} tone="danger" />
          {/* A percentage of nothing marked yet would read as 0% attendance, so it shows a dash until something is. */}
          <StatTile icon={Percent} label="Attendance" value={marked > 0 ? `${summary.percentage ?? 0}%` : "—"} tone="info" />
        </StatTileGroup>

        <EligibleStudentsList students={eligibleStudents} batch={session.batches} />
      </Container>
    </>
  );
}
