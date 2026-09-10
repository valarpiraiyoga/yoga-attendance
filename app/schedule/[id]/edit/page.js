import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSchedule } from "@/lib/schedules/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { updateSchedule } from "@/lib/schedules/actions";
import ScheduleForm from "@/app/schedule/schedule-form";

/**
 * Edit Schedule (02-ux.md Flow 04). Batch is fixed — a schedule's batch
 * does not change on edit, only day/time/instructor/effective dates do.
 * Saving versions the schedule (see lib/schedules/actions.js's
 * `updateSchedule`) rather than rewriting the current row, so this page
 * lands the admin back on whichever row ends up current after saving —
 * `updateSchedule` decides that and redirects accordingly.
 */
export default async function EditSchedulePage({ params }) {
  // Authorization boundary — see app/schedule/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateSchedule
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const [schedule, instructorOptions] = await Promise.all([getSchedule(id), listInstructorOptions()]);

  if (!schedule) {
    notFound();
  }

  const updateScheduleById = updateSchedule.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/schedule/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Schedule Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Schedule</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {schedule.batches?.name ?? "this batch"}&rsquo;s recurring schedule.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <ScheduleForm
          action={updateScheduleById}
          batch={schedule.batches}
          instructorOptions={instructorOptions}
          schedule={schedule}
          requireConfirmation
          submitLabel="Save Changes"
          pendingLabel="Saving…"
          cancelHref={`/schedule/${id}`}
        />
      </div>
    </div>
  );
}
