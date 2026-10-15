"use client";

import DateGroupTimeline from "@/components/layout/DateGroupTimeline";
import { formatDateWithWeekday } from "@/lib/format";
import HistoryGroupTable from "@/app/attendance-history/history-group-table";
import HistorySessionCard from "@/app/attendance-history/history-session-card";
import HistoryClassCountSection from "@/app/attendance-history/history-class-count-section";
import { classCountGroupLabel } from "@/lib/class-count-attendance/attendance-rows";

/**
 * Attendance History results as the shared date timeline
 * (`DateGroupTimeline`): each date opens onto History's own session cards or
 * its Session / Instructor / counts / Attendance table.
 *
 * Each group is `{ date, sessions, classCount }` (`mergeHistoryGroups`). The class-count records (Admin only; the list is empty
 * otherwise) are a separate section under that date's sessions, never part of the session cards, rows or counts.
 */
export default function HistoryTimeline({ groups, selectedDate, layout = "", variant = "admin" }) {
  return (
    <DateGroupTimeline
      groups={groups.map((group) => ({
        date: group.date,
        items: group.sessions,
        classCount: group.classCount ?? [],
        extraLabel: classCountGroupLabel(group.classCount?.length ?? 0),
      }))}
      selectedDate={selectedDate}
      layout={layout}
      ariaLabel="Attendance history by date"
      renderCards={(group) => (
        <>
          {group.items.map((session) => (
            <HistorySessionCard key={session.id} session={session} variant={variant} />
          ))}
          {group.classCount.length > 0 ? (
            <div className="md:col-span-2">
              <HistoryClassCountSection records={group.classCount} mode="cards" date={group.date} />
            </div>
          ) : null}
        </>
      )}
      renderTable={(group) => (
        <div className="flex flex-col gap-4">
          {group.items.length > 0 ? (
            <HistoryGroupTable
              sessions={group.items}
              variant={variant}
              ariaLabel={`Attendance for ${formatDateWithWeekday(group.date)}`}
            />
          ) : null}
          {group.classCount.length > 0 ? <HistoryClassCountSection records={group.classCount} mode="table" date={group.date} /> : null}
        </div>
      )}
    />
  );
}
