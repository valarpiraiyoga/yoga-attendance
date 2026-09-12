import Link from "next/link";
import { Suspense } from "react";
import { Calendar } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser, ROLES } from "@/lib/auth/dal";
import { listSessionsForDate, listSessions } from "@/lib/class-sessions/data";
import { todayInCentreTimezone, CENTRE_TIMEZONE } from "@/lib/class-sessions/validation";
import { addDaysUTC } from "@/lib/schedules/validation";
import { getAttendanceSummaries } from "@/lib/attendance/data";
import { getActiveStudentCount } from "@/lib/students/data";
import { getActiveBatchCount } from "@/lib/batches/data";
import DashboardTodaysClasses from "@/app/dashboard-todays-classes";
import DashboardUpcomingClasses from "@/app/dashboard-upcoming-classes";

// How many days ahead Upcoming Classes looks, and how many rows it shows —
// a short preview (approved wireframes p.2, p.8 show 1–3 rows), not a
// second schedule browser. "View Full Schedule" (Admin only — Instructor
// has no /schedule route, `02-ux.md`'s Role-Based IA) is the entry point
// into the real thing; this stays intentionally small.
const UPCOMING_WINDOW_DAYS = 6;
const UPCOMING_LIMIT = 5;

function formatHeadingDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Good morning/afternoon/evening, {first name}" (approved wireframes p.2,
 * p.8). Read against `CENTRE_TIMEZONE`, the same clock every other
 * date/time derivation in this codebase is required to use (§7A "Centre
 * Timezone") — never the server's own local time.
 */
function greeting(name) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: CENTRE_TIMEZONE }).format(new Date())
  );
  const partOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const firstName = (name || "").trim().split(/\s+/)[0] || name;
  return `Good ${partOfDay}, ${firstName}`;
}

/**
 * Attaches each session's attendance summary in ONE round trip via
 * `getAttendanceSummaries` (`lib/attendance/data.js`, backed by the
 * `session_attendance_summaries` RPC — Performance Slice 2), the same
 * batched call `app/attendance/page.js`'s own `withAttendanceSummaries`
 * uses. Duplicated here rather than imported from that page file — a
 * `page.js` is a route entry, not a shared module; the part that is
 * genuinely shared (the batched RPC call itself) already lives in the data
 * layer both callers import.
 */
async function withAttendanceSummaries(sessions) {
  const summaries = await getAttendanceSummaries(sessions);
  return sessions.map((session, index) => ({ ...session, attendanceSummary: summaries[index] }));
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <dt className="text-small font-medium tracking-wide text-text-secondary uppercase">{label}</dt>
      <dd className="text-page-title mt-1 font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-body max-w-sm text-text-secondary">{children}</p>
    </div>
  );
}

