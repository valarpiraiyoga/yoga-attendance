import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { deriveDisplayStatus } from "@/lib/class-sessions/validation";
import { listInstructorOptions } from "@/lib/instructors/data";
import { updateClassSession } from "@/lib/class-sessions/actions";
import SessionForm from "@/app/attendance/session-form";

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

  if (deriveDisplayStatus(session) !== "upcoming") {
    redirect(`/attendance/${scheduleId}/${date}`);
  }

  const instructorOptions = await listInstructorOptions();
  const updateClassSessionForOccurrence = updateClassSession.bind(null, scheduleId, date);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/attendance/${scheduleId}/${date}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Session Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit This Session</h1>
      <p className="text-body mt-1 text-text-secondary">
        Change the instructor and/or time for this session only. The recurring schedule is not affected.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <SessionForm
          action={updateClassSessionForOccurrence}
          session={session}
          instructorOptions={instructorOptions}
          cancelHref={`/attendance/${scheduleId}/${date}`}
        />
      </div>
    </div>
  );
}
