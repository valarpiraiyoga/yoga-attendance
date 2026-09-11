import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import EligibleStudentsList from "@/app/attendance/[scheduleId]/[date]/eligible-students-list";
import AttendancePanel from "@/app/attendance/[scheduleId]/[date]/attendance-panel";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "eligible", label: "Eligible Students" },
  { key: "attendance", label: "Attendance" },
];

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
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Session Details' tabs (approved wireframe: Overview / Eligible Students /
 * Attendance). URL-addressable via `?tab=` (Phase 15 Slice 2 — Eligible
 * Students now has real content to navigate to, so this switched from
 * Phase 14's inert-`<span>` treatment to real `<Link>`s, the same
 * server-rendered, URL-driven pattern app/schedule/schedule-view-toggle.js
 * already uses for Today's Sessions/All Sessions). Overview stays the
 * default at the bare `/attendance/[scheduleId]/[date]` URL — its own href
 * omits `?tab=` entirely rather than writing `?tab=overview`, so the
 * canonical Session Details URL is unchanged from Phase 14.
 *
 * Attendance (Phase 15 Slice 3) renders `AttendancePanel`, which owns the
 * Take/View/Edit Attendance behavior itself — this component only wires the
 * tab and passes through what the page already fetched for it
 * (`eligibleStudents`, `initialAttendanceMarks`), the same "page fetches
 * for the active tab, this component only renders" split Eligible Students
 * already uses.
 *
 * Works identically for a materialized or a projected `session` — both
 * carry the same `batches`/`instructors`/`session_date`/`start_time`/
 * `end_time` shape (lib/class-sessions/data.js). `eligibleStudents` is only
 * ever non-empty when `activeTab` is `"eligible"` or `"attendance"` — the
 * page only fetches it for those tabs (app/attendance/[scheduleId]/[date]/page.js),
 * so opening Overview never triggers an eligibility lookup.
 * `initialAttendanceMarks` is likewise only fetched for `"attendance"`.
 *
 * Overview's Attendance Summary card reads `attendanceSummary`
 * (`getAttendanceSummary`, lib/attendance/data.js), fetched only when
 * Overview is the active tab — the same already-schedule-scoped,
 * already-safe-for-a-null-session-id summary `AttendancePanel` derives its
 * own live counts from, not a second implementation of it.
 *
 * The Note row (Flow 07 — Cancel/Holiday) only renders when `session.note`
 * is set — a projected occurrence's `note` is always null
 * (`buildProjectedOccurrence`), and a materialized `scheduled`/`completed`
 * session usually has none either, so this stays hidden far more often
 * than not, by design.
 */
export default function SessionDetailsTabs({
  session,
  displayStatus,
  scheduleId,
  date,
  activeTab,
  eligibleStudents,
  initialAttendanceMarks,
  attendanceSummary,
}) {
  return (
    <div>
      <nav aria-label="Session sections" className="mb-6 border-b border-border">
        <ul className="flex gap-6">
          {TABS.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tab.key === "overview" ? `/attendance/${scheduleId}/${date}` : `/attendance/${scheduleId}/${date}?tab=${tab.key}`}
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={
                  activeTab === tab.key
                    ? "inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
                    : "inline-flex border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary hover:text-text-primary"
                }
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {activeTab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
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
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Status</dt>
                <dd className="text-body text-text-primary">
                  <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>
                    {DISPLAY_STATUS_LABELS[displayStatus]}
                  </Badge>
                </dd>
              </div>
              {session.note ? (
                <div className="col-span-2">
                  <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Note</dt>
                  <dd className="text-body text-text-primary">{session.note}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
            <h2 className="text-section-title font-semibold text-text-primary">Attendance Summary</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Eligible</dt>
                <dd className="text-body text-text-primary">{attendanceSummary?.eligibleCount ?? 0}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Present</dt>
                <dd className="text-body text-text-primary">{attendanceSummary?.presentCount ?? 0}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Absent</dt>
                <dd className="text-body text-text-primary">{attendanceSummary?.absentCount ?? 0}</dd>
              </div>
              <div>
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Unmarked</dt>
                <dd className="text-body text-text-primary">{attendanceSummary?.unmarkedCount ?? 0}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">Attendance</dt>
                <dd className="text-body text-text-primary">{attendanceSummary?.percentage ?? 0}%</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}

      {activeTab === "eligible" ? <EligibleStudentsList students={eligibleStudents} batch={session.batches} /> : null}

      {activeTab === "attendance" ? (
        <AttendancePanel
          session={session}
          scheduleId={scheduleId}
          date={date}
          eligibleStudents={eligibleStudents}
          initialMarks={initialAttendanceMarks}
        />
      ) : null}
    </div>
  );
}
