import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, projectUpcomingSessions } from "@/lib/schedules/data";
import { getCentreToday } from "@/lib/center-profile/settings";
import ScheduleDetailsTabs from "@/app/schedule/[id]/schedule-details-tabs";
import ScheduleHeader, { ScheduleSummary } from "@/app/schedule/[id]/schedule-header";

const SUCCESS_MESSAGES = {
  created: "Schedule created successfully.",
  updated: "Schedule updated successfully.",
};

/**
 * Schedule Details (approved wireframe): Overview / Recurring Pattern /
 * Upcoming Sessions. `projectUpcomingSessions` is computed here, server-side,
 * once, and passed down to the client tabs component — it is a pure
 * projection (lib/schedules/data.js), not a database read of session rows.
 *
 * Composition mirrors Batch Details: the shared detail header, four summary
 * tiles, then the underline tabs with their panels.
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
  const upcomingSessions = projectUpcomingSessions(schedule, { today });
  const rawParams = await searchParams;
  const baseMessage = SUCCESS_MESSAGES[rawParams?.success] ?? null;
  // `added=N`: Edit Schedule also created N schedules on extra weekdays.
  const added = Math.min(6, Math.max(0, Math.floor(Number(rawParams?.added)) || 0));
  const message =
    baseMessage && rawParams?.success === "updated" && added > 0
      ? `${baseMessage} ${added === 1 ? "1 more schedule was" : `${added} more schedules were`} created for the extra days.`
      : baseMessage;

  return (
    <div className="flex flex-col gap-6">
      <ScheduleHeader schedule={schedule} today={today} />

      <ScheduleSummary schedule={schedule} />

      {message ? (
        <div
          role="status"
          className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <ScheduleDetailsTabs schedule={schedule} upcomingSessions={upcomingSessions} />
    </div>
  );
}
