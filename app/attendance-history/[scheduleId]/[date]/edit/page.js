import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import EditAttendanceForm from "@/app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Edit Attendance (Phase 16; approved wireframe p.32), addressed by
 * `(scheduleId, date)` — same reasoning as Attendance Details
 * (`app/attendance-history/[scheduleId]/[date]/page.js`), which this page
 * sits directly under and returns to via "Cancel" or its own breadcrumb
 * ("Back to Attendance Details", matching the wireframe — not "Back to
 * Attendance History", which is Attendance Details' own breadcrumb one
 * level up).
 *
 * Authorization is entirely reused, not reimplemented, and identical to
 * Attendance Details' own: `requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR)`
 * only decides whether the *role* may open Attendance-area pages at all;
 * `getSessionOccurrence` resolves the session under the same RLS
 * (`class_sessions_select_instructor`, `schedules_select_instructor`,
 * `0014_instructor_attendance_access.sql`) that already restricts an
 * instructor to their own sessions — another instructor's session
 * resolves to `null` (or is never `completed`) and this page 404s, exactly
 * like Attendance Details. No `can_access_session` check is duplicated in
 * JavaScript, and nothing here uses the service-role client. The eventual
 * write path (a later Review/Confirm step, not built by this task) still
 * goes through the unchanged `saveSessionAttendance` → `save_session_attendance`,
 * which re-checks the same ownership rule authoritatively at save time —
 * this page's job is only to read and let the user compose a draft
 * correction, never to authorize the write.
 *
 * Only a completed session can be edited here — the same
 * `status !== "completed"` 404 guard Attendance Details uses, for the same
 * reason: there is nothing recorded to correct otherwise.
 *
 * `initialMarks` (`getAttendanceForSession`) is this session's actual
 * saved attendance, handed to `EditAttendanceForm` to seed its local
 * editing state exactly as saved — see that component's own comment for
 * why a saved value is never silently reset to Unmarked. The Attendance
 * Summary shown here is the **original, saved** summary
 * (`computeAttendanceSummary` over the same eligible list and marks this
 * page already fetched — no second query), matching the wireframe: the
 * *updated* summary and the before/after comparison belong to the
 * Review Attendance Changes screen (p.33), not this one.
 *
 * Nothing on this page writes to the database. Historical session
 * date/time/batch/instructor, schedule history, membership history, and
 * student/batch relationships are all read-only here, exactly as
 * Attendance Details already treats them — editing attendance never
 * touches any of them, only `attendance` rows for this one class session,
 * and only once an eventual Confirm & Save (a later task) actually calls
 * `saveSessionAttendance`.
 */
export default async function EditAttendancePage({ params }) {
  // Authorization boundary — see app/attendance-history/layout.js for why
  // this must be repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  const { scheduleId, date } = await params;

  if (!isValidDateString(date)) {
    notFound();
  }

  const session = await getSessionOccurrence(scheduleId, date);

  if (!session || session.status !== "completed") {
    notFound();
  }

  const [eligibleStudents, marks] = await Promise.all([
    listEligibleStudents(session.batch_id, session.schedule_id, session.session_date),
    getAttendanceForSession(session.id),
  ]);

  const summary = computeAttendanceSummary(eligibleStudents.length, marks);

  return (
    <div>
      <Link
        href={`/attendance-history/${scheduleId}/${date}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance Details
      </Link>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-title font-semibold text-text-primary">Edit Attendance</h1>
          <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}>{DISPLAY_STATUS_LABELS.completed}</Badge>
        </div>
        <p className="text-body mt-1 text-text-secondary">Correct attendance for this class session.</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Session Details</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Batch</dt>
              <dd className="text-body text-text-primary">{session.batches?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Instructor</dt>
              <dd className="text-body text-text-primary">{session.instructors?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Date</dt>
              <dd className="text-body text-text-primary">{formatDate(session.session_date)}</dd>
            </div>
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Time</dt>
              <dd className="text-body text-text-primary">
                {formatTime(session.start_time)} – {formatTime(session.end_time)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Attendance Summary</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Eligible</dt>
              <dd className="text-body text-text-primary">{summary.eligibleCount}</dd>
            </div>
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Present</dt>
              <dd className="text-body text-text-primary">{summary.presentCount}</dd>
            </div>
            <div>
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Absent</dt>
              <dd className="text-body text-text-primary">{summary.absentCount}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Attendance</dt>
              <dd className="text-body text-text-primary">{summary.percentage}%</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-section-title font-semibold text-text-primary">Attendance</h2>
        <p className="text-body mt-1 mb-4 text-text-secondary">Change attendance for eligible students.</p>
        <EditAttendanceForm scheduleId={scheduleId} date={date} students={eligibleStudents} initialMarks={marks} />
      </div>
    </div>
  );
}
