"use client";

import DateGroupTimeline from "@/components/layout/DateGroupTimeline";
import { formatDateWithWeekday } from "@/lib/format";
import SessionCardItem from "@/app/attendance/session-card-item";
import SessionTable from "@/app/attendance/session-table";

/**
 * All Sessions results as the shared date timeline (`DateGroupTimeline`): each
 * date opens onto the same session cards and table Today's Sessions uses. The
 * date is the group header, so neither draws it again.
 */
export default function SessionTimeline({ groups, selectedDate, layout = "", today, timeZone, isAdmin = false }) {
  return (
    <DateGroupTimeline
      groups={groups.map((group) => ({ date: group.date, items: group.sessions }))}
      selectedDate={selectedDate}
      layout={layout}
      ariaLabel="All sessions by date"
      renderCards={(group) =>
        group.items.map((session) => (
          <SessionCardItem key={session.id ?? `${session.schedule_id}:${session.session_date}`} session={session} today={today} timeZone={timeZone} isAdmin={isAdmin} />
        ))
      }
      renderTable={(group) => (
        <SessionTable
          sessions={group.items}
          today={today}
          timeZone={timeZone}
          isAdmin={isAdmin}
          ariaLabel={`Sessions for ${formatDateWithWeekday(group.date)}`}
        />
      )}
    />
  );
}
