import { notFound, redirect } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { deriveDisplayStatus } from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { listInstructorOptions } from "@/lib/instructors/data";
import { updateClassSession } from "@/lib/class-sessions/actions";
import SessionForm from "@/app/attendance/session-form";
import PageHeader from "@/components/layout/PageHeader";

/**
 * Edit This Session (02-ux.md Flow 06). Reading this page never writes
 * anything — `getSessionOccurrence` resolves a materialized row or a
 * projected occurrence exactly as Session Details does; only submitting
 * the form (`updateClassSession`) can ever create or change a
 * `class_sessions` row, and only when something actually changed.
 *
 * Editable status is Upcoming only (approved Phase 14 decision). The
 * "Edit This Session" action on Session Details is already hidden for
 * every other status, but a direct visit to this URL is still possible, so
 * that rule is re-checked here — and again, authoritatively, inside
 * `updateClassSession` itself on submit.
 */
export default async function EditSessionPage({ params }) {
  // Authorization boundary — see app/attendance/layout.js for why this must
  // be repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session) {
    notFound();
  }

  if (deriveDisplayStatus(session, new Date(), await getCenterTimezone()) !== "upcoming") {
    redirect(`/attendance/${scheduleId}/${date}/details`);
  }

  const instructorOptions = await listInstructorOptions();
  const updateClassSessionForOccurrence = updateClassSession.bind(null, scheduleId, date);

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/attendance/${scheduleId}/${date}/details`, label: "Back to Session Details" }}
        title="Edit This Session"
        description="Change the instructor and/or time for this session only. The recurring schedule is not affected."
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <SessionForm
            action={updateClassSessionForOccurrence}
            session={session}
            instructorOptions={instructorOptions}
            cancelHref={`/attendance/${scheduleId}/${date}/details`}
          />
        </div>
      </div>
    </>
  );
}
