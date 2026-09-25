import Link from "next/link";
import { Calendar, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";

/**
 * The row-level "Edit Session" action: the finalized icon-button row action,
 * linking to the existing Edit This Session page (`/attendance/<schedule>/<date>/edit`,
 * `updateClassSession`) for THAT one session - it changes the instructor and/or time
 * of this date only and never the recurring schedule ("Edit Schedule" in the header
 * does that). Offered only while the session is still Upcoming.
 */
function EditSessionAction({ scheduleId, session }) {
  if (!session.editable) return null;
  const label = formatDateWithWeekday(session.date);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-brand hover:bg-brand/10 hover:text-brand"
      aria-label={`Edit session on ${label}`}
      title="Edit Session"
      render={<Link href={`/attendance/${scheduleId}/${session.date}/edit`} />}
      nativeButton={false}
    >
      <Pencil className="size-4" aria-hidden="true" />
    </Button>
  );
}

/**
 * Schedule Details' Upcoming Sessions: every projected future session of this recurring schedule
 * (date, time, and its Edit Session action). Batch and instructor are the schedule's own and
 * already in the header, so they are not repeated per row.
 *
 * Each row is a computed projection, not a stored class_sessions row (04-development-plan.md's
 * Phase 13 definition - no persistence), so there is no status or details link to offer. It
 * displays future occurrences; it does not create, store or modify them.
 */
export default function UpcomingSessionsPanel({ scheduleId, sessions }) {
  return (
    <Panel className="min-w-0">
      <PanelHeader
        icon={Calendar}
        title="Upcoming Sessions"
        description="Future class sessions computed from this recurring schedule."
        className="mb-4 min-h-8"
      />

      {sessions.length === 0 ? (
        <EmptyState
          size="compact"
          title="No upcoming sessions"
          description="This schedule is inactive or its effective period has ended."
        />
      ) : (
        <>
          <Table aria-label="Upcoming sessions">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="w-px whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.date}>
                  <TableCell className="font-medium text-text-primary sm:whitespace-nowrap">
                    {formatDateWithWeekday(session.date)}
                  </TableCell>
                  <TableCell className="text-text-secondary sm:whitespace-nowrap">
                    {formatTimeRange(session.start_time, session.end_time)}
                  </TableCell>
                  <TableCell className="w-px whitespace-nowrap">
                    <EditSessionAction scheduleId={scheduleId} session={session} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-small mt-3 text-text-secondary">
            Showing {sessions.length} upcoming session{sessions.length === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </Panel>
  );
}
