import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, projectUpcomingSessions } from "@/lib/schedules/data";
import ScheduleDetailsTabs from "@/app/schedule/[id]/schedule-details-tabs";
import ScheduleHeader from "@/app/schedule/[id]/schedule-header";

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
 * Visual language mirrors Batch Detail: hero + KPIs, then folder tabs with
 * content inside the same card.
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

  const upcomingSessions = projectUpcomingSessions(schedule);
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ScheduleHeader schedule={schedule} />

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
