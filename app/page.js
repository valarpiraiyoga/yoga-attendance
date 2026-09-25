import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Calendar, CircleCheck, Clock, Layers, Users } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import Container from "@/components/layout/Container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { requireUser, ROLES } from "@/lib/auth/dal";
import { getSessionDateNavigation, listSessionsForDate, listSessions } from "@/lib/class-sessions/data";
import { getRecentActivity } from "@/lib/dashboard/data";
import { isValidMonth, monthOf } from "@/lib/attendance-history/calendar";
import { todayInCentreTimezone, hourInCentreTimezone } from "@/lib/class-sessions/validation";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { addDaysUTC } from "@/lib/schedules/validation";
import { getAttendanceSummaries } from "@/lib/attendance/data";
import { getActiveStudentCount } from "@/lib/students/data";
import { getActiveBatchCount } from "@/lib/batches/data";
import { cn } from "@/lib/utils";
import DashboardTodaysClasses from "@/app/dashboard-todays-classes";
import DashboardUpcomingClasses from "@/app/dashboard-upcoming-classes";
import { DashboardCalendar, DashboardQuickActions, DashboardRecentActivity } from "@/app/dashboard-side-panels";

// How many days ahead Upcoming Classes looks, and how many rows it shows —
// a short preview (approved wireframes p.2, p.8 show 1–3 rows), not a
// second schedule browser. "View Full Schedule" (Admin only — Instructor
// has no /schedule route, `02-ux.md`'s Role-Based IA) is the entry point
// into the real thing; this stays intentionally small.
const UPCOMING_WINDOW_DAYS = 6;
const UPCOMING_LIMIT = 5;

function formatHeadingDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Good morning/afternoon/evening" (approved wireframes p.2, p.8).
 * Read in the centre's timezone (Center Settings), the same clock every other
 * date/time derivation in this codebase is required to use (§7A "Centre
 * Timezone") - never the viewer's own clock.
 *
 * Identity is presentation-only from `user.name`. A real name stays in the
 * title. An email (fallback when `full_name` is empty) is shown on its own
 * line so it can wrap at `@` / `.` instead of through the local part.
 */
function getGreetingPresentation(name, timeZone) {
  const hour = hourInCentreTimezone(new Date(), timeZone);
  const partOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const identity = String(name || "").trim();
  const firstToken = identity.split(/\s+/).filter(Boolean)[0] || identity;
  const isEmail = identity.includes("@");

  return {
    salutation: `Good ${partOfDay}`,
    identity: isEmail ? identity : firstToken,
    inlineIdentity: Boolean(firstToken) && !isEmail,
  };
}

/** Zero-width wrap opportunities after `@` and at `.` in the domain. */
function EmailIdentity({ value }) {
  const [local, domain = ""] = value.split("@");
  const domainParts = domain.split(".");

  return (
    <>
      {local}
      <wbr />
      @
      {domainParts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? (
            <>
              <wbr />.
            </>
          ) : null}
          {part}
        </span>
      ))}
    </>
  );
}

/**
 * Presentation-only initials for the Dashboard greeting avatar.
 * `profiles` has `full_name` only — no photo field — so this is the
 * available identity treatment. First and last word initials, uppercase;
 * a single name yields one letter; empty/whitespace falls back to "?".
 */
function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

const SECTION_FRAME = "rounded-card border border-border bg-surface p-4 shadow-xs sm:p-6";

function DashboardSection({ children, className, ...props }) {
  return (
    <section className={cn(SECTION_FRAME, className)} {...props}>
      {children}
    </section>
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
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading dashboard" role="status">
      <StatTileGroup columns={isAdmin ? 4 : 3} ariaLabel="Loading summary" className="grid-cols-1 sm:grid-cols-2">
        {(isAdmin ? [0, 1, 2, 3] : [0, 1, 2]).map((tile) => (
          <div
            key={tile}
            className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-xs"
          >
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <Skeleton className="h-4.5 w-24" />
              <Skeleton className="h-8 w-12" />
              <Skeleton className="h-4.5 w-28" />
            </div>
          </div>
        ))}
      </StatTileGroup>

      <DashboardSection>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full rounded-card" />
          ))}
        </div>
      </DashboardSection>
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
 * Total round trips: 6 for an Instructor (today's occurrences, upcoming
 * occurrences, two batched summary calls), 8 for an Admin (the same plus
 * the two counts) — independent of how many sessions exist on either list.
 */
