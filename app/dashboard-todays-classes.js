import Link from "next/link";
import { ArrowRight, Calendar, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardClassRow from "@/app/dashboard-class-row";

function resolveAction(session, today) {
  if (session.status === "cancelled" || session.status === "holiday") {
    return "View Session";
  }
  if (session.status === "completed") {
    return "View Attendance";
  }
  return session.session_date <= today ? "Take Attendance" : "View Session";
}

function sessionAction(session, today) {
  const label = resolveAction(session, today);
  return {
    label,
    primary: label === "Take Attendance",
    // A session with no attendance to take (upcoming, cancelled, holiday) opens its details.
    href: `/attendance/${session.schedule_id}/${session.session_date}${label === "View Session" ? "/details" : ""}`,
  };
}

/**
 * Today's Classes (`01-product.md` §3; wireframes p.2 / p.8): a header with the
 * section's icon, title and - for an Admin - the View Full Schedule link, a quiet
 * note stating how many classes are shown and that times are in the centre's own
 * time zone (named, from Center Settings), then the day's classes as rows of one
 * bordered list (`DashboardClassRow`). Actions still use `resolveAction` +
 * Session Details. The date itself is in the page's greeting card.
 */
export default function DashboardTodaysClasses({
  sessions,
  showInstructor,
  isAdmin,
  description,
  today,
  timeZone,
}) {
  const count = sessions.length;

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
          >
            <Calendar className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-section-title font-semibold text-text-primary">Today&apos;s Classes</h2>
            <p className="text-small mt-0.5 text-text-secondary">{description}</p>
          </div>
        </div>
        {isAdmin ? (
          <Button variant="outline" size="sm" className="self-start" render={<Link href="/schedule" />} nativeButton={false}>
            View Full Schedule
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg bg-background px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <div>
          <p className="text-body font-medium text-text-primary">
            Showing {count} {count === 1 ? "class" : "classes"} for today
          </p>
          <p className="text-small mt-0.5 text-text-secondary">
            Times are in your center&apos;s local timezone ({timeZone}).
          </p>
        </div>
      </div>

      {count === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-body max-w-sm text-text-secondary">No class sessions are scheduled for today.</p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {sessions.map((session) => (
            <DashboardClassRow
              key={session.id ?? `${session.schedule_id}:${session.session_date}`}
              session={session}
              showInstructor={showInstructor}
              timeZone={timeZone}
              action={sessionAction(session, today)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
