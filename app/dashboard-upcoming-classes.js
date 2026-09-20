import Link from "next/link";
import { CalendarDays, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";

const BATCH_BADGE_TONES = [
  "bg-brand/10 text-brand",
  "bg-info/10 text-info",
  "bg-warning/10 text-warning",
  "bg-success/10 text-success",
];

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function batchBadgeTone(code) {
  const source = String(code || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash + source.charCodeAt(i)) % BATCH_BADGE_TONES.length;
  }
  return BATCH_BADGE_TONES[hash];
}

function personInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function BatchCodeBadge({ code }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-14 shrink-0 items-center justify-center rounded-xl text-body font-semibold ${batchBadgeTone(code)}`}
    >
      {code}
    </span>
  );
}

function InstructorMeta({ instructor }) {
  const name = instructor?.full_name;
  const photoUrl = instructor?.photo_url;

  if (!name && !photoUrl) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-text-secondary">
        <User className="size-3.5 shrink-0" aria-hidden="true" />
        —
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-text-secondary">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="size-5 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold leading-none text-brand"
        >
          {personInitials(name)}
        </span>
      )}
      <span className="truncate">{name || "—"}</span>
    </span>
  );
}

function DateMeta({ date }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-small text-text-secondary">
      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
      {formatDate(date)}
    </span>
  );
}

function StudentsMeta({ count }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-small text-text-secondary">
      <Users className="size-3.5 shrink-0" aria-hidden="true" />
      {count} Students
    </span>
  );
}

function MetaDivider() {
  return <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />;
}

function StatusPill({ status }) {
  return (
    <Badge variant={DISPLAY_STATUS_BADGE_VARIANTS[status]}>{DISPLAY_STATUS_LABELS[status]}</Badge>
  );
}

function sessionHref(session) {
  return `/attendance/${session.schedule_id}/${session.session_date}`;
}

function ClassCard({ session, showInstructor }) {
  const displayStatus = deriveDisplayStatus(session);
  const studentCount = session.attendanceSummary?.eligibleCount ?? 0;
  const batch = session.batches;
  const code = batch?.code || "?";
  const name = batch?.name || "—";

  return (
    <article className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_10rem]">
        <BatchCodeBadge code={code} />

        <div className="min-w-0">
          <p className="text-body truncate font-semibold text-text-primary">
            <span className="whitespace-nowrap">{formatTime(session.start_time)}</span>
            <span> - {name}</span>
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <DateMeta date={session.session_date} />
            <MetaDivider />
            {showInstructor ? (
              <>
                <InstructorMeta instructor={session.instructors} />
                <MetaDivider />
              </>
            ) : null}
            <StudentsMeta count={studentCount} />
            <MetaDivider />
            <StatusPill status={displayStatus} />
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 sm:flex sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            className="w-full border-brand/40 bg-surface text-brand hover:bg-brand/5 hover:text-brand sm:w-auto"
            render={<Link href={sessionHref(session)} />}
            nativeButton={false}
          >
            View Details
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Upcoming Classes as the same card layout as Today's Classes, with Date
 * on the meta row because these sessions are not all today. ACTION remains
 * "View Details" to Session Details (no attendance tab).
 */
export default function DashboardUpcomingClasses({ sessions, showInstructor }) {
  return (
    <div className="flex flex-col gap-3" aria-label="Upcoming Classes">
      {sessions.map((session) => (
        <ClassCard
          key={session.id ?? `${session.schedule_id}:${session.session_date}`}
          session={session}
          showInstructor={showInstructor}
        />
      ))}
    </div>
  );
}
