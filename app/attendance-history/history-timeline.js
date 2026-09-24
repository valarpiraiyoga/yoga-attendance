"use client";

import DateGroupTimeline from "@/components/layout/DateGroupTimeline";
import { formatDateWithWeekday } from "@/lib/format";
import HistoryGroupTable from "@/app/attendance-history/history-group-table";
import HistorySessionCard from "@/app/attendance-history/history-session-card";

/**
 * Attendance History results as the shared date timeline
 * (`DateGroupTimeline`): each date opens onto History's own session cards or
 * its Session / Instructor / counts / Attendance table.
 */
export default function HistoryTimeline({ groups, selectedDate, layout = "", variant = "admin" }) {
  return (
    <DateGroupTimeline
      groups={groups.map((group) => ({ date: group.date, items: group.sessions }))}
      selectedDate={selectedDate}
      layout={layout}
      ariaLabel="Attendance history by date"
      renderCards={(group) =>
        group.items.map((session) => <HistorySessionCard key={session.id} session={session} variant={variant} />)
      }
      renderTable={(group) => (
        <HistoryGroupTable
          sessions={group.items}
          variant={variant}
          ariaLabel={`Attendance for ${formatDateWithWeekday(group.date)}`}
        />
      )}
    />
  );
}
