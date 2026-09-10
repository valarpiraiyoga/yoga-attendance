import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule, projectUpcomingSessions } from "@/lib/schedules/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import DeactivateSchedule from "@/app/schedule/[id]/deactivate-schedule";
import ScheduleDetailsTabs from "@/app/schedule/[id]/schedule-details-tabs";

const SUCCESS_MESSAGES = {
  created: "Schedule created successfully.",
  updated: "Schedule updated successfully.",
};

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Schedule Details (approved wireframe): Overview / Recurring Pattern /
 * Upcoming Sessions. `projectUpcomingSessions` is computed here, server-side,
 * once, and passed down to the client tabs component — it is a pure
 * projection (lib/schedules/data.js), not a database read of session rows.
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
    <div>
      <Link
        href="/schedule"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Schedule
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page-title font-semibold text-text-primary">Schedule Details</h1>
            <Badge variant={schedule.status === "active" ? "success" : "danger"}>
              {schedule.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-body mt-1 text-text-secondary">
            {schedule.batches?.name ?? "—"} · {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week},{" "}
            {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <DeactivateSchedule scheduleId={schedule.id} isActive={schedule.status === "active"} />
          <Button render={<Link href={`/schedule/${schedule.id}/edit`} />} nativeButton={false}>
            Edit Schedule
          </Button>
        </div>
      </div>

      {message ? (
        <div
          role="status"
          className="mt-4 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      <div className="mt-6">
        <ScheduleDetailsTabs schedule={schedule} upcomingSessions={upcomingSessions} />
      </div>
    </div>
  );
}