async function DashboardContent({ isAdmin, today, timeZone, month }) {
  const upcomingFrom = addDaysUTC(today, 1);
  const upcomingTo = addDaysUTC(today, UPCOMING_WINDOW_DAYS);

  const [todaysSessions, upcoming, activeStudentCount, activeBatchCount, dateNavigation, recentActivity] = await Promise.all([
    listSessionsForDate(today).then(withAttendanceSummaries),
    listSessions({ dateFrom: upcomingFrom, dateTo: upcomingTo, page: 1, pageSize: UPCOMING_LIMIT }).then(
      async (result) => ({
        ...result,
        sessions: await withAttendanceSummaries(result.sessions),
      })
    ),
    isAdmin ? getActiveStudentCount() : Promise.resolve(null),
    isAdmin ? getActiveBatchCount() : Promise.resolve(null),
    // The calendar's days with class sessions (RLS narrows an Instructor to their own), and,
    // for an Admin, what has happened lately - both real records, nothing invented.
    getSessionDateNavigation(month),
    isAdmin ? getRecentActivity() : Promise.resolve(null),
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
    <div className="flex flex-col gap-8">
      {isAdmin ? (
        <StatTileGroup ariaLabel="Summary" className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Active Students"
            value={activeStudentCount}
            caption="Currently enrolled"
            icon={Users}
            tone="brand"
          />
          <StatTile
            label="Active Batches"
            value={activeBatchCount}
            caption="Ongoing batches"
            icon={Layers}
            tone="info"
          />
          <StatTile
            label="Today's Classes"
            value={totalToday}
            caption="Scheduled for today"
            icon={Calendar}
            tone="warning"
          />
          <StatTile
            label="Attendance Marked"
            value={`${attendanceMarkedCount} / ${totalToday}`}
            caption="Marked today"
            icon={CircleCheck}
            tone="success"
          />
        </StatTileGroup>
      ) : (
        <StatTileGroup columns={3} ariaLabel="Summary" className="grid-cols-1 sm:grid-cols-2">
          <StatTile
            label="Today's Classes"
            value={totalToday}
            caption="Scheduled for today"
            icon={Calendar}
            tone="warning"
          />
          <StatTile
            label="Completed"
            value={attendanceMarkedCount}
            caption="Marked today"
            icon={CircleCheck}
            tone="success"
          />
          <StatTile
            label="Remaining"
            value={totalToday - attendanceMarkedCount}
            caption="Still scheduled"
            icon={Clock}
            tone="info"
          />
        </StatTileGroup>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="flex min-w-0 flex-col gap-6">
      <DashboardTodaysClasses
        sessions={todaysSessions}
        showInstructor={isAdmin}
        isAdmin={isAdmin}
        today={today}
        timeZone={timeZone}
        description={isAdmin ? "All classes scheduled for today." : "Your assigned yoga classes for today."}
      />

      <DashboardSection className="sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info"
            >
              <Calendar className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-section-title font-semibold text-text-primary">Upcoming Classes</h2>
              <p className="text-small mt-1 text-text-secondary">Your scheduled classes for the next few days.</p>
            </div>
          </div>
          {isAdmin ? (
            <Button variant="outline" size="sm" className="self-start" render={<Link href="/schedule" />} nativeButton={false}>
              View Full Schedule
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        {upcoming.sessions.length === 0 ? (
          <EmptyState>No upcoming classes in the next {UPCOMING_WINDOW_DAYS} days.</EmptyState>
        ) : (
          <div className="mt-4">
            <DashboardUpcomingClasses sessions={upcoming.sessions} showInstructor={isAdmin} timeZone={timeZone} />
          </div>
        )}
      </DashboardSection>
      </div>

      <aside aria-label="Calendar and shortcuts" className="flex min-w-0 flex-col gap-6">
        <DashboardCalendar month={month} today={today} monthDays={dateNavigation.monthDays} />
        {isAdmin ? <DashboardQuickActions /> : null}
        {isAdmin && recentActivity ? <DashboardRecentActivity items={recentActivity} timeZone={timeZone} /> : null}
      </aside>
      </div>
    </div>
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
export default async function Home({ searchParams }) {
  // Authorization boundary — the proxy is only a first-pass check.
  const user = await requireUser();
  const isAdmin = user.role === ROLES.ADMIN;
  // The centre's own day and zone (Center Settings), never the viewer's.
  const timeZone = await getCenterTimezone();
  const today = todayInCentreTimezone(new Date(), timeZone);
  const greeting = getGreetingPresentation(user.name, timeZone);
  const rawParams = await searchParams;
  // The calendar's month (`?month=YYYY-MM`); the centre's current month by default.
  const month = isValidMonth(rawParams?.month) ? rawParams.month : monthOf(today);

  return (
    <AppShell role={user.role} user={user}>
      <Container>
        {/*
          Dashboard-local header, not the shared PageHeader.
          Mobile: compact column — avatar + salutation, email on its own
          wrapping line, date as a single supporting row (not a KPI card).
          sm+: greeting left, date right. Sidebar remains lg-only.
        */}
        <div className="flex flex-col gap-8">
        <header className={cn(SECTION_FRAME, "bg-linear-to-r from-brand/10 via-surface to-surface")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-brand/20 bg-brand/10 text-small font-semibold leading-none text-brand shadow-xs sm:mt-0 sm:size-12 sm:text-body"
            >
              {getInitials(user.name)}
            </span>
            <div className="min-w-0">
              <h1 className="text-page-title font-semibold break-words text-text-primary">
                {greeting.inlineIdentity ? `${greeting.salutation}, ${greeting.identity}` : greeting.salutation}
              </h1>
              {!greeting.inlineIdentity && greeting.identity ? (
                <p className="text-body mt-1 font-medium break-words text-text-primary">
                  <EmailIdentity value={greeting.identity} />
                </p>
              ) : null}
              <p className="text-small mt-1 break-words text-text-secondary">
                {isAdmin
                  ? "Here's your center overview for today."
                  : "Here's your schedule and session overview for today."}
              </p>
            </div>
          </div>

          {/* Date chip: keep bg-brand/5, rounded-card, padding, and top-aligned icon. */}
          <div className="flex w-full min-w-0 items-start gap-3 self-start rounded-card border border-border bg-surface px-4 py-3 shadow-xs sm:w-auto sm:shrink-0">
            <Calendar className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-small font-medium tracking-wide text-text-secondary uppercase">Today</p>
              <time className="text-body font-medium text-text-primary" dateTime={today}>
                {formatHeadingDate(today)}
              </time>
            </div>
          </div>
        </div>
        </header>

        <Suspense fallback={<DashboardSkeleton isAdmin={isAdmin} />}>
          <DashboardContent isAdmin={isAdmin} today={today} timeZone={timeZone} month={month} />
        </Suspense>
        </div>
      </Container>
    </AppShell>
  );
}
