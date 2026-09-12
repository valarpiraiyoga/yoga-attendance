import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import { listEligibleStudents, getAttendanceForSession } from "@/lib/attendance/data";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import AttendanceDetailsRoster from "@/app/attendance-history/[scheduleId]/[date]/attendance-details-roster";

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
 * Attendance Details (Phase 16; approved wireframe p.31), addressed by
 * `(scheduleId, date)` — same reasoning as Session Details
 * (`app/attendance/[scheduleId]/[date]/page.js`): a class session has no
 * product-facing identifier (`01-product.md` §7A), so schedule + date is
 * the only address that works.
 *
 * Deliberately its own, flatter page — not the tabbed Session Details
 * screen reused with a different breadcrumb. The wireframe draws it
 * without Overview/Eligible Students/Attendance tabs, and it is reached
 * from Attendance History (`Back to Attendance History`), a different
 * entry context than Session Details' own (`Back to Attendance`). It
 * reuses Session Details' *visual* language (the same Session
 * Information / Attendance Summary card pattern from
 * `session-details-tabs.js`) without importing that component, since this
 * page has no tabs to share it with.
 *
 * Attendance Details only makes sense for a session whose attendance has
 * actually been recorded — `session.status !== "completed"` 404s, the same
 * way an out-of-range date already does. This is a product-shape guard
 * (what this page is *for*), not a security check: `listAttendanceHistory`
 * (lib/attendance-history/data.js) never links here for anything but a
 * completed session, and a direct URL to a materialized-but-not-completed
 * or purely projected occurrence has nothing to show here anyway.
 *
 * Authorization is entirely reused, not reimplemented. `getSessionOccurrence`
 * reads `class_sessions`/`schedules` under the same RLS Session Details
 * already relies on (`class_sessions_select_instructor`,
 * `schedules_select_instructor`, `0014_instructor_attendance_access.sql`):
 * another instructor's completed session simply resolves to `null` (or, in
 * the one case it doesn't, is never `completed`), and this page 404s —
 * indistinguishable from a session that does not exist. `listEligibleStudents`
 * and `getAttendanceForSession` are the same two functions Session Details'
 * Attendance tab already calls, under the same `resolve_eligible_students`/
 * `attendance` RLS. No ownership check is added here in JavaScript.
 *
 * The summary (Eligible/Present/Absent/Attendance %) is derived locally
 * with `computeAttendanceSummary` from the eligible list and marks this
 * page already fetched, rather than a second call to `getAttendanceSummary`
 * (lib/attendance/data.js) — that function would only re-fetch the same
 * two things again internally. Same numbers, one fewer round trip.
 *
 * "Edit Attendance" always renders once this page has loaded at all: an
 * admin and an authorized instructor are the only two ways to reach a
 * completed session's Details, and editing follows the exact same
 * ownership rule viewing already enforced — there is nothing further to
 * branch on in JavaScript. It links to the planned Edit Attendance route
 * (`/attendance-history/[scheduleId]/[date]/edit`), not built yet.
 *
 * The post-save success banner (approved wireframe p.34) reuses the exact
 * `?success=` query-param convention Session Details' own Edit This
 * Session flow already established
 * (`app/attendance/[scheduleId]/[date]/page.js`'s `SUCCESS_MESSAGES`) —
 * not a new mechanism. `review-attendance-changes.js`'s Confirm & Save
 * appends `?success=updated&changes=N` only on its own successful
 * `saveSessionAttendance` call before navigating here, so the banner is
 * pure UI state driven by how this page was *reached*, never by anything
 * this page re-derives, checks, or trusts for authorization —
 * `sessionStorage` plays no part in it. A direct visit, a link from
 * History, a Cancel from Edit, or a failed save (Review stays put and
 * shows its own error instead of navigating away) all reach this page
 * with no such param and render no banner. The message itself only
 * confirms an attendance count changed — it says nothing about, and must
 * not be read as implying anything about, session/schedule/membership/
 * batch history or student relationships, none of which this flow ever
 * touches.
 */
export default async function AttendanceDetailsPage({ params, searchParams }) {
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

  const marksByStudentId = Object.fromEntries(marks.map((mark) => [mark.student_id, mark.status]));
  const summary = computeAttendanceSummary(eligibleStudents.length, marks);

  const rawParams = await searchParams;
  const changeCount = Number(rawParams?.changes);
  const message =
    rawParams?.success === "updated"
      ? `Attendance updated successfully.${
          Number.isInteger(changeCount) && changeCount > 0
            ? ` ${changeCount} attendance change${changeCount === 1 ? "" : "s"} saved.`
            : ""
        }`
      : null;

  return (
    <div>
      <Link
        href="/attendance-history"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance History
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page-title font-semibold text-text-primary">Attendance Details</h1>
            <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS.completed}>{DISPLAY_STATUS_LABELS.completed}</Badge>
          </div>
          <p className="text-body mt-1 text-text-secondary">
            {formatTime(session.start_time)} – {formatTime(session.end_time)} · {session.instructors?.full_name ?? "—"}
          </p>
          <p className="text-body text-text-secondary">
            {session.batches?.name ?? "—"} {session.batches?.code ? `(${session.batches.code})` : ""} ·{" "}
            {formatDate(session.session_date)}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <Button render={<Link href={`/attendance-history/${scheduleId}/${date}/edit`} />} nativeButton={false}>
            Edit Attendance
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Session Information</h2>
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
        <p className="text-body mt-1 mb-4 text-text-secondary">Recorded attendance for this class session.</p>
        <AttendanceDetailsRoster students={eligibleStudents} marksByStudentId={marksByStudentId} />
      </div>
    </div>
  );
}
