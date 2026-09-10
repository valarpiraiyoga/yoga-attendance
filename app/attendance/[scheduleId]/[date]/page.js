import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getSessionOccurrence } from "@/lib/class-sessions/data";
import { isValidDateString } from "@/lib/schedules/validation";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, DISPLAY_STATUS_BADGE_VARIANTS } from "@/lib/class-sessions/validation";
import SessionDetailsTabs from "@/app/attendance/[scheduleId]/[date]/session-details-tabs";
import MarkSession from "@/app/attendance/[scheduleId]/[date]/mark-session";

const SUCCESS_MESSAGES = {
  updated: "Session updated successfully.",
  unchanged: "No changes were made.",
};

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value, options) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/**
 * Session Details (approved wireframe: Overview / Eligible Students /
 * Attendance), addressed by `(scheduleId, date)` rather than a
 * `class_sessions` id — a class session has no product-facing identifier
 * (01-product.md §7A), and a projected occurrence has no `id` at all, so
 * this is the only address that works for both a materialized and an
 * unmaterialized occurrence (approved Phase 14 decision).
 *
 * `getSessionOccurrence` (lib/class-sessions/data.js) resolves the
 * materialized row when one exists, or the projected occurrence from the
 * current schedule otherwise — a plain read either way. Viewing never
 * materializes: there is no write anywhere on this page.
 *
 * "Edit This Session" (02-ux.md Flow 06) only appears when the session
 * currently displays as Upcoming — editable status is Upcoming only
 * (approved Phase 14 decision) — and links to a separate route
 * (`[scheduleId]/[date]/edit`) rather than opening the form here; that
 * route re-checks the same status rule server-side, so hiding the button
 * is a UX convenience, not the enforcement.
 *
 * "Mark Cancelled / Holiday" (02-ux.md Flow 07) is gated on the
 * **persisted** status instead — `session.status === "scheduled"` — not
 * `displayStatus`. That is deliberately different from Edit This Session:
 * a session may be marked Cancelled/Holiday whether it currently displays
 * as Upcoming, In Progress, or a clock-derived Completed reading, since
 * none of those are a real stored `completed`. `markSessionException`
 * (lib/class-sessions/actions.js) re-checks the same persisted-status rule
 * server-side.
 */
export default async function SessionDetailsPage({ params, searchParams }) {
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

  const displayStatus = deriveDisplayStatus(session);
  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  return (
    <div>
      <Link
        href="/attendance"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Attendance
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page-title font-semibold text-text-primary">Session Details</h1>
            <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[displayStatus]}>{DISPLAY_STATUS_LABELS[displayStatus]}</Badge>
          </div>
          <p className="text-body mt-1 text-text-secondary">
            {formatTime(session.start_time)} – {formatTime(session.end_time)} · {session.instructors?.full_name ?? "—"}
          </p>
          <p className="text-body text-text-secondary">
            {session.batches?.name ?? "—"} {session.batches?.code ? `(${session.batches.code})` : ""} ·{" "}
            {formatDate(session.session_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          {displayStatus === "upcoming" ? (
            <Button render={<Link href={`/attendance/${scheduleId}/${date}/edit`} />} nativeButton={false}>
              Edit This Session
            </Button>
          ) : null}
          {session.status === "scheduled" ? <MarkSession scheduleId={scheduleId} date={date} /> : null}
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
        <SessionDetailsTabs session={session} displayStatus={displayStatus} />
      </div>
    </div>
  );
}
