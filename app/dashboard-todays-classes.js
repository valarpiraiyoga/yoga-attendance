import Link from "next/link";
import { Calendar, ChevronRight, Info, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deriveDisplayStatus,
  todayInCentreTimezone,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";

const BATCH_BADGE_TONES = [
  "bg-brand/10 text-brand",
  "bg-info/10 text-info",
  "bg-warning/10 text-warning",
  "bg-success/10 text-success",
];

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDisplayDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function batchBadgeTone(code) {
  const source = String(code || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash + source.charCodeAt(i)) % BATCH_BADGE_TONES.length;
  }
  return BATCH_BADGE_TONES[hash];
}

function resolveAction(session, today) {
  if (session.status === "cancelled" || session.status === "holiday") {
    return "View Session";
  }
  if (session.status === "completed") {
    return "View Attendance";
  }
  return session.session_date <= today ? "Take Attendance" : "View Session";
}

function sessionHref(session) {
  return `/attendance/${session.schedule_id}/${session.session_date}?tab=attendance`;
}

function SessionAction({ session, today, fullWidth = false }) {
  const label = resolveAction(session, today);
  const isPrimary = label === "Take Attendance";

  return (
    <Button
      size="sm"
      variant={isPrimary ? "default" : "outline"}
      className={[
        isPrimary ? undefined : "border-brand/40 bg-surface text-brand hover:bg-brand/5 hover:text-brand",
        fullWidth ? "w-full" : "w-full sm:w-auto",
      ]
        .filter(Boolean)
        .join(" ")}
      render={<Link href={sessionHref(session)} />}
      nativeButton={false}
    >
      {label}
    </Button>
  );
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

function ClassCard({ session, showInstructor, today }) {
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
          <SessionAction session={session} today={today} />
        </div>
      </div>
    </article>
  );
}

/**
 * Today's Classes as a card list (`01-product.md` §3; wireframes p.2 / p.8).
 * Actions still use resolveAction + Session Details. Date shown is today's
 * centre date only — there is no existing date-navigation control to wire.
 */
export default function DashboardTodaysClasses({
  sessions,
  showInstructor,
  isAdmin,
  description,
}) {
  const today = todayInCentreTimezone();
  const count = sessions.length;

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
          >
            <Calendar className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-section-title font-semibold text-text-primary">Today&apos;s Classes</h2>
            <p className="text-small mt-1 text-text-secondary">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start rounded-lg border border-border bg-surface px-3 py-2 text-text-secondary">
          <Calendar className="size-4 shrink-0" aria-hidden="true" />
          <time className="text-small font-medium whitespace-nowrap text-text-primary" dateTime={today}>
            {formatDisplayDate(today)}
          </time>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-card bg-brand/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <div>
            <p className="text-body font-medium text-text-primary">
              Showing {count} {count === 1 ? "class" : "classes"} for today
            </p>
            <p className="text-small mt-1 text-text-secondary">Times are in your center&apos;s local timezone.</p>
          </div>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <p className="text-small text-text-secondary">Need to make changes?</p>
            <Link href="/schedule" className="text-small inline-flex items-center gap-1 font-medium text-brand hover:underline">
              Go to Schedule
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>

      {count === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-body max-w-sm text-text-secondary">No class sessions are scheduled for today.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {sessions.map((session) => (
            <ClassCard
              key={session.id ?? `${session.schedule_id}:${session.session_date}`}
              session={session}
              showInstructor={showInstructor}
              today={today}
            />
          ))}
        </div>
      )}
    </section>
  );
}
