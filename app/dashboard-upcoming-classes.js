import DashboardClassRow from "@/app/dashboard-class-row";

/**
 * Upcoming Classes as rows of one bordered list, the same row as Today's Classes
 * (`DashboardClassRow`) with the session's date and status on the right. The
 * action remains "View Details" to Session Details (no attendance tab).
 */
export default function DashboardUpcomingClasses({ sessions, showInstructor, timeZone }) {
  return (
    <div
      className="divide-y divide-border overflow-hidden rounded-lg border border-border"
      role="list"
      aria-label="Upcoming Classes"
    >
      {sessions.map((session) => (
        <div key={session.id ?? `${session.schedule_id}:${session.session_date}`} role="listitem">
          <DashboardClassRow
            session={session}
            showInstructor={showInstructor}
            timeZone={timeZone}
            showDate
            action={{
              label: "View Details",
              primary: false,
              href: `/attendance/${session.schedule_id}/${session.session_date}/details`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
