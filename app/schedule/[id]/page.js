import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, projectUpcomingSessions } from "@/lib/schedules/data";
import { getCenterTimezone, getCentreToday } from "@/lib/center-profile/settings";
import { deriveDisplayStatus } from "@/lib/class-sessions/validation";
import FlashToast from "@/components/ui/flash-toast";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import ScheduleHeader, { ScheduleSummary } from "@/app/schedule/[id]/schedule-header";
import SchedulePatternCard from "@/app/schedule/[id]/schedule-pattern-card";
import UpcomingSessionsPanel from "@/app/schedule/[id]/upcoming-sessions-panel";

const SUCCESS_MESSAGES = {
  created: "Schedule created successfully.",
  updated: "Schedule updated successfully.",
};

/**
 * Schedule Details: one page, no tabs, in the same shape as Session Details - the compact page
 * strip, the header card (when it happens, which batch, who teaches it, Edit / Deactivate), four
 * summary cards (frequency, duration, effective period, next session), then the content itself:
 * the Upcoming Sessions and, beside it, the Recurring Pattern card. `projectUpcomingSessions` is
 * computed here, server-side, once - it is a pure projection (lib/schedules/data.js), not a
 * database read of session rows.
 */
export default async function ScheduleDetailsPage({ params, searchParams }) {
  // Authorization boundary — see app/schedule/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const schedule = await getSchedule(id);

  if (!schedule) {
    notFound();
  }

  const today = await getCentreToday();
  const timeZone = await getCenterTimezone();
  // Which projected sessions can be edited individually: exactly the ones that are still Upcoming
  // right now in the centre's time zone (the existing Edit This Session rule; that route and its
  // action re-check it, so this only decides whether to offer the action).
  const upcomingSessions = projectUpcomingSessions(schedule, { today }).map((session) => ({
    ...session,
    editable:
      deriveDisplayStatus(
        { status: "scheduled", session_date: session.date, start_time: session.start_time, end_time: session.end_time },
        new Date(),
        timeZone
      ) === "upcoming",
  }));
  const rawParams = await searchParams;
  const baseMessage = SUCCESS_MESSAGES[rawParams?.success] ?? null;
  // `added=N`: Edit Schedule also created N schedules on extra weekdays.
  const added = Math.min(6, Math.max(0, Math.floor(Number(rawParams?.added)) || 0));
  const message =
    baseMessage && rawParams?.success === "updated" && added > 0
      ? `${baseMessage} ${added === 1 ? "1 more schedule was" : `${added} more schedules were`} created for the extra days.`
      : baseMessage;

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/schedule", label: "Back to Schedule" }}
        title="Schedule Details"
        description={`Sessions, attendance and details for ${schedule.batches?.name ?? "this schedule"}.`}
      />
      <FlashToast message={message} />

      <Container className="flex flex-col gap-6">
        <ScheduleHeader schedule={schedule} today={today} />

        <ScheduleSummary schedule={schedule} upcomingSessions={upcomingSessions} />

        {/* From xl the upcoming sessions (the working list) sit left and the pattern picture right;
            below that they stack in the same order. */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <UpcomingSessionsPanel scheduleId={schedule.id} sessions={upcomingSessions} />
          <SchedulePatternCard schedule={schedule} />
        </div>
      </Container>
    </>
  );
}