/** Mirrors the real content's shape so the Suspense swap-in is not a layout jump. */
function DashboardSkeleton({ isAdmin }) {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" role="status">
      <dl className={`grid grid-cols-2 gap-4 sm:grid-cols-${isAdmin ? "4" : "3"}`}>
        {(isAdmin ? [0, 1, 2, 3] : [0, 1, 2]).map((tile) => (
          <div key={tile} className="rounded-card border border-border bg-surface p-4 shadow-xs">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-4 space-y-3 rounded-card border border-border bg-surface p-4">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The data-dependent half of the Dashboard, streamed in behind a
 * `<Suspense>` boundary (`app/reports/page.js` established this same
 * pattern for Reports) so the greeting header appears immediately while
 * today's sessions, their attendance summaries, and Upcoming Classes are
 * fetched.
 *
 * Every query here is set-based:
 *   - `listSessionsForDate` / `listSessions` (`lib/class-sessions/data.js`,
 *     unchanged) — the exact merge of materialized and projected
 *     occurrences, under the exact RLS scoping, Attendance's own Today's
 *     and All Sessions lists already use. RLS alone decides whether a
 *     query returns every session (Admin) or only the caller's own
 *     (Instructor, `class_sessions_select_instructor` +
 *     `0014_instructor_attendance_access.sql`) — nothing here repeats or
 *     narrows that in JavaScript.
 *   - `getAttendanceSummaries` — ONE batched RPC call for every row on the
 *     screen (Performance Slice 2's `session_attendance_summaries`), not a
 *     per-row query.
 *   - `getActiveStudentCount` / `getActiveBatchCount` — Admin-only
 *     `head: true` counts, transferring a number each, not a row per
 *     student/batch.
 *
 * Total round trips: 5 for an Instructor (today's occurrences, one batched
 * summary call, upcoming occurrences), 7 for an Admin (the same three plus
 * the two counts) — independent of how many sessions exist on either list.
 */
async function DashboardContent({ isAdmin, today }) {
  const upcomingFrom = addDaysUTC(today, 1);
  const upcomingTo = addDaysUTC(today, UPCOMING_WINDOW_DAYS);

  const [todaysSessions, upcoming, activeStudentCount, activeBatchCount] = await Promise.all([
    listSessionsForDate(today).then(withAttendanceSummaries),
    listSessions({ dateFrom: upcomingFrom, dateTo: upcomingTo, page: 1, pageSize: UPCOMING_LIMIT }),
    isAdmin ? getActiveStudentCount() : Promise.resolve(null),
    isAdmin ? getActiveBatchCount() : Promise.resolve(null),
  ]);

  const totalToday = todaysSessions.length;
  // "Attendance marked" counts a session whose PERSISTED status is
  // completed — set only by `save_session_attendance` — not the
  // clock-derived display status, which would also call a still-scheduled
  // session "completed" the moment its end time passes even though no
  // attendance was ever taken. A projected occurrence is never persisted
  // `completed` by construction, so it correctly never counts here.
  const attendanceMarkedCount = todaysSessions.filter((session) => session.status === "completed").length;

  return (
    <>
      {isAdmin ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Active Students" value={activeStudentCount} />
          <StatTile label="Active Batches" value={activeBatchCount} />
          <StatTile label="Today's Classes" value={totalToday} />
          <StatTile label="Attendance Marked" value={`${attendanceMarkedCount} / ${totalToday}`} />
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatTile label="Today's Classes" value={totalToday} />
          <StatTile label="Completed" value={attendanceMarkedCount} />
          <StatTile label="Remaining" value={totalToday - attendanceMarkedCount} />
        </dl>
      )}

      <section className="mt-8">
        <h2 className="text-section-title font-semibold text-text-primary">Today&apos;s Classes</h2>
        <p className="text-body mt-1 text-text-secondary">
          {isAdmin ? "All classes scheduled for today." : "Your assigned yoga classes for today."}
        </p>

        {totalToday === 0 ? (
          <EmptyState>No class sessions are scheduled for today.</EmptyState>
        ) : (
          <div className="mt-4">
            <DashboardTodaysClasses sessions={todaysSessions} showInstructor={isAdmin} />
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-section-title font-semibold text-text-primary">Upcoming Classes</h2>
            <p className="text-body mt-1 text-text-secondary">Your scheduled classes for the next few days.</p>
          </div>
          {isAdmin ? (
            <Button variant="outline" size="sm" render={<Link href="/schedule" />} nativeButton={false}>
              View Full Schedule
            </Button>
          ) : null}
        </div>

        {upcoming.sessions.length === 0 ? (
          <EmptyState>No upcoming classes in the next {UPCOMING_WINDOW_DAYS} days.</EmptyState>
        ) : (
          <div className="mt-4">
            <DashboardUpcomingClasses sessions={upcoming.sessions} />
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Dashboard (`01-product.md` §3; `02-ux.md`'s Role-Based IA; approved
 * wireframes p.2 Instructor, p.8 Admin) — real data replacing the Phase-14
 * placeholder scaffold.
 *
 * One route for both roles, the same shape `/attendance` and
 * `/attendance-history` already use: `isAdmin` decides which stat tiles
 * and table columns render, never which rows a query returns — RLS is the
 * only thing that ever narrows Today's/Upcoming Classes to an
 * instructor's own, exactly as `01-product.md` §3 requires ("Admin sees
 * all today's classes" / "Instructor sees only their assigned classes").
 *
 * Deliberately NOT built: any chart, trend, or analytics beyond the counts
 * and lists §3 itself enumerates — "Today's Classes are the primary
 * operational content. The dashboard prioritizes daily tasks rather than
 * complex analytics" is the section's own stated principle.
 */
export default async function Home() {
  // Authorization boundary — the proxy is only a first-pass check.
  const user = await requireUser();
  const isAdmin = user.role === ROLES.ADMIN;
  const today = todayInCentreTimezone();

  return (
    <AppShell role={user.role} user={user}>
      <Container>
        {/*
          Dashboard-local header, not the shared PageHeader: the greeting
          needs a slightly different visual rhythm (tighter title/subtitle
          coupling, a subtle icon+date treatment, more breathing room before
          the KPI row) than PageHeader's one-size-fits-all defaults, and
          PageHeader is used by every other page in the app — changing it
          here would be a global typography change, not a Dashboard one.
          Same responsive recipe PageHeader itself uses (stacks on mobile,
          row from sm: up, date never causes horizontal overflow), and no
          card/border, matching the approved reference.
        */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-page-title font-semibold text-text-primary">
              {greeting(user.name)} <span aria-hidden="true">👋</span>
            </h1>
            <p className="text-body mt-1.5 text-text-secondary">
              {isAdmin
                ? "Here's your center overview for today."
                : "Here's your schedule and session overview for today."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 text-text-secondary">
            <Calendar className="size-4 shrink-0" aria-hidden="true" />
            <p className="text-body font-medium">{formatHeadingDate(today)}</p>
          </div>
        </div>

        <Suspense fallback={<DashboardSkeleton isAdmin={isAdmin} />}>
          <DashboardContent isAdmin={isAdmin} today={today} />
        </Suspense>
      </Container>
    </AppShell>
  );
}
