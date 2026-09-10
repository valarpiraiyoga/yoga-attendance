import { Badge } from "@/components/ui/badge";
import { DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";

const INERT_TABS = [
  { key: "eligible-students", label: "Eligible Students" },
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
 * Session Details' three tabs (approved wireframe: Overview / Eligible
 * Students / Attendance). Unlike app/schedule/[id]/schedule-details-tabs.js,
 * this is a plain Server Component with no toggle state at all: Eligible
 * Students and Attendance have no content to switch to yet (this task's
 * explicit scope boundary — no Eligible Students tab functionality, no
 * Attendance tab functionality), so they render as inert, non-clickable
 * tab labels rather than a client component pretending to navigate
 * somewhere. Only Overview ever renders.
 *
 * Works identically for a materialized or a projected `session` — both
 * carry the same `batches`/`instructors`/`session_date`/`start_time`/
 * `end_time` shape (lib/class-sessions/data.js).
 */
export default function SessionDetailsTabs({ session, displayStatus }) {
  return (
    <div>
      <nav aria-label="Session sections" className="mb-6 border-b border-border">
        <ul className="flex gap-6">
          <li>
            <span
              aria-current="page"
              className="inline-flex border-b-2 border-brand px-0.5 pb-3 text-body font-semibold text-text-primary"
            >
              Overview
            </span>
          </li>
          {INERT_TABS.map((tab) => (
            <li key={tab.key}>
              <span
                aria-disabled="true"
                title="Available in Phase 15"
                className="inline-flex cursor-not-allowed border-b-2 border-transparent px-0.5 pb-3 text-body text-text-secondary/50"
              >
                {tab.label}
              </span>
            </li>
          ))}
        </ul>
      </nav>

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
          </dl>
        </div>

        <div className="rounded-card border border-dashed border-border bg-surface p-6 shadow-xs">
          <h2 className="text-section-title font-semibold text-text-primary">Attendance Summary</h2>
          <p className="text-body mt-2 text-text-secondary">
            Attendance recording and summary counts (Present, Absent, Unmarked, Eligible Students) will be
            available once Attendance is introduced in Phase 15.
          </p>
        </div>
      </div>
    </div>
  );
}
